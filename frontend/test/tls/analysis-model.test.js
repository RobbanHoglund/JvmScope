import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { buildComprehensiveTlsSampleLog } from '../../assets/javautils/tls-sample.js';
import { createTlsFilters, prepareTlsAnalysis, interactionTime, facetKey, selectTlsEntries,
    tlsFacetCounts, tlsTimeDomain, tlsTimelineBins, parseUtcInput, utcInputValue } from '../../assets/javautils/tls-analysis-model.js';

const item = (id, overrides = {}) => ({ id, outcome: 'success', direction: 'outbound', startTs: 100,
    endTs: 200, peerHost: 'api.example.com', sni: 'api.example.com', ...overrides });
const ids = entries => entries.map(entry => entry.interaction.id);

test('real captures with reversed or partially missing clocks remain available without a fabricated span or period', () => {
    const line = (message, clock) => `javax.net.ssl|DEBUG|A|worker|2026-10-02 ${clock}|X.java:1|${message}`;
    for (const [clock, quality] of [['09:59:59.000 UTC', 'reversed'], ['10:00:01.000 CST', 'unavailable']]) {
        const text = [line('Produced ClientHello handshake message', '10:00:00.000 UTC'),
            line('Consuming server Finished handshake message', clock),
            line('Produced client Finished handshake message', '10:00:02.000 UTC')].join('\n');
        const [it] = analyzeTlsLog(text).interactions;
        assert.equal(it.outcome, 'success');
        assert.equal(it.timeQuality, quality);
        assert.equal(it.durationMs, -1);
        assert.equal(interactionTime(it), null);
        assert.equal(it.rawLines.join('\n'), text);
        const entries = prepareTlsAnalysis([it]);
        assert.equal(tlsTimeDomain(entries), null);
        assert.deepEqual(ids(selectTlsEntries(entries, createTlsFilters())), [1]);
        assert.deepEqual(ids(selectTlsEntries(entries, { ...createTlsFilters(), timeMode: 'untimed' })), [1]);
        assert.deepEqual(selectTlsEntries(entries, { ...createTlsFilters(), range: { start: 0, end: Date.parse('2027-01-01Z') } }), []);
    }
});

test('equal future clocks and interleaved independent threads retain reliable per-interaction time', () => {
    const record = (tid, time, message) => `javax.net.ssl|DEBUG|${tid}|worker|2030-01-01 ${time} UTC|X.java:1|${message}`;
    const entries = prepareTlsAnalysis(analyzeTlsLog([
        record('A', '10:00:01.000', 'Produced ClientHello handshake message'),
        record('B', '10:00:00.000', 'Produced ClientHello handshake message'),
        record('A', '10:00:01.000', 'Handshake completed'),
        record('B', '10:00:00.000', 'Handshake completed'),
    ].join('\n')).interactions);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(entry => entry.time && entry.interaction.timeQuality === 'reliable' && entry.interaction.durationMs === 0));
});

test('period selection includes overlapping interactions and treats the upper boundary as exclusive', () => {
    const entries = prepareTlsAnalysis([item(1), item(2, { startTs: 150, endTs: 150 }),
        item(3, { startTs: 180, endTs: 190 }), item(4, { startTs: 0, endTs: 149 }),
        item(5, { startTs: 0, endTs: 150 })]);
    const filters = { ...createTlsFilters(), range: { start: 150, end: 180 } };
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [1, 2, 5]);
    assert.equal(entries[0].interaction.endTs, 200);
});

test('a partial period preserves complete outcomes and raw evidence in the real parser sample', () => {
    const entries = prepareTlsAnalysis(analyzeTlsLog(buildComprehensiveTlsSampleLog()).interactions);
    const selected = selectTlsEntries(entries, { ...createTlsFilters(), range: {
        start: Date.parse('2026-08-31T08:01:08.050Z'), end: Date.parse('2026-08-31T08:01:08.090Z'),
    } });
    assert.deepEqual(ids(selected), [18, 19]);
    assert.deepEqual(selected.map(e => e.interaction.outcome), ['success', 'failure']);
    for (const entry of selected) assert.strictEqual(entry.interaction, entries.find(e => e.interaction.id === entry.interaction.id).interaction);
});

test('missing, reversed, noninteger and invalid dates are unplaced; valid point intervals are retained', () => {
    for (const overrides of [{ startTs: Number.MAX_SAFE_INTEGER, endTs: Number.MIN_SAFE_INTEGER },
        { startTs: null }, { endTs: undefined }, { startTs: -1 }, { startTs: NaN },
        { endTs: Infinity }, { startTs: 1.2 }, { startTs: 201 }, { endTs: 8_640_000_000_000_001 }]) {
        assert.equal(interactionTime(item(1, overrides)), null);
    }
    assert.deepEqual(interactionTime(item(1, { endTs: 100 })), { start: 100, end: 100 });
});

test('untimed interactions stay in the default table and have an explicit selection', () => {
    const entries = prepareTlsAnalysis([item(1), item(2, { startTs: Number.MAX_SAFE_INTEGER, endTs: Number.MIN_SAFE_INTEGER })]);
    const filters = createTlsFilters();
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [1, 2]);
    filters.timeMode = 'untimed';
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [2]);
    filters.timeMode = 'all'; filters.range = { start: 0, end: 201 };
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [1]);
    assert.equal(tlsTimeDomain(entries).start, 100);
});

test('hosts and SNI are OR within a facet and AND across facets, with case-insensitive names and unknowns', () => {
    const entries = prepareTlsAnalysis([item(1), item(2, { peerHost: 'other.example', sni: null }),
        item(3, { peerHost: null, sni: 'api.example.com', clientCertSubjectCn: 'must-not-be-a-host' })]);
    const filters = { ...createTlsFilters(), hosts: [facetKey('API.EXAMPLE.COM'), facetKey(null)] };
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [1, 3]);
    filters.snis = [facetKey(null)];
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), []);
    filters.hosts = [facetKey('other.example')];
    assert.deepEqual(ids(selectTlsEntries(entries, filters)), [2]);
    assert.equal(entries[2].host, 'null');
});

test('facets exclude their own selection but preserve other filters and zero-count alternatives', () => {
    const entries = prepareTlsAnalysis([item(1), item(2, { peerHost: 'b.example', outcome: 'failure', failureReason: 'Received fatal alert: protocol_version' })]);
    const filters = { ...createTlsFilters(), hosts: [facetKey('api.example.com')], outcome: 'failure' };
    assert.equal(selectTlsEntries(entries, filters).length, 0);
    assert.deepEqual(tlsFacetCounts(entries, filters, 'host'), [
        { key: facetKey('b.example'), count: 1 }, { key: facetKey('api.example.com'), count: 0 },
    ]);
    assert.deepEqual(tlsFacetCounts(entries, filters, 'failure'), [{ key: 'protocol_version', count: 0 }]);
});

test('diagnostic groups count failures rather than warning highlights or successful selection messages', () => {
    const entries = prepareTlsAnalysis([item(1, { warnCount: 12 }), item(2, { outcome: 'failure', warnCount: 100, failureReason: 'Received fatal alert: certificate_required' }),
        item(3, { outcome: 'failure', failureReason: 'unrecognized diagnostic' }), item(4, { outcome: 'failure', failureReason: 'Fatal (HANDSHAKE_FAILURE): unspecified' })]);
    assert.equal(entries[0].failure, null);
    const groups = tlsFacetCounts(entries, createTlsFilters(), 'failure');
    assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 3);
    assert.ok(groups.some(group => group.key === 'other'));
    assert.deepEqual(ids(selectTlsEntries(entries, { ...createTlsFilters(), failures: ['certificate_required'] })), [2]);
});

test('histograms count every start once, handle equal times and omit timestamps outside the viewport', () => {
    const entries = prepareTlsAnalysis([item(1, { endTs: 100 }), item(2, { endTs: 100, outcome: 'failure' }),
        item(3, { startTs: 101, endTs: 101, outcome: 'unknown' })]);
    const domain = tlsTimeDomain(entries);
    assert.deepEqual(domain, { start: 100, end: 102 });
    for (const count of [1, 64, 300]) {
        const bins = tlsTimelineBins(entries, domain, count);
        assert.equal(bins.reduce((sum, b) => sum + b.total, 0), 3);
        assert.equal(bins.reduce((sum, b) => sum + b.failure, 0), 1);
        assert.ok(bins.every(bin => bin.start >= domain.start && bin.start < domain.end));
    }
    assert.equal(tlsTimelineBins(entries, { start: 101, end: 102 }).reduce((sum, b) => sum + b.total, 0), 1);
    assert.deepEqual(tlsTimelineBins(entries, { start: 100, end: 100 }), []);
    assert.equal(tlsTimeDomain(prepareTlsAnalysis([item(1, { startTs: -1 })])), null);
});

test('invalid periods do not silently become an unrestricted selection', () => {
    const entries = prepareTlsAnalysis([item(1)]);
    for (const range of [{ start: 200, end: 100 }, { start: 100, end: 100 }, { start: null, end: 200 }, { start: -1, end: 200 }]) {
        assert.deepEqual(selectTlsEntries(entries, { ...createTlsFilters(), range }), []);
    }
});

test('UTC input round trips milliseconds without the browser timezone and rejects normalized invalid dates', () => {
    for (const value of ['2026-08-31T08:01:08.050', '2026-08-31T08:01:08', '2026-08-31T08:01']) {
        const timestamp = parseUtcInput(value);
        assert.equal(timestamp, Date.parse(`${value}Z`));
        assert.ok(utcInputValue(timestamp).startsWith(value));
    }
    for (const value of ['', '2026-02-30T10:00', '2026-13-01T10:00', '2026-01-01T24:01', 'tomorrow', '2026-01-01T10:00Z']) assert.equal(parseUtcInput(value), null);
});

test('all Java runtime fixtures retain every interaction and never put parser sentinel timestamps on the chart', () => {
    const directory = new URL('./fixtures/runtime/', import.meta.url);
    // Use the repository's runtime-capture directory rather than synthetic event counts.
    const files = readdirSync(directory).filter(name => name.endsWith('.txt'));
    assert.equal(files.length, 70);
    let untimed = 0;
    for (const name of files) {
        const interactions = analyzeTlsLog(readFileSync(new URL(name, directory), 'utf8')).interactions;
        const entries = prepareTlsAnalysis(interactions);
        assert.equal(selectTlsEntries(entries, createTlsFilters()).length, interactions.length, name);
        const domain = tlsTimeDomain(entries);
        const timed = entries.filter(entry => entry.time).length;
        untimed += entries.length - timed;
        assert.equal(tlsTimelineBins(entries, domain).reduce((sum, b) => sum + b.total, 0), timed, name);
        assert.equal(tlsFacetCounts(entries, createTlsFilters(), 'failure').reduce((sum, b) => sum + b.count, 0),
            interactions.filter(item => item.outcome === 'failure').length, name);
    }
    assert.ok(untimed > 0);
});

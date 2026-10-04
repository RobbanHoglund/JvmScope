import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { tlsObservedSequence, tlsDiagnosis, tlsCaptureCoverage } from '../../assets/javautils/tls-sequence-model.js';
import { createTlsFilters, prepareTlsAnalysis, selectTlsEntries } from '../../assets/javautils/tls-analysis-model.js';
import { explainIssueText } from '../../assets/javautils/tls-explanations.js';

const line = (msg, tid = 'A', expanded = false) => expanded
    ? `{\n"logger": "javax.net.ssl",\n"thread id": "${tid}",\n"thread name": "worker",\n"time": "2026-10-04 12:00:00.000 UTC",\n"message": "${msg}"\n}`
    : `javax.net.ssl|DEBUG|${tid}|worker|2026-10-04 12:00:00.000 UTC|Handshake.java:1|${msg}`;
const messages = ['Produced ClientHello handshake message', 'Consuming ServerHello handshake message',
    'Produced client Finished handshake message', 'Consuming server Finished handshake message'];
const parse = parts => analyzeTlsLog(parts.join('\n'));

test('two incomplete connections interleaved on one thread cannot borrow each other’s Finished', () => {
    for (const expanded of [false, true]) {
        const [client, server, produced, consumed] = messages.map(m => line(m, 'A', expanded));
        const raw = [client, client, server, server, produced, consumed];
        const result = parse(raw);
        assert.equal(result.status, 'partial');
        assert.match(result.warnings.join(' '), /connection identity is ambiguous/);
        assert.deepEqual(result.interactions.map(i => i.outcome), ['unknown', 'unknown']);
        const it = result.interactions[1];
        assert.equal(it.correlationQuality, 'ambiguous-thread');
        assert.equal(it.sawHandshakeFinished, false);
        assert.equal(it.tlsVersion, null);
        assert.equal(it.clientCertSubject, null);
        assert.equal(it.direction, 'unknown');
        assert.ok(it.warnCount > 0);
        assert.equal(tlsDiagnosis(it), 'Grouping uncertain');
        assert.match(tlsCaptureCoverage(it), /cannot be assigned reliably/);
        assert.equal(tlsObservedSequence(it).length, 5);
        assert.ok(tlsObservedSequence(it).every(event => !event.postHandshake));
        assert.ok(it.rawLines.join('\n').includes(server));
        assert.equal(it.observedRecords.length, 5);
        const visible = selectTlsEntries(prepareTlsAnalysis(result.interactions), { ...createTlsFilters(), outcome: 'success' });
        assert.equal(visible.length, 0);
    }
});

test('complete sequential connections, separate threads and HelloRetryRequest remain attributable', () => {
    const full = messages.map(m => line(m));
    assert.deepEqual(parse([...full, ...full]).interactions.map(i => i.outcome), ['success', 'success']);
    const parallel = messages.flatMap(m => [line(m,'A'), line(m,'B')]);
    assert.deepEqual(parse(parallel).interactions.map(i => i.outcome), ['success', 'success']);
    const retry = parse([full[0], line('Consuming HelloRetryRequest handshake message'), ...full]);
    assert.equal(retry.interactions.length, 1);
    assert.equal(retry.interactions[0].outcome, 'success');
});

test('missing records cannot resolve an unfinished same-thread boundary', () => {
    for (const expanded of [false, true]) {
        for (const finished of [['Produced client Finished', 'Consuming server Finished'],
            ['Produced Finished', 'Consuming Finished']]) {
            const client = line(messages[0], 'A', expanded);
            const end = [messages[1], ...finished.map(m => `${m} handshake message`)].map(m => line(m, 'A', expanded));
            for (const tail of [end, end.slice(1), end.slice(0, 2), [end[0], end[2]]]) {
                const raw = [client, client, ...tail];
                const result = parse(raw);
                assert.equal(result.status, 'partial');
                assert.ok(result.interactions.every(it => it.outcome === 'unknown' && it.correlationQuality === 'ambiguous-thread'));
                assert.equal(result.interactions.flatMap(it => it.rawLines).join('\n'), raw.join('\n'));
                assert.ok(result.interactions.every(it => tlsDiagnosis(it) === 'Grouping uncertain'));
                assert.equal(selectTlsEntries(prepareTlsAnalysis(result.interactions), { ...createTlsFilters(), outcome: 'success' }).length, 0);
            }
        }
    }
});

test('uncertainty persists on the affected thread, but completed failures and other threads stay independent', () => {
    const full = messages.map(m => line(m));
    const uncertain = parse([full[0], ...full, ...full, ...messages.map(m => line(m, 'B'))]);
    assert.deepEqual(uncertain.interactions.map(it => it.outcome), ['unknown', 'unknown', 'unknown', 'success']);
    assert.deepEqual(parse([full[1], ...full]).interactions.map(it => it.outcome), ['unknown', 'unknown']);
    assert.deepEqual(parse([full[0], full[0], line('Received fatal alert: certificate_unknown'), ...full]).interactions.map(it => it.outcome), ['unknown', 'unknown', 'unknown']);
    assert.deepEqual(parse([full[0], line('Received fatal alert: certificate_unknown'), ...full]).interactions.map(it => it.outcome), ['failure', 'success']);
});

test('contradicting Finished roles, duplicates and extra ServerHello cannot establish success', () => {
    const full = messages.map(m => line(m));
    for (const records of [[full[0],full[1],line('Produced server Finished handshake message'),full[3]],
        [...full,full[2]], [...full,full[1]]]) {
        const result = parse(records);
        assert.equal(result.interactions[0].outcome, 'unknown');
        assert.equal(result.interactions[0].correlationQuality, 'ambiguous-thread');
    }
});

test('removing a ServerHello block never proves that reset happened before it', () => {
    const [client, server] = messages.map(m => line(m));
    for (const observation of ['java.net.SocketException: Connection reset', 'java.net.SocketException: Broken pipe',
        'java.io.EOFException: SSL peer shut down incorrectly', 'Connection closed by peer']) {
        for (const hello of [[], [server]]) {
            const it = parse([client,...hello,line(observation)]).interactions[0];
            assert.equal(it.outcome,'failure');
            assert.match(it.failureReason,/phase unknown/);
            assert.doesNotMatch(it.failureReason,/before ServerHello/);
            if (!hello.length) assert.match(it.failureReason,/ServerHello not captured/);
            assert.ok(explainIssueText(it.failureReason), 'General guidance remains reachable');
            assert.equal(tlsDiagnosis(it),it.failureReason);
        }
    }
});

test('post-completion reset stays transport evidence, and explicit fatal client-auth rejection stays failure', () => {
    const full = messages.map(m => line(m));
    assert.equal(parse([...full,line('java.net.SocketException: Connection reset')]).interactions[0].outcome,'success');
    assert.equal(parse([...full,line('Received fatal alert: certificate_required')]).interactions[0].outcome,'failure');
});

const legacyHello = ['*** ClientHello, TLSv1.2', 'worker, WRITE: TLSv1.2 Handshake, length = 123'];
const legacyEnd = ['worker, READ: TLSv1.2 Handshake, length = 456', '*** ServerHello, TLSv1.2',
    'worker, WRITE: TLSv1.2 Change Cipher Spec, length = 1', '*** Finished',
    'worker, READ: TLSv1.2 Handshake, length = 42', '*** Finished'];

test('legacy unfinished boundaries stay unknown with one thread name or missing record markers', () => {
    for (const tail of [legacyEnd, legacyEnd.filter(m => !m.includes('ServerHello')), legacyEnd.slice(0, -1)]) {
        for (const markers of ['all', 'none', 'no-write', 'no-read']) {
            const lines = [...legacyHello, ...legacyHello, ...tail, ...legacyHello, ...legacyEnd]
                .filter(m => markers === 'all' || (markers === 'none' ? !m.includes('worker,')
                    : !m.includes(markers === 'no-write' ? 'WRITE:' : 'READ:')));
            const result = parse(lines);
            assert.equal(result.status, 'partial');
            assert.deepEqual(result.interactions.map(it => it.outcome), ['unknown', 'unknown', 'unknown']);
            assert.match(result.warnings.join(' '), /legacy.*cannot be assigned reliably/);
            const source = lines.join('\n');
            for (const it of result.interactions) {
                assert.equal(it.correlationQuality, 'ambiguous-legacy');
                assert.equal(it.sawHandshakeFinished, false);
                assert.equal(it.direction, 'unknown');
                assert.equal(it.tlsVersion, null);
                assert.equal(tlsDiagnosis(it), 'Grouping uncertain');
                assert.deepEqual(tlsObservedSequence(it), []);
                assert.ok(source.includes(it.rawLines.join('\n')));
                for (const record of it.observedRecords) {
                    assert.deepEqual(it.rawLines.slice(record.rawStart, record.rawEnd), lines.slice(record.sourceStart - 1, record.sourceStart - 1 + record.rawEnd - record.rawStart));
                }
            }
            assert.equal(selectTlsEntries(prepareTlsAnalysis(result.interactions), { ...createTlsFilters(), outcome: 'success' }).length, 0);
        }
    }
});

test('legacy complete and fatally ended handshakes permit a new attributable handshake', () => {
    const full = [...legacyHello, ...legacyEnd];
    assert.deepEqual(parse(full).interactions.map(it => it.outcome), ['success']);
    assert.deepEqual(parse([...full, ...full]).interactions.map(it => it.outcome), ['success', 'success']);
    assert.deepEqual(parse([...legacyHello, 'worker, RECV TLSv1.2 ALERT: fatal, description = certificate_unknown', ...full]).interactions.map(it => it.outcome), ['failure', 'success']);
    assert.deepEqual(parse([...legacyHello, ...legacyHello, 'worker, RECV TLSv1.2 ALERT: fatal, description = certificate_unknown', ...full]).interactions.map(it => it.outcome), ['unknown', 'unknown', 'unknown']);
});

test('a duplicated ClientHello block in a real Java 7 capture cannot borrow completion', () => {
    const lines = readFileSync(new URL('../../../testdata/jvm-samples/gh-37178210582-1-zulu-7-all/tlsv1.2-success-client.txt', import.meta.url), 'utf8').replaceAll('\r\n', '\n').split('\n');
    assert.equal(parse(lines).interactions[0].outcome, 'success');
    const start = lines.findIndex(line => line.startsWith('*** ClientHello,'));
    const end = lines.findIndex((line, index) => index > start && line.includes('WRITE: TLSv1.2 Handshake')) + 1;
    const result = parse([...lines.slice(0, end), ...lines.slice(start, end), ...lines.slice(end)]);
    assert.deepEqual(result.interactions.map(it => it.outcome), ['unknown', 'unknown']);
    assert.ok(result.interactions[1].rawLines.some(line => line === '*** Finished'));
});

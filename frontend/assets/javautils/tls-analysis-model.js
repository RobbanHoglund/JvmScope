import { explainIssueText } from './tls-explanations.js';

// Presentation only. Never shorten the records passed to the TLS parser.
export function createTlsFilters() {
    return { search: '', outcome: 'all', warnings: false, direction: 'all',
        hosts: [], snis: [], failures: [], range: null, timeMode: 'all' };
}

export function interactionTime(interaction) {
    if (interaction.timeQuality && interaction.timeQuality !== 'reliable') return null;
    const valid = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
    const { startTs: start, endTs: end } = interaction;
    // The parser uses MAX_SAFE_INTEGER / MIN_SAFE_INTEGER for missing times.
    if (!valid(start) || !valid(end) || end < start) return null;
    return { start, end };
}

export function facetKey(value) {
    const text = String(value ?? '').trim();
    return JSON.stringify(!text || text === '—' || text.toLowerCase() === 'unknown' ? null : text.toLowerCase());
}

export function facetLabel(key) { return JSON.parse(key) ?? 'Unknown / not captured'; }

const FAILURE_LABELS = {
    'local-fatal': 'Local fatal alert (unspecified)',
    'Received fatal alert:': 'Received fatal alert (unspecified)',
    'PKIX path building failed': 'Certificate trust / PKIX',
    'Certificate name mismatch': 'Certificate name mismatch',
    'other': 'Other / unclassified failure',
    'Connection reset during TLS handshake': 'Connection reset',
    'Broken pipe during TLS handshake': 'Broken pipe',
    'Unexpected EOF during TLS handshake': 'Unexpected EOF',
    'Peer closed connection during TLS handshake': 'Peer closed connection',
};
export function failureLabel(key) { return FAILURE_LABELS[key] ?? key.replaceAll('_', ' '); }

export function prepareTlsAnalysis(interactions) {
    return interactions.map(interaction => ({
        interaction,
        time: interactionTime(interaction),
        host: facetKey(interaction.peerHost),
        sni: facetKey(interaction.sni),
        failure: interaction.outcome === 'failure'
            ? explainIssueText(interaction.failureReason || interaction.outcomeReason)?.key ?? 'other' : null,
        search: [interaction.outcome, interaction.direction, interaction.dir, interaction.tidDisplay,
            interaction.peerHost, interaction.sni, interaction.tlsVersion, interaction.cipherSuite,
            interaction.failureReason, interaction.startTsRaw, interaction.endTsRaw,
            interaction.clientCertSubject, interaction.clientCertSubjectCn,
            interaction.certificateAuthoritiesText, interaction.certificateAuthoritiesRaw]
            .filter(Boolean).join(' | ').toLowerCase(),
    }));
}

export function validRange(range) {
    return range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end)
        && range.start >= 0 && range.end <= 8_640_000_000_000_000 && range.start < range.end;
}

export function selectTlsEntries(entries, filters, omit = []) {
    const ignored = new Set(omit);
    const search = filters.search.trim().toLowerCase();
    return entries.filter(entry => {
        const item = entry.interaction;
        if (!ignored.has('search') && search && !entry.search.includes(search)) return false;
        if (!ignored.has('outcome') && filters.outcome !== 'all' && item.outcome !== filters.outcome) return false;
        if (!ignored.has('warnings') && filters.warnings && !(item.warnCount > 0)) return false;
        if (!ignored.has('direction') && filters.direction !== 'all'
            && String(item.direction || item.dir || '').toLowerCase() !== filters.direction) return false;
        if (!ignored.has('hosts') && filters.hosts.length && !filters.hosts.includes(entry.host)) return false;
        if (!ignored.has('snis') && filters.snis.length && !filters.snis.includes(entry.sni)) return false;
        if (!ignored.has('failures') && filters.failures.length && !filters.failures.includes(entry.failure)) return false;
        if (!ignored.has('timeMode') && filters.timeMode === 'untimed' && entry.time) return false;
        if (!ignored.has('range') && filters.range) {
            // Range is [start, end); the last observed record belongs to the interaction.
            if (!validRange(filters.range) || !entry.time
                || entry.time.start >= filters.range.end || entry.time.end < filters.range.start) return false;
        }
        return true;
    });
}

// Exclude a facet's own selection from its counts; keep zero-count alternatives
// visible so users can recover from an empty intersection without losing choices.
export function tlsFacetCounts(entries, filters, field) {
    const selection = { host: 'hosts', sni: 'snis', failure: 'failures' }[field];
    const counts = new Map(entries.filter(e => e[field] !== null).map(e => [e[field], 0]));
    for (const entry of selectTlsEntries(entries, filters, [selection])) {
        if (entry[field] !== null) counts.set(entry[field], (counts.get(entry[field]) ?? 0) + 1);
    }
    return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) =>
        b.count - a.count || a.key.localeCompare(b.key));
}

export function tlsTimeDomain(entries) {
    let start = Infinity, end = -Infinity;
    for (const { time } of entries) {
        if (!time) continue;
        start = Math.min(start, time.start);
        end = Math.max(end, time.end);
    }
    if (!Number.isFinite(start)) return null;
    // Include the final observed instant, even for a one-record capture.
    return { start, end: Math.min(8_640_000_000_000_000, Math.max(start + 1, end + 1)) };
}

export function tlsTimelineBins(entries, viewport, count = 64) {
    if (!validRange(viewport)) return [];
    const length = Math.max(1, Math.min(200, Math.floor(count) || 1));
    const bins = Array.from({ length }, (_, index) => ({
        start: viewport.start + index * (viewport.end - viewport.start) / length,
        success: 0, failure: 0, unknown: 0, total: 0,
    }));
    for (const entry of entries) {
        if (!entry.time || entry.time.start < viewport.start || entry.time.start >= viewport.end) continue;
        const index = Math.min(bins.length - 1, Math.floor(
            (entry.time.start - viewport.start) / (viewport.end - viewport.start) * bins.length));
        const outcome = ['success', 'failure'].includes(entry.interaction.outcome) ? entry.interaction.outcome : 'unknown';
        bins[index][outcome]++;
        bins[index].total++;
    }
    return bins;
}

export function utcInputValue(timestamp) { return new Date(timestamp).toISOString().slice(0, 23); }
export function parseUtcInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return null;
    const timestamp = Date.parse(`${value}Z`);
    if (!Number.isFinite(timestamp) || timestamp < 0) return null;
    // Date.parse normalizes impossible dates on some engines. Reject them.
    const canonical = utcInputValue(timestamp);
    return canonical.slice(0, value.length) === value ? timestamp : null;
}

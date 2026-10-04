/** Pure deterministic thread-table filtering. This module has no DOM dependencies. */

const STATE_GROUPS = Object.freeze(['BLOCKED', 'WAITING']);
const CHART_FILTER_KINDS = Object.freeze(['state', 'cpu', 'elapsed', 'allocated', 'allocation-rate']);

function normalizedText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function arrayValues(value) {
    return Array.isArray(value) ? value : [];
}

function normalizedStateGroup(value) {
    const state = String(value ?? '').trim().toUpperCase();
    return STATE_GROUPS.includes(state) ? state : null;
}

function normalizeChartFilter(chartFilter) {
    if (!chartFilter || typeof chartFilter !== 'object') return null;
    const kind = normalizedText(chartFilter.kind);
    const value = String(chartFilter.value ?? '').trim();
    if (!kind || !value) return null;
    return {
        kind,
        value: kind === 'state' ? value.toUpperCase() : value,
    };
}

/** Returns a stable canonical filter state suitable for pure matching. */
export function normalizeThreadFilterState(state = {}) {
    const stateGroups = [];
    for (const value of Array.isArray(state?.stateGroups) ? state.stateGroups : []) {
        const group = normalizedStateGroup(value);
        if (group && !stateGroups.includes(group)) stateGroups.push(group);
    }
    stateGroups.sort((left, right) => STATE_GROUPS.indexOf(left) - STATE_GROUPS.indexOf(right));

    return {
        searchTerm: normalizedText(state?.searchTerm),
        onlyDaemon: Boolean(state?.onlyDaemon),
        stateGroups,
        onlyDeadlocked: Boolean(state?.onlyDeadlocked),
        onlyCarrier: Boolean(state?.onlyCarrier),
        chartFilter: normalizeChartFilter(state?.chartFilter),
    };
}

function searchValues(thread) {
    return [
        thread?.threadName,
        thread?.javaState,
        thread?.javaStateDetail,
        thread?.stateText,
        thread?.nid,
        thread?.tid,
        thread?.nativeIdDec,
        thread?.topFrame,
        thread?.scenarioLabel,
        thread?.scenarioReason,
        thread?.scenarioConfidence,
        thread?.scenarioSeverity,
        thread?.scenarioPatternScore,
        ...(thread?.scenarioPatternSignals || []).map((signal) => signal?.label),
        ...(thread?.scenarioMatchedFrames || []),
        thread?.scenarioEvidence?.label,
        thread?.scenarioEvidence?.basis,
        thread?.scenarioEvidence?.qualification,
        ...(thread?.findings || []).flatMap((finding) => [
            finding?.label,
            finding?.reason,
            finding?.evidence?.label,
            finding?.evidence?.basis,
            finding?.evidence?.qualification,
        ]),
        thread?.crossSnapshotDiagnostics?.status,
        thread?.crossSnapshotDiagnostics?.qualification,
        ...(thread?.crossSnapshotDiagnostics?.diagnostics || []).flatMap((diagnostic) => [
            diagnostic?.label,
            diagnostic?.trend,
            diagnostic?.reason,
        ]),
        ...(thread?.crossSnapshotDiagnostics?.rootCauseLinks || []).flatMap((link) => [
            link?.lockId,
            link?.relation,
            link?.reason,
            link?.evidence?.label,
            link?.qualification,
        ]),
        ...arrayValues(thread?.rawBlock),
        ...arrayValues(thread?.stackLines),
        ...arrayValues(thread?.normalizedFrames),
        ...arrayValues(thread?.carrierStackLines),
        ...arrayValues(thread?.mountedVirtualStackLines),
    ].map(normalizedText).filter(Boolean);
}

function matchesStateGroups(thread, stateGroups) {
    if (!stateGroups.length) return true;
    const state = String(thread?.javaState || 'UNKNOWN').toUpperCase();
    return stateGroups.some((group) => group === 'BLOCKED'
        ? state === 'BLOCKED'
        : state === 'WAITING' || state === 'TIMED_WAITING');
}

function matchesMetricBucket(value, bucket, boundaries) {
    if (!Number.isFinite(value)) return false;
    const predicate = boundaries[bucket];
    return typeof predicate === 'function' ? predicate(value) : false;
}

function matchesChartFilter(thread, chartFilter) {
    if (!chartFilter) return true;
    const { kind, value } = chartFilter;
    if (!CHART_FILTER_KINDS.includes(kind)) return false;

    if (kind === 'state') {
        return String(thread?.javaState || 'UNKNOWN').toUpperCase() === value;
    }
    if (kind === 'cpu') {
        return matchesMetricBucket(thread?.cpuMs, value, {
            '0 ms': (metric) => metric === 0,
            '0–1 ms': (metric) => metric > 0 && metric < 1,
            '1–10 ms': (metric) => metric >= 1 && metric < 10,
            '10–100 ms': (metric) => metric >= 10 && metric < 100,
            '100+ ms': (metric) => metric >= 100,
        });
    }
    if (kind === 'elapsed') {
        return matchesMetricBucket(thread?.elapsedS, value, {
            '<1s': (metric) => metric < 1,
            '1–10s': (metric) => metric >= 1 && metric < 10,
            '10–60s': (metric) => metric >= 10 && metric < 60,
            '1–10m': (metric) => metric >= 60 && metric < 600,
            '10m+': (metric) => metric >= 600,
        });
    }
    if (kind === 'allocated') {
        return matchesMetricBucket(thread?.allocatedBytes, value, {
            '0 B': (metric) => metric === 0,
            '1–4 KB': (metric) => metric > 0 && metric < 4096,
            '4–64 KB': (metric) => metric >= 4096 && metric < 65536,
            '64 KB–1 MB': (metric) => metric >= 65536 && metric < 1048576,
            '1–64 MB': (metric) => metric >= 1048576 && metric < 64 * 1048576,
            '64 MB–1 GB': (metric) => metric >= 64 * 1048576 && metric < 1024 * 1048576,
            '1 GB+': (metric) => metric >= 1024 * 1048576,
        });
    }
    return matchesMetricBucket(thread?.allocationRateBytesPerSecond, value, {
        '0 B/s': (metric) => metric === 0,
        '<1 MiB/s': (metric) => metric > 0 && metric < 1048576,
        '1–10 MiB/s': (metric) => metric >= 1048576 && metric < 10 * 1048576,
        '10–64 MiB/s': (metric) => metric >= 10 * 1048576 && metric < 64 * 1048576,
        '64 MiB/s+': (metric) => metric >= 64 * 1048576,
    });
}

/** Tests all active dimensions. State-family controls are OR; dimensions are AND. */
export function threadMatchesFilters(thread, state = {}) {
    const filters = normalizeThreadFilterState(state);
    if (filters.onlyDaemon && !thread?.daemon) return false;
    if (!matchesStateGroups(thread, filters.stateGroups)) return false;
    if (filters.onlyDeadlocked && !thread?.isDeadlocked) return false;
    if (filters.onlyCarrier && !thread?.isCarrierThread) return false;
    if (!matchesChartFilter(thread, filters.chartFilter)) return false;
    if (filters.searchTerm && !searchValues(thread).some((value) => value.includes(filters.searchTerm))) {
        return false;
    }
    return true;
}

/** Returns a new filtered array and optionally intersects a focused index set. */
export function filterThreads(threads, state = {}, focusedThreadIndexes = null) {
    const filters = normalizeThreadFilterState(state);
    const hasFocus = focusedThreadIndexes instanceof Set;
    return (Array.isArray(threads) ? threads : []).filter((thread) =>
        (!hasFocus || focusedThreadIndexes.has(Number(thread?.index)))
        && threadMatchesFilters(thread, filters));
}

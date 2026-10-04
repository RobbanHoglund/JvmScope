function text(value) {
    return String(value ?? '').trim();
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function boundedLimit(value) {
    const limit = Number(value);
    return Number.isInteger(limit) ? Math.min(50, Math.max(1, limit)) : 10;
}

function snapshotLabel(dump, index) {
    return text(dump?.timestamp) || `D${index + 1}`;
}

export function buildSnapshotTickIndexes(snapshotCount, maxTicks = 10) {
    const count = Math.max(0, Math.trunc(Number(snapshotCount) || 0));
    if (!count) return [];

    const limit = Math.max(2, Math.trunc(Number(maxTicks) || 10));
    if (count <= limit) return Array.from({ length: count }, (_, index) => index);

    const indexes = Array.from({ length: limit }, (_, index) =>
        Math.round(index * (count - 1) / (limit - 1)));
    return [...new Set(indexes)];
}

function stackEvidence(thread, limit = 80) {
    const lines = (Array.isArray(thread?.stackLines) ? thread.stackLines : [])
        .map((line) => String(line ?? '').replaceAll('\r', ''))
        .filter((line) => line.trim());
    return {
        stackLines: lines.slice(0, limit),
        omittedStackLineCount: Math.max(0, lines.length - limit),
    };
}

function timelineSeriesSummary(threadSeries, intervalEndIndexes) {
    const occurrences = [...(Array.isArray(threadSeries?.occurrences)
        ? threadSeries.occurrences : [])]
        .filter((occurrence) => occurrence?.thread)
        .sort((left, right) => Number(left.dumpIndex) - Number(right.dumpIndex));
    const measured = occurrences.filter((occurrence) =>
        intervalEndIndexes.has(Number(occurrence.dumpIndex))
        && occurrence.thread?.cpuDeltaStatus === 'computed'
        && finiteNumber(occurrence.thread?.cpuRatePercent) != null);
    if (!measured.length) return null;

    const latest = occurrences.at(-1)?.thread;
    const name = text(latest?.threadName) || 'Unknown thread';
    const rates = measured.map((occurrence) => finiteNumber(occurrence.thread.cpuRatePercent));
    const maximumRatePercent = Math.max(...rates);
    const averageRatePercent = rates.reduce((total, rate) => total + rate, 0) / rates.length;

    return {
        seriesKey: text(threadSeries?.seriesKey),
        name,
        measured,
        sampleCount: measured.length,
        maximumRatePercent,
        averageRatePercent,
    };
}

function enrichTimelineSeries(summary) {
    const points = summary.measured.map((occurrence) => {
        const thread = occurrence.thread;
        return {
            dumpIndex: Number(occurrence.dumpIndex),
            sourceKey: text(occurrence.sourceKey || thread?.sourceKey),
            threadName: text(thread?.threadName) || summary.name,
            ratePercent: finiteNumber(thread.cpuRatePercent),
            deltaMs: finiteNumber(thread.cpuDeltaMs),
            intervalMs: finiteNumber(thread.cpuIntervalMs),
            rateBasis: text(thread.cpuRateBasis),
            intervalReason: text(thread.cpuIntervalReason),
            state: text(thread.javaState) || 'UNKNOWN',
            topFrame: text(thread.topFrame),
            nativeId: text(thread.nid || thread.nativeIdDec),
            ...stackEvidence(thread),
        };
    });

    return {
        seriesKey: summary.seriesKey,
        name: summary.name,
        points,
        sampleCount: summary.sampleCount,
        maximumRatePercent: summary.maximumRatePercent,
        averageRatePercent: summary.averageRatePercent,
    };
}

export function buildCpuTimelineModel({
    dumps = [],
    series = [],
    query = '',
    limit = 10,
    selectedSeriesKey = '',
} = {}) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const normalizedQuery = text(query).toLowerCase();
    const normalizedSeriesKey = text(selectedSeriesKey);
    const snapshots = normalizedDumps.map((dump, index) => ({
        dumpIndex: Number.isInteger(Number(dump?.index)) ? Number(dump.index) : index,
        shortLabel: `D${index + 1}`,
        label: snapshotLabel(dump, index),
    }));
    const intervals = snapshots.slice(1).map((snapshot, index) => ({
        dumpIndex: snapshot.dumpIndex,
        startDumpIndex: snapshots[index].dumpIndex,
        shortLabel: `${snapshots[index].shortLabel}→${snapshot.shortLabel}`,
    }));
    const intervalEndIndexes = new Set(intervals.map(interval => interval.dumpIndex));
    const availableSeries = (Array.isArray(series) ? series : [])
        .map(item => timelineSeriesSummary(item, intervalEndIndexes))
        .filter(Boolean);
    const measuredSeriesCount = availableSeries.length;
    const matchingSeries = availableSeries
        .filter((item) => !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery))
        .sort((left, right) =>
            right.maximumRatePercent - left.maximumRatePercent
            || right.averageRatePercent - left.averageRatePercent
            || left.name.localeCompare(right.name));
    const visibleSeries = matchingSeries
        .slice(0, boundedLimit(limit))
        .map(enrichTimelineSeries);

    return {
        snapshots,
        intervals,
        series: visibleSeries,
        measuredSeriesCount,
        availableSeriesCount: matchingSeries.length,
        visibleSeriesCount: visibleSeries.length,
        maximumRatePercent: visibleSeries.length
            ? Math.max(...visibleSeries.map((item) => item.maximumRatePercent))
            : null,
        query: text(query),
        limit: boundedLimit(limit),
        selectedSeriesKey: visibleSeries.some(item => item.seriesKey === normalizedSeriesKey) ? normalizedSeriesKey : '',
    };
}

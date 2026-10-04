import { canCompareThreadCollections } from './snapshot-quality.js';

/** Partial counts are lower bounds. Keep observations without inventing absence. */
export function buildClusterTimeline(clusterLike, dumpCount, dumps) {
    const counts = new Map((clusterLike?.perDump || []).map(item => [item.dumpIndex, item.count]));
    const baseline = dumps?.[0];
    const processes = new Set((dumps || []).map(dump => dump?.processId).filter(Boolean));
    const scopes = new Set((dumps || []).map(dump => dump?.collectionScope).filter(Boolean));
    const sameCollection = processes.size <= 1 && scopes.size <= 1;
    return Array.from({ length: dumpCount }, (_, dumpIndex) => {
        const snapshot = dumps?.[dumpIndex];
        const complete = canCompareThreadCollections(snapshot, snapshot);
        const rawCount = counts.has(dumpIndex) ? counts.get(dumpIndex) : 0;
        const observedCount = Number.isInteger(rawCount) && rawCount >= 0 ? rawCount : null;
        return {
            dumpIndex,
            count: complete ? observedCount : null,
            observedCount,
            comparable: sameCollection && canCompareThreadCollections(baseline, snapshot)
                && (dumpIndex === 0 || canCompareThreadCollections(dumps?.[dumpIndex - 1], snapshot)),
            timestamp: snapshot?.timestamp || `Dump ${dumpIndex + 1}`,
        };
    });
}

export function classifyClusterTrend(timeline) {
    if (!timeline?.length) return 'None';
    if (timeline.some(item => !item.comparable || !Number.isFinite(item.count) || item.count < 0)) {
        return 'Unavailable';
    }
    const counts = timeline.map(item => item.count);
    const nonZeroIndexes = counts.map((count, index) => count > 0 ? index : -1).filter(index => index >= 0);
    if (!nonZeroIndexes.length) return 'None';
    if (nonZeroIndexes.length === counts.length) {
        if (counts.at(-1) > counts[0]) return 'Growing';
        if (counts.at(-1) < counts[0]) return 'Fading';
        return 'Persistent';
    }
    if (nonZeroIndexes.length <= 2) return 'Bursty';
    const first = nonZeroIndexes[0];
    const last = nonZeroIndexes.at(-1);
    if (counts.slice(first, last + 1).some(count => count === 0)) return 'Intermittent';
    if (counts[last] > counts[first]) return 'Growing';
    if (counts[last] < counts[first]) return 'Fading';
    return 'Stable';
}

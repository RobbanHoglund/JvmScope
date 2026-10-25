import { ALLOCATION_RATE_THRESHOLDS, getRunnableCpuThresholdProfile } from '../../../frontend/assets/javautils/tda/classification.js';

const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function sourceEvidence(dump, thread, source) {
    const range = Number.isInteger(thread?.rawStartLine) && thread.rawStartLine > 0
        && Number.isInteger(thread.rawEndLine) && thread.rawEndLine >= thread.rawStartLine
        ? { startLine: dump.sourceStartLine + thread.rawStartLine - 1, endLine: dump.sourceStartLine + thread.rawEndLine - 1 } : null;
    return { snapshotIndex: dump.index, snapshotNumber: dump.index + 1, sourceKey: thread?.sourceKey || null,
        threadName: thread?.threadName || null, path: source.path, name: source.name, sha256: source.sha256, range };
}
export function threadMeasurements(dump, previous, captures) {
    const source = captures[Number(dump.sourceId.split(':')[1])];
    const previousThreads = new Map((previous?.threads || []).map(t => [t.sourceKey, t]));
    const rows = dump.threads.map(t => {
        const before = t.seriesMatchStatus === 'matched' ? previousThreads.get(t.previousSourceKey) : null;
        const cpuValid = before && t.cpuDeltaStatus === 'computed' && finite(t.cpuRatePercent);
        const allocationValid = before && ['computed', 'bounded'].includes(t.allocationDeltaStatus);
        const bounds = allocationValid && finite(t.allocationRateBounds?.minimum) && finite(t.allocationRateBounds?.maximum)
            ? { ...t.allocationRateBounds } : null;
        const exact = allocationValid && finite(t.allocationRateBytesPerSecond) ? t.allocationRateBytesPerSecond : null;
        return { sourceKey: t.sourceKey, seriesKey: t.seriesKey || t.sourceKey, name: t.threadName,
            state: t.javaState, identityStatus: t.seriesMatchStatus,
            current: sourceEvidence(dump, t, source),
            baseline: before ? sourceEvidence(previous, before, captures[Number(previous.sourceId.split(':')[1])]) : null,
            cpu: { status: t.cpuDeltaStatus || 'unavailable', percent: cpuValid ? t.cpuRatePercent : null,
                intervalMs: cpuValid ? t.cpuIntervalMs : null, uncertaintyMs: cpuValid ? t.cpuIntervalUncertaintyMs : null,
                quality: t.cpuIntervalQuality, reason: t.cpuIntervalReason },
            allocation: { status: t.allocationDeltaStatus || 'unavailable', bytesPerSecond: exact,
                boundsBytesPerSecond: bounds, intervalMs: allocationValid ? t.allocationIntervalMs : null,
                quality: t.allocationIntervalQuality, reason: t.allocationIntervalReason } };
    });
    // Retain both CPU and allocation leaders; never let one metric hide the other.
    const cpu = [...rows].sort((a, b) => (b.cpu.percent ?? -1) - (a.cpu.percent ?? -1)).slice(0, 20);
    const allocation = [...rows].sort((a, b) => allocationCeiling(b) - allocationCeiling(a)).slice(0, 20);
    const selected = [...new Map([...cpu, ...allocation].map(r => [r.sourceKey, r])).values()];
    const findingCount = id => dump.smartAnalysis.findings.find(f => f.id === id)?.threads?.length || 0;
    return { baselineSnapshotIndex: previous?.index ?? null, endSnapshotIndex: dump.index,
        thresholds: { cpuPercent: getRunnableCpuThresholdProfile('balanced').thresholds.applicationFindingPercent,
            allocationBytesPerSecond: ALLOCATION_RATE_THRESHOLDS.findingBytesPerSecond, scope: 'JvmScope review thresholds, not JVM limits' },
        hotCpuThreads: findingCount('cpu-hot'), hotAllocationThreads: findingCount('allocation-hot'),
        threads: { total: rows.length, shown: selected.length, omitted: rows.length - selected.length,
            selection: 'Union of the top 20 CPU and top 20 allocation rates; missing rates are unavailable, never zero.', items: selected },
        qualifications: ['CPU percentages are per thread relative to one logical CPU; they are not machine-wide utilization.',
            'Preserve allocation lower and upper bounds. Rounded counters do not justify an exact rate or a zero delta.',
            'Allocation throughput is not retained heap and cannot establish a memory leak.',
            'Identity and interval validity come from the shared analyzer. Missing rates must not be reconstructed from names.'] };
}
const allocationCeiling = row => row.allocation.boundsBytesPerSecond?.maximum ?? row.allocation.bytesPerSecond ?? -1;

// The interactive report retains its wider row set in UI metadata. Keep the model's
// follow-up payload focused, while disclosing the omitted rows and exact bounds.
export function comparisonSummary(snapshot) {
    const m = snapshot.measurements, rows = m.threads.items;
    const cpu = [...rows].sort((a, b) => (b.cpu.percent ?? -1) - (a.cpu.percent ?? -1)).slice(0, 8);
    const allocation = [...rows].sort((a, b) => allocationCeiling(b) - allocationCeiling(a)).slice(0, 8);
    const selected = m.baselineSnapshotIndex == null ? [] : [...new Map([...cpu, ...allocation].map(r => [r.sourceKey, r])).values()];
    const endpoint = e => e ? { snapshotIndex: e.snapshotIndex, snapshotNumber: e.snapshotNumber, sourceKey: e.sourceKey, range: e.range } : null;
    return { index: snapshot.index, measurements: { baselineSnapshotIndex: m.baselineSnapshotIndex,
        endSnapshotIndex: m.endSnapshotIndex, thresholds: m.thresholds, hotCpuThreads: m.hotCpuThreads, hotAllocationThreads: m.hotAllocationThreads,
        threads: { total: m.threads.total, shown: selected.length, omitted: m.threads.total - selected.length,
            selection: 'Union of top 8 CPU and allocation rows; the interactive report retains more rows.',
            items: selected.map(r => ({ sourceKey: r.sourceKey, seriesKey: r.seriesKey, name: r.name, state: r.state,
                baseline: endpoint(r.baseline), current: endpoint(r.current),
                cpu: { percent: r.cpu.percent, intervalMs: r.cpu.intervalMs, uncertaintyMs: r.cpu.uncertaintyMs,
                    quality: r.cpu.quality, status: r.cpu.status },
                allocation: { bytesPerSecond: r.allocation.bytesPerSecond, boundsBytesPerSecond: r.allocation.boundsBytesPerSecond,
                    intervalMs: r.allocation.intervalMs, quality: r.allocation.quality, status: r.allocation.status } })) },
        qualifications: m.qualifications } };
}

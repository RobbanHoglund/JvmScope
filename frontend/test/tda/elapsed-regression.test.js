import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';
import { threadComparisonInterval, threadElapsedComparison } from '../../assets/javautils/tda/time-quality.js';
import { buildCpuTimelineModel } from '../../assets/javautils/tda/cpu-timeline.js';
import { buildThreadDetailsViewModel } from '../../assets/javautils/tda/thread-modal.js';
import { evaluateMeasuredCpu, evaluateAllocationRate } from '../../assets/javautils/tda/classification.js';
import { elapsedSnapshot, elapsedRegressionSnapshots } from './elapsed-regression-fixture.js';

function assertNoComparison(thread) {
    assert.equal(thread.cpuDeltaMs, null);
    assert.equal(thread.allocatedDeltaBytes, null);
    assert.equal(thread.cpuRatePercent, null);
    assert.equal(thread.allocationRateBytesPerSecond, null);
    assert.equal(thread.cpuDeltaStatus, 'elapsed-counter-regressed');
    assert.match(thread.cpuIntervalReason, /continuity is uncertain/);
    assert.equal(evaluateMeasuredCpu(thread).available, false);
    assert.equal(evaluateAllocationRate(thread).available, false);
}

test('elapsed regression breaks continuity through parsing, separate files, diagnostics, history and measured charts', () => {
    for (const input of [elapsedRegressionSnapshots.join('\n'), elapsedRegressionSnapshots.map(text => ({ text }))]) {
        const result = analyzeThreadDumpData(input);
        const previous = result.parsedDumps[0].threads[0];
        const current = result.parsedDumps[1].threads[0];
        assert.notEqual(current.seriesKey, previous.seriesKey);
        assert.equal(current.seriesMatchReason, 'elapsed-counter-regressed');
        assert.equal(current.seriesMatchStatus, 'ambiguous');
        assert.equal(current.seriesMatchConfidence, 'none');
        assert.equal(current.previousSourceKey, null);
        assertNoComparison(current);
        assert.deepEqual(current.snapshotChange.changes, []);
        assert.equal(current.snapshotChange.status, 'unresolved');
        assert.equal(result.parsedDumps[1].threadChanges.endedCount, null);
        assert.equal(current.crossSnapshotDiagnostics.status, 'identity-unavailable');
        assert.deepEqual(result.threadSeries.map(s => s.occurrences.length), [1, 1]);
        assert.ok(result.threadSeries.every(s => s.averageCpuRatePercent == null && s.averageAllocationRateBytesPerSecond == null));
        const model = buildCpuTimelineModel({ dumps: result.parsedDumps, series: result.threadSeries });
        assert.equal(model.measuredSeriesCount, 0);
        assert.equal(model.maximumRatePercent, null);
        const details = buildThreadDetailsViewModel(current);
        assert.match(details.cpuComparison.reason, /elapsed counter decreased/);
        assert.equal(details.coreFacts.find(f => f.label === 'CPU rate').value, '—');
        assert.equal(details.coreFacts.find(f => f.label === 'Allocation rate').value, '—');
    }
});

test('known process identity cannot override elapsed regression; later snapshots continue only the new series', () => {
    const dumps = analyzeThreadDumpData([...elapsedRegressionSnapshots, elapsedSnapshot(2, 900, '2.000', 1000100)].join('\n')).parsedDumps;
    dumps.forEach(dump => dump.processId = '1234');
    const correlated = correlateThreadsAcrossSnapshots(dumps);
    annotateCpuRates(correlated.dumps, correlated.series);
    assertNoComparison(dumps[1].threads[0]);
    assert.notEqual(dumps[0].threads[0].seriesKey, dumps[1].threads[0].seriesKey);
    assert.equal(dumps[1].threads[0].seriesKey, dumps[2].threads[0].seriesKey);
    assert.equal(dumps[2].threads[0].cpuRatePercent, 10);
    assert.equal(dumps[2].threads[0].allocationRateBytesPerSecond, 100);
});

test('temporal analysis also rejects elapsed regression in already correlated external data', () => {
    const dumps = analyzeThreadDumpData(elapsedRegressionSnapshots.join('\n')).parsedDumps;
    const [first, last] = dumps.map(d => d.threads[0]);
    last.seriesMatchStatus = 'matched';
    last.previousSourceKey = first.sourceKey;
    const series = [{ occurrences: dumps.map((d, index) => ({ dumpIndex: index, sourceKey: d.threads[0].sourceKey, thread: d.threads[0] })) }];
    annotateCpuRates(dumps, series);
    assertNoComparison(last);
    assert.equal(series[0].totalCpuDeltaMs, null);
    assert.equal(series[0].totalAllocatedDeltaBytes, null);
});

test('missing, equal and resolution-limited elapsed values preserve legitimate wall-clock fallback', () => {
    for (const values of [[null, null], [null, '101.000'], ['100.000', null], ['100.000', '100.000'], ['100.000', '101.000']]) {
        const result = analyzeThreadDumpData([elapsedSnapshot(0, 100, values[0]), elapsedSnapshot(1, 800, values[1], 1000000)].join('\n'));
        const current = result.parsedDumps[1].threads[0];
        assert.equal(current.seriesMatchConfidence, 'exact');
        assert.equal(current.cpuIntervalQuality, 'reliable');
        assert.equal(current.cpuRatePercent, 70);
        assert.equal(current.allocationRateBytesPerSecond, 999000);
    }
    const previous = { elapsedS: 100, elapsedResolutionMs: 1000 };
    assert.equal(threadElapsedComparison(previous, { elapsedS: 99.5, elapsedResolutionMs: 1000 }).status, 'rounded');
    assert.equal(threadElapsedComparison(previous, { elapsedS: 98.5, elapsedResolutionMs: 1000 }).status, 'regressed');
    const interval = threadComparisonInterval({ timestampRaw: '2026-10-04T12:00:00.000Z' }, { timestampRaw: '2026-10-04T12:00:01.000Z' }, previous, { elapsedS: 1 });
    assert.equal(interval.continuity, 'conflicting');
    assert.equal(interval.intervalMs, null);
});

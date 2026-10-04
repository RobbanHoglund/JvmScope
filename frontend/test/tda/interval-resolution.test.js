import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { evaluateMeasuredCpu, evaluateAllocationRate } from '../../assets/javautils/tda/classification.js';
import { parseSnapshotTimestamp, threadComparisonInterval } from '../../assets/javautils/tda/time-quality.js';
import { annotateThreadChanges } from '../../assets/javautils/tda/changes.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { buildThreadDetailsViewModel } from '../../assets/javautils/tda/thread-modal.js';

test('preserves printed timestamp precision, capped at the JS millisecond clock', () => {
    for (const [suffix, resolution] of [['', 1000], ['.1', 100], ['.12', 10], ['.123', 1], ['.123456', 1]]) {
        assert.equal(parseSnapshotTimestamp(`2026-10-04T12:00:00${suffix}Z`).resolutionMs, resolution);
    }
});

test('selects finer compatible intervals without treating rounded clocks as exact', () => {
    const d = time => ({ timestampRaw: `2026-10-04T12:00:${time}Z` });
    const p = { elapsedS: 0.56, elapsedResolutionMs: 10 };
    const c = { elapsedS: 2.12, elapsedResolutionMs: 10 };
    const interval = threadComparisonInterval(d('00'), d('01'), p, c);
    assert.equal(interval.basis, 'thread-elapsed');
    assert.ok(Math.abs(interval.intervalMs - 1560) < 0.001);
    assert.equal(interval.uncertaintyMs, 10);
    assert.equal(interval.quality, 'reliable');
    assert.equal(threadComparisonInterval(d('00.000'), d('01.560'), p, c).basis, 'snapshot-time');
    assert.equal(threadComparisonInterval(d('00.000'), d('03.000'), p, c).quality, 'conflicting');
    assert.equal(threadComparisonInterval(d('00'), d('00'), p, c).basis, 'thread-elapsed');
    assert.equal(threadComparisonInterval(d('01'), d('00'), p, c).basis, 'thread-elapsed');
    assert.equal(threadComparisonInterval(d('00'), d('01'), {}, {}).quality, 'estimated');
});

test('real Corretto 25 short-interval captures no longer report 121.876 percent from a one-second clock', () => {
    const provenance = JSON.parse(readFileSync(new URL('fixtures/cpu-precision-provenance.json', import.meta.url), 'utf8'));
    for (const [file, hash] of [[provenance.source, provenance.sourceSha256], [provenance.capture, provenance.captureSha256]]) {
        assert.equal(createHash('sha256').update(readFileSync(new URL(`fixtures/${file}`, import.meta.url))).digest('hex'), hash);
    }
    const text = readFileSync(new URL('fixtures/cpu-precision-sequence.txt', import.meta.url), 'utf8');
    const analysis = analyzeThreadDumpData(text);
    assert.equal(analysis.parserResult.status, 'success');
    const hot = analysis.parsedDumps.map(d => d.threads.find(t => t.threadName === 'audit-cpu-worker'));
    assert.equal(hot.length, 2);
    assert.equal(hot[1].seriesMatchStatus, 'matched');
    assert.equal(hot[1].cpuRateBasis, 'thread-elapsed');
    assert.equal(hot[1].elapsedResolutionMs, 10);
    assert.ok(Math.abs(hot[1].cpuRatePercent - 73.419277) < 0.000001);
    assert.ok(Math.abs(hot[1].cpuDeltaMs - 1218.76) < 0.001);
    assert.match(hot[1].cpuIntervalReason, /Approximate/);
});

test('coarse estimates stay visible but cannot establish CPU or allocation heat', () => {
    const thread = { cpuDeltaStatus: 'computed', cpuRatePercent: 156, cpuIntervalMs: 1000,
        cpuIntervalQuality: 'estimated', allocationDeltaStatus: 'computed',
        allocationRateBytesPerSecond: 1e9, allocationIntervalMs: 1000, allocationIntervalQuality: 'estimated' };
    assert.equal(evaluateMeasuredCpu(thread).status, 'interval-imprecise');
    assert.equal(evaluateAllocationRate(thread).status, 'interval-imprecise');
    const previous = { sourceKey: 'first', seriesKey: 'worker', heldLocks: [], waitingLocks: [] };
    const current = { ...previous, ...thread, sourceKey: 'second', previousSourceKey: 'first', seriesMatchStatus: 'matched' };
    annotateThreadChanges([{ index: 0, threads: [previous] }, { index: 1, threads: [current] }], []);
    assert.deepEqual(current.snapshotChange.changes, []);
    assert.match(buildThreadDetailsViewModel(current).coreFacts.find(fact => fact.label === 'Allocation rate').value, /^≈ /);
    assert.equal(buildThreadDependencyGraph([current]).threadNodes[0].cpuIntervalQuality, 'estimated');
});

test('collector clock precision does not imply atomic JVM sampling precision', () => {
    const dump = (iso, jvm) => ({timestampRaw:iso, timestampSource:'collector', jvmTimestampRaw:jvm});
    const interval = threadComparisonInterval(
        dump('2026-10-04T12:00:00.000Z','2026-10-04 14:00:00'),
        dump('2026-10-04T12:00:01.318Z','2026-10-04 14:00:01'),
        {elapsedS:1.25,elapsedResolutionMs:10}, {elapsedS:2.61,elapsedResolutionMs:10});
    assert.equal(interval.basis,'thread-elapsed');
    assert.equal(interval.quality,'reliable');
    assert.ok(Math.abs(interval.intervalMs-1360)<0.001);
});

test('an interval conflict retains deltas and prevents both normalized rates', () => {
    const dump = (timestamp, cpu, elapsed, allocated) => `${timestamp}\nFull thread dump OpenJDK 64-Bit Server VM:\n\n"worker" #11 [101] prio=5 os_prio=0 cpu=${cpu}ms elapsed=${elapsed}s allocated=${allocated}KB tid=0x11 nid=0x65 runnable [0x1100]\n   java.lang.Thread.State: RUNNABLE\n    at example.Work.run(Work.java:1)\n\nJNI global refs: 1\n`;
    const a = analyzeThreadDumpData(dump('2026-10-04 12:00:00', 10, '1.00', 1) + dump('2026-10-04 12:00:01', 20, '20.00', 2));
    const t = a.parsedDumps[1].threads[0];
    assert.equal(t.cpuDeltaStatus, 'interval-conflict');
    assert.equal(t.cpuDeltaMs, 10);
    assert.equal(t.cpuRatePercent, null);
    assert.equal(t.allocatedDeltaBytes, 1024);
    assert.equal(t.allocationDeltaStatus, 'interval-conflict');
    assert.equal(t.allocationRateBytesPerSecond, null);
});

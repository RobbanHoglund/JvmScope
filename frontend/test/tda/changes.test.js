import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { annotateThreadChanges } from '../../assets/javautils/tda/changes.js';
import { getRunnableCpuThresholdProfile } from '../../assets/javautils/tda/classification.js';
import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { parseThreadDump, splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';

const fixture = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

async function temporalFixture(name) {
    const snapshots = splitThreadDumpSnapshots(await fixture(name));
    const dumps = snapshots.map((snapshot) => ({
        ...snapshot,
        threads: parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index }),
    }));
    const correlation = correlateThreadsAcrossSnapshots(dumps);
    return annotateCpuRates(correlation.dumps, correlation.series);
}

test('labels baseline, continued, new, and ended threads conservatively', async () => {
    const temporal = await temporalFixture('cross-snapshot-identity.txt');

    const result = annotateThreadChanges(temporal.dumps, temporal.series);
    const firstStable = result.dumps[0].threads.find((thread) => thread.threadName === 'stable-worker');
    const secondStable = result.dumps[1].threads.find((thread) => thread.threadName === 'stable-worker');
    const secondPooled = result.dumps[1].threads.find((thread) => thread.threadName === 'pooled-worker');

    assert.equal(firstStable.snapshotChange.status, 'baseline');
    assert.equal(secondStable.snapshotChange.status, 'continued');
    assert.equal(secondStable.snapshotChange.previousSourceKey, firstStable.sourceKey);
    assert.deepEqual(secondStable.snapshotChange.changes, []);
    assert.equal(secondPooled.snapshotChange.status, 'new');
    assert.equal(result.dumps[1].threadChanges.newCount, 1);
    assert.equal(result.dumps[1].threadChanges.endedCount, 1);
    assert.equal(result.dumps[1].threadChanges.continuedCount, 1);
    assert.equal(result.dumps[1].threadChanges.changedCount, 0);
    assert.equal(result.dumps[1].threadChanges.endedThreads[0].threadName, 'pooled-worker');
    const endedSeries = result.series.find((series) => series.seriesKey === result.dumps[0].threads[1].seriesKey);
    assert.deepEqual(endedSeries.endedAfterDumpIndexes, [0]);
});

test('reports all material changes for an exact continued thread', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:1', threadName: 'worker',
        javaState: 'RUNNABLE', topFrame: 'example.Work.run(Work.java:10)', isDeadlocked: false,
        heldLocks: [{ lockId: '0xa', lockType: 'a example.First', semantic: 'monitor' }],
        waitingLocks: [], cpuMs: 10, allocatedBytes: 1024,
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:1', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', threadName: 'renamed-worker', javaState: 'BLOCKED',
        topFrame: 'example.Other.run(Other.java:20)', isDeadlocked: true,
        heldLocks: [{ lockId: '0xb', lockType: 'a example.Second', semantic: 'monitor' }],
        waitingLocks: [{ lockId: '0xc', lockType: 'a example.Third', semantic: 'monitor-enter' }],
        cpuMs: 40, cpuDeltaMs: 30, cpuIntervalMs: 1000, cpuRatePercent: 3,
        cpuDeltaStatus: 'computed',
        allocatedBytes: 2 * 1024 ** 2, allocatedDeltaBytes: 2 * 1024 ** 2 - 1024,
        allocationIntervalMs: 1000, allocationRateBytesPerSecond: 2 * 1024 ** 2 - 1024,
        allocationDeltaStatus: 'computed',
    };
    const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }];
    const series = [{
        seriesKey: 'series:1',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    const result = annotateThreadChanges(dumps, series);

    assert.equal(current.snapshotChange.status, 'continued');
    assert.deepEqual(current.snapshotChange.changes.map((change) => change.type), [
        'name',
        'state',
        'top-frame',
        'held-locks',
        'waiting-locks',
        'deadlock',
        'cpu-activity',
        'allocation-activity',
    ]);
    assert.equal(current.snapshotChange.previousState, 'RUNNABLE');
    assert.equal(current.snapshotChange.previousTopFrame, 'example.Work.run(Work.java:10)');
    assert.equal(current.snapshotChange.previousAllocatedBytes, 1024);
    assert.equal(result.dumps[1].threadChanges.changedCount, 1);
    assert.equal(result.diagnostics.materialChanges, 8);
    assert.equal(result.series[0].continuedOccurrences, 1);
    assert.equal(result.series[0].changedOccurrences, 1);
    assert.equal(result.series[0].materialChanges, 8);
});

test('uses the selected CPU profile for material CPU activity changes', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:1', threadName: 'worker',
        javaState: 'RUNNABLE', topFrame: 'example.Work.run(Work.java:10)',
        heldLocks: [], waitingLocks: [], cpuMs: 10,
    };
    const current = {
        ...previous,
        sourceKey: 'snapshot:1:tid:0x1', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 40, cpuDeltaMs: 30,
        cpuIntervalMs: 1000, cpuRatePercent: 3, cpuDeltaStatus: 'computed',
    };
    const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }];
    const series = [{
        seriesKey: 'series:1',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];
    const highThroughput = getRunnableCpuThresholdProfile('high-throughput');

    annotateThreadChanges(dumps, series, { cpuThresholds: highThroughput.thresholds });

    assert.deepEqual(current.snapshotChange.changes, []);
});

test('suppresses material allocation activity for low, short, or reset samples', () => {
    const samples = [
        { status: 'computed', intervalMs: 1000, rate: 1024 ** 2 - 1 },
        { status: 'computed', intervalMs: 999, rate: 64 * 1024 ** 2 },
        { status: 'counter-reset', intervalMs: 1000, rate: 64 * 1024 ** 2 },
    ];

    for (const [index, sample] of samples.entries()) {
        const previous = {
            sourceKey: `snapshot:0:tid:0x${index}`, seriesKey: `series:${index}`,
            threadName: 'worker', javaState: 'RUNNABLE', topFrame: 'example.Work.run(Work.java:10)',
            heldLocks: [], waitingLocks: [], allocatedBytes: 1024,
        };
        const current = {
            ...previous,
            sourceKey: `snapshot:1:tid:0x${index}`, previousSourceKey: previous.sourceKey,
            seriesMatchStatus: 'matched', allocatedBytes: 2048, allocatedDeltaBytes: 1024,
            allocationDeltaStatus: sample.status, allocationIntervalMs: sample.intervalMs,
            allocationRateBytesPerSecond: sample.rate,
        };
        const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }];
        const series = [{
            seriesKey: previous.seriesKey,
            occurrences: [
                { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
                { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
            ],
        }];

        annotateThreadChanges(dumps, series);

        assert.deepEqual(current.snapshotChange.changes, []);
    }
});

test('ignores volatile line-number-only top-frame differences', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:1', threadName: 'worker',
        javaState: 'RUNNABLE', topFrame: 'example.Work.run(Work.java:10)', heldLocks: [], waitingLocks: [],
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:1', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', threadName: 'worker', javaState: 'RUNNABLE',
        topFrame: 'example.Work.run(Work.java:99)', heldLocks: [], waitingLocks: [],
    };
    const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }];
    const series = [{
        seriesKey: 'series:1',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    annotateThreadChanges(dumps, series);

    assert.deepEqual(current.snapshotChange.changes, []);
});

test('marks ambiguous identity unresolved and suppresses unreliable ended claims', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:old', threadName: 'worker',
    };
    const ambiguous = {
        sourceKey: 'snapshot:1:tid:0x2', seriesKey: 'series:new', threadName: 'worker',
        seriesMatchStatus: 'ambiguous', seriesMatchReason: 'ambiguous-identity',
    };
    const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [ambiguous] }];
    const series = [
        { seriesKey: 'series:old', occurrences: [{ dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous }] },
        { seriesKey: 'series:new', occurrences: [{ dumpIndex: 1, sourceKey: ambiguous.sourceKey, thread: ambiguous }] },
    ];

    const result = annotateThreadChanges(dumps, series);

    assert.equal(ambiguous.snapshotChange.status, 'unresolved');
    assert.equal(result.dumps[1].threadChanges.unresolvedCount, 1);
    assert.equal(result.dumps[1].threadChanges.endedCount, null);
    assert.deepEqual(result.dumps[1].threadChanges.endedThreads, []);
    assert.equal(result.dumps[1].threadChanges.endedStatus, 'identity-unresolved');
});

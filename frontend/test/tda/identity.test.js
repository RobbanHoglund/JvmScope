import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    correlateThreadsAcrossSnapshots,
    resolveThreadReference,
} from '../../assets/javautils/tda/identity.js';
import { parseThreadDump, splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { canCompareThreadCollections } from '../../assets/javautils/tda/snapshot-quality.js';

const fixture = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

test('assigns deterministic unique source keys without using duplicate thread names', async () => {
    const threads = parseThreadDump(await fixture('duplicate-thread-names.txt'), { snapshotIndex: 4 });

    assert.equal(threads.length, 2);
    assert.equal(threads[0].sourceKey, 'snapshot:4:tid:0x0000000000000031');
    assert.equal(threads[1].sourceKey, 'snapshot:4:tid:0x0000000000000032');
    assert.notEqual(threads[0].sourceKey, threads[1].sourceKey);
    assert.equal(threads[0].seriesKey, null);
});

test('disambiguates duplicate names with explicit waiting-lock evidence', async () => {
    const threads = parseThreadDump(await fixture('duplicate-thread-names.txt'), { snapshotIndex: 0 });
    const resolution = resolveThreadReference(threads, {
        threadName: 'worker',
        waitingLockId: '0x00000000ccccdddd',
    });

    assert.equal(resolution.status, 'resolved');
    assert.equal(resolution.reason, 'name-and-waiting-lock');
    assert.equal(resolution.thread.sourceKey, 'snapshot:0:tid:0x0000000000000032');
});

test('reports ambiguous duplicate-name references instead of choosing the first match', async () => {
    const threads = parseThreadDump(await fixture('duplicate-thread-names.txt'), { snapshotIndex: 0 });
    const resolution = resolveThreadReference(threads, { threadName: 'worker' });

    assert.equal(resolution.status, 'ambiguous');
    assert.equal(resolution.thread, null);
    assert.deepEqual(resolution.candidateSourceKeys, [
        'snapshot:0:tid:0x0000000000000031',
        'snapshot:0:tid:0x0000000000000032',
    ]);
});

test('correlates exact JVM identities across adjacent snapshots without matching by name', async () => {
    const snapshots = splitThreadDumpSnapshots(await fixture('cross-snapshot-identity.txt'));
    const dumps = snapshots.map((snapshot) => ({
        ...snapshot,
        threads: parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index }),
    }));

    const result = correlateThreadsAcrossSnapshots(dumps);
    const firstStable = result.dumps[0].threads.find((thread) => thread.threadName === 'stable-worker');
    const secondStable = result.dumps[1].threads.find((thread) => thread.threadName === 'stable-worker');
    const thirdStable = result.dumps[2].threads.find((thread) => thread.threadName === 'stable-worker');
    const firstPooled = result.dumps[0].threads.find((thread) => thread.threadName === 'pooled-worker');
    const secondPooled = result.dumps[1].threads.find((thread) => thread.threadName === 'pooled-worker');
    const thirdPooled = result.dumps[2].threads.find((thread) => thread.threadName === 'pooled-worker');

    assert.equal(firstStable.seriesKey, secondStable.seriesKey);
    assert.equal(secondStable.seriesKey, thirdStable.seriesKey);
    assert.equal(secondStable.seriesMatchStatus, 'matched');
    assert.equal(secondStable.seriesMatchReason, 'exact-tid');
    assert.notEqual(firstPooled.seriesKey, secondPooled.seriesKey);
    assert.notEqual(secondPooled.seriesKey, thirdPooled.seriesKey);
    assert.equal(secondPooled.seriesMatchStatus, 'new');
    assert.equal(result.diagnostics.matchedThreads, 2);
    assert.equal(result.diagnostics.seriesCount, 4);
});

test('rejects conflicting identifiers and ambiguous one-to-many matches', () => {
    const dumps = [
        {
            index: 0,
            threads: [
                { sourceKey: 'snapshot:0:source:1', threadName: 'first', tid: '0x1', jvmId: 1, nid: '0xa' },
                { sourceKey: 'snapshot:0:source:2', threadName: 'second', tid: '0x2', jvmId: 2, nid: '0xb' },
            ],
        },
        {
            index: 1,
            threads: [
                { sourceKey: 'snapshot:1:source:1', threadName: 'conflict', tid: '0x1', jvmId: 99, nid: '0xa' },
                { sourceKey: 'snapshot:1:source:2', threadName: 'claim-a', tid: '0x2', jvmId: 2, nid: '0xb' },
                { sourceKey: 'snapshot:1:source:3', threadName: 'claim-b', tid: '0x2', jvmId: 2, nid: '0xb' },
            ],
        },
    ];

    const result = correlateThreadsAcrossSnapshots(dumps);
    const [conflict, claimA, claimB] = result.dumps[1].threads;

    assert.equal(conflict.seriesMatchStatus, 'new');
    assert.equal(conflict.seriesMatchReason, 'conflicting-identifiers');
    assert.equal(claimA.seriesMatchStatus, 'ambiguous');
    assert.equal(claimB.seriesMatchStatus, 'ambiguous');
    assert.notEqual(claimA.seriesKey, claimB.seriesKey);
    assert.equal(result.diagnostics.ambiguousThreads, 2);
});

test('does not reconnect a thread across a missing snapshot', () => {
    const dumps = [
        { index: 0, threads: [{ sourceKey: 'snapshot:0:tid:0x1', threadName: 'worker', tid: '0x1' }] },
        { index: 1, threads: [] },
        { index: 2, threads: [{ sourceKey: 'snapshot:2:tid:0x1', threadName: 'worker', tid: '0x1' }] },
    ];

    const result = correlateThreadsAcrossSnapshots(dumps);

    assert.notEqual(result.dumps[0].threads[0].seriesKey, result.dumps[2].threads[0].seriesKey);
    assert.equal(result.dumps[2].threads[0].seriesMatchReason, 'no-adjacent-match');
});

test('does not infer cross-snapshot identity from matching names or stacks', () => {
    const dumps = [
        {
            index: 0,
            threads: [{ sourceKey: 'snapshot:0:source:1', threadName: 'worker', topFrame: 'example.Work.run' }],
        },
        {
            index: 1,
            threads: [{ sourceKey: 'snapshot:1:source:1', threadName: 'worker', topFrame: 'example.Work.run' }],
        },
    ];

    const result = correlateThreadsAcrossSnapshots(dumps);

    assert.notEqual(result.dumps[0].threads[0].seriesKey, result.dumps[1].threads[0].seriesKey);
    assert.equal(result.dumps[1].threads[0].seriesMatchStatus, 'new');
    assert.equal(result.dumps[1].threads[0].seriesMatchReason, 'no-adjacent-match');
});

test('unknown process IDs cannot bridge known process changes or reconnect an older series', () => {
    const dumps = ['100', null, undefined, '', '200', null, '100'].map((processId, index) => ({
        index, processId, threads: [{ sourceKey: `snapshot:${index}:jvm:42`, jvmId: 42 }],
    }));
    const { series } = correlateThreadsAcrossSnapshots(dumps);
    assert.deepEqual(series.map(item => item.occurrences.map(o => o.dumpIndex)), [[0, 1, 2, 3], [4, 5], [6]]);
    for (const index of [4, 6]) {
        assert.equal(dumps[index].threads[0].seriesMatchReason, 'different-process');
        assert.equal(dumps[index].threads[0].seriesMatchConfidence, 'none');
        assert.equal(dumps[index].threads[0].previousSourceKey, null);
        assert.equal(canCompareThreadCollections(dumps[index - 1], dumps[index]), false);
        assert.equal(canCompareThreadCollections(dumps[index], dumps[index - 1]), false);
        assert.equal(canCompareThreadCollections(dumps[index], dumps[index]), true, 'individual complete counts remain available');
    }
});

test('unknown IDs preserve adjacent matches within the same normalized known process', () => {
    const dumps = [null, 100, undefined, '100'].map((processId, index) => ({
        index, processId, threads: [{ sourceKey: `snapshot:${index}:jvm:42`, jvmId: 42 }],
    }));
    assert.equal(correlateThreadsAcrossSnapshots(dumps).series.length, 1);
    assert.ok(dumps.slice(1).every(dump => dump.threads[0].seriesMatchConfidence === 'exact'));
});

test('indexes exact identifiers instead of comparing every adjacent thread pair', () => {
    const threadCount = 2_000;
    const snapshot = (dumpIndex) => Array.from({ length: threadCount }, (_, index) => ({
        sourceKey: `snapshot:${dumpIndex}:tid:0x${index.toString(16)}`,
        threadName: `worker-${index}`,
        tid: `0x${index.toString(16)}`,
        jvmId: index + 1,
        nid: `0x${(index + 10_000).toString(16)}`,
    }));
    const dumps = [
        { index: 0, threads: snapshot(0) },
        { index: 1, threads: snapshot(1) },
    ];

    const result = correlateThreadsAcrossSnapshots(dumps);

    assert.equal(result.diagnostics.matchedThreads, threadCount);
    assert.equal(result.diagnostics.identityComparisons, threadCount);
});

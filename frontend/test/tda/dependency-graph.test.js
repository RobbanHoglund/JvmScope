import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { parseThreadDump } from '../../assets/javautils/tda/parser.js';

const fixtures = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

function lock(lockId, kind = 'monitor', lockType = 'a example.Lock') {
    return { lockId, kind, lockType };
}

function thread(sourceKey, threadName, overrides = {}) {
    return {
        sourceKey,
        threadName,
        javaState: 'RUNNABLE',
        heldLocks: [],
        waitingLocks: [],
        isDeadlocked: false,
        ...overrides,
    };
}

test('builds an explicit waiter -> synchronizer -> owner resource path and a direct dependency', async () => {
    const threads = parseThreadDump(await fixtures('ownable-synchronizer-contention.txt'));
    const graph = buildThreadDependencyGraph(threads);

    assert.equal(graph.metrics.threadCount, 2);
    assert.equal(graph.metrics.lockCount, 1);
    assert.equal(graph.metrics.synchronizerCount, 1);
    assert.equal(graph.metrics.waitRelationCount, 1);
    assert.equal(graph.metrics.holdRelationCount, 1);
    assert.equal(graph.metrics.dependencyCount, 1);
    assert.equal(graph.metrics.unresolvedWaitCount, 0);

    const lockNode = graph.lockNodes[0];
    const ownerNode = graph.threadNodes.find((node) => node.threadName === 'lock-owner');
    const waiterNode = graph.threadNodes.find((node) => node.threadName === 'lock-waiter');
    const parsedOwner = threads.find((item) => item.threadName === 'lock-owner');
    assert.equal(ownerNode.rawStartLine, parsedOwner.rawStartLine);
    assert.equal(ownerNode.rawEndLine, parsedOwner.rawEndLine);
    assert.deepEqual(lockNode.ownerIds, [ownerNode.id]);
    assert.deepEqual(lockNode.waiterIds, [waiterNode.id]);

    assert.ok(graph.resourceEdges.some((edge) => edge.source === waiterNode.id && edge.target === lockNode.id && edge.type === 'park'));
    assert.ok(graph.resourceEdges.some((edge) => edge.source === lockNode.id && edge.target === ownerNode.id && edge.type === 'hold'));
    assert.ok(graph.dependencyEdges.some((edge) => edge.source === waiterNode.id && edge.target === ownerNode.id));
});

test('does not convert Object.wait notification waits into owner dependencies', () => {
    const owner = thread('owner', 'owner', { heldLocks: [lock('0x1')] });
    const awaiter = thread('awaiter', 'awaiter', {
        javaState: 'WAITING',
        waitingLocks: [lock('0x1', 'monitor-wait')],
    });

    const graph = buildThreadDependencyGraph([owner, awaiter]);

    assert.equal(graph.metrics.awaitRelationCount, 1);
    assert.equal(graph.metrics.waitRelationCount, 0);
    assert.equal(graph.metrics.dependencyCount, 0);
    assert.equal(graph.observedCycles.length, 0);
});

test('preserves confirmed JVM deadlock evidence and identifies the observed dependency cycle', () => {
    const alpha = thread('alpha-key', 'alpha', {
        javaState: 'BLOCKED',
        heldLocks: [lock('0xa')],
        waitingLocks: [lock('0xb', 'monitor-enter')],
        isDeadlocked: true,
        deadlockCycleId: 1,
        deadlockHeldBy: 'beta',
        deadlockWaitingLockId: '0xb',
        deadlockHoldingLockId: '0xa',
    });
    const beta = thread('beta-key', 'beta', {
        javaState: 'BLOCKED',
        heldLocks: [lock('0xb')],
        waitingLocks: [lock('0xa', 'monitor-enter')],
        isDeadlocked: true,
        deadlockCycleId: 1,
        deadlockHeldBy: 'alpha',
        deadlockWaitingLockId: '0xa',
        deadlockHoldingLockId: '0xb',
    });
    const deadlocks = [{
        id: 1,
        threads: [
            { sourceKey: alpha.sourceKey, threadName: 'alpha', heldBy: 'beta', waitingLockId: '0xb', waitingLockType: 'a example.Lock' },
            { sourceKey: beta.sourceKey, threadName: 'beta', heldBy: 'alpha', waitingLockId: '0xa', waitingLockType: 'a example.Lock' },
        ],
    }];

    const graph = buildThreadDependencyGraph([alpha, beta], deadlocks);

    assert.equal(graph.metrics.deadlockedThreadCount, 2);
    assert.equal(graph.metrics.confirmedDeadlockCycleCount, 1);
    assert.equal(graph.metrics.observedDependencyCycleCount, 1);
    assert.equal(graph.observedCycles[0].nodeIds.length, 2);
    assert.equal(graph.dependencyEdges.length, 2);
    assert.ok(graph.dependencyEdges.every((edge) => edge.confirmedDeadlock));
    assert.ok(graph.lockNodes.every((node) => node.deadlocked));
});

test('keeps isolated threads visible and adds a mounted virtual-thread relationship', () => {
    const isolated = thread('isolated', 'isolated');
    const carrier = thread('carrier', 'ForkJoinPool-1-worker-1', {
        isCarrierThread: true,
        carrierVirtualThreadId: '77',
        mountedVirtualThreadId: '77',
    });

    const graph = buildThreadDependencyGraph([isolated, carrier]);

    assert.equal(graph.metrics.threadCount, 2);
    assert.equal(graph.metrics.virtualThreadCount, 1);
    assert.equal(graph.metrics.mountRelationCount, 1);
    assert.equal(graph.metrics.isolatedThreadCount, 1);
    assert.ok(graph.resourceEdges.some((edge) => edge.type === 'mount'));
});

test('reconstructs a complete confirmed resource cycle from authoritative deadlock metadata', () => {
    const alpha = thread('alpha-key', 'alpha', { javaState: 'BLOCKED' });
    const beta = thread('beta-key', 'beta', { javaState: 'BLOCKED' });
    const deadlocks = [{
        id: 7,
        threads: [
            { sourceKey: alpha.sourceKey, threadName: 'alpha', heldBy: 'beta', waitingLockId: '0xb', waitingLockType: 'a example.Lock' },
            { sourceKey: beta.sourceKey, threadName: 'beta', heldBy: 'alpha', waitingLockId: '0xa', waitingLockType: 'a example.Lock' },
        ],
    }];

    const graph = buildThreadDependencyGraph([alpha, beta], deadlocks);

    assert.equal(graph.metrics.deadlockedThreadCount, 2);
    assert.equal(graph.metrics.confirmedDeadlockCycleCount, 1);
    assert.equal(graph.metrics.waitRelationCount, 2);
    assert.equal(graph.metrics.holdRelationCount, 2);
    assert.equal(graph.metrics.unresolvedWaitCount, 0);
    assert.equal(graph.dependencyEdges.length, 2);
    assert.ok(graph.dependencyEdges.every((edge) => edge.confirmedDeadlock));
    assert.equal(graph.lockNodes.length, 2);
    assert.ok(graph.lockNodes.every((node) => node.deadlocked));
    assert.ok(graph.lockNodes.every((node) => node.ownerIds.length === 1 && node.waiterIds.length === 1));
    assert.equal(graph.resourceEdges.filter((edge) => edge.confirmedDeadlock).length, 4);
});

test('handles dependency chains larger than the JavaScript call stack', () => {
    const threadCount = 15_000;
    const threads = Array.from({ length: threadCount }, (_unused, index) => thread(
        `thread-${index}`,
        `thread-${index}`,
        {
            javaState: index < threadCount - 1 ? 'BLOCKED' : 'RUNNABLE',
            heldLocks: index > 0 ? [lock(`lock-${index - 1}`)] : [],
            waitingLocks: index < threadCount - 1 ? [lock(`lock-${index}`, 'monitor-enter')] : [],
        },
    ));

    const graph = buildThreadDependencyGraph(threads);

    assert.equal(graph.metrics.threadCount, threadCount);
    assert.equal(graph.metrics.dependencyCount, threadCount - 1);
    assert.equal(graph.metrics.maxDependencyDepth, threadCount);
    assert.equal(graph.metrics.observedDependencyCycleCount, 0);
});

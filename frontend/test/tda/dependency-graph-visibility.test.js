import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CONTENTION_DENSITY_PROFILES,
    buildContentionVisibility,
    buildThreadLockRoleIndex,
    contentionDensityProfile,
    resourceKindVisible,
    threadMatchesHighlightMode,
} from '../../assets/javautils/tda/dependency-graph-visibility.js';

function thread(id, state = 'WAITING', extras = {}) {
    return {
        id: `thread:${id}`,
        type: 'thread',
        label: id,
        state,
        role: 'waiter',
        deadlocked: false,
        severityScore: 0,
        findingCount: 0,
        ...extras,
    };
}

function lock(id, resourceKind, waiterIds, ownerIds = [], extras = {}) {
    return {
        id: `lock:${id}`,
        type: 'lock',
        lockId: id,
        resourceKind,
        waiterIds,
        ownerIds,
        deadlocked: false,
        ...extras,
    };
}

test('defines compact, balanced, and complete contention profiles', () => {
    assert.deepEqual(contentionDensityProfile('compact'), CONTENTION_DENSITY_PROFILES.compact);
    assert.equal(CONTENTION_DENSITY_PROFILES.compact.maxLocks, 5);
    assert.equal(CONTENTION_DENSITY_PROFILES.compact.maxWaitersPerLock, 6);
    assert.equal(CONTENTION_DENSITY_PROFILES.balanced.maxLocks, 10);
    assert.equal(contentionDensityProfile('unknown'), CONTENTION_DENSITY_PROFILES.compact);
    assert.equal(contentionDensityProfile('complete').maxLocks, Number.POSITIVE_INFINITY);
});

test('filters monitor, synchronizer, and mixed resources independently', () => {
    assert.equal(resourceKindVisible('monitor', { showMonitors: true, showSynchronizers: false }), true);
    assert.equal(resourceKindVisible('synchronizer', { showMonitors: true, showSynchronizers: false }), false);
    assert.equal(resourceKindVisible('mixed', { showMonitors: true, showSynchronizers: false }), true);
    assert.equal(resourceKindVisible('mixed', { showMonitors: false, showSynchronizers: true }), true);
    assert.equal(resourceKindVisible('monitor', { showMonitors: false, showSynchronizers: false }), false);
});

test('compact contention selects top locks and caps visible waiters without losing full metadata', () => {
    const threads = Array.from({ length: 50 }, (_unused, index) => thread(`t-${index}`, index % 2 ? 'WAITING' : 'BLOCKED'));
    const locks = Array.from({ length: 8 }, (_unused, index) => lock(
        `l-${index}`,
        index % 2 ? 'synchronizer' : 'monitor',
        threads.slice(index, index + 10).map((node) => node.id),
        index % 3 ? ['thread:owner'] : [],
    ));

    const result = buildContentionVisibility({ lockNodes: locks, threadNodes: threads, density: 'compact' });
    assert.equal(result.selectedLocks.length, 5);
    assert.equal(result.hiddenLockCount, 3);
    assert.ok([...result.visibleWaiterIdsByLock.values()].every((ids) => ids.size <= 6));
    assert.equal(result.hiddenWaiterObservationCount, 20);
    assert.equal(result.contendedLockCount, 8);
});

test('contention visibility can hide synchronizers and unresolved waits', () => {
    const threads = [thread('a'), thread('b')];
    const monitor = lock('monitor', 'monitor', ['thread:a'], ['thread:owner']);
    const synchronizer = lock('sync', 'synchronizer', ['thread:b'], ['thread:owner']);
    const unresolvedMonitor = lock('unresolved', 'monitor', ['thread:b'], []);

    const result = buildContentionVisibility({
        lockNodes: [monitor, synchronizer, unresolvedMonitor],
        threadNodes: threads,
        showMonitors: true,
        showSynchronizers: false,
        showUnresolved: false,
    });

    assert.deepEqual(result.selectedLocks.map((node) => node.id), ['lock:monitor']);
    assert.equal(result.filteredByTypeCount, 1);
    assert.equal(result.filteredUnresolvedCount, 1);
});

test('waiter compaction prioritizes deadlocked and BLOCKED threads', () => {
    const threads = [
        thread('waiting-1'),
        thread('waiting-2'),
        thread('waiting-3'),
        thread('waiting-4'),
        thread('waiting-5'),
        thread('waiting-6'),
        thread('blocked', 'BLOCKED'),
        thread('deadlocked', 'BLOCKED', { deadlocked: true }),
    ];
    const hotspot = lock('hot', 'monitor', threads.map((node) => node.id));
    const result = buildContentionVisibility({ lockNodes: [hotspot], threadNodes: threads, density: 'compact' });
    const visible = result.visibleWaiterIdsByLock.get(hotspot.id);
    assert.equal(visible.size, 6);
    assert.ok(visible.has('thread:blocked'));
    assert.ok(visible.has('thread:deadlocked'));
});

test('builds exact synchronized and synchronizer waiter/holder roles', () => {
    const threads = [thread('monitor-both'), thread('sync-waiter'), thread('notification-only')];
    const monitor = lock('m', 'monitor', [], []);
    const synchronizer = lock('s', 'synchronizer', [], []);
    const roles = buildThreadLockRoleIndex({
        threadNodes: threads,
        lockNodes: [monitor, synchronizer],
        resourceEdges: [
            { type: 'wait', source: 'thread:monitor-both', target: monitor.id },
            { type: 'hold', source: monitor.id, target: 'thread:monitor-both' },
            { type: 'park', source: 'thread:sync-waiter', target: synchronizer.id },
            { type: 'await', source: 'thread:notification-only', target: monitor.id },
        ],
    });

    assert.equal(threadMatchesHighlightMode(threads[0], roles.get(threads[0].id), 'monitor-both'), true);
    assert.equal(threadMatchesHighlightMode(threads[0], roles.get(threads[0].id), 'monitor-holder'), true);
    assert.equal(threadMatchesHighlightMode(threads[1], roles.get(threads[1].id), 'synchronizer-waiter'), true);
    assert.equal(threadMatchesHighlightMode(threads[1], roles.get(threads[1].id), 'monitor-waiter'), false);
    assert.equal(threadMatchesHighlightMode(threads[2], roles.get(threads[2].id), 'any-waiter'), false);
});

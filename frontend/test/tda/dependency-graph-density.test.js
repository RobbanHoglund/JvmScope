import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_DEPENDENCY_GRAPH_OPTIONS,
    graphNodePriority,
    projectionDensity,
    selectSmartLabelNodeIds,
    smartLabelBudget,
} from '../../assets/javautils/tda/dependency-graph-density.js';

test('uses a progressive-disclosure contention overview by default', () => {
    assert.deepEqual(DEFAULT_DEPENDENCY_GRAPH_OPTIONS, {
        view: 'resource',
        scope: 'contention',
        density: 'compact',
        layout: 'flow',
        labels: 'smart',
        highlight: 'none',
        showMonitors: true,
        showSynchronizers: true,
        showUnresolved: true,
        showWaits: true,
        showHolds: true,
        showAwaits: false,
        showMounts: false,
        showEdgeLabels: false,
    });
});

test('caps smart labels aggressively as graph density grows', () => {
    assert.equal(smartLabelBudget(10), 10);
    assert.equal(smartLabelBudget(20), 16);
    assert.equal(smartLabelBudget(60), 22);
    assert.equal(smartLabelBudget(140), 24);
    assert.equal(smartLabelBudget(280), 20);
    assert.equal(smartLabelBudget(1300), 16);
});

test('prioritizes deadlocks, blocked threads, blockers, and contended resources', () => {
    const routineLock = {
        id: 'routine-lock',
        type: 'lock',
        waiterIds: [],
        awaiterIds: [],
        ownerIds: ['owner'],
        _visibleDegree: 1,
    };
    const contendedLock = {
        id: 'contended-lock',
        type: 'lock',
        waiterIds: ['waiter-1', 'waiter-2'],
        awaiterIds: [],
        ownerIds: [],
        _visibleDegree: 2,
    };
    const blockedThread = {
        id: 'blocked-thread',
        type: 'thread',
        state: 'BLOCKED',
        dependencySourceIds: [],
        dependencyTargetIds: [],
        _visibleDegree: 1,
    };
    const deadlockedThread = {
        id: 'deadlocked-thread',
        type: 'thread',
        state: 'BLOCKED',
        deadlocked: true,
        dependencySourceIds: [],
        dependencyTargetIds: [],
        _visibleDegree: 1,
    };

    assert.ok(graphNodePriority(contendedLock) > graphNodePriority(routineLock));
    assert.ok(graphNodePriority(blockedThread) > graphNodePriority(routineLock));
    assert.ok(graphNodePriority(deadlockedThread) > graphNodePriority(blockedThread));
});

test('selects only the most important labels in a very large map', () => {
    const nodes = Array.from({ length: 800 }, (_unused, index) => ({
        id: `node-${index}`,
        type: 'thread',
        state: index === 799 ? 'BLOCKED' : 'WAITING',
        dependencySourceIds: index === 798 ? ['waiter'] : [],
        dependencyTargetIds: [],
        _visibleDegree: 1,
    }));
    nodes[797].deadlocked = true;

    const selected = selectSmartLabelNodeIds(nodes);
    assert.equal(selected.size, 16);
    assert.ok(selected.has('node-797'));
    assert.ok(selected.has('node-798'));
    assert.ok(selected.has('node-799'));
});

test('detects dense and extreme raw projections', () => {
    assert.deepEqual(projectionDensity({ nodeCount: 80, resourceCount: 22, edgeCount: 54 }), {
        dense: false,
        extreme: false,
        nodeCount: 80,
        resourceCount: 22,
        edgeCount: 54,
    });
    assert.equal(projectionDensity({ nodeCount: 240, resourceCount: 80, edgeCount: 200 }).dense, true);
    assert.equal(projectionDensity({ nodeCount: 1331, resourceCount: 825, edgeCount: 860 }).extreme, true);
});

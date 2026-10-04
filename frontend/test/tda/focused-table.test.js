import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createFocusedTableState,
    emptyFocusedTableState,
    focusedThreadIndexSet,
    getFocusedTableView,
    isFocusedTableActive,
} from '../../assets/javautils/tda/focused-table.js';

test('creates a canonical focused-table state from exact cluster members', () => {
    assert.deepEqual(createFocusedTableState('cluster-7', 2, [
        { dumpIndex: 1, index: 10 },
        { dumpIndex: 2, index: 21 },
        { dumpIndex: 2, index: '21' },
        { dumpIndex: 2, index: 22 },
        { dumpIndex: 2, index: 'invalid' },
        { dumpIndex: 2, index: -1 },
        { dumpIndex: 2, index: 2.5 },
    ]), {
        active: true,
        clusterId: 'cluster-7',
        dumpIndex: 2,
        threadIndexes: [21, 22],
        filterTableToFocus: true,
    });
});

test('returns an inactive state for invalid targets and empty snapshot membership', () => {
    assert.deepEqual(createFocusedTableState('', 1, [{ dumpIndex: 1, index: 2 }]), emptyFocusedTableState());
    assert.deepEqual(createFocusedTableState('cluster-1', -1, []), emptyFocusedTableState());
    assert.deepEqual(createFocusedTableState('cluster-1', 3, [{ dumpIndex: 2, index: 2 }]), emptyFocusedTableState());
});

test('activates focus only for its exact selected snapshot', () => {
    const state = createFocusedTableState('cluster-1', 3, [{ dumpIndex: 3, index: 4 }]);

    assert.equal(isFocusedTableActive(state, 3), true);
    assert.equal(isFocusedTableActive(state, 2), false);
    assert.equal(isFocusedTableActive({ ...state, filterTableToFocus: false }, 3), false);
});

test('returns a defensive focused thread index set', () => {
    const state = createFocusedTableState('cluster-1', 0, [
        { dumpIndex: 0, index: 5 },
        { dumpIndex: 0, index: 8 },
    ]);
    const indexes = focusedThreadIndexSet(state, 0);

    assert.deepEqual([...indexes], [5, 8]);
    indexes.add(99);
    assert.deepEqual(state.threadIndexes, [5, 8]);
    assert.equal(focusedThreadIndexSet(state, 1).size, 0);
});

test('presents focused, visible, and hidden counts without impossible values', () => {
    const state = createFocusedTableState('cluster-1', 0, [
        { dumpIndex: 0, index: 1 },
        { dumpIndex: 0, index: 2 },
        { dumpIndex: 0, index: 3 },
    ]);

    assert.deepEqual(getFocusedTableView(state, 0, 1, '2026-08-10 12:00:00'), {
        isActive: true,
        clusterId: 'cluster-1',
        dumpIndex: 0,
        dumpLabel: '2026-08-10 12:00:00',
        totalFocused: 3,
        visibleFocused: 1,
        hiddenFocused: 2,
        countText: 'Showing 1 of 3 focused threads after all other table filters',
    });
    assert.equal(getFocusedTableView(state, 0, 99, '').visibleFocused, 3);
    assert.equal(getFocusedTableView(state, 1, 1, '').isActive, false);
});

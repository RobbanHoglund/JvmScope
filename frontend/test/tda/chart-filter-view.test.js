import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getChartFilterView,
    getChartLegendItemView,
} from '../../assets/javautils/tda/chart-filter-view.js';

test('presents an inactive chart filter without hiding thread totals', () => {
    assert.deepEqual(getChartFilterView(null, 12, 7), {
        isActive: false,
        label: '',
        totalThreads: 12,
        visibleThreads: 7,
        hiddenThreads: 5,
        countText: 'Showing 7 of 12 threads after all active table filters',
    });
});

test('presents an active chart filter with a safe deterministic fallback label', () => {
    assert.deepEqual(getChartFilterView(
        { kind: 'state', value: 'RUNNABLE', label: 'Thread state = RUNNABLE' },
        20,
        4,
    ), {
        isActive: true,
        label: 'Thread state = RUNNABLE',
        totalThreads: 20,
        visibleThreads: 4,
        hiddenThreads: 16,
        countText: 'Showing 4 of 20 threads after all active table filters',
    });

    assert.equal(getChartFilterView({ kind: 'cpu', value: '100+ ms' }, 5, 2).label, 'cpu = 100+ ms');
});

test('normalizes malformed counts without producing negative or impossible summaries', () => {
    assert.deepEqual(getChartFilterView({ kind: 'state', value: 'BLOCKED' }, -2, 99), {
        isActive: true,
        label: 'state = BLOCKED',
        totalThreads: 0,
        visibleThreads: 0,
        hiddenThreads: 0,
        countText: 'Showing 0 of 0 threads after all active table filters',
    });
    assert.equal(getChartFilterView({ kind: 'state', value: 'BLOCKED' }, 10, 15).visibleThreads, 10);
    assert.equal(getChartFilterView({}, 10, 5).isActive, false);
});

test('marks only the exact chart legend value as pressed and dims sibling values', () => {
    const active = { kind: 'state', value: 'RUNNABLE' };

    assert.deepEqual(getChartLegendItemView('state', 'RUNNABLE', active), {
        isActive: true,
        ariaPressed: 'true',
        opacity: 1,
    });
    assert.deepEqual(getChartLegendItemView('state', 'WAITING', active), {
        isActive: false,
        ariaPressed: 'false',
        opacity: 0.34,
    });
    assert.deepEqual(getChartLegendItemView('cpu', '100+ ms', active), {
        isActive: false,
        ariaPressed: 'false',
        opacity: 1,
    });
});

test('keeps every legend item fully visible when no chart filter is active', () => {
    assert.deepEqual(getChartLegendItemView('state', 'RUNNABLE', null), {
        isActive: false,
        ariaPressed: 'false',
        opacity: 1,
    });
});

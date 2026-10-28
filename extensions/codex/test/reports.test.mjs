import assert from 'node:assert/strict';
import test from 'node:test';
import { createReports } from '../src/reports.mjs';

test('report cache expires, evicts oldest entries and isolates connections', () => {
    let time = 0;
    const reports = createReports({ maxEntries: 2, ttlMs: 10, now: () => time });
    const first = reports.add({ value: 1 });
    const second = reports.add({ value: 2 });
    assert.equal(reports.get(first).value, 1);
    const third = reports.add({ value: 3 });
    assert.throws(() => reports.get(first), /expired/);
    assert.equal(reports.get(second).value, 2);
    assert.throws(() => createReports().get(third), /another session/);
    time = 10;
    assert.throws(() => reports.get(third), /expired/);
});

test('cached pages keep global snapshot identity and never leak private cache payloads', () => {
    const reports = createReports();
    const snapshots = [0, 1, 2].map(index => ({ index }));
    const report = { analyzer: 'threads', snapshotCount: 3,
        snapshots: { total: 3, items: snapshots.slice(0, 1), offset: 0, limit: 1 }, _cachedSnapshots: snapshots };
    const id = reports.add(report);
    assert.equal(report._cachedSnapshots, undefined);
    assert.equal(report.cache.complete, true);
    const page = reports.page(id, { offset: 2, limit: 1 });
    assert.deepEqual(page.snapshots.items, [{ index: 2 }]);
    assert.equal(page.snapshots.nextOffset, null);
    assert.equal(reports.get(id).snapshots.offset, 0);
    assert.equal(reports.page(id, { snapshotIndex: 1 }).snapshots.items[0].index, 1);
    assert.throws(() => reports.snapshot(id, 3), /SNAPSHOTS_NOT_CACHED/);
});

test('AI conclusions survive navigation but remain scoped, bounded and tied to report lifetime', () => {
    let time = 0;
    const reports = createReports({ ttlMs: 10, now: () => time });
    const first = reports.add({}), other = reports.add({});
    const scope = { view: 'snapshot', snapshots: [0] };
    const text = { summary: 'Observed wait.', nextCheck: 'Compare another capture.' };
    reports.conclusion(first, scope, 'en', text);
    assert.equal(reports.conclusion(first, scope, 'sv').language, 'en');
    assert.equal(reports.conclusion(first, scope, 'sv').summary, text.summary);
    assert.equal(reports.conclusion(other, scope, 'en'), null);
    assert.equal(reports.conclusion(first, { view: 'snapshot', snapshots: [1] }, 'en'), null);
    assert.equal(reports.conclusion(first, { view: 'comparison', snapshots: [0] }, 'en'), null);
    const focused = { view: 'threads', snapshots: [0], sourceKeys: ['one'] };
    reports.conclusion(first, focused, 'sv', text);
    assert.equal(reports.conclusion(first, { ...focused, sourceKeys: ['two'] }, 'sv'), null);
    for (let i = 1; i <= 24; i++) reports.conclusion(first, { view: 'snapshot', snapshots: [i] }, 'en', text);
    assert.equal(reports.conclusion(first, scope, 'en'), null);
    assert.equal(reports.conclusion(first, { view: 'snapshot', snapshots: [24] }, 'en').origin, 'assistant');
    time = 10;
    assert.throws(() => reports.conclusion(first, scope, 'en'), /expired/);
});

test('explicit focus must belong to the requested page, including empty pages', () => {
    const reports = createReports();
    const snapshots = [0, 1, 2].map(index => ({ index }));
    const id = reports.add({ analyzer: 'threads', snapshotCount: 3,
        snapshots: { total: 3, offset: 0, limit: 1, items: snapshots.slice(0, 1) }, _cachedSnapshots: snapshots });
    for (const args of [{ snapshotIndex: 2, offset: 0, limit: 1 }, { snapshotIndex: 0, offset: 1, limit: 2 }, { snapshotIndex: 2, offset: 3, limit: 1 }])
        assert.throws(() => reports.page(id, args), /snapshot.*page/);
    assert.deepEqual(reports.page(id, { snapshotIndex: 2, offset: 1, limit: 2 }).snapshots.items, snapshots.slice(1));
    assert.deepEqual(reports.page(id, { snapshotIndex: 2 }).snapshots.items, [snapshots[2]]);
    assert.deepEqual(reports.page(id, { offset: 3, limit: 1 }).snapshots.items, [], 'Unfocused empty pages keep their navigation fallback');
});

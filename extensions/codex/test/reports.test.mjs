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

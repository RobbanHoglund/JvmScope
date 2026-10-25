import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRate } from '../ui/comparison.mjs';
test('displayed allocation bounds round outwards and preserve small nonzero upper bounds', () => {
    const row = { allocation: { boundsBytesPerSecond: { minimum: 3.529412 * 2 ** 20, maximum: 4.761904 * 2 ** 20 } } };
    assert.equal(formatRate(row, 'allocation', 'en'), '3.5–4.8 MiB/s');
    assert.equal(formatRate(row, 'allocation', 'sv'), '3,5–4,8 MiB/s');
    row.allocation.boundsBytesPerSecond = { minimum: 0, maximum: 608.9285 };
    assert.equal(formatRate(row, 'allocation', 'en'), '0–609 B/s');
    row.allocation = { bytesPerSecond: null, boundsBytesPerSecond: null };
    assert.equal(formatRate(row, 'allocation', 'en'), 'Unavailable');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClusterTimeline, classifyClusterTrend } from '../../assets/javautils/tda/runnable-cluster-trend.js';

const dump = (extra = {}) => ({ parsingStatus: 'success', collectionScope: 'platform-threads', ...extra });
function timeline(counts, dumps = counts.map(() => dump())) {
    return buildClusterTimeline({ perDump: counts.map((count, dumpIndex) => ({ count, dumpIndex })) }, counts.length, dumps);
}

test('retains the existing trends for complete comparable observations', () => {
    for (const [counts, expected] of [
        [[1, 2], 'Growing'], [[5, 1], 'Fading'], [[2, 2], 'Persistent'],
        [[0, 1, 1], 'Bursty'], [[1, 0, 1, 1], 'Intermittent'],
        [[0, 1, 1, 1], 'Stable'], [[0, 0], 'None'],
    ]) assert.equal(classifyClusterTrend(timeline(counts)), expected);
});

test('partial observations are lower bounds and cannot establish fading or growth', () => {
    for (const counts of [[5, 1], [1, 5], [2, 2]]) {
        const items = timeline(counts, [dump(), dump({ parsingStatus: 'partial' })]);
        assert.equal(items[1].count, null);
        assert.equal(items[1].observedCount, counts[1]);
        assert.equal(classifyClusterTrend(items), 'Unavailable');
    }
});

test('a missing cluster in a partial snapshot is unknown rather than zero', () => {
    const items = buildClusterTimeline({ perDump: [{ dumpIndex: 0, count: 2 }, { dumpIndex: 2, count: 2 }] }, 3,
        [dump(), dump({ parsingStatus: 'partial' }), dump()]);
    assert.equal(items[1].count, null);
    assert.equal(items[1].observedCount, 0);
    assert.equal(classifyClusterTrend(items), 'Unavailable');
});

test('changed process and collection scope suppress cluster trends', () => {
    for (const dumps of [
        [dump({ processId: '100' }), dump({ processId: '200' })],
        [dump(), dump({ collectionScope: 'all-threads' })],
        [dump({ processId: '100' }), dump(), dump({ processId: '200' })],
        [dump(), dump({ processId: '100' }), dump(), dump({ processId: '200' })],
    ]) assert.equal(classifyClusterTrend(timeline(dumps.map(() => 1), dumps)), 'Unavailable');
});

test('null snapshots and invalid counts cannot manufacture observed inactivity', () => {
    assert.equal(classifyClusterTrend(timeline([1, 1], [dump(), null])), 'Unavailable');
    for (const value of [null, -1, NaN, Infinity, '1']) {
        assert.equal(classifyClusterTrend(timeline([1, value])), 'Unavailable');
    }
    assert.equal(classifyClusterTrend([]), 'None');
});

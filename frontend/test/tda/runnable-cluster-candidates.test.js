import assert from 'node:assert/strict';
import test from 'node:test';
import { createClusterCandidateIndex } from '../../assets/javautils/tda/runnable-cluster-candidates.js';
const thread = frames => ({ meaningfulFrames: frames });
const cluster = frames => ({ representative: thread(frames) });

test('top frame overlap and long shared tails remain eligible', () => {
    const index = createClusterCandidateIndex();
    const top = cluster(['shared', 'other']);
    const tail = Array.from({ length: 10 }, (_, i) => `tail-${i}`);
    const ending = cluster([...Array.from({ length: 20 }, (_, i) => `prefix-${i}`), ...tail]);
    index.add(top);
    index.add(ending);
    assert.deepEqual(index.matching(thread(['new', 'shared'])), [top]);
    assert.deepEqual(index.matching(thread([...Array.from({ length: 20 }, (_, i) => `different-${i}`), ...tail])), [ending]);
    assert.deepEqual(index.matching(thread(['unrelated'])), []);
});

test('candidate order retains the old tie breaker regardless of frame lookup order', () => {
    const index = createClusterCandidateIndex();
    const first = cluster(['first', 'shared']);
    const second = cluster(['second', 'shared']);
    index.add(first);
    index.add(second);
    index.add(first);
    assert.deepEqual(index.matching(thread(['second', 'first', 'shared', 'shared'])), [first, second]);
});

test('matches exclusively in the middle cannot pass the existing prefilter', () => {
    const index = createClusterCandidateIndex();
    index.add(cluster(Array.from({ length: 40 }, (_, i) => `frame-${i}`)));
    assert.deepEqual(index.matching(thread(['frame-15'])), []);
    assert.deepEqual(index.matching(null), []);
    assert.deepEqual(index.matching({ meaningfulFrames: null }), []);
});

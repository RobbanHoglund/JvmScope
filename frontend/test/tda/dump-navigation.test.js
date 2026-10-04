import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getDumpNavigationView,
    keyboardDumpNavigationAction,
    resolveDumpIndex,
} from '../../assets/javautils/tda/dump-navigation.js';

test('resolves previous, next, first, last, and direct snapshot navigation safely', () => {
    assert.equal(resolveDumpIndex(2, 5, 'previous'), 1);
    assert.equal(resolveDumpIndex(2, 5, 'next'), 3);
    assert.equal(resolveDumpIndex(2, 5, 'first'), 0);
    assert.equal(resolveDumpIndex(2, 5, 'last'), 4);
    assert.equal(resolveDumpIndex(2, 5, 'direct', 4), 4);
});

test('clamps navigation at boundaries and rejects malformed direct targets', () => {
    assert.equal(resolveDumpIndex(0, 5, 'previous'), 0);
    assert.equal(resolveDumpIndex(4, 5, 'next'), 4);
    assert.equal(resolveDumpIndex(2, 5, 'direct', 99), 4);
    assert.equal(resolveDumpIndex(2, 5, 'direct', 'bad'), 2);
    assert.equal(resolveDumpIndex(2, 0, 'next'), 0);
});

test('builds contextual navigation labels and boundary state', () => {
    assert.deepEqual(getDumpNavigationView(0, 5, '2026-04-08 09:00:01'), {
        isVisible: true,
        positionText: 'Snapshot 1 of 5',
        announcement: 'Snapshot 1 of 5 selected: 2026-04-08 09:00:01.',
        previousDisabled: true,
        nextDisabled: false,
    });
    assert.equal(getDumpNavigationView(4, 5).nextDisabled, true);
    assert.equal(getDumpNavigationView(0, 1).isVisible, false);
});

test('maps unmodified navigation keys while ignoring typing and modifiers', () => {
    assert.equal(keyboardDumpNavigationAction({ key: 'ArrowLeft' }), 'previous');
    assert.equal(keyboardDumpNavigationAction({ key: 'ArrowRight' }), 'next');
    assert.equal(keyboardDumpNavigationAction({ key: 'Home' }), 'first');
    assert.equal(keyboardDumpNavigationAction({ key: 'End' }), 'last');
    assert.equal(keyboardDumpNavigationAction({ key: 'ArrowRight', ctrlKey: true }), null);
    assert.equal(keyboardDumpNavigationAction({ key: 'ArrowRight', isTyping: true }), null);
    assert.equal(keyboardDumpNavigationAction({ key: 'ArrowRight', dialogOpen: true }), null);
});

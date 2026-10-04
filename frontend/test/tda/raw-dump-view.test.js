import assert from 'node:assert/strict';
import test from 'node:test';
import { rawDumpMatchIndex, revealRawDumpMatch } from '../../assets/javautils/tda/raw-dump-view.js';

test('search reveals a collapsed thread and synchronizes its accessible disclosure state', () => {
    const classes = new Set(['is-collapsed']);
    const attributes = new Map([['aria-label', 'Expand worker'], ['aria-expanded', 'false']]);
    const disclosure = {
        textContent: '+',
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: name => attributes.get(name),
    };
    const block = {
        dataset: { sourceKey: 'worker:17' },
        classList: { remove: name => classes.delete(name) },
        querySelector: () => disclosure,
    };
    const match = { closest: selector => selector === '.raw-workspace-thread-block' ? block : null };
    const expanded = new Set();
    revealRawDumpMatch(match, expanded);
    revealRawDumpMatch(match, expanded);
    assert.equal(classes.has('is-collapsed'), false);
    assert.deepEqual([...expanded], ['worker:17']);
    assert.equal(disclosure.textContent, '−');
    assert.equal(attributes.get('aria-expanded'), 'true');
    assert.equal(attributes.get('aria-label'), 'Collapse worker');
});

test('search reveals source context without inventing an expanded thread', () => {
    const context = { open: false };
    const expanded = new Set();
    revealRawDumpMatch({ closest: selector => selector === 'details' ? context : null }, expanded);
    assert.equal(context.open, true);
    assert.equal(expanded.size, 0);
});

test('exact evidence search does not require a thread wrapper', () => {
    const expanded = new Set(['existing']);
    revealRawDumpMatch({ closest: () => null }, expanded);
    assert.deepEqual([...expanded], ['existing']);
});

test('match navigation starts at the correct end and wraps in both directions', () => {
    assert.equal(rawDumpMatchIndex(-1, 0, 1), -1);
    assert.equal(rawDumpMatchIndex(-1, 3, 1), 0);
    assert.equal(rawDumpMatchIndex(-1, 3, -1), 2);
    assert.equal(rawDumpMatchIndex(2, 3, 1), 0);
    assert.equal(rawDumpMatchIndex(0, 3, -1), 2);
    assert.equal(rawDumpMatchIndex(0, 1, -1), 0);
});

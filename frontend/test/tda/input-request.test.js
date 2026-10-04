import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestInputRequestGate } from '../../assets/javautils/tda/input-request.js';

test('allows only the newest asynchronous input request to update the analyzer', async () => {
    const gate = createLatestInputRequestGate();
    const clipboardRequest = gate.begin();
    const fileRequest = gate.begin();

    await Promise.resolve();

    assert.equal(gate.isCurrent(clipboardRequest), false);
    assert.equal(gate.isCurrent(fileRequest), true);
});

test('invalidates pending input when the analyzer is cleared', () => {
    const gate = createLatestInputRequestGate();
    const pendingRequest = gate.begin();

    gate.invalidate();

    assert.equal(gate.isCurrent(pendingRequest), false);
});

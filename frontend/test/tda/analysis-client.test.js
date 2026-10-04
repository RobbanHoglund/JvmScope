import assert from 'node:assert/strict';
import test from 'node:test';
import { createAnalysisClient } from '../../assets/javautils/tda/analysis-client.js';

function fixture() {
    const workers = [];
    const client = createAnalysisClient(() => {
        const worker = { terminated: 0, postMessage(value) { this.input = value; }, terminate() { this.terminated += 1; } };
        workers.push(worker);
        return worker;
    });
    return { client, workers };
}
const result = { parserResult: { status: 'success' }, parsedDumps: [] };

test('a completed analysis returns its result and releases the worker', async () => {
    const { client, workers } = fixture();
    const pending = client.analyze('dump', { minimumIntervalMs: 1000 });
    assert.equal(workers[0].input.text, 'dump');
    workers[0].onmessage({ data: { result } });
    assert.equal(await pending, result);
    assert.equal(workers[0].terminated, 1);
    client.cancel();
    assert.equal(workers[0].terminated, 1);
});

test('a replacement cancels prior work and ignores its late result and errors', async () => {
    const { client, workers } = fixture();
    const first = client.analyze('old');
    const second = client.analyze('new');
    assert.equal(await first, null);
    assert.equal(workers[0].terminated, 1);
    workers[0].onmessage({ data: { result } });
    workers[0].onerror({ message: 'stale error' });
    workers[1].onmessage({ data: { result } });
    assert.equal(await second, result);
});

test('Clear can cancel repeatedly and a new analysis still works', async () => {
    const { client, workers } = fixture();
    const first = client.analyze('old');
    client.cancel();
    client.cancel();
    workers[0].onmessage({ data: { result } });
    assert.equal(await first, null);
    const next = client.analyze('next');
    workers[1].onmessage({ data: { result } });
    assert.equal(await next, result);
});

test('worker exceptions, decoding failures and malformed replies are contained', async () => {
    for (const fail of [
        worker => worker.onmessage({ data: { error: 'analysis failed' } }),
        worker => worker.onerror({ message: 'load failed', preventDefault() {} }),
        worker => worker.onmessageerror(),
        worker => worker.onmessage({ data: {} }),
    ]) {
        const { client, workers } = fixture();
        const pending = client.analyze('dump');
        const rejected = assert.rejects(pending);
        fail(workers[0]);
        await rejected;
        assert.equal(workers[0].terminated, 1);
        const recovery = client.analyze('valid dump');
        workers[1].onmessage({ data: { result } });
        assert.equal(await recovery, result);
    }
});

test('worker creation and dispatch failures reject without leaving a pending job', async () => {
    await assert.rejects(createAnalysisClient(() => { throw new Error('unavailable'); }).analyze('dump'), /unavailable/);
    let terminated = 0;
    const client = createAnalysisClient(() => ({ postMessage() { throw new Error('clone failed'); }, terminate() { terminated += 1; } }));
    await assert.rejects(client.analyze('dump'), /clone failed/);
    client.cancel();
    assert.equal(terminated, 1);
});

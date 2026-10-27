import test from 'node:test';
import assert from 'node:assert/strict';
import { readCapture } from '../src/captures.mjs';
import { analyzeThreads } from '../src/analysis.mjs';
import { stackContext, overviewThread } from '../src/stack-context.mjs';
import { fileURLToPath } from 'node:url';

const chain = [
    ' at java.base@25/jdk.internal.misc.Unsafe.park(Native Method)',
    ' at java.base@25/java.util.concurrent.CompletableFuture.get(CompletableFuture.java:2093)',
    ' at java.net.http@25/jdk.internal.net.http.HttpClientImpl.send(HttpClientImpl.java:902)',
    ' at app//sample.StatusClient.runOneCycle(StatusClient.java:152)',
];
test('HTTP wait observation needs a parked Java state and the recorded ordered call chain', () => {
    assert.equal(stackContext(chain, 'WAITING').observation, 'jdk-http-send-wait');
    assert.equal(stackContext(chain, 'TIMED_WAITING').observation, 'jdk-http-send-wait');
    assert.equal(stackContext(chain, 'WAITING').frame, 'app//sample.StatusClient.runOneCycle(StatusClient.java:152)');
    for (const state of ['RUNNABLE', 'BLOCKED', null]) assert.equal(stackContext(chain, state).observation, null);
    for (const lines of [chain.slice(1), chain.toReversed(), chain.filter(s => !s.includes('CompletableFuture')),
        chain.map(s => s.replace('HttpClientImpl.send(', 'HttpClientImpl.sendAsync(')),
        [' at example.HttpClientImpl.send(HttpClientImpl.java:12)'], []])
        assert.equal(stackContext(lines, 'WAITING').observation, null);
});

test('overview distinguishes a selected observation from a finding and avoids ambiguous automatic main selection', async () => {
    const capture = await readCapture(fileURLToPath(new URL('./fixtures/no-findings-java25.txt', import.meta.url)));
    const report = analyzeThreads([capture]), snapshot = report.snapshots.items[0];
    const focus = overviewThread(snapshot);
    assert.equal(focus.reason, 'main-http-wait');
    assert.equal(focus.thread.name, 'main');
    assert.equal(focus.thread.stackContext.observation, 'jdk-http-send-wait');
    assert.equal(snapshot.analysis.findings.total, 0);
    assert.equal(snapshot.deadlocks.total, 0);
    const vm = snapshot.threadInventory.items.at(-1);
    assert.equal(overviewThread(snapshot, vm.sourceKey).thread.state, null);
    assert.equal(overviewThread(snapshot, 'wrong-key'), null);
    assert.equal(overviewThread({ ...snapshot, parsingStatus: 'partial' }), null);
    assert.equal(overviewThread({ ...snapshot, analysis: { findings: { total: 1 } } }), null);
    snapshot.threadInventory.items.push({ ...focus.thread, sourceKey: 'duplicate-main' });
    assert.equal(overviewThread(snapshot), null);
    assert.equal(overviewThread(snapshot, focus.thread.sourceKey).reason, 'selected');
});

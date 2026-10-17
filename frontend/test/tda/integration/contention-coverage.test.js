import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../../assets/javautils/tda/analysis.js';
import { contentionDiagram } from '../../../assets/javautils/tda/relationship-diagram.js';

test('real Java 27 JSON preserves both acquisition waits even when held-lock ownership is absent', () => {
    const text = readFileSync(new URL('../fixtures/runtime/jdk27-dump-to-file.json', import.meta.url), 'utf8');
    const dump = analyzeThreadDumpData(text).parsedDumps[0];
    const finding = dump.smartAnalysis.findings.find(f => f.id === 'observed-lock-contention');
    assert.equal(finding.threads.length, 2);
    assert.equal(finding.resourceIds.length, 2);
    assert.equal(dump.contentionChains.length, 2);
    assert.equal(dump.contentionChains.reduce((sum, c) => sum + c.waiters.length, 0), 2);
    const chain = dump.contentionChains.find(c => c.waiters.some(t => t.threadName === 'sample-sync-waiter'));
    assert.deepEqual(chain.owners, []);
    assert.deepEqual(chain.reportedOwnerJvmIds, ['36']);
    const graph = contentionDiagram(chain);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].kind, 'wait');
    assert.match(graph.nodes[2].detail, /36/);
    assert.match(graph.nodes[2].label, /No matching held-lock entry/);
    assert.equal(graph.closed, false);
});

test('ownerless monitor waits stay visible, while conditions, latches and generic parks do not become acquisition chains', () => {
    const waits = [
        ['monitor', 'BLOCKED', 'waiting to lock', 'java.lang.Object', 'example.Work.run(Work.java:1)'],
        ['condition', 'WAITING', 'parking to wait for', 'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject', 'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1)'],
        ['latch', 'WAITING', 'parking to wait for', 'java.util.concurrent.CountDownLatch$Sync', 'java.util.concurrent.CountDownLatch.await(CountDownLatch.java:1)'],
        ['park', 'WAITING', 'parking to wait for', 'java.lang.Object', 'java.util.concurrent.locks.LockSupport.park(LockSupport.java:1)'],
        ['object-wait', 'WAITING', 'waiting on', 'java.lang.Object', 'java.lang.Object.wait(Object.java:1)'],
    ];
    const text = 'Full thread dump OpenJDK 64-Bit Server VM:\n\n' + waits.map(([name, state, action, type, frame], i) =>
        `"${name}" #${i + 1} prio=5 tid=0x${i + 1} nid=0x${i + 1} waiting\n java.lang.Thread.State: ${state}\n at ${frame}\n - ${action} <0x${100 + i}> (a ${type})\n`).join('\n');
    const dump = analyzeThreadDumpData(text).parsedDumps[0];
    assert.equal(dump.contentionChains.length, 1);
    assert.equal(dump.contentionChains[0].waiters[0].threadName, 'monitor');
    assert.equal(dump.contentionChains[0].owners.length, 0);
    assert.equal(contentionDiagram(dump.contentionChains[0]).nodes[2].label, 'Owner not observed');
});

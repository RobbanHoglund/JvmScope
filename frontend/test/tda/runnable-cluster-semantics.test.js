import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';

test('real JVM sample keeps explicit class-init waits separate from other recurring stacks', () => {
    const text = readFileSync(new URL('../../assets/javautils/tda/samples/real-java-all-3-snapshots.txt', import.meta.url), 'utf8');
    const { runnableStackClusters: clusters } = analyzeThreadDumpData(text);
    const waits = clusters.filter(cluster => cluster.observationKind === 'class-initialization-wait');
    assert.equal(waits.length, 1);
    assert.equal(waits[0].totalOccurrences, 30);
    assert.deepEqual(waits[0].timeline.map(entry => entry.count), [10, 10, 10]);
    for (const cluster of clusters) {
        const kinds = new Set(cluster.members.map(thread => Boolean(thread.classInitializationWaits?.length)));
        assert.equal(kinds.size, 1, 'An explicit initialization wait must not inherit a running stack representative');
    }
    const livelockSample = clusters.find(cluster => cluster.members.some(thread => thread.threadName === 'scenario-livelock-2-agent-1'));
    assert.equal(livelockSample.totalOccurrences, 15);
    assert.deepEqual(livelockSample.timeline.map(entry => entry.count), [5, 5, 5]);
});

test('identical caller frames do not merge distinct class waits or ordinary RUNNABLE observations', () => {
    const snapshot = second => `2026-10-16 12:00:0${second}\nFull thread dump OpenJDK 64-Bit Server VM (25 mixed mode):\n\n` +
        ['', 'example.Target', 'example.target'].map((className, i) =>
            `"worker-${i}" #${i + 1} prio=5 tid=0x${i + 1} nid=${i + 1} runnable\n` +
            `   java.lang.Thread.State: RUNNABLE\n` +
            (className ? `        - waiting on the Class initialization monitor for ${className}\n` : '') +
            `        at example.Worker.run(Worker.java:12)\n`).join('\n');
    const { runnableStackClusters: clusters } = analyzeThreadDumpData([snapshot(0), snapshot(1)].join('\n'));
    assert.equal(clusters.length, 3);
    assert.ok(clusters.every(cluster => cluster.members.length === 2));
    assert.equal(new Set(clusters.map(cluster => cluster.contextKey)).size, 3);
});

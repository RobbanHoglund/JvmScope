import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../../assets/javautils/tda/analysis.js';
import { deadlockDiagrams, classInitializationDiagram } from '../../../assets/javautils/tda/relationship-diagram.js';

for (const capture of ['gh-37178210582-1-zulu-8-all', 'gh-37178916324-1-dragonwell-17-all', 'gh-37180401747-1-bisheng-25-all', 'gh-37178210582-1-zulu-27-all']) {
test(`captured ${capture} retains every reported deadlock wait and closing ownership edge`, () => {
    const text = readFileSync(new URL(`../../../../testdata/jvm-samples/${capture}/classic-sequence.txt`, import.meta.url), 'utf8');
    const dumps = analyzeThreadDumpData(text).parsedDumps;
    let count = 0;
    for (const dump of dumps) for (const cycle of dump.deadlocks) {
        const graphs = deadlockDiagrams(cycle, dump.threads);
        assert.equal(graphs.length, 1);
        assert.equal(graphs[0].closed, true);
        assert.equal(graphs[0].edges.length, cycle.threads.length * 2);
        for (const entry of cycle.threads) {
            const index = graphs[0].nodes.findIndex(n => n.sourceKey === entry.sourceKey);
            const lock = graphs[0].edges.find(e => e.from === index).to;
            const owner = graphs[0].edges.find(e => e.from === lock).to;
            assert.equal(graphs[0].nodes[lock].detail, entry.waitingLockId);
            assert.equal(graphs[0].nodes[owner].sourceKey, entry.heldBySourceKey);
        }
        count++;
    }
    assert.ok(count > 0);
});
}

test('JVM-reported deadlocks with absent thread blocks preserve named evidence without clickable invented threads', () => {
    const text = readFileSync(new URL('../fixtures/unmapped-deadlock-participants.txt', import.meta.url), 'utf8');
    const dump = analyzeThreadDumpData(text).parsedDumps[0];
    const graphs = deadlockDiagrams(dump.deadlocks[0], dump.threads);
    assert.equal(graphs.length, 2);
    assert.ok(graphs.every(g => !g.closed && g.nodes.every(n => !n.sourceKey)));
    assert.equal(graphs[0].nodes[2].label, 'beta');
    assert.equal(graphs[1].nodes[2].label, 'alpha');
});

test('class-initialization stall evidence stays a dependency instead of a confirmed deadlock diagram', () => {
    const text = readFileSync(new URL('../fixtures/class-initialization-stall.txt', import.meta.url), 'utf8');
    const dump = analyzeThreadDumpData(text).parsedDumps[0];
    const graph = classInitializationDiagram(dump.classInitializationChains[0]);
    assert.equal(graph.nodes[0].threads.length, 2);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.closed, false);
    assert.equal(graph.tone, 'initialization');
});

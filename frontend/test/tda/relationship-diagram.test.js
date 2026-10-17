import assert from 'node:assert/strict';
import test from 'node:test';
import { deadlockDiagrams, contentionDiagram, classInitializationDiagram, renderRelationshipDiagram } from '../../assets/javautils/tda/relationship-diagram.js';

const threads = ['a', 'b', 'c'].map(sourceKey => ({ sourceKey, threadName: `worker-${sourceKey}`, javaState: 'BLOCKED' }));
const entry = (from, to, lock) => ({ sourceKey: from, heldBySourceKey: to, threadName: `worker-${from}`, heldBy: `worker-${to}`, waitingLockId: lock });

test('closed graph follows reported owner identities, including shuffled three-thread cycles', () => {
    const cycle = { id: 1, threads: [entry('a', 'b', '0x11'), entry('c', 'a', '0x33'), entry('b', 'c', '0x22')] };
    const [graph] = deadlockDiagrams(cycle, threads);
    assert.equal(graph.closed, true);
    assert.deepEqual(graph.nodes.filter(n => n.kind === 'thread').map(n => n.sourceKey), ['a', 'b', 'c']);
    assert.deepEqual(graph.nodes.filter(n => n.kind === 'resource').map(n => n.detail), ['0x11', '0x22', '0x33']);
    assert.deepEqual(graph.edges.map(e => [e.from, e.to, e.kind]), [[0, 1, 'wait'], [1, 2, 'owner'], [2, 3, 'wait'], [3, 4, 'owner'], [4, 5, 'wait'], [5, 0, 'owner']]);
    assert.equal(cycle.threads[1].sourceKey, 'c', 'source order stays unchanged');
});

test('duplicate names never join threads whose resolved identities differ', () => {
    const sameNames = threads.map(t => ({ ...t, threadName: 'same' }));
    const items = [entry('a', 'b', '0x1'), entry('b', 'a', '0x2')].map(i => ({ ...i, threadName: 'same', heldBy: 'same' }));
    assert.equal(deadlockDiagrams({ threads: items }, sameNames)[0].closed, true);
    items[0].heldBySourceKey = null;
    const graphs = deadlockDiagrams({ threads: items }, sameNames);
    assert.ok(graphs.every(g => !g.closed));
    assert.equal(graphs[0].nodes[2].sourceKey, '');
    assert.match(graphs[0].nodes[2].detail, /not mapped/);
});

test('incomplete, disconnected and stale mappings never get a fabricated closing arrow', () => {
    for (const items of [
        [entry('a', 'b', '0x1')],
        [entry('a', 'b', '0x1'), entry('b', 'b', '0x2')],
        [entry('a', 'b', '0x1'), entry('b', 'a', '0x2'), entry('c', 'c', '0x3')],
        [entry('a', 'absent', '0x1'), entry('absent', 'a', '0x2')],
    ]) assert.ok(deadlockDiagrams({ threads: items }, threads).every(g => !g.closed));
    assert.deepEqual(deadlockDiagrams({ threads: [] }, threads), []);
});

test('contention draws only observed owners and keeps all waiters in progressive disclosure', () => {
    const waiters = Array.from({ length: 15 }, (_, i) => ({ sourceKey: `w${i}`, threadName: `worker-${i}` }));
    const model = contentionDiagram({ lockId: '0x1', waiters, owners: [] });
    assert.equal(model.closed, false);
    assert.equal(model.edges.length, 1);
    const html = renderRelationshipDiagram(model);
    assert.match(html, /Show all 15 threads/);
    assert.equal((html.match(/data-source-key=/g) || []).length, 15);
    assert.match(html, /Owner not observed/);
    assert.equal(contentionDiagram({ owners: threads }).edges.length, 2);
});

test('class initialization arrows require a uniquely resolved initializer, including stall candidates', () => {
    for (const initializers of [[], threads.slice(0, 2)]) {
        const graph = classInitializationDiagram({ className: 'a.Class', waiters: [threads[2]], initializers });
        assert.equal(graph.edges.length, 1);
        assert.equal(graph.nodes[2].role, 'Initializer unresolved');
    }
    const graph = classInitializationDiagram({ className: 'a.Class', waiters: [threads[1]], initializer: threads[0], stallCandidate: true });
    assert.equal(graph.closed, false);
    assert.notEqual(graph.tone, 'deadlock');
    assert.equal(graph.edges[1].label, 'initialized by');
});

test('untrusted thread names, lock types and identities stay text in graph nodes and attributes', () => {
    const name = '<img src=x onerror="alert(1)">';
    const graph = contentionDiagram({ lockId: name, lockType: name, owners: [{ sourceKey: 'a" onclick="x', threadName: name }], waiters: [] });
    const html = renderRelationshipDiagram(graph);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
    assert.match(html, /data-source-key="a&quot; onclick=&quot;x"/);
});

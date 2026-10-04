import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeThreadDump, parseThreadDump } from '../../assets/javautils/tda/parser.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { buildThreadDetailsViewModel } from '../../assets/javautils/tda/thread-modal.js';
import { observedVirtualThreadIds, resolveJsonCarriers } from '../../assets/javautils/tda/dump-to-file.js';
import { filterThreads } from '../../assets/javautils/tda/thread-filters.js';

const record = (tid, extra = {}) => ({ tid, name: `worker-${tid}`, state: 'RUNNABLE', stack: ['example.Work.run(Work.java:1)'], ...extra });
const dump = threads => JSON.stringify({ threadDump: { threadContainers: [{ threads, threadCount: String(threads.length) }] } });
const carrierFact = thread => buildThreadDetailsViewModel(thread).summaryMeta.find(item => item.label === 'Carrier').value;

test('JSON mounts reuse real thread nodes and enable carrier filtering', () => {
    const threads = parseThreadDump(dump([record('23', { virtual: true, carrier: '24' }), record('24')]));
    const [virtual, carrier] = threads;
    assert.equal(virtual.carrierSourceKey, carrier.sourceKey);
    assert.equal(carrier.isCarrierThread, true);
    assert.deepEqual(filterThreads(threads, { onlyCarrier: true }), [carrier]);
    assert.equal(carrierFact(virtual), '#24');
    assert.equal(carrierFact(carrier), 'Carrier thread');
    assert.deepEqual(observedVirtualThreadIds(carrier), ['23']);
    const graph = buildThreadDependencyGraph(threads);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.virtualThreadNodes.length, 0);
    assert.equal(graph.metrics.virtualThreadCount, 1);
    assert.equal(graph.metrics.mountRelationCount, 1);
    assert.equal(graph.threadNodes[0].role, 'virtual');
    assert.equal(graph.threadNodes[1].role, 'carrier');
    assert.deepEqual(graph.resourceEdges.map(({ type, source, target }) => ({ type, source, target })), [
        { type: 'mount', source: `thread:${virtual.sourceKey}`, target: `thread:${carrier.sourceKey}` },
    ]);
    assert.equal(buildThreadDependencyGraph([virtual]).metrics.mountRelationCount, 0, 'filtered graphs have no dangling edge');
    assert.equal(buildThreadDependencyGraph([carrier]).virtualThreadNodes.length, 0, 'filtered graphs do not invent replacement threads');
});

test('re-resolving carrier observations clears stale reverse metadata', () => {
    const threads = parseThreadDump(dump([record('23', { virtual: true, carrier: '24' }), record('24')]));
    resolveJsonCarriers(threads);
    assert.deepEqual(observedVirtualThreadIds(threads[1]), ['23'], 'repeated resolution is idempotent');
    threads[0].carrierThreadId = null;
    resolveJsonCarriers(threads);
    assert.equal(threads[0].carrierSourceKey, null);
    assert.equal(threads[1].isCarrierThread, false);
    assert.deepEqual(observedVirtualThreadIds(threads[1]), []);
    assert.equal(buildThreadDependencyGraph(threads).metrics.mountRelationCount, 0);
});

test('separate observations on one carrier retain all mounts without claiming one current virtual thread', () => {
    const threads = parseThreadDump(dump([record('24'), record('23', { virtual: true, carrier: 24 }), record('25', { virtual: true, carrier: '24' })]));
    assert.deepEqual(observedVirtualThreadIds(threads[0]), ['23', '25']);
    assert.equal(threads[0].carrierVirtualThreadId, null);
    assert.equal(threads[0].mountedVirtualThreadId, null);
    const graph = buildThreadDependencyGraph(threads);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.metrics.mountRelationCount, 2);
});

test('large JVM carrier IDs retain precision and do not use names for identity', () => {
    const threads = parseThreadDump(dump([record('9007199254740993', { name: 'same' }), record('2', { name: 'same', virtual: true, carrier: '9007199254740993' })]));
    assert.equal(threads[1].carrierSourceKey, threads[0].sourceKey);
    assert.equal(carrierFact(threads[1]), '#9007199254740993');
});

for (const [name, records] of [
    ['missing carrier', [record('23', { virtual: true, carrier: '24' })]],
    ['duplicate carrier IDs', [record('23', { virtual: true, carrier: '24' }), record('24'), record('24')]],
    ['duplicate virtual IDs', [record('23', { virtual: true, carrier: '24' }), record('23', { virtual: true, carrier: '24' }), record('24')]],
    ['self reference', [record('23', { virtual: true, carrier: '23' })]],
    ['virtual carrier', [record('23', { virtual: true, carrier: '24' }), record('24', { virtual: true })]],
]) {
    test(`${name} does not invent a mount or carrier`, () => {
        const threads = parseThreadDump(dump(records));
        assert.ok(threads.every(thread => !thread.isCarrierThread && !thread.carrierSourceKey));
        assert.equal(buildThreadDependencyGraph(threads).metrics.mountRelationCount, 0);
        assert.match(carrierFact(threads[0]), /not resolved in dump/);
    });
}

for (const carrier of [{}, 'bad', -1, 9007199254740992]) {
    test(`malformed carrier ${JSON.stringify(carrier)} preserves the thread but marks incomplete evidence`, () => {
        const result = analyzeThreadDump(dump([record('23', { virtual: true, carrier }), record('24')]));
        assert.equal(result.status, 'partial');
        assert.equal(result.snapshots[0].parsedThreads.length, 2);
        assert.equal(result.snapshots[0].parsedThreads[0].carrierThreadId, null);
    });
}

test('unmounted virtual threads and older unknown thread kinds are not described as known platform threads', () => {
    const [virtual] = parseThreadDump(dump([record('23', { virtual: true })]));
    assert.equal(carrierFact(virtual), 'Not reported');
    assert.equal(buildThreadDependencyGraph([virtual]).metrics.virtualThreadCount, 1);
    const [unknown] = parseThreadDump(dump([{ tid: '24', name: 'unknown', stack: [] }]));
    assert.equal(unknown.isVirtualThread, null);
    assert.equal(carrierFact(unknown), 'Not reported');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    analyzeClassInitialization,
    annotateThreadsWithClassInitialization,
    buildClassInitializationChains,
} from '../../assets/javautils/tda/class-initialization.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { parseThreadDump } from '../../assets/javautils/tda/parser.js';

const fixture = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

test('links explicit class-initialization waiters to the exact <clinit> initializer', async () => {
    const threads = parseThreadDump(await fixture('class-initialization-stall.txt'));
    const result = analyzeClassInitialization(threads);
    const [chain] = result.chains;
    const parsedWaiter = threads.find((thread) => thread.threadName === 'class-waiter-1');

    assert.equal(chain.className, 'example.MapMetadataHandler');
    assert.equal(chain.waiterCount, 2);
    assert.equal(chain.initializer.threadName, 'class-initializer');
    assert.equal(chain.status, 'stall-candidate');
    assert.equal(chain.confidence, 'medium');
    assert.equal(chain.initializerWaitingResources[0].lockId, '0x00000000000000aa');
    assert.match(chain.qualification, /not a confirmed hang or deadlock/i);
    assert.equal(parsedWaiter.classInitializationWaits[0].className, 'example.MapMetadataHandler');
    assert.equal(parsedWaiter.classInitializationWaits[0].rawLineNumber, 16);
    assert.equal(chain.initializer.initializingClasses[0].rawLineNumber, 10);
    assert.equal(parsedWaiter.classInitializationChains[0].role, 'waiter');
    assert.equal(chain.initializer.classInitializationBlockedWaiterCount, 2);
});

test('keeps an ownerless class-initialization wait explicit instead of inventing an initializer', () => {
    const waiter = {
        sourceKey: 'waiter',
        threadName: 'waiter',
        classInitializationWaits: [{ className: 'example.Missing' }],
        initializingClasses: [],
        waitingLocks: [],
    };
    const [chain] = buildClassInitializationChains([waiter]);

    assert.equal(chain.status, 'initializer-not-observed');
    assert.equal(chain.initializer, null);
    assert.equal(chain.stallCandidate, false);
});

test('does not call a runnable initializer a stall candidate from waiters alone', () => {
    const initializer = {
        sourceKey: 'initializer',
        threadName: 'initializer',
        javaState: 'RUNNABLE',
        initializingClasses: [{ className: 'example.Active' }],
        classInitializationWaits: [],
        waitingLocks: [],
    };
    const waiter = {
        sourceKey: 'waiter',
        threadName: 'waiter',
        classInitializationWaits: [{ className: 'example.Active' }],
        initializingClasses: [],
        waitingLocks: [],
    };
    const [chain] = buildClassInitializationChains([initializer, waiter]);

    assert.equal(chain.status, 'initializing');
    assert.equal(chain.stallCandidate, false);
});

test('marks both sides of a mutual class-initialization cycle as stall candidates', async () => {
    const threads = parseThreadDump(await fixture('class-initialization-cycle.txt'));
    const { chains } = analyzeClassInitialization(threads);
    const cycleChains = chains.filter((chain) => ['pkg.A', 'pkg.B'].includes(chain.className));

    assert.equal(cycleChains.length, 2);
    assert.ok(cycleChains.every((chain) => chain.status === 'stall-candidate'));
    assert.ok(cycleChains.every((chain) => chain.stallCandidate));
    assert.ok(cycleChains.every((chain) => chain.confidence === 'medium'));
    assert.deepEqual(
        cycleChains.map((chain) => chain.initializerWaitingResources[0].className).sort(),
        ['pkg.A', 'pkg.B'],
    );
});

test('annotates chain participants that are disjoint from the reset thread list', () => {
    const unrelated = { sourceKey: 'unrelated' };
    const waiter = { sourceKey: 'waiter' };
    const initializer = { sourceKey: 'initializer' };
    const chain = {
        waiters: [waiter],
        initializers: [initializer],
        waiterCount: 3,
    };
    const threads = [unrelated];

    const result = annotateThreadsWithClassInitialization(threads, [chain]);

    assert.equal(result, threads);
    assert.deepEqual(unrelated.classInitializationChains, []);
    assert.equal(unrelated.classInitializationBlockedWaiterCount, 0);
    assert.deepEqual(waiter.classInitializationChains[0].chain.waiters.map(t=>t.sourceKey),['waiter']);
    assert.notEqual(waiter.classInitializationChains[0].chain.waiters[0],waiter);
    assert.equal(waiter.classInitializationChains[0].role, 'waiter');
    assert.deepEqual(initializer.classInitializationChains[0].chain.initializers.map(t=>t.sourceKey),['initializer']);
    assert.doesNotThrow(()=>JSON.stringify(threads));
    assert.equal(initializer.classInitializationChains[0].role, 'initializer');
    assert.equal(initializer.classInitializationBlockedWaiterCount, 3);
});

test('does not invent a blocker when more than one initializer candidate is observed', () => {
    const initializer = (sourceKey) => ({
        sourceKey,
        threadName: sourceKey,
        javaState: 'WAITING',
        initializingClasses: [{ className: 'example.Ambiguous' }],
        classInitializationWaits: [],
        waitingLocks: [{ lockId: `lock-${sourceKey}` }],
    });
    const waiter = {
        sourceKey: 'waiter',
        threadName: 'waiter',
        classInitializationWaits: [{ className: 'example.Ambiguous' }],
        initializingClasses: [],
        waitingLocks: [],
    };
    const [chain] = buildClassInitializationChains([
        initializer('candidate-1'),
        initializer('candidate-2'),
        waiter,
    ]);

    assert.equal(chain.status, 'ambiguous-initializer');
    assert.equal(chain.initializer, null);
    assert.equal(chain.initializers.length, 2);
    assert.equal(chain.stallCandidate, false);
});

test('represents class initialization in both resource and direct dependency graphs', async () => {
    const threads = parseThreadDump(await fixture('class-initialization-stall.txt'));
    const graph = buildThreadDependencyGraph(threads);
    const classResource = graph.lockNodes.find((node) =>
        node.resourceKind === 'class-initialization');

    assert.equal(classResource.className, 'example.MapMetadataHandler');
    assert.equal(classResource.waiterIds.length, 2);
    assert.equal(classResource.ownerIds.length, 1);
    assert.equal(graph.metrics.classInitializationResourceCount, 1);
    assert.equal(graph.metrics.classInitializationWaitCount, 2);
    assert.equal(graph.metrics.classInitializerRelationCount, 1);
    assert.equal(graph.dependencyEdges.filter((edge) =>
        edge.className === 'example.MapMetadataHandler').length, 2);
    assert.equal(graph.observedCycles.length, 0);
});

test('detects ten metadata waiters beside header-only VM threads in a synthetic dump', async () => {
    const rawText = await readFile(join(
        import.meta.dirname,
        'fixtures',
        'class-initialization-vm-threads.txt',
    ), 'utf8');
    const threads = parseThreadDump(rawText);
    const { chains } = analyzeClassInitialization(threads);
    const chain = chains.find((item) =>
        item.waiterCount === 10 && item.className === 'example.MetadataCache');

    assert.ok(chain);
    assert.equal(chain.waiterCount, 10);
    assert.equal(chain.initializer.threadName, 'metadata-initializer');
    assert.equal(chain.status, 'stall-candidate');
    assert.equal(chain.initializerWaitingResources[0].lockType, 'a example.StartupFuture');
});

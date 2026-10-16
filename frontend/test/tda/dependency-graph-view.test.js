import assert from 'node:assert/strict';
import test from 'node:test';

import { createThreadDependencyGraphView } from '../../assets/javautils/tda/dependency-graph-view.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { parseThreadDump } from '../../assets/javautils/tda/parser.js';

test('compact projection keeps a six-thread confirmed cycle complete alongside other contention', () => {
    const threads = Array.from({ length: 6 }, (_, i) => ({
        sourceKey: `t${i}`, threadName: `cycle-${i}`, javaState: 'BLOCKED',
    }));
    const deadlocks = [{ id: 1, threads: threads.map((thread, i) => ({
        sourceKey: thread.sourceKey, threadName: thread.threadName,
        heldBy: threads[(i + 1) % threads.length].threadName, waitingLockId: `0x${i + 1}`,
    })) }];
    const view = createThreadDependencyGraphView();
    view.model = buildThreadDependencyGraph([
        ...threads,
        { sourceKey: 'init', initializingClasses: [{ className: 'example.Slow' }] },
        { sourceKey: 'wait', classInitializationWaits: [{ className: 'example.Slow' }] },
    ], deadlocks);
    view.fullNodeById = new Map(view.model.nodes.map(node => [node.id, node]));
    const projection = view.projectionData();
    assert.equal(projection.edges.filter(edge => edge.confirmedDeadlock).length, 12);
    assert.equal(projection.nodes.filter(node => node.deadlocked).length, 12);
    assert.ok(projection.edges.some(edge => edge.type === 'class-init-wait'));
    assert.equal(projection.meta.hiddenLockCount, 0);
    view.options.view = 'dependency';
    assert.equal(view.projectionData().edges.filter(edge => edge.confirmedDeadlock).length, 6);
});

test('graph search finds deeper frames without attributing mounted frames to their carrier', () => {
    const threads = parseThreadDump(`Full thread dump OpenJDK 64-Bit Server VM (25 mixed mode):

"carrier" #10 [10] prio=5 os_prio=0 tid=0x10 [0x1000]
   Carrying virtual thread #20
    at jdk.internal.vm.Continuation.run(Continuation.java:1)
    at example.Carrier.dispatch(Carrier.java:20)
   Mounted virtual thread #20
    at example.Service.handle(Service.java:1)
    at example.Request.deepFrame(Request.java:42)
`);
    const view = createThreadDependencyGraphView();
    const model = buildThreadDependencyGraph(threads);
    view.fullNodeById = new Map(model.nodes.map(node => [node.id, node]));
    view.searchTerm = 'request.deepframe';
    view.updateSearchState();
    assert.equal(view.searchMatches.length, 1);
    assert.equal(view.searchMatches[0].rawThread.isVirtualThread, true);
    view.searchTerm = 'carrier.dispatch';
    view.updateSearchState();
    assert.deepEqual(view.searchMatches.map(node => node.threadName), ['carrier']);
});

test('class resources retain their exact identities in dependency projection and reveal', () => {
    const view = createThreadDependencyGraphView();
    view.model = buildThreadDependencyGraph(['example.Target', 'example.target'].flatMap((className, index) => [
        { sourceKey: `o${index}`, initializingClasses: [{ className }] },
        { sourceKey: `w${index}`, classInitializationWaits: [{ className }] },
    ]));
    view.fullNodeById = new Map(view.model.nodes.map(node => [node.id, node]));
    view.options.view = 'dependency';
    assert.equal(view.projectionData().edges.length, 2);
    const selected = [];
    view.selectNode = id => selected.push(id);
    assert.equal(view.revealLock('class-init:example.Target', { focus: false, center: false }), true);
    assert.equal(view.revealLock('class-init:example.target', { focus: false, center: false }), true);
    assert.deepEqual(selected, ['lock:class-init:example.Target', 'lock:class-init:example.target']);
});

function createClassList() {
    const values = new Set();
    return {
        contains: (value) => values.has(value),
        toggle(value, active) {
            if (active) values.add(value);
            else values.delete(value);
        },
    };
}

async function withFullscreenView(requestFullscreen, run) {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const listeners = new Map();
    const details = { open: false, addEventListener: (event, callback) => listeners.set(event, callback), listeners };
    const root = {
        classList: createClassList(),
        querySelector: (selector) => selector === '#dependencyGraphDetails' ? details : null,
        requestFullscreen,
    };
    globalThis.document = {
        body: { classList: createClassList() },
        fullscreenElement: null,
        addEventListener() {},
        exitFullscreen: async () => {},
    };
    globalThis.window = { addEventListener() {} };
    globalThis.requestAnimationFrame = (callback) => callback();

    try {
        await run(createThreadDependencyGraphView({ root }), root, details);
    } finally {
        globalThis.document = originalDocument;
        globalThis.window = originalWindow;
        globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
}

test('fallback fullscreen opens collapsed details and toggles off', async () => {
    await withFullscreenView(undefined, async (view, root, details) => {
        await view.toggleFullscreen();
        assert.equal(details.open, true);
        assert.equal(view.fallbackExpanded, true);
        assert.equal(root.classList.contains('dependency-graph-expanded'), true);

        await view.toggleFullscreen();
        assert.equal(view.fallbackExpanded, false);
        assert.equal(root.classList.contains('dependency-graph-expanded'), false);
    });
});

test('rejected native fullscreen falls back and toggles off', async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await withFullscreenView(async () => { throw new Error('denied'); }, async (view, root) => {
            await view.toggleFullscreen();
            assert.equal(view.fallbackExpanded, true);

            await view.toggleFullscreen();
            assert.equal(view.fallbackExpanded, false);
            assert.equal(root.classList.contains('dependency-graph-expanded'), false);
        });
    } finally {
        console.warn = originalWarn;
    }
});

test('reveals threads by sourceKey without exposing graph node IDs', async () => {
    await withFullscreenView(undefined, async (view) => {
        view.fullNodeById = new Map([
            ['internal-thread-id', { id: 'internal-thread-id', type: 'thread', sourceKey: 'snapshot:0:tid:0x1' }],
        ]);
        const calls = [];
        view.selectNode = (nodeId, options) => calls.push(['select', nodeId, options]);
        view.focusNeighborhood = (nodeId) => calls.push(['focus', nodeId]);
        view.centerOnNode = (nodeId) => calls.push(['center', nodeId]);

        assert.equal(view.revealThread({ sourceKey: 'snapshot:0:tid:0x1' }), true);
        assert.equal(view.revealThread({ sourceKey: 'missing' }), false);
        assert.deepEqual(calls, [
            ['select', 'internal-thread-id', { center: false, reveal: true }],
            ['focus', 'internal-thread-id'],
            ['center', 'internal-thread-id'],
        ]);
    });
});

test('reveals locks case-insensitively and supports selection without focus', async () => {
    await withFullscreenView(undefined, async (view) => {
        view.fullNodeById = new Map([
            ['internal-lock-id', { id: 'internal-lock-id', type: 'lock', lockId: '0x00AaBb' }],
        ]);
        const calls = [];
        view.selectNode = (nodeId, options) => calls.push(['select', nodeId, options]);
        view.focusNeighborhood = (nodeId) => calls.push(['focus', nodeId]);
        view.centerOnNode = (nodeId) => calls.push(['center', nodeId]);

        assert.equal(view.revealLock('0X00AABB', { focus: false, center: false }), true);
        assert.equal(view.revealLock('0xmissing'), false);
        assert.deepEqual(calls, [
            ['select', 'internal-lock-id', { center: false, reveal: true }],
        ]);
    });
});

test('hides stale hover evidence before rebuilding the graph projection', async () => {
    await withFullscreenView(undefined, async (view) => {
        let hideCalls = 0;
        view.hideTooltip = () => { hideCalls += 1; };
        view.hoveredNodeId = 'old-resource';

        view.rebuildProjection();

        assert.equal(hideCalls, 1);
        assert.equal(view.hoveredNodeId, null);
    });
});


test('opening a collapsed graph refits after layout settles and cancels stale fits', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await withFullscreenView(undefined, async (view, root, details) => {
        let fits = 0;
        view.fitToGraph = () => { fits += 1; };
        view.scheduleFit();
        t.mock.timers.tick(500);
        assert.equal(fits, 0, 'a hidden graph must not consume its initial fit');
        details.open = true;
        details.listeners.get('toggle')();
        t.mock.timers.tick(200);
        view.scheduleFit();
        t.mock.timers.tick(300);
        assert.equal(fits, 0, 'the superseded fit must be cancelled');
        t.mock.timers.tick(120);
        assert.equal(fits, 1);
        view.scheduleFit();
        details.open = false;
        t.mock.timers.tick(500);
        assert.equal(fits, 1, 'closing during layout must not zoom a hidden graph');
    });
});

test('fit bounds include long SVG labels and exclude invalid node positions', async () => {
    await withFullscreenView(undefined, async (view) => {
        const node = { id: 'thread', type: 'thread', x: -30, y: 50 };
        view.visibleNodes = [node, { id: 'pending', type: 'thread', x: NaN, y: Infinity }];
        let measurements = 0;
        view.nodeSelection = { each(callback) {
            callback.call({ getBBox() { measurements += 1; return { x: -20, y: -18, width: 640, height: 45 }; } }, node);
        } };
        const bounds = view.graphBounds(true);
        assert.ok(bounds.x0 <= -50);
        assert.ok(bounds.x1 >= 590, 'the full rendered label must fit');
        assert.ok(bounds.y0 <= 32 && bounds.y1 >= 77);
        assert.ok(Object.values(bounds).every(Number.isFinite));
        view.graphBounds();
        assert.equal(measurements, 1, 'minimap updates must not repeatedly measure SVG text');
        view.nodeSelection = { each(callback) { callback.call({ getBBox() { throw new Error('detached'); } }, node); } };
        assert.ok(Object.values(view.graphBounds(true)).every(Number.isFinite));
        node.label = 'W'.repeat(31);
        view.nodeSelection = { each(callback) { callback.call({ getBBox() { return { x: -10, y: -10, width: 20, height: 20 }; } }, node); } };
        assert.ok(view.graphBounds(true).x1 > node.x + 31 * 13, 'fit must reserve labels hidden by the current zoom');
        view.visibleNodes = [];
        assert.deepEqual(view.graphBounds(true), { x0: 0, y0: 0, x1: view.width, y1: view.height });
    });
});

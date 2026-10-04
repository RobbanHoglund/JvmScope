import assert from 'node:assert/strict';
import test from 'node:test';

import {
    filterThreads,
    normalizeThreadFilterState,
    threadMatchesFilters,
} from '../../assets/javautils/tda/thread-filters.js';

function thread(overrides = {}) {
    return {
        index: 0,
        threadName: 'worker',
        javaState: 'RUNNABLE',
        daemon: false,
        isDeadlocked: false,
        isCarrierThread: false,
        cpuMs: 0,
        elapsedS: 0,
        allocatedBytes: 0,
        findings: [],
        ...overrides,
    };
}

test('normalizes missing and malformed filter state conservatively', () => {
    assert.deepEqual(normalizeThreadFilterState(), {
        searchTerm: '',
        onlyDaemon: false,
        stateGroups: [],
        onlyDeadlocked: false,
        onlyCarrier: false,
        chartFilter: null,
    });
    assert.deepEqual(normalizeThreadFilterState({
        searchTerm: '  LOCK  ',
        onlyDaemon: 1,
        stateGroups: ['WAITING', 'blocked', 'WAITING', 'unknown'],
        chartFilter: { kind: 'state', value: 'RUNNABLE', label: 'ignored' },
    }), {
        searchTerm: 'lock',
        onlyDaemon: true,
        stateGroups: ['BLOCKED', 'WAITING'],
        onlyDeadlocked: false,
        onlyCarrier: false,
        chartFilter: { kind: 'state', value: 'RUNNABLE' },
    });
    assert.equal(normalizeThreadFilterState({ chartFilter: { kind: '', value: 'RUNNABLE' } }).chartFilter, null);
    assert.equal(normalizeThreadFilterState({ chartFilter: { kind: 'state', value: '  ' } }).chartFilter, null);
    assert.equal(normalizeThreadFilterState({ chartFilter: 'state:RUNNABLE' }).chartFilter, null);
});

test('treats BLOCKED and WAITING controls as an OR state group', () => {
    const threads = [
        thread({ threadName: 'blocked', javaState: 'BLOCKED' }),
        thread({ threadName: 'waiting', javaState: 'WAITING' }),
        thread({ threadName: 'timed', javaState: 'TIMED_WAITING' }),
        thread({ threadName: 'running', javaState: 'RUNNABLE' }),
    ];

    const result = filterThreads(threads, { stateGroups: ['BLOCKED', 'WAITING'] });

    assert.deepEqual(result.map((item) => item.threadName), ['blocked', 'waiting', 'timed']);
    assert.deepEqual(filterThreads(threads, { stateGroups: [] }), threads);
});

test('combines orthogonal controls with AND semantics', () => {
    const matching = thread({
        threadName: 'matching',
        javaState: 'BLOCKED',
        daemon: true,
        isDeadlocked: true,
        isCarrierThread: true,
    });
    const threads = [
        matching,
        thread({ threadName: 'not-daemon', javaState: 'BLOCKED', isDeadlocked: true, isCarrierThread: true }),
        thread({ threadName: 'not-deadlocked', javaState: 'BLOCKED', daemon: true, isCarrierThread: true }),
        thread({ threadName: 'not-carrier', javaState: 'BLOCKED', daemon: true, isDeadlocked: true }),
    ];

    const result = filterThreads(threads, {
        onlyDaemon: true,
        stateGroups: ['BLOCKED'],
        onlyDeadlocked: true,
        onlyCarrier: true,
    });

    assert.deepEqual(result, [matching]);
});

test('combines text, controls, chart, and focused indexes deterministically', () => {
    const threads = [
        thread({ index: 1, threadName: 'api-worker', daemon: true, javaState: 'RUNNABLE', cpuMs: 50 }),
        thread({ index: 2, threadName: 'api-idle', daemon: true, javaState: 'WAITING', cpuMs: 50 }),
        thread({ index: 3, threadName: 'batch-worker', daemon: true, javaState: 'RUNNABLE', cpuMs: 50 }),
        thread({ index: 4, threadName: 'api-cold', daemon: true, javaState: 'RUNNABLE', cpuMs: 2 }),
    ];

    const result = filterThreads(threads, {
        searchTerm: 'api',
        onlyDaemon: true,
        chartFilter: { kind: 'state', value: 'RUNNABLE' },
    }, new Set([1, 2, 4]));

    assert.deepEqual(result.map((item) => item.threadName), ['api-worker', 'api-cold']);
});

test('matches search within individual fields without crossing field boundaries', () => {
    const candidate = thread({
        threadName: 'alpha',
        scenarioLabel: 'beta',
        scenarioReason: 'Lock owner observed',
        scenarioEvidence: { label: 'JVM FACT', basis: 'Monitor identifier' },
        findings: [{ label: 'Many waiters', reason: 'Three blocked threads' }],
        crossSnapshotDiagnostics: {
            status: 'available',
            diagnostics: [{ label: 'CPU hot', trend: 'growing', reason: 'Latest endpoint' }],
            rootCauseLinks: [{ lockId: '0xabc', reason: 'Prior contention' }],
        },
    });

    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'lock owner' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'many waiters' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: '0xabc' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'alpha beta' }), false);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'alpha | beta' }), false);
});

test('searches every raw and normalized stack line case-insensitively', () => {
    const candidate = thread({
        topFrame: 'com.example.Api.handle(Api.java:10)',
        rawBlock: [
            '"worker" #12 prio=5 tid=0x1 nid=0x2 RUNNABLE',
            '   at com.example.Api.handle(Api.java:10)',
            '   at com.example.persistence.OrderRepository.load(OrderRepository.java:87)',
            '   - locked <0x00000000abc123ef> (a java.lang.Object)',
        ],
        stackLines: ['at com.example.messaging.EventDispatcher.dispatch(EventDispatcher.java:53)'],
        normalizedFrames: [
            'com.example.Api.handle()',
            'com.example.persistence.OrderRepository.load()',
        ],
    });

    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'orderrepository.load' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'ORDERREPOSITORY.JAVA:87' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'locked <0x00000000abc123ef>' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'eventdispatcher.java:53' }), true);
});

test('searches carrier and mounted virtual-thread stacks when raw blocks omit them', () => {
    const candidate = thread({
        carrierStackLines: ['at java.util.concurrent.ForkJoinPool.runWorker(ForkJoinPool.java:1622)'],
        mountedVirtualStackLines: ['at com.example.CheckoutTask.call(CheckoutTask.java:41)'],
    });

    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'forkjoinpool.runworker' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'checkouttask.java:41' }), true);
});

test('keeps full-stack search literal and isolated to individual lines', () => {
    const candidate = thread({
        rawBlock: [
            '   at com.example.alpha.Service.call(Service.java:10)',
            '   at com.example.beta.Worker.run(Worker.java:20)',
            '   at com.example.Patterns.match(foo.*bar:30)',
        ],
    });

    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'alpha.service' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'foo.*bar' }), true);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'alpha.service beta.worker' }), false);
    assert.equal(threadMatchesFilters(candidate, { searchTerm: 'fooZZbar' }), false);
    assert.equal(threadMatchesFilters(thread({ rawBlock: null }), { searchTerm: 'service.call' }), false);
});

test('uses exact inclusive chart bucket boundaries', () => {
    const cases = [
        [{ kind: 'cpu', value: '0 ms' }, { cpuMs: 0 }, true],
        [{ kind: 'cpu', value: '0–1 ms' }, { cpuMs: 1 }, false],
        [{ kind: 'cpu', value: '1–10 ms' }, { cpuMs: 1 }, true],
        [{ kind: 'cpu', value: '10–100 ms' }, { cpuMs: 100 }, false],
        [{ kind: 'cpu', value: '100+ ms' }, { cpuMs: 100 }, true],
        [{ kind: 'elapsed', value: '<1s' }, { elapsedS: 1 }, false],
        [{ kind: 'elapsed', value: '1–10s' }, { elapsedS: 1 }, true],
        [{ kind: 'elapsed', value: '10–60s' }, { elapsedS: 60 }, false],
        [{ kind: 'elapsed', value: '1–10m' }, { elapsedS: 60 }, true],
        [{ kind: 'elapsed', value: '10m+' }, { elapsedS: 600 }, true],
        [{ kind: 'allocated', value: '1–4 KB' }, { allocatedBytes: 4096 }, false],
        [{ kind: 'allocated', value: '4–64 KB' }, { allocatedBytes: 4096 }, true],
        [{ kind: 'allocated', value: '64 KB–1 MB' }, { allocatedBytes: 1048576 }, false],
        [{ kind: 'allocated', value: '1–64 MB' }, { allocatedBytes: 1048576 }, true],
        [{ kind: 'allocated', value: '1–64 MB' }, { allocatedBytes: 64 * 1048576 }, false],
        [{ kind: 'allocated', value: '64 MB–1 GB' }, { allocatedBytes: 64 * 1048576 }, true],
        [{ kind: 'allocated', value: '1 GB+' }, { allocatedBytes: 1024 * 1048576 }, true],
        [{ kind: 'allocation-rate', value: '<1 MiB/s' }, { allocationRateBytesPerSecond: 1048576 }, false],
        [{ kind: 'allocation-rate', value: '1–10 MiB/s' }, { allocationRateBytesPerSecond: 1048576 }, true],
        [{ kind: 'allocation-rate', value: '10–64 MiB/s' }, { allocationRateBytesPerSecond: 10 * 1048576 }, true],
        [{ kind: 'allocation-rate', value: '64 MiB/s+' }, { allocationRateBytesPerSecond: 64 * 1048576 }, true],
    ];

    for (const [chartFilter, overrides, expected] of cases) {
        assert.equal(threadMatchesFilters(thread(overrides), { chartFilter }), expected, JSON.stringify(chartFilter));
    }
});

test('fails closed for invalid chart filters and unavailable metrics', () => {
    assert.equal(threadMatchesFilters(thread(), { chartFilter: { kind: 'future', value: 'x' } }), false);
    assert.equal(threadMatchesFilters(thread({ cpuMs: null }), { chartFilter: { kind: 'cpu', value: '0 ms' } }), false);
    assert.equal(threadMatchesFilters(thread({ elapsedS: Number.NaN }), { chartFilter: { kind: 'elapsed', value: '<1s' } }), false);
    assert.equal(threadMatchesFilters(thread({ allocatedBytes: undefined }), { chartFilter: { kind: 'allocated', value: '0 B' } }), false);
    assert.equal(threadMatchesFilters(thread({ allocationRateBytesPerSecond: null }), { chartFilter: { kind: 'allocation-rate', value: '0 B/s' } }), false);
});

test('does not mutate the input array or thread objects', () => {
    const first = thread({ index: 1, threadName: 'first' });
    const second = thread({ index: 2, threadName: 'second' });
    const threads = [first, second];

    const result = filterThreads(threads, { searchTerm: 'second' });

    assert.deepEqual(result, [second]);
    assert.deepEqual(threads, [first, second]);
    assert.equal(Object.hasOwn(first, '_displayIndex'), false);
    assert.equal(Object.hasOwn(second, '_displayIndex'), false);
});

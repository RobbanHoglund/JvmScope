import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeThreadDump, parseDeadlocks, parseThreadDump } from '../../assets/javautils/tda/parser.js';
import { annotateDeadlocks } from '../../assets/javautils/tda/deadlocks.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';
import { annotateLockPrecedence } from '../../assets/javautils/tda/lock-precedence.js';

const header = (name, id) => `"${name}" #${id} [${id}] prio=5 os_prio=0 cpu=1ms elapsed=2s tid=0x${id} nid=${id} runnable [0x1000]`;
const block = (name, id, state, lines = []) => [header(name, id), `   java.lang.Thread.State: ${state}`, ...lines, ''].join('\n');

test('Object.wait releases only its own monitor, including reentrant lexical hold lines', () => {
    const raw = block('waiter', 1, 'WAITING (on object monitor)', [
        '\tat java.lang.Object.wait0(Native Method)',
        '\t- waiting on <0xA> (a java.lang.Object)',
        '\tat example.Work.await(Work.java:10)',
        '\t- locked <0xa> (a java.lang.Object)',
        '\t- locked <0xa> (a java.lang.Object)',
        '\t- locked <0xb> (a example.Outer)',
    ]);
    const threads = parseThreadDump(raw);
    assert.deepEqual(threads[0].heldLocks.map(lock => lock.lockId), ['0xb']);
    assert.equal(threads[0].locksHeldCount, 1);
    assert.equal(threads[0].waitingLocks[0].kind, 'monitor-wait');
    const graph = buildThreadDependencyGraph(threads);
    assert.equal(graph.metrics.awaitRelationCount, 1);
    assert.equal(graph.metrics.dependencyCount, 0);
    assert.deepEqual(graph.lockNodes.find(lock => lock.lockId === '0xA').ownerIds, []);
});

test('a notified waiter is blocked by the actual monitor owner rather than owning the monitor', () => {
    const raw = block('waiter', 1, 'BLOCKED (on object monitor)', [
        '\tat java.lang.Object.wait0(Native Method)',
        '\t- waiting to re-lock in wait() <0xa> (a java.lang.Object)',
        '\tat example.Work.await(Work.java:10)',
        '\t- locked <0xa> (a java.lang.Object)',
    ]) + block('owner', 2, 'TIMED_WAITING (sleeping)', [
        '\tat java.lang.Thread.sleep0(Native Method)',
        '\t- locked <0xa> (a java.lang.Object)',
    ]);
    const threads = parseThreadDump(raw);
    assert.equal(threads[0].waitingToLock.lockId, '0xa');
    assert.deepEqual(threads[0].heldLocks, []);
    const graph = buildThreadDependencyGraph(threads);
    assert.equal(graph.dependencyEdges.length, 1);
    assert.equal(graph.dependencyEdges[0].source, `thread:${threads[0].sourceKey}`);
    assert.equal(graph.dependencyEdges[0].target, `thread:${threads[1].sourceKey}`);
    assert.equal(graph.metrics.ambiguousWaitCount, 0);
    annotateLockPrecedence([{ index: 0, threads }], []);
    assert.equal(threads[0].lockAssessment.observedContentions.length, 1);
    assert.equal(threads[1].lockAssessment.likelyBlockers.length, 1);
});

test('empty, quoted, and field-like names remain separate without leaking fields into headers', () => {
    const names = ['before', '', 'worker-"quoted"', 'name allocated=99G defined_classes=99', 'name" #999 prio=9 tid=0x999'];
    const raw = names.map((name, index) => block(name, index + 1, index ? 'WAITING' : 'RUNNABLE', [
        `\tat example.Work${index}.run(Work.java:1)`,
    ])).join('');
    const threads = parseThreadDump(raw);
    assert.deepEqual(threads.map(thread => thread.threadName), names);
    assert.equal(threads[0].javaState, 'RUNNABLE');
    for (const [index, thread] of threads.entries()) {
        assert.equal(thread.jvmId, index + 1);
        assert.equal(thread.allocatedBytes, null);
        assert.equal(thread.definedClasses, null);
        assert.equal(thread.stackFrames, 1);
        assert.equal(raw.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n'), thread.rawBlock.join('\n'));
    }
    assert.equal(analyzeThreadDump(raw).status, 'success');
});

test('an unsupported header isolates its stack and marks a mixed dump partial', () => {
    const raw = block('before', 1, 'RUNNABLE', ['\tat example.Before.run(Before.java:1)'])
        + '"future" #2 future_scheduler=5\n   java.lang.Thread.State: BLOCKED\n\tat example.Other.run(Other.java:1)\n'
        + block('after', 3, 'WAITING', ['\tat example.After.run(After.java:1)']);
    const threads = parseThreadDump(raw);
    assert.deepEqual(threads.map(thread => thread.threadName), ['before', 'after']);
    assert.equal(threads[0].javaState, 'RUNNABLE');
    assert.equal(threads[0].stackFrames, 1);
    const result = analyzeThreadDump(raw);
    assert.equal(result.status, 'partial');
    assert.equal(result.diagnostics.unparsedThreadHeaders, 1);
    assert.match(result.warnings.join(' '), /could not be parsed/);
});

test('classic JVM IDs prevent correlation and rate calculation for replacement threads', () => {
    const raw = id => `"worker" #${id} prio=5 os_prio=0 cpu=${id}ms elapsed=${id}s tid=0xa nid=0xb runnable [0x1000]\n   java.lang.Thread.State: RUNNABLE\n`;
    const dumps = [5, 6].map((id, index) => ({ index, threads: parseThreadDump(raw(id), { snapshotIndex: index }) }));
    assert.deepEqual(dumps.map(dump => dump.threads[0].jvmId), [5, 6]);
    assert.equal(dumps[0].threads[0].stateText, 'runnable');
    const correlation = correlateThreadsAcrossSnapshots(dumps);
    annotateCpuRates(correlation.dumps, correlation.series);
    assert.equal(dumps[1].threads[0].seriesMatchReason, 'conflicting-identifiers');
    assert.equal(dumps[1].threads[0].cpuRatePercent, null);
});

function deadlockDump(names = ['worker', 'worker'], { omitStacks = false, synchronizers = false } = {}) {
    const [first, second] = names;
    const own = id => synchronizers
        ? ['Locked ownable synchronizers:', `\t- <${id}> (a example.Lock)`]
        : [`\t- locked <${id}> (a example.Lock)`];
    const wait = id => `\t- ${synchronizers ? 'parking to wait for' : 'waiting to lock'} <${id}> (a example.Lock)`;
    const reportedWait = id => synchronizers
        ? `  waiting for ownable synchronizer ${id}, (a example.Lock),`
        : `  waiting to lock monitor 0xf (object ${id}, a example.Lock),`;
    return (omitStacks ? '' : block(first, 1, 'BLOCKED', [wait('0xb'), ...own('0xa')])
        + block(second, 2, 'BLOCKED', [wait('0xa'), ...own('0xb')])) + [
        'Found one Java-level deadlock:',
        '=============================',
        `"${first}":`, reportedWait('0xb'), `  which is held by "${second}"`, '',
        `"${second}":`, reportedWait('0xa'), `  which is held by "${first}"`, '',
        'Java stack information for the threads listed above:',
    ].join('\n');
}

for (const names of [['worker', 'worker'], ['', ''], ['worker-"quoted"', 'worker-"quoted"'], ['alpha', 'beta']]) {
    test(`deadlock entries retain exact participant identities for ${JSON.stringify(names)}`, () => {
        const raw = deadlockDump(names);
        const threads = parseThreadDump(raw);
        const cycles = parseDeadlocks(raw);
        assert.equal(cycles.length, 1);
        assert.equal(cycles[0].threads.length, 2);
        // Exercise the graph both as a standalone consumer and after UI annotation.
        for (const annotate of [false, true]) {
            if (annotate) assert.deepEqual(annotateDeadlocks(threads, cycles), []);
            const graph = buildThreadDependencyGraph(threads, cycles);
            assert.equal(graph.metrics.deadlockedThreadCount, 2);
            assert.equal(graph.dependencyEdges.length, 2);
            assert.ok(graph.dependencyEdges.every(edge => edge.confirmedDeadlock && edge.source !== edge.target));
            assert.ok(graph.lockNodes.every(lock => lock.ownerIds.length === 1));
        }
        assert.equal(threads[0].deadlockHoldingLockId, '0xa');
        assert.equal(threads[1].deadlockHoldingLockId, '0xb');
    });
}

test('ambiguous deadlock entries survive without fabricated self-dependencies or ownership', () => {
    const cycles = parseDeadlocks(deadlockDump(['worker', 'worker'], { omitStacks: true }));
    const threads = parseThreadDump(block('worker', 1, 'BLOCKED') + block('worker', 2, 'BLOCKED'));
    assert.equal(cycles[0].threads.length, 2);
    assert.equal(annotateDeadlocks(threads, cycles).length, 4);
    assert.ok(cycles[0].threads.every(item => item.mappingStatus === 'ambiguous' && item.heldByMappingStatus === 'ambiguous'));
    const graph = buildThreadDependencyGraph(threads, cycles);
    assert.equal(graph.dependencyEdges.length, 0);
    assert.equal(graph.metrics.deadlockedThreadCount, 0);
    assert.equal(graph.metrics.confirmedDeadlockCycleCount, 1);
});

test('ownable-synchronizer deadlocks resolve duplicate names using lock identities', () => {
    const raw = deadlockDump(['worker', 'worker'], { synchronizers: true });
    const threads = parseThreadDump(raw);
    const cycles = parseDeadlocks(raw);
    assert.deepEqual(annotateDeadlocks(threads, cycles), []);
    assert.deepEqual(cycles[0].threads.map(item => item.waitingLockId), ['0xb', '0xa']);
    const graph = buildThreadDependencyGraph(threads, cycles);
    assert.equal(graph.metrics.deadlockedThreadCount, 2);
    assert.ok(graph.dependencyEdges.every(edge => edge.source !== edge.target && edge.confirmedDeadlock));
});

test('separate JVM deadlock sections preserve repeated names without collapsing cycles', () => {
    const cycles = parseDeadlocks(deadlockDump() + '\n' + deadlockDump());
    assert.equal(cycles.length, 2);
    assert.deepEqual(cycles.map(cycle => cycle.threads.length), [2, 2]);
});

test('a missing deadlock reference never resolves to a thread with an empty name', () => {
    const threads = parseThreadDump(block('', 1, 'BLOCKED'));
    const graph = buildThreadDependencyGraph(threads, [{ id: 1, threads: [null, { threadName: '', heldBy: null }] }]);
    assert.equal(graph.dependencyEdges.length, 0);
    assert.equal(graph.resourceEdges.length, 0);
});

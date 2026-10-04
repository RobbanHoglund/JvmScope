import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeSnapshotProblems } from '../../assets/javautils/tda/smart-analysis.js';
import { annotateLockPrecedence } from '../../assets/javautils/tda/lock-precedence.js';

function thread(index, name, overrides = {}) {
    return {
        index,
        sourceKey: `snapshot:0:thread:${index}`,
        threadName: name,
        javaState: 'RUNNABLE',
        cpuMs: null,
        allocatedBytes: null,
        waitingLocks: [],
        waitingSynchronizers: [],
        findings: [],
        ...overrides,
    };
}

function finding(result, id) {
    return result.findings.find((entry) => entry.id === id);
}

test('prioritizes a JVM-reported deadlock over measured secondary symptoms', () => {
    const first = thread(1, 'deadlock-1', {
        isDeadlocked: true,
        scenarioKey: 'deadlock',
        scenarioSeverity: 'critical',
        scenarioConfidence: 'high',
    });
    const second = thread(2, 'deadlock-2', {
        isDeadlocked: true,
        scenarioKey: 'deadlock',
        scenarioSeverity: 'critical',
        scenarioConfidence: 'high',
        findings: [{ key: 'cpu-hot', severity: 'high', confidence: 'high' }],
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 87,
    });
    const result = analyzeSnapshotProblems({
        snapshot: {
            threads: [first, second],
            deadlocks: [{
                id: 1,
                threads: [
                    { waitingLockId: '0x1', holdingLockId: '0x2' },
                    { waitingLockId: '0x2', holdingLockId: '0x1' },
                ],
            }],
        },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    assert.equal(result.findings[0].id, 'confirmed-deadlock');
    assert.equal(result.findings[0].severity, 'critical');
    assert.equal(result.findings[0].evidence.level, 'fact');
    assert.equal(result.findings[0].threads.length, 2);
    assert.equal(result.counts.critical, 1);
    assert.ok(finding(result, 'cpu-hot'));
});

test('does not turn expected sleeping, waiting, or idle executor states into problems', () => {
    const result = analyzeSnapshotProblems({
        snapshot: {
            threads: [
                thread(1, 'sleeper', { javaState: 'TIMED_WAITING', scenarioKey: 'sleeping' }),
                thread(2, 'notifier', { javaState: 'WAITING', scenarioKey: 'object-wait' }),
                thread(3, 'pool-worker', { javaState: 'WAITING', scenarioKey: 'executor-idle' }),
            ],
        },
    });

    assert.equal(result.status, 'no-material-findings');
    assert.equal(result.findings.length, 0);
    assert.match(result.summary, /not proof/i);
    assert.ok(result.limitations.some((item) => /Only one snapshot/i.test(item)));
});

test('reports a stalled class initializer with all initializer and waiter threads', () => {
    const initializer = thread(1, 'initializer', {
        javaState: 'WAITING',
        scenarioKey: 'class-initialization-stall',
        scenarioSeverity: 'high',
        scenarioConfidence: 'medium',
    });
    const waiter1 = thread(2, 'waiter-1', { scenarioKey: 'class-initialization-wait' });
    const waiter2 = thread(3, 'waiter-2', { scenarioKey: 'class-initialization-wait' });
    const result = analyzeSnapshotProblems({
        snapshot: {
            threads: [initializer, waiter1, waiter2],
            classInitializationChains: [{
                className: 'pkg.MapMetadataHandler',
                stallCandidate: true,
                initializer,
                initializers: [initializer],
                waiters: [waiter1, waiter2],
                waiterCount: 2,
                initializerWaitingResources: [{ lockId: '0xfuture' }],
            }],
        },
    });

    const classFinding = finding(result, 'class-initialization-stall');
    assert.equal(classFinding.severity, 'high');
    assert.equal(classFinding.confidence, 'medium');
    assert.equal(classFinding.threads.length, 3);
    assert.deepEqual(classFinding.resourceIds, ['0xfuture']);
    assert.match(classFinding.qualification, /not a confirmed hang or deadlock/i);
});

test('separates an inferred lock bottleneck from observed contention effects', () => {
    const owner = thread(1, 'owner', {
        heldLocks: [{ lockId: '0xlock', kind: 'monitor' }],
        blockedWaiterCount: 3,
        findings: [{
            key: 'likely-lock-bottleneck',
            severity: 'high',
            confidence: 'low',
        }],
    });
    const waiters = [2, 3, 4].map((index) => thread(index, `waiter-${index}`, {
        javaState: 'WAITING',
        scenarioKey: 'reentrant-lock-contention',
        scenarioSeverity: 'high',
        scenarioConfidence: 'high',
        waitingSynchronizers: [{ lockId: '0xlock' }],
        waitingLocks: [{ lockId: '0xlock', kind: 'synchronizer-park' }],
        lockAssessment: {
            tier: 'contention',
            observedContentions: [{ lockId: '0xlock', kind: 'synchronizer-park' }],
        },
    }));
    annotateLockPrecedence([{ index: 0, threads: [owner, ...waiters] }], []);
    const result = analyzeSnapshotProblems({
        snapshot: {
            threads: [owner, ...waiters],
            contentionChains: [{ lockId: '0xlock', owners: [owner], waiters }],
        },
    });

    const bottleneck = finding(result, 'likely-lock-bottleneck');
    const contention = finding(result, 'observed-lock-contention');
    assert.equal(bottleneck.confidence, 'low');
    assert.equal(bottleneck.threads.length, 4);
    assert.equal(contention.confidence, 'high');
    assert.equal(contention.threads.length, 3);
    assert.deepEqual(contention.resourceIds, ['0xlock']);
});

test('groups measured CPU and allocation findings without calling allocation a leak', () => {
    const cpu = thread(1, 'cpu-hot', {
        cpuMs: 1500,
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 72.5,
        scenarioKey: 'cpu-hot',
        scenarioSeverity: 'high',
        scenarioConfidence: 'high',
    });
    const allocator = thread(2, 'allocator', {
        allocatedBytes: 50_000_000,
        allocationDeltaStatus: 'computed',
        allocationRateBytesPerSecond: 25 * 1024 * 1024,
        scenarioKey: 'allocation-hot',
        scenarioSeverity: 'high',
        scenarioConfidence: 'high',
    });
    const result = analyzeSnapshotProblems({
        snapshot: { threads: [cpu, allocator] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    const cpuFinding = finding(result, 'cpu-hot');
    const allocationFinding = finding(result, 'allocation-hot');
    assert.equal(cpuFinding.evidence.level, 'measured');
    assert.equal(cpuFinding.confidence, 'high');
    assert.equal(allocationFinding.evidence.level, 'measured');
    assert.equal(allocationFinding.confidence, 'high');
    assert.match(allocationFinding.summary, /not retained heap or a memory leak/i);
    assert.match(allocationFinding.facts[0].value, /MiB\/s/);
    assert.equal(result.coverage.measuredCpuRates, 1);
    assert.equal(result.coverage.measuredAllocationRates, 1);
});

test('uses the lowest contributor confidence without treating the fallback as a cap', () => {
    const highConfidence = thread(1, 'cpu-high-confidence', {
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 70,
        scenarioKey: 'cpu-hot',
        scenarioSeverity: 'high',
        scenarioConfidence: 'high',
    });
    const mediumConfidence = thread(2, 'cpu-medium-confidence', {
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 45,
        scenarioKey: 'cpu-hot',
        scenarioSeverity: 'high',
        scenarioConfidence: 'medium',
    });

    const result = analyzeSnapshotProblems({
        snapshot: { threads: [highConfidence, mediumConfidence] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    assert.equal(finding(result, 'cpu-hot').confidence, 'medium');
});

test('uses the highest contributor severity without treating the fallback as a floor', () => {
    const cpuFinding = (index, severity) => thread(index, `cpu-${severity}-${index}`, {
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 50,
        scenarioKey: 'cpu-hot',
        scenarioSeverity: severity,
        scenarioConfidence: 'high',
    });
    const allInfo = analyzeSnapshotProblems({
        snapshot: { threads: [cpuFinding(1, 'info'), cpuFinding(2, 'info')] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });
    const mixed = analyzeSnapshotProblems({
        snapshot: { threads: [cpuFinding(3, 'info'), cpuFinding(4, 'high')] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    assert.equal(finding(allInfo, 'cpu-hot').severity, 'info');
    assert.equal(finding(mixed, 'cpu-hot').severity, 'high');
});

test('reports interval CPU when an application thread is parked at capture time', () => {
    const parked = thread(1, 'cached-worker', {
        javaState: 'TIMED_WAITING',
        cpuMs: 32275.1,
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 28.4395,
        findings: [{ key: 'cpu-hot', severity: 'high', confidence: 'high' }],
    });
    const result = analyzeSnapshotProblems({
        snapshot: { threads: [parked] },
        snapshotIndex: 2,
        snapshotCount: 3,
    });

    const cpuFinding = finding(result, 'cpu-hot');
    assert.ok(cpuFinding);
    assert.equal(cpuFinding.threads[0].state, 'TIMED_WAITING');
    assert.match(cpuFinding.summary, /endpoint state describes capture time/i);
    assert.doesNotMatch(cpuFinding.summary, /RUNNABLE application thread/);
});

test('surfaces measured selector and event-loop CPU in Smart Analysis', () => {
    const eventLoop = thread(1, 'event-loop', {
        cpuMs: 5000,
        cpuDeltaStatus: 'computed',
        cpuRatePercent: 15,
        scenarioKey: 'hot-selector-event-loop',
        scenarioSeverity: 'high',
        scenarioConfidence: 'high',
        findings: [{ key: 'infra-hot', severity: 'high', confidence: 'high' }],
    });
    const result = analyzeSnapshotProblems({
        snapshot: { threads: [eventLoop] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    const infrastructureFinding = finding(result, 'infra-hot');
    assert.ok(infrastructureFinding);
    assert.equal(infrastructureFinding.evidence.level, 'mixed');
    assert.equal(infrastructureFinding.facts[0].value, '15.0%');
});

test('does not promote inferred lock frames or stale rate badges to observed measurements', () => {
    const inferredWaiter = thread(1, 'inferred-waiter', {
        scenarioKey: 'reentrant-lock-contention',
        waitingLocks: [],
        lockAssessment: { tier: 'none', observedContentions: [] },
    });
    const conditionWaiter = thread(4, 'condition-waiter', {
        scenarioKey: 'condition-await',
        waitingLocks: [{ lockId: '0xcondition', kind: 'synchronizer-park' }],
        lockAssessment: {
            tier: 'contention',
            observedContentions: [{ lockId: '0xcondition', kind: 'synchronizer-park' }],
        },
    });
    const unsafeCpu = thread(2, 'unsafe-cpu', {
        scenarioKey: 'cpu-hot',
        cpuDeltaStatus: 'counter-reset',
        cpuRatePercent: 85,
    });
    const unsafeAllocator = thread(3, 'unsafe-allocator', {
        scenarioKey: 'allocation-hot',
        allocationDeltaStatus: 'invalid-interval',
        allocationRateBytesPerSecond: 50 * 1024 * 1024,
    });
    const result = analyzeSnapshotProblems({
        snapshot: { threads: [inferredWaiter, conditionWaiter, unsafeCpu, unsafeAllocator] },
        snapshotIndex: 1,
        snapshotCount: 2,
    });

    assert.equal(finding(result, 'observed-lock-contention'), undefined);
    assert.equal(finding(result, 'cpu-hot'), undefined);
    assert.equal(finding(result, 'allocation-hot'), undefined);
    assert.equal(result.status, 'no-material-findings');
});

test('keeps possible livelock and starvation explicitly low-confidence', () => {
    const livelock = thread(1, 'worker', {
        scenarioKey: 'cpu-hot',
        findings: [{ key: 'possible-livelock', severity: 'medium', confidence: 'low' }],
    });
    const starvation = thread(2, 'holder', {
        lockAssessment: { transitions: { status: 'compared', intervalMs: 1000, contentionAtBothEndpoints: [{ lockId: '0x1' }] } },
        scenarioKey: 'possible-starvation',
        scenarioSeverity: 'medium',
        scenarioConfidence: 'low',
    });
    const result = analyzeSnapshotProblems({ snapshot: { threads: [livelock, starvation] } });

    assert.equal(finding(result, 'possible-livelock').confidence, 'low');
    assert.equal(finding(result, 'possible-livelock').evidence.level, 'heuristic');
    assert.equal(finding(result, 'possible-starvation').confidence, 'low');
});

test('does not invent a cycle count when only deadlock flags remain', () => {
    const result = analyzeSnapshotProblems({ snapshot: { threads: [thread(1, 'worker', { isDeadlocked: true })] } });
    const deadlock = finding(result, 'confirmed-deadlock');
    assert.match(deadlock.summary, /cycle report is unavailable/);
    assert.equal(deadlock.facts.find(f => f.label === 'JVM-reported cycles').value, 'Unavailable');
});

test('reported participants and matched blocks stay separate for incomplete or ambiguous reports', () => {
    const mapped = thread(1, 'duplicate-name', { isDeadlocked: true });
    const result = analyzeSnapshotProblems({ snapshot: {
        threads: [mapped], deadlocks: [{ threads: [{ sourceKey: mapped.sourceKey }, { sourceKey: null }] }],
        diagnostics: { identityWarnings: ['Second participant cannot be mapped uniquely.'] },
    } });
    const deadlock = finding(result, 'confirmed-deadlock');
    assert.match(deadlock.summary, /2 reported participant entries/);
    assert.match(deadlock.summary, /1 thread block matched/);
    assert.match(deadlock.summary, /missing or ambiguous/);
    assert.equal(deadlock.facts.find(f => f.label === 'Participant mapping warning').value, 'Second participant cannot be mapped uniquely.');
    assert.deepEqual(deadlock.threads.map(t => t.sourceKey), [mapped.sourceKey]);
});

test('ignores stale starvation labels without validated repeated contention', () => {
    const result = analyzeSnapshotProblems({ snapshot: { threads: [thread(1, 'old', {
        elapsedS: 600, scenarioKey: 'possible-starvation', blockedWaiterCount: 10,
    })] } });
    assert.equal(finding(result, 'possible-starvation'), undefined);
});

test('ambiguous ownership cannot be promoted by legacy counts or findings', () => {
    const owners = [1, 2].map(i => thread(i, `owner-${i}`, {
        heldLocks: [{ lockId: '0xabc', kind: 'monitor' }], blockedWaiterCount: 3,
        findings: [{ key: 'likely-lock-bottleneck', severity: 'high', confidence: 'low' }],
    }));
    const waiters = [3, 4, 5].map(i => thread(i, `waiter-${i}`, {
        waitingLocks: [{ lockId: '0xabc', kind: 'monitor-enter' }],
    }));
    annotateLockPrecedence([{ index: 0, threads: [...owners, ...waiters] }], []);
    const snapshot = { threads: [...owners, ...waiters], contentionChains: [{ lockId: '0xabc', owners, waiters }] };
    assert.equal(finding(analyzeSnapshotProblems({ snapshot }), 'likely-lock-bottleneck'), undefined);
    // A separate unique lock held by one of these owners remains analyzable.
    owners[0].heldLocks.push({ lockId: '0xdef', kind: 'monitor' });
    const uniqueWaiter = thread(6, 'unique-waiter', { waitingLocks: [{ lockId: '0xdef', kind: 'monitor-enter' }] });
    snapshot.threads.push(uniqueWaiter);
    annotateLockPrecedence([{ index: 0, threads: snapshot.threads }], []);
    const bottleneck = finding(analyzeSnapshotProblems({ snapshot }), 'likely-lock-bottleneck');
    assert.deepEqual(bottleneck.resourceIds, ['0xdef']);
    assert.deepEqual(bottleneck.threads.map(t => t.index), [1, 6]);
});

test('bottleneck participants are deduplicated and stale waiter references are ignored', () => {
    const owner = thread(1, 'owner', { lockAssessment: { likelyBlockers: [
        { lockId: '0x1', waiterSourceKeys: ['snapshot:0:thread:2', 'snapshot:0:thread:2', 'missing'] },
        { lockId: '0x2', waiterSourceKeys: ['snapshot:0:thread:2'] },
    ] } });
    const result = analyzeSnapshotProblems({ snapshot: { threads: [owner, thread(2, 'waiter')] } });
    const bottleneck = finding(result, 'likely-lock-bottleneck');
    assert.equal(bottleneck.facts.find(f => f.label === 'Dependent waiters').value, '1');
    assert.equal(bottleneck.threads.length, 2);
});

test('reports partial input and absent counters as limitations instead of zero activity', () => {
    const result = analyzeSnapshotProblems({
        snapshot: { threads: [thread(1, 'main')] },
        snapshotIndex: 1,
        snapshotCount: 3,
        analysisStatus: 'partial',
        parserWarnings: ['One block appears truncated.'],
    });

    assert.equal(result.coverage.cpuCounters, 0);
    assert.equal(result.coverage.allocationCounters, 0);
    assert.ok(result.limitations.some((item) => /partial or truncated/i.test(item)));
    assert.ok(result.limitations.some((item) => /CPU-hot analysis is unavailable/i.test(item)));
    assert.ok(result.limitations.some((item) => /Allocation-hot analysis is unavailable/i.test(item)));
});

test('fails closed for null and malformed optional collections', () => {
    assert.doesNotThrow(() => analyzeSnapshotProblems({
        snapshot: {
            threads: [thread(1, 'main', {
                findings: null,
                waitingLocks: {},
                waitingSynchronizers: 'invalid',
                crossSnapshotDiagnostics: { diagnostics: null },
            })],
            deadlocks: {},
            classInitializationChains: 'invalid',
            contentionChains: {},
        },
        parserWarnings: 'invalid',
    }));

    const empty = analyzeSnapshotProblems();
    assert.equal(empty.findings.length, 0);
    assert.equal(empty.coverage.threads, 0);
});

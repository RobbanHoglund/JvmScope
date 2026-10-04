import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DIAGNOSTIC_EVIDENCE_LEVELS,
    diagnosticEvidenceFor,
    hasThreadDiagnostic,
} from '../../assets/javautils/tda/diagnostics.js';

const scenarioKeys = [
    'deadlock',
    'monitor-contention',
    'observed-lock-contention',
    'confirmed-lock-hold',
    'reentrant-lock-holder',
    'reentrant-lock-contention',
    'rwlock-reader-wait',
    'rwlock-writer-lock',
    'rwlock-writer-holder',
    'rwlock',
    'condition-await',
    'latch-await',
    'object-wait',
    'sleeping',
    'carrier-thread',
    'class-initialization-wait',
    'class-initializer-with-waiters',
    'class-initialization-stall',
    'executor-idle',
    'jvm-internal',
    'hot-selector-event-loop',
    'selector-event-loop',
    'cpu-hot',
    'allocation-hot',
    'possible-starvation',
    'possible-livelock',
    'parked',
];

const findingKeys = ['cpu-hot', 'allocation-hot', 'many-waiters', 'likely-lock-bottleneck', 'infra-hot'];

test('finds thread diagnostics in either the primary scenario or secondary findings', () => {
    const threads = [
        { scenarioKey: 'possible-livelock', findings: [] },
        { scenarioKey: 'cpu-hot', findings: [{ key: 'possible-livelock' }] },
        { scenarioKey: 'possible-livelock', findings: [{ key: 'possible-livelock' }] },
        { scenarioKey: 'cpu-hot', findings: [] },
    ];

    assert.equal(threads.filter((thread) =>
        hasThreadDiagnostic(thread, 'possible-livelock')).length, 3);
    assert.equal(hasThreadDiagnostic(null, 'possible-livelock'), false);
    assert.equal(hasThreadDiagnostic(threads[0], ''), false);
});

test('classifies direct JVM facts separately from measured and heuristic claims', () => {
    const deadlock = diagnosticEvidenceFor('deadlock');
    const cpuHot = diagnosticEvidenceFor('cpu-hot');
    const allocationHot = diagnosticEvidenceFor('allocation-hot');
    const infrastructureHot = diagnosticEvidenceFor('hot-selector-event-loop');
    const observedLockContention = diagnosticEvidenceFor('observed-lock-contention');
    const confirmedLockHold = diagnosticEvidenceFor('confirmed-lock-hold');
    const likelyLockBlocker = diagnosticEvidenceFor('likely-lock-bottleneck');
    const executorIdle = diagnosticEvidenceFor('executor-idle');
    const jvmInternal = diagnosticEvidenceFor('jvm-internal');
    const livelock = diagnosticEvidenceFor('possible-livelock');
    const classInitializationWait = diagnosticEvidenceFor('class-initialization-wait');
    const classInitializationStall = diagnosticEvidenceFor('class-initialization-stall');

    assert.equal(deadlock.level, 'fact');
    assert.equal(deadlock.label, 'JVM FACT');
    assert.match(deadlock.basis, /JVM-reported deadlock/i);
    assert.equal(cpuHot.level, 'measured');
    assert.match(cpuHot.basis, /adjacent-snapshot CPU rate/i);
    assert.equal(allocationHot.level, 'measured');
    assert.match(allocationHot.qualification, /not retained\/live heap/i);
    assert.equal(infrastructureHot.level, 'mixed');
    assert.match(infrastructureHot.qualification, /inference from scored stack evidence/i);
    assert.equal(observedLockContention.level, 'fact');
    assert.match(observedLockContention.basis, /monitor-enter or synchronizer wait/i);
    assert.equal(confirmedLockHold.level, 'fact');
    assert.match(confirmedLockHold.qualification, /current snapshot observation/i);
    assert.equal(likelyLockBlocker.level, 'inferred');
    assert.match(likelyLockBlocker.qualification, /does not prove/i);
    assert.equal(executorIdle.level, 'inferred');
    assert.match(executorIdle.qualification, /scored stack pattern/i);
    assert.equal(jvmInternal.level, 'inferred');
    assert.match(jvmInternal.basis, /known JVM infrastructure thread-name list/i);
    assert.equal(livelock.level, 'heuristic');
    assert.match(livelock.qualification, /does not prove/i);
    assert.equal(classInitializationWait.level, 'fact');
    assert.match(classInitializationWait.qualification, /does not establish duration/i);
    assert.equal(classInitializationStall.level, 'mixed');
    assert.match(classInitializationStall.qualification, /not a confirmed hang or deadlock/i);
});

test('provides explicit evidence metadata for every current scenario and finding', () => {
    for (const key of [...scenarioKeys, ...findingKeys]) {
        const evidence = diagnosticEvidenceFor(key);
        assert.notEqual(evidence.level, 'unclassified', key);
        assert.ok(DIAGNOSTIC_EVIDENCE_LEVELS.includes(evidence.level), key);
        assert.ok(evidence.label, key);
        assert.ok(evidence.basis, key);
        assert.ok(evidence.qualification, key);
    }
});

test('does not present unknown diagnostics as facts', () => {
    const evidence = diagnosticEvidenceFor('future-rule');

    assert.equal(evidence.level, 'unclassified');
    assert.equal(evidence.label, 'UNCLASSIFIED');
    assert.match(evidence.qualification, /not been classified/i);
});

test('returns independent immutable-style evidence values', () => {
    const first = diagnosticEvidenceFor('deadlock');
    first.label = 'changed';
    const second = diagnosticEvidenceFor('deadlock');

    assert.equal(second.label, 'JVM FACT');
});

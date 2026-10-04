import assert from 'node:assert/strict';
import test from 'node:test';

import { annotateLockPrecedence } from '../../assets/javautils/tda/lock-precedence.js';
import { isPossibleStarvationCandidate } from '../../assets/javautils/tda/classification.js';

test('starvation requires repeated unique contention at validated adjacent endpoints, never thread age', () => {
    function run({ age = 600, previousWaiters = 3, currentWaiters = 3, gap = false, ambiguous = false, exact = true, interval = 1, changedLock = false, partial = false } = {}) {
        const previous = thread('old-owner', { heldLocks: [held('0xa')], elapsedS: age });
        const current = thread('new-owner', {
            heldLocks: [held(changedLock ? '0xb' : '0xa')], elapsedS: age + interval,
            seriesMatchStatus: 'matched', seriesMatchConfidence: exact ? 'exact' : 'ambiguous', previousSourceKey: previous.sourceKey,
        });
        const waiters = (count, prefix, lockId) => Array.from({ length: count }, (_, i) => thread(`${prefix}-${i}`, { waitingLocks: [waiting(lockId)] }));
        const dumps = [
            { index: 0, threads: [previous, ...waiters(previousWaiters, 'old-waiter', '0xa')] },
            { index: gap ? 2 : 1, threads: [current, ...waiters(currentWaiters, 'new-waiter', changedLock ? '0xb' : '0xa')] },
        ];
        if (ambiguous) dumps[1].threads.push(thread('another-owner', { heldLocks: [held('0xa')] }));
        if (partial) dumps[0].parsingStatus = 'partial';
        annotateLockPrecedence(dumps, seriesFor(
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: dumps[1].index, sourceKey: current.sourceKey, thread: current },
        ));
        assert.equal(isPossibleStarvationCandidate(previous), false);
        return isPossibleStarvationCandidate(current);
    }
    assert.equal(run(), true);
    assert.equal(run({ age: 1 }), true, 'thread age is not a wait duration');
    assert.equal(isPossibleStarvationCandidate({ lockAssessment: { transitions: {
        status: 'compared', intervalMs: Infinity, contentionAtBothEndpoints: [{ lockId: '0xa' }],
    } } }), false);
    for (const options of [{ previousWaiters: 0 }, { previousWaiters: 2 }, { currentWaiters: 2 }, { gap: true }, { ambiguous: true }, { exact: false }, { interval: 0 }, { interval: -1 }, { changedLock: true }, { partial: true }]) {
        assert.equal(run(options), false, JSON.stringify(options));
    }
});

function held(lockId, lockType = 'a java.lang.Object') {
    return { lockId, lockType, kind: 'monitor' };
}

function waiting(lockId, lockType = 'a java.lang.Object', kind = 'monitor-enter') {
    return { lockId, lockType, kind };
}

function thread(sourceKey, overrides = {}) {
    return {
        sourceKey,
        seriesKey: 'series:worker',
        threadName: 'worker',
        heldLocks: [],
        waitingLocks: [],
        waitingToLock: null,
        javaState: 'RUNNABLE',
        isDeadlocked: false,
        ...overrides,
    };
}

function seriesFor(...occurrences) {
    return [{ seriesKey: 'series:worker', occurrences }];
}

test('records direct held-lock facts and does not infer an acquisition from one snapshot', () => {
    const current = thread('snapshot:0:tid:0x1', { heldLocks: [held('0xa')] });
    const result = annotateLockPrecedence(
        [{ index: 0, threads: [current] }],
        seriesFor({ dumpIndex: 0, sourceKey: current.sourceKey, thread: current }),
    );

    assert.equal(result.dumps[0].threads[0].lockAssessment.tier, 'confirmed-hold');
    assert.equal(result.dumps[0].threads[0].lockAssessment.severityScore, 10);
    assert.deepEqual(
        result.dumps[0].threads[0].lockAssessment.confirmedHolds.map((lock) => lock.lockId),
        ['0xa'],
    );
    assert.equal(result.dumps[0].threads[0].lockAssessment.transitions.status, 'first-occurrence');
    assert.deepEqual(result.dumps[0].threads[0].lockAssessment.transitions.appearedSincePrevious, []);
});

test('compares exact adjacent snapshots using endpoint observations, not fabricated hold durations', () => {
    const previous = thread('snapshot:0:tid:0x1', { heldLocks: [held('0xa')] });
    const current = thread('snapshot:1:tid:0x1', {
        heldLocks: [held('0xa'), held('0xb')],
        seriesMatchStatus: 'matched',
        seriesMatchConfidence: 'exact',
        previousSourceKey: previous.sourceKey,
    });
    const dumps = [
        { index: 0, timestamp: '1970-01-01T00:00:01Z', threads: [previous] },
        { index: 1, timestamp: '1970-01-01T00:00:02Z', threads: [current] },
    ];

    annotateLockPrecedence(dumps, seriesFor(
        { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
        { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
    ));

    const transitions = current.lockAssessment.transitions;
    assert.equal(transitions.status, 'compared');
    assert.equal(transitions.intervalMs, 1000);
    assert.equal(transitions.intervalBasis, 'snapshot-time');
    assert.deepEqual(transitions.observedAtBothEndpoints.map((lock) => lock.lockId), ['0xa']);
    assert.deepEqual(transitions.appearedSincePrevious.map((lock) => lock.lockId), ['0xb']);
    assert.deepEqual(transitions.noLongerObservedSincePrevious, []);
    assert.equal(Object.hasOwn(transitions.observedAtBothEndpoints[0], 'holdDurationMs'), false);
});

test('reports a missing later endpoint as no longer observed rather than a confirmed release', () => {
    const previous = thread('snapshot:0:tid:0x1', { heldLocks: [held('0xa'), held('0xb')] });
    const current = thread('snapshot:1:tid:0x1', {
        heldLocks: [held('0xb')],
        seriesMatchStatus: 'matched',
        seriesMatchConfidence: 'exact',
        previousSourceKey: previous.sourceKey,
    });
    const dumps = [
        { index: 0, threads: [previous] },
        { index: 1, threads: [current] },
    ];

    annotateLockPrecedence(dumps, seriesFor(
        { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
        { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
    ));

    assert.deepEqual(
        current.lockAssessment.transitions.noLongerObservedSincePrevious.map((lock) => lock.lockId),
        ['0xa'],
    );
    assert.match(current.lockAssessment.transitions.qualification, /do not prove/i);
});

test('uses exact thread elapsed time only as an endpoint-observation fallback', () => {
    const previous = thread('snapshot:0:tid:0x1', { heldLocks: [held('0xa')], elapsedS: 10 });
    const current = thread('snapshot:1:tid:0x1', {
        heldLocks: [held('0xa')],
        elapsedS: 12.5,
        seriesMatchStatus: 'matched',
        seriesMatchConfidence: 'exact',
        previousSourceKey: previous.sourceKey,
    });

    annotateLockPrecedence(
        [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }],
        seriesFor(
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ),
    );

    assert.equal(current.lockAssessment.transitions.intervalMs, 2500);
    assert.equal(current.lockAssessment.transitions.intervalBasis, 'thread-elapsed');
    assert.deepEqual(
        current.lockAssessment.transitions.observedAtBothEndpoints.map((lock) => lock.lockId),
        ['0xa'],
    );
});

test('suppresses temporal lock claims when thread identity is ambiguous', () => {
    const previous = thread('snapshot:0:tid:0x1', { heldLocks: [held('0xa')] });
    const current = thread('snapshot:1:tid:0x2', {
        heldLocks: [held('0xa')],
        seriesMatchStatus: 'ambiguous',
        seriesMatchConfidence: 'none',
    });

    annotateLockPrecedence(
        [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }],
        seriesFor(
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ),
    );

    assert.equal(current.lockAssessment.transitions.status, 'identity-unavailable');
    assert.deepEqual(current.lockAssessment.transitions.observedAtBothEndpoints, []);
});

test('ranks observed contention over likely blocker and confirmed hold evidence', () => {
    const owner = thread('snapshot:0:tid:0x1', {
        threadName: 'owner',
        heldLocks: [held('0xa')],
    });
    const waiter = thread('snapshot:0:tid:0x2', {
        threadName: 'waiter',
        javaState: 'BLOCKED',
        waitingToLock: waiting('0xa'),
        waitingLocks: [waiting('0xa')],
    });
    const deadlocked = thread('snapshot:0:tid:0x3', {
        heldLocks: [held('0xb')],
        isDeadlocked: true,
    });

    annotateLockPrecedence(
        [{ index: 0, threads: [owner, waiter, deadlocked] }],
        [
            { seriesKey: owner.seriesKey, occurrences: [{ dumpIndex: 0, sourceKey: owner.sourceKey, thread: owner }] },
            { seriesKey: 'series:waiter', occurrences: [{ dumpIndex: 0, sourceKey: waiter.sourceKey, thread: waiter }] },
            { seriesKey: 'series:deadlocked', occurrences: [{ dumpIndex: 0, sourceKey: deadlocked.sourceKey, thread: deadlocked }] },
        ],
    );

    assert.equal(owner.lockAssessment.tier, 'likely-blocker');
    assert.equal(owner.lockAssessment.severity, 'medium');
    assert.deepEqual(owner.lockAssessment.likelyBlockers[0].waiterSourceKeys, [waiter.sourceKey]);
    assert.equal(waiter.lockAssessment.tier, 'contention');
    assert.equal(waiter.lockAssessment.severity, 'high');
    assert.equal(waiter.lockAssessment.observedContentions[0].ownerResolution, 'unique-observed-owner');
    assert.deepEqual(waiter.lockAssessment.observedContentions[0].ownerSourceKeys, [owner.sourceKey]);
    assert.equal(deadlocked.lockAssessment.tier, 'deadlock');
    assert.equal(deadlocked.lockAssessment.severityScore, 100);
    assert.equal(deadlocked.lockAssessment.severity, 'critical');
});

test('unannotated previous occurrence makes the whole lock comparison unavailable', () => {
    const previous = thread('outside-dumps', { heldLocks: [held('0xa'), held('0x9')], elapsedS: 600 });
    const current = thread('current', {
        heldLocks: [held('0xa')], elapsedS: 602,
        seriesMatchStatus: 'matched', seriesMatchConfidence: 'exact', previousSourceKey: previous.sourceKey,
    });
    const waiters = [1, 2, 3].map(i => thread(`waiter-${i}`, { waitingLocks: [waiting('0xa')] }));
    const dumps = [{ index: 0, threads: [] }, { index: 1, threads: [current, ...waiters] }];
    const series = seriesFor(
        { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
        { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
    );
    assert.doesNotThrow(() => annotateLockPrecedence(dumps, series));
    assert.equal(current.lockAssessment.likelyBlockers[0].waiterCount, 3);
    const transitions = current.lockAssessment.transitions;
    assert.equal(transitions.status, 'observation-unavailable');
    assert.equal(transitions.intervalMs, null);
    assert.deepEqual(transitions.contentionAtBothEndpoints, []);
    assert.deepEqual(transitions.observedAtBothEndpoints, []);
    assert.deepEqual(transitions.appearedSincePrevious, []);
    assert.deepEqual(transitions.noLongerObservedSincePrevious, []);
});

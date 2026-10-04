import assert from 'node:assert/strict';
import test from 'node:test';

import {
    confidenceForStackPatternScore,
    evaluateRuntimeStackPatterns,
    evaluateSelectorOrEventLoopPattern,
    evaluateSynchronizationPatterns,
} from '../../assets/javautils/tda/generic-classification.js';

function threadWithStack(frames, overrides = {}) {
    return {
        threadName: 'worker',
        javaState: 'WAITING',
        locksHeldCount: 0,
        heldLocks: [],
        waitingLocks: [],
        rawBlock: frames.map((frame) => `\tat ${frame}`),
        ...overrides,
    };
}

test('scores corroborated Condition.await evidence and explains every point', () => {
    const thread = threadWithStack([
        'jdk.internal.misc.Unsafe.park(Native Method)',
        'java.util.concurrent.locks.LockSupport.park(LockSupport.java:211)',
        'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1707)',
    ]);

    const result = evaluateSynchronizationPatterns(thread);

    assert.equal(result.primary.key, 'condition-await');
    assert.equal(result.primary.confidence, 'high');
    assert.ok(result.primary.score >= 85);
    assert.ok(result.primary.signals.some((signal) => signal.id === 'exact-library-frame'));
    assert.ok(result.primary.signals.some((signal) => signal.id === 'compatible-java-state'));
    assert.ok(result.primary.signals.some((signal) => signal.id === 'park-companion-frame'));
    assert.equal(
        result.primary.score,
        result.primary.signals.reduce((total, signal) => total + signal.points, 0),
    );
    assert.match(result.primary.matchedFrames[0], /ConditionObject\.await/);
});

test('keeps an exact stack match but lowers confidence for a conflicting Java state', () => {
    const result = evaluateSynchronizationPatterns(threadWithStack([
        'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1707)',
    ], { javaState: 'RUNNABLE' }));

    assert.equal(result.primary.key, 'condition-await');
    assert.equal(result.primary.confidence, 'low');
    assert.ok(result.primary.score >= 0 && result.primary.score <= 100);
    assert.ok(result.primary.score < 60);
    assert.ok(result.primary.conflicts.some((conflict) => conflict.id === 'conflicting-java-state'));
});

test('ranks the specific condition pattern ahead of incidental lock acquisition evidence', () => {
    const result = evaluateSynchronizationPatterns(threadWithStack([
        'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1707)',
        'java.util.concurrent.locks.ReentrantLock.lock(ReentrantLock.java:322)',
    ]));

    assert.equal(result.primary.key, 'condition-await');
    assert.equal(result.alternates[0].key, 'reentrant-lock-contention');
    assert.ok(result.primary.priority > result.alternates[0].priority);
});

test('keeps parsed synchronizer wait metadata conservative without a matching lock frame', () => {
    const result = evaluateSynchronizationPatterns(threadWithStack([
        'jdk.internal.misc.Unsafe.park(Native Method)',
    ], {
        waitingLocks: [{
            lockId: '0xa',
            lockType: 'java.util.concurrent.locks.ReentrantLock$NonfairSync',
            kind: 'synchronizer-park',
        }],
    }));

    assert.equal(result.primary.key, 'reentrant-lock-contention');
    assert.equal(result.primary.confidence, 'medium');
    assert.equal(result.primary.score, 70);
    assert.ok(result.primary.signals.some((signal) => signal.id === 'parsed-wait-lock'));
});

test('requires exact selector library frames and rejects unqualified helper methods', () => {
    const exact = evaluateSelectorOrEventLoopPattern(threadWithStack([
        'sun.nio.ch.EPollSelectorImpl.doSelect(EPollSelectorImpl.java:118)',
    ], { javaState: 'RUNNABLE' }));
    const helper = evaluateSelectorOrEventLoopPattern(threadWithStack([
        'example.CustomLoop.selectLoop(CustomLoop.java:10)',
    ], { javaState: 'RUNNABLE' }));
    const nameOnly = evaluateSelectorOrEventLoopPattern(threadWithStack([
        'example.BusinessService.execute(BusinessService.java:10)',
    ], { threadName: 'reactor-eventloop-selector', javaState: 'RUNNABLE' }));

    assert.equal(exact.key, 'selector-event-loop');
    assert.equal(exact.confidence, 'high');
    assert.ok(exact.score >= 85);
    assert.equal(helper, null);
    assert.equal(nameOnly, null);
});

test('maps confidence thresholds at exact deterministic boundaries', () => {
    assert.equal(confidenceForStackPatternScore(100), 'high');
    assert.equal(confidenceForStackPatternScore(85), 'high');
    assert.equal(confidenceForStackPatternScore(84), 'medium');
    assert.equal(confidenceForStackPatternScore(60), 'medium');
    assert.equal(confidenceForStackPatternScore(59), 'low');
    assert.equal(confidenceForStackPatternScore(0), 'low');
});

test('scoring is deterministic and remains invariant when the thread is renamed', () => {
    const frames = [
        'java.util.concurrent.CountDownLatch.await(CountDownLatch.java:230)',
        'java.util.concurrent.locks.AbstractQueuedSynchronizer.acquireSharedInterruptibly(AbstractQueuedSynchronizer.java:1048)',
    ];
    const first = evaluateSynchronizationPatterns(threadWithStack(frames, { threadName: 'first-name' }));
    const renamed = evaluateSynchronizationPatterns(threadWithStack(frames, { threadName: 'other-name' }));

    assert.deepEqual(renamed, first);
});

test('returns no scored pattern for application frames or lock release paths', () => {
    const application = evaluateSynchronizationPatterns(threadWithStack([
        'example.BusinessService.execute(BusinessService.java:10)',
    ], { javaState: 'RUNNABLE' }));
    const unlock = evaluateSynchronizationPatterns(threadWithStack([
        'java.util.concurrent.locks.ReentrantLock.unlock(ReentrantLock.java:494)',
    ], { javaState: 'RUNNABLE' }));

    assert.equal(application.primary, null);
    assert.deepEqual(application.alternates, []);
    assert.equal(unlock.primary, null);
});

test('scores common runtime stack patterns with state and companion evidence', () => {
    const sleeping = evaluateRuntimeStackPatterns(threadWithStack([
        'java.lang.Thread.sleep(Thread.java:507)',
    ], { javaState: 'TIMED_WAITING' }));
    const executor = evaluateRuntimeStackPatterns(threadWithStack([
        'java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:435)',
        'java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1062)',
    ]));
    const parked = evaluateRuntimeStackPatterns(threadWithStack([
        'java.util.concurrent.locks.LockSupport.park(LockSupport.java:211)',
    ], { javaStateDetail: 'parking' }));

    assert.equal(sleeping.primary.key, 'sleeping');
    assert.equal(sleeping.primary.confidence, 'high');
    assert.equal(executor.primary.key, 'executor-idle');
    assert.equal(executor.primary.confidence, 'high');
    assert.equal(parked.primary.key, 'parked');
    assert.equal(parked.primary.confidence, 'high');
});

test('does not call a RUNNABLE executor worker idle without a queue-wait frame', () => {
    const activeWorker = evaluateRuntimeStackPatterns(threadWithStack([
        'java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)',
        'example.BusinessTask.execute(BusinessTask.java:10)',
    ], { javaState: 'RUNNABLE' }));

    assert.equal(activeWorker.primary, null);
});

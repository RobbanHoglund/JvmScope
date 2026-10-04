import assert from 'node:assert/strict';
import test from 'node:test';

import {
    detectGenericSynchronizationScenario,
    isGenericSelectorOrEventLoopThread,
} from '../../assets/javautils/tda/generic-classification.js';

function threadWithStack(threadName, frames, overrides = {}) {
    return {
        threadName,
        javaState: 'WAITING',
        locksHeldCount: 0,
        rawBlock: frames.map((frame) => `\tat ${frame}`),
        ...overrides,
    };
}

test('classifies standard synchronization stacks independently of thread names', () => {
    const cases = [
        {
            frame: 'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1707)',
            expected: 'condition-await',
        },
        {
            frame: 'java.util.concurrent.CountDownLatch.await(CountDownLatch.java:230)',
            expected: 'latch-await',
        },
        {
            frame: 'java.lang.Object.wait0(Native Method)',
            extraFrame: 'java.lang.Object.wait(Object.java:338)',
            expected: 'object-wait',
        },
        {
            frame: 'java.util.concurrent.locks.ReentrantReadWriteLock$ReadLock.lock(ReentrantReadWriteLock.java:738)',
            expected: 'rwlock-reader-wait',
        },
        {
            frame: 'java.util.concurrent.locks.ReentrantLock.lock(ReentrantLock.java:322)',
            expected: 'reentrant-lock-contention',
        },
    ];

    for (const sample of cases) {
        const frames = [sample.frame, sample.extraFrame].filter(Boolean);
        const first = detectGenericSynchronizationScenario(threadWithStack('arbitrary-worker-A', frames));
        const renamed = detectGenericSynchronizationScenario(threadWithStack('completely-different-name', frames));

        assert.equal(first?.key, sample.expected, sample.expected);
        assert.deepEqual(renamed, first, sample.expected);
    }
});

test('does not classify sample names or application methods without generic JVM evidence', () => {
    const sampleNames = [
        'synchronized-mutex-worker-1',
        'reentrant-lock-worker-1',
        'rwlock-writer',
        'rwlock-reader-1',
        'condition-await-worker-1',
        'latch-await-worker-1',
        'object-wait-worker-1',
    ];

    for (const threadName of sampleNames) {
        const thread = threadWithStack(threadName, ['example.BusinessService.execute(BusinessService.java:10)'], {
            javaState: 'RUNNABLE',
        });
        assert.equal(detectGenericSynchronizationScenario(thread), null, threadName);
    }

    const applicationMethod = threadWithStack(
        'ordinary-worker',
        ['example.ResourceConsumer.enterMutex(ResourceConsumer.java:42)'],
        { javaState: 'RUNNABLE' },
    );
    assert.equal(detectGenericSynchronizationScenario(applicationMethod), null);
});

test('uses standard stack evidence rather than names for selector and event-loop roles', () => {
    const nameOnly = threadWithStack(
        'reactor-eventloop-selector',
        ['example.BusinessService.execute(BusinessService.java:10)'],
        { javaState: 'RUNNABLE' },
    );
    const stackEvidence = threadWithStack(
        'ordinary-worker',
        ['sun.nio.ch.EPollSelectorImpl.doSelect(EPollSelectorImpl.java:118)'],
        { javaState: 'RUNNABLE' },
    );

    assert.equal(isGenericSelectorOrEventLoopThread(nameOnly), false);
    assert.equal(isGenericSelectorOrEventLoopThread(stackEvidence), true);
});

test('recognizes supported framework event loops by fully qualified stack frames', () => {
    const netty = threadWithStack(
        'ordinary-worker',
        ['io.netty.channel.nio.NioEventLoop.run(NioEventLoop.java:569)'],
        { javaState: 'RUNNABLE' },
    );
    const jetty = threadWithStack(
        'ordinary-worker',
        ['org.eclipse.jetty.io.ManagedSelector.doSelect(ManagedSelector.java:145)'],
        { javaState: 'RUNNABLE' },
    );

    assert.equal(isGenericSelectorOrEventLoopThread(netty), true);
    assert.equal(isGenericSelectorOrEventLoopThread(jetty), true);
});

test('prefers the most specific synchronization primitive in mixed library stacks', () => {
    const condition = threadWithStack('worker', [
        'java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1707)',
        'java.util.concurrent.locks.ReentrantLock.lock(ReentrantLock.java:322)',
    ]);

    assert.equal(detectGenericSynchronizationScenario(condition)?.key, 'condition-await');
});

test('uses parsed lock semantics without treating every ReentrantLock frame as contention', () => {
    const waiter = threadWithStack('worker', ['jdk.internal.misc.Unsafe.park(Native Method)'], {
        waitingLocks: [{ lockType: 'java.util.concurrent.locks.ReentrantLock$NonfairSync' }],
    });
    const holder = threadWithStack('worker', ['java.lang.Thread.sleep(Thread.java:507)'], {
        javaState: 'TIMED_WAITING',
        locksHeldCount: 1,
        heldLocks: [{ lockType: 'java.util.concurrent.locks.ReentrantLock$NonfairSync' }],
    });
    const unlockFrame = threadWithStack(
        'worker',
        ['java.util.concurrent.locks.ReentrantLock.unlock(ReentrantLock.java:494)'],
        { javaState: 'RUNNABLE' },
    );

    assert.equal(detectGenericSynchronizationScenario(waiter)?.key, 'reentrant-lock-contention');
    assert.equal(detectGenericSynchronizationScenario(holder)?.key, 'reentrant-lock-holder');
    assert.equal(detectGenericSynchronizationScenario(unlockFrame), null);
});

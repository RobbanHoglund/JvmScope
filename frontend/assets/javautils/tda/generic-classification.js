/**
 * Pure generic JVM and standard-library scenario rules.
 *
 * Application thread names are intentionally excluded: identical state, stack,
 * and lock evidence must produce the same result after a thread is renamed.
 * Scores are deterministic evidence-strength scores, not probabilities or ML.
 */

export const STACK_PATTERN_CONFIDENCE_THRESHOLDS = Object.freeze({
    high: 85,
    medium: 60,
});

function stackFrames(thread) {
    return (Array.isArray(thread?.stackLines) ? thread.stackLines : Array.isArray(thread?.rawBlock) ? thread.rawBlock : [])
        .map((line) => String(line || '').match(/^\s*at\s+(.+)$/)?.[1] || '')
        .filter(Boolean);
}

function lockTypes(thread, property) {
    return (Array.isArray(thread?.[property]) ? thread[property] : [])
        .map((lock) => String(lock?.lockType || ''))
        .filter(Boolean)
        .join('\n');
}

function matchingFrames(frames, pattern) {
    return frames.filter((frame) => pattern.test(frame));
}

function signal(id, label, points) {
    return { id, label, points };
}

function addStateEvidence(signals, state, compatibleStates) {
    if (compatibleStates.includes(state)) {
        signals.push(signal('compatible-java-state', `Java state ${state} supports the pattern`, 15));
    } else if (state) {
        signals.push(signal('conflicting-java-state', `Java state ${state} conflicts with the expected waiting state`, -25));
    }
}

export function confidenceForStackPatternScore(score) {
    if (score >= STACK_PATTERN_CONFIDENCE_THRESHOLDS.high) return 'high';
    if (score >= STACK_PATTERN_CONFIDENCE_THRESHOLDS.medium) return 'medium';
    return 'low';
}

function candidate({ key, label, reason, priority, severity = 'medium', signals, matchedFrames = [] }) {
    const rawScore = signals.reduce((total, entry) => total + entry.points, 0);
    const score = Math.max(0, Math.min(100, rawScore));
    return {
        key,
        label,
        reason,
        priority,
        severity,
        score,
        confidence: confidenceForStackPatternScore(score),
        signals,
        conflicts: signals.filter((entry) => entry.points < 0),
        matchedFrames: [...new Set(matchedFrames)],
    };
}

function rankedResult(candidates) {
    const ranked = candidates.sort((left, right) =>
        right.priority - left.priority || right.score - left.score || left.key.localeCompare(right.key));
    return {
        primary: ranked[0] || null,
        alternates: ranked.slice(1),
    };
}

/**
 * Scores all recognized synchronization patterns. An exact library frame or
 * parsed lock type is always required; weak names and stack similarity alone
 * never create a match. Priority preserves the established most-specific rule.
 */
export function evaluateSynchronizationPatterns(thread) {
    const frames = stackFrames(thread);
    const state = String(thread?.javaState || '');
    const heldLockTypes = lockTypes(thread, 'heldLocks');
    const waitingLockTypes = lockTypes(thread, 'waitingLocks');
    const candidates = [];
    const waitingStates = ['WAITING', 'TIMED_WAITING'];
    const parkFrames = matchingFrames(
        frames,
        /(?:jdk\.internal\.misc\.Unsafe|sun\.misc\.Unsafe)\.park\(|java\.util\.concurrent\.locks\.LockSupport\.park/,
    );

    const conditionFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.locks\.AbstractQueuedSynchronizer\$ConditionObject\.(?:await|awaitNanos|awaitUntil)\(/,
    );
    if (conditionFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact AQS ConditionObject await frame', 70)];
        addStateEvidence(signals, state, waitingStates);
        if (parkFrames.length) signals.push(signal('park-companion-frame', 'Standard park frame corroborates the wait path', 10));
        if (/ConditionObject/.test(waitingLockTypes)) {
            signals.push(signal('parsed-wait-lock', 'Parsed waiting lock references ConditionObject', 5));
        }
        candidates.push(candidate({
            key: 'condition-await',
            label: 'Condition await',
            reason: 'AbstractQueuedSynchronizer ConditionObject await path',
            priority: 100,
            signals,
            matchedFrames: [...conditionFrames, ...parkFrames],
        }));
    }

    const latchFrames = matchingFrames(frames, /java\.util\.concurrent\.CountDownLatch\.await\(/);
    if (latchFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact CountDownLatch.await frame', 70)];
        addStateEvidence(signals, state, waitingStates);
        const sharedAcquireFrames = matchingFrames(
            frames,
            /java\.util\.concurrent\.locks\.AbstractQueuedSynchronizer\.acquireSharedInterruptibly\(/,
        );
        if (sharedAcquireFrames.length) {
            signals.push(signal('shared-acquire-companion-frame', 'AQS shared-acquire frame corroborates the latch path', 10));
        }
        candidates.push(candidate({
            key: 'latch-await',
            label: 'CountDownLatch await',
            reason: 'CountDownLatch.await() path',
            priority: 90,
            signals,
            matchedFrames: [...latchFrames, ...sharedAcquireFrames],
        }));
    }

    const objectWaitFrames = matchingFrames(frames, /java\.lang\.Object\.(?:wait|wait0)\(/);
    if (objectWaitFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact java.lang.Object wait frame', 70)];
        addStateEvidence(signals, state, waitingStates);
        if (objectWaitFrames.length >= 2) signals.push(signal('wait-companion-frame', 'Both Object.wait wrapper and native wait frame are present', 10));
        if ((thread?.waitingLocks || []).some((lock) => lock?.kind === 'monitor-wait')) {
            signals.push(signal('parsed-monitor-wait', 'Parsed lock metadata reports a monitor wait', 5));
        }
        candidates.push(candidate({
            key: 'object-wait',
            label: 'Object.wait',
            reason: 'Object monitor wait path',
            priority: 80,
            signals,
            matchedFrames: objectWaitFrames,
        }));
    }

    const readLockFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.locks\.ReentrantReadWriteLock\$ReadLock\.lock(?:Interruptibly)?\(/,
    );
    const writeLockFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.locks\.ReentrantReadWriteLock\$WriteLock\.lock(?:Interruptibly)?\(/,
    );
    const rwHeld = /ReentrantReadWriteLock/.test(heldLockTypes);
    const rwWaiting = /ReentrantReadWriteLock/.test(waitingLockTypes);
    const rwMetadataOrFrame = rwHeld || rwWaiting || frames.some((frame) =>
        /java\.util\.concurrent\.locks\.ReentrantReadWriteLock/.test(frame));

    if (readLockFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact read-lock acquisition frame', 75)];
        addStateEvidence(signals, state, waitingStates);
        if (rwWaiting) signals.push(signal('parsed-wait-lock', 'Parsed wait metadata references ReentrantReadWriteLock', 10));
        candidates.push(candidate({
            key: 'rwlock-reader-wait',
            label: 'ReadWriteLock reader wait',
            reason: 'Standard read-lock acquisition path',
            priority: 70,
            severity: 'high',
            signals,
            matchedFrames: readLockFrames,
        }));
    }

    if (writeLockFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact write-lock acquisition frame', 75)];
        addStateEvidence(signals, state, waitingStates);
        if (rwWaiting) signals.push(signal('parsed-wait-lock', 'Parsed wait metadata references ReentrantReadWriteLock', 10));
        candidates.push(candidate({
            key: 'rwlock-writer-lock',
            label: 'ReadWriteLock writer',
            reason: 'Standard write-lock acquisition path',
            priority: 69,
            signals,
            matchedFrames: writeLockFrames,
        }));
    }

    const sleepFrames = matchingFrames(frames, /java\.lang\.Thread\.sleep\(/);
    if (rwHeld && state === 'TIMED_WAITING' && sleepFrames.length) {
        candidates.push(candidate({
            key: 'rwlock-writer-holder',
            label: 'ReadWriteLock writer holder',
            reason: 'Sleeping while the dump reports a held ReadWriteLock synchronizer',
            priority: 68,
            signals: [
                signal('parsed-held-lock', 'Parsed held lock references ReentrantReadWriteLock', 70),
                signal('sleep-companion-frame', 'Exact Thread.sleep frame is present', 15),
                signal('compatible-java-state', 'Java state TIMED_WAITING supports Thread.sleep', 15),
            ],
            matchedFrames: sleepFrames,
        }));
    }

    if (rwMetadataOrFrame && !readLockFrames.length && !writeLockFrames.length) {
        const signals = [];
        if (rwHeld || rwWaiting) {
            signals.push(signal('parsed-lock-type', 'Parsed lock metadata references ReentrantReadWriteLock', 65));
        } else {
            signals.push(signal('exact-library-class', 'Stack references the fully qualified ReentrantReadWriteLock class', 60));
        }
        candidates.push(candidate({
            key: 'rwlock',
            label: 'ReadWriteLock activity',
            reason: 'Stack or parsed lock metadata references ReentrantReadWriteLock',
            priority: 60,
            signals,
            matchedFrames: matchingFrames(frames, /java\.util\.concurrent\.locks\.ReentrantReadWriteLock/),
        }));
    }

    const heldReentrantLock = /ReentrantLock/.test(heldLockTypes);
    const waitingForReentrantLock = /ReentrantLock/.test(waitingLockTypes);
    const reentrantLockFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.locks\.ReentrantLock\.(?:lock|lockInterruptibly|tryLock)\(/,
    );

    if (heldReentrantLock && state === 'TIMED_WAITING' && sleepFrames.length) {
        candidates.push(candidate({
            key: 'reentrant-lock-holder',
            label: 'ReentrantLock holder',
            reason: 'Sleeping while the dump reports a held ReentrantLock synchronizer',
            priority: 50,
            signals: [
                signal('parsed-held-lock', 'Parsed held lock references ReentrantLock', 70),
                signal('sleep-companion-frame', 'Exact Thread.sleep frame is present', 15),
                signal('compatible-java-state', 'Java state TIMED_WAITING supports Thread.sleep', 15),
            ],
            matchedFrames: sleepFrames,
        }));
    }

    if (waitingForReentrantLock || reentrantLockFrames.length) {
        const signals = [];
        if (reentrantLockFrames.length) signals.push(signal('exact-library-frame', 'Exact ReentrantLock acquisition frame', 75));
        if (waitingForReentrantLock) {
            signals.push(signal(
                'parsed-wait-lock',
                'Parsed wait metadata references ReentrantLock',
                reentrantLockFrames.length ? 10 : 55,
            ));
        }
        addStateEvidence(signals, state, waitingStates);
        candidates.push(candidate({
            key: 'reentrant-lock-contention',
            label: 'ReentrantLock contention',
            reason: 'ReentrantLock acquisition path or parsed synchronizer wait',
            priority: 49,
            severity: 'high',
            signals,
            matchedFrames: [...reentrantLockFrames, ...parkFrames],
        }));
    }

    return rankedResult(candidates);
}

/** Scores common JVM runtime wait paths that are not synchronization primitives. */
export function evaluateRuntimeStackPatterns(thread) {
    const frames = stackFrames(thread);
    const state = String(thread?.javaState || '');
    const detail = String(thread?.javaStateDetail || '');
    const candidates = [];
    const waitingStates = ['WAITING', 'TIMED_WAITING'];

    const sleepFrames = matchingFrames(frames, /java\.lang\.Thread\.sleep\(/);
    if (sleepFrames.length) {
        const signals = [signal('exact-library-frame', 'Exact java.lang.Thread.sleep frame', 70)];
        if (state === 'TIMED_WAITING') {
            signals.push(signal('compatible-java-state', 'Java state TIMED_WAITING supports Thread.sleep', 15));
        } else if (state) {
            signals.push(signal('conflicting-java-state', `Java state ${state} conflicts with Thread.sleep`, -25));
        }
        candidates.push(candidate({
            key: 'sleeping',
            label: 'Sleeping',
            reason: 'Thread.sleep() path',
            priority: 90,
            severity: 'info',
            signals,
            matchedFrames: sleepFrames,
        }));
    }

    const queueWaitFrames = matchingFrames(
        frames,
        /(?:java\.util\.concurrent\.LinkedBlockingQueue\.take|java\.util\.concurrent\.ScheduledThreadPoolExecutor\$DelayedWorkQueue\.take|org\.apache\.tomcat\.util\.threads\.TaskQueue\.take|java\.util\.concurrent\.ForkJoinPool\.awaitWork)\(/,
    );
    const getTaskFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.ThreadPoolExecutor\.getTask\(/,
    );
    if (queueWaitFrames.length || getTaskFrames.length) {
        const signals = [signal(
            'exact-idle-library-frame',
            queueWaitFrames.length ? 'Exact queue-wait frame used by an executor' : 'Exact ThreadPoolExecutor.getTask frame',
            queueWaitFrames.length ? 65 : 70,
        )];
        if (queueWaitFrames.length && getTaskFrames.length) {
            // The pair identifies both the pool work-retrieval path and its blocking queue endpoint.
            signals.push(signal('executor-companion-frame', 'Queue wait and ThreadPoolExecutor.getTask frames corroborate idle work retrieval', 20));
        }
        addStateEvidence(signals, state, waitingStates);
        candidates.push(candidate({
            key: 'executor-idle',
            label: 'Executor idle',
            reason: 'Executor worker is waiting for new work',
            priority: 80,
            severity: 'info',
            signals,
            matchedFrames: [...queueWaitFrames, ...getTaskFrames],
        }));
    }

    const parkFrames = matchingFrames(
        frames,
        /java\.util\.concurrent\.locks\.LockSupport\.park(?:Nanos|Until)?\(/,
    );
    if (parkFrames.length || detail === 'parking') {
        const signals = [signal(
            parkFrames.length ? 'exact-library-frame' : 'jvm-state-detail',
            parkFrames.length ? 'Exact LockSupport park frame' : 'JVM state detail reports parking',
            parkFrames.length ? 70 : 65,
        )];
        addStateEvidence(signals, state, waitingStates);
        if (parkFrames.length && detail === 'parking') {
            signals.push(signal('parking-detail-corroboration', 'JVM state detail also reports parking', 10));
        }
        candidates.push(candidate({
            key: 'parked',
            label: 'Parked',
            reason: 'LockSupport park path or explicit JVM parking detail',
            priority: 70,
            severity: 'info',
            signals,
            matchedFrames: parkFrames,
        }));
    }

    return rankedResult(candidates);
}

/** Scores supported selector/event-loop frames without using thread names. */
export function evaluateSelectorOrEventLoopPattern(thread) {
    const frames = stackFrames(thread);
    const state = String(thread?.javaState || '');
    const preciseFrames = matchingFrames(
        frames,
        /(?:sun\.nio\.ch\.(?:EPoll|KQueue|Poll)SelectorImpl\.(?:doSelect|lockAndDoSelect)|java\.nio\.channels\.Selector\.select\(|io\.netty\.channel\.(?:nio\.NioEventLoop|epoll\.EpollEventLoop|kqueue\.KQueueEventLoop)\.(?:run|select|processSelectedKeys)\(|org\.eclipse\.jetty\.io\.ManagedSelector\.(?:select|doSelect|run)\()/,
    );
    if (!preciseFrames.length) return null;

    const signals = [signal('exact-library-frame', 'Fully qualified selector or event-loop frame', 75)];
    if (state === 'RUNNABLE') {
        signals.push(signal('compatible-java-state', 'Java state RUNNABLE supports an active selector loop', 10));
    } else if (state) {
        signals.push(signal('conflicting-java-state', `Java state ${state} weakens the selector interpretation`, -15));
    }

    return candidate({
        key: 'selector-event-loop',
        label: 'Selector/event loop',
        reason: 'Recognized JVM or framework selector/event-loop frame',
        priority: 80,
        severity: 'info',
        signals,
        matchedFrames: preciseFrames,
    });
}

export function detectGenericSynchronizationScenario(thread) {
    return evaluateSynchronizationPatterns(thread).primary;
}

export function isGenericSelectorOrEventLoopThread(thread) {
    return Boolean(evaluateSelectorOrEventLoopPattern(thread));
}

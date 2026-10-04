/**
 * Pure same-snapshot class-initialization relationship analysis.
 *
 * HotSpot reports threads waiting for a class initialization monitor without a
 * monitor identity. The matching initializer is therefore resolved by the exact
 * binary class name in a <clinit> stack frame. This establishes a snapshot
 * relationship, not a duration, deadlock, or application-level root cause.
 */

function text(value) {
    return String(value ?? '').trim();
}

function uniqueThreads(threads) {
    return [...new Map((threads || []).filter(Boolean).map((thread, index) => [
        text(thread.sourceKey) || `thread:${index}:${text(thread.threadName)}`,
        thread,
    ])).values()];
}

function isInitializerWaiting(thread) {
    const state = text(thread?.javaState).toUpperCase();
    return ['WAITING', 'TIMED_WAITING', 'BLOCKED'].includes(state)
        || (Array.isArray(thread?.waitingLocks) && thread.waitingLocks.length > 0)
        || (Array.isArray(thread?.classInitializationWaits) && thread.classInitializationWaits.length > 0);
}

function waitingResources(thread) {
    const lockResources = (Array.isArray(thread?.waitingLocks) ? thread.waitingLocks : []).map((lock) => ({
        lockId: text(lock?.lockId) || null,
        lockType: text(lock?.lockType) || null,
        kind: text(lock?.kind) || null,
    }));
    const classInitializationResources = (Array.isArray(thread?.classInitializationWaits)
        ? thread.classInitializationWaits : [])
        .map((wait) => {
            const className = text(wait?.className);
            return {
                lockId: null,
                lockType: className ? `Class initialization monitor for ${className}` : null,
                kind: text(wait?.kind) || 'class-initialization-wait',
                className: className || null,
            };
        })
        .filter((resource) => resource.className);
    return [...lockResources, ...classInitializationResources];
}

function chainStatus(initializers) {
    if (!initializers.length) return 'initializer-not-observed';
    if (initializers.length > 1) return 'ambiguous-initializer';
    return isInitializerWaiting(initializers[0]) ? 'stall-candidate' : 'initializing';
}

/** Builds class -> initializer -> waiter relationships for one parsed snapshot. */
export function buildClassInitializationChains(threads = []) {
    const normalizedThreads = Array.isArray(threads) ? threads : [];
    const waitersByClass = new Map();
    const initializersByClass = new Map();

    for (const thread of normalizedThreads) {
        for (const wait of Array.isArray(thread?.classInitializationWaits)
            ? thread.classInitializationWaits : []) {
            const className = text(wait?.className);
            if (!className) continue;
            if (!waitersByClass.has(className)) waitersByClass.set(className, []);
            waitersByClass.get(className).push(thread);
        }
        for (const initializer of Array.isArray(thread?.initializingClasses)
            ? thread.initializingClasses : []) {
            const className = text(initializer?.className);
            if (!className) continue;
            if (!initializersByClass.has(className)) initializersByClass.set(className, []);
            initializersByClass.get(className).push(thread);
        }
    }

    return [...waitersByClass.entries()]
        .map(([className, waiterThreads]) => {
            const waiters = uniqueThreads(waiterThreads);
            const initializers = uniqueThreads(initializersByClass.get(className) || []);
            const initializer = initializers.length === 1 ? initializers[0] : null;
            const status = chainStatus(initializers);
            return {
                id: `class-init:${className}`,
                className,
                waiters,
                initializers,
                initializer,
                initializerState: initializer ? text(initializer.javaState) || 'UNKNOWN' : null,
                initializerWaitingResources: initializer ? waitingResources(initializer) : [],
                waiterCount: waiters.length,
                status,
                stallCandidate: status === 'stall-candidate',
                confidence: status === 'stall-candidate' ? 'medium' : 'high',
                qualification: status === 'stall-candidate'
                    ? 'The initializer is waiting in this snapshot. Duration and loss of progress are not established, so this is not a confirmed hang or deadlock.'
                    : 'This same-snapshot relationship does not establish duration, loss of progress, or application impact.',
            };
        })
        .sort((left, right) => right.waiterCount - left.waiterCount
            || left.className.localeCompare(right.className));
}

/** Attaches the relationships to their participating thread models. */
export function annotateThreadsWithClassInitialization(threads = [], chains = []) {
    for (const thread of Array.isArray(threads) ? threads : []) {
        thread.classInitializationChains = [];
        thread.classInitializationBlockedWaiterCount = 0;
    }

    for (const chain of Array.isArray(chains) ? chains : []) {
        for (const waiter of chain.waiters || []) {
            waiter.classInitializationChains ||= [];
            waiter.classInitializationChains.push({ chain, role: 'waiter' });
        }
        for (const initializer of chain.initializers || []) {
            initializer.classInitializationChains ||= [];
            initializer.classInitializationBlockedWaiterCount =
                Number(initializer.classInitializationBlockedWaiterCount || 0) + chain.waiterCount;
            initializer.classInitializationChains.push({ chain, role: 'initializer' });
        }
    }

    return threads;
}

export function analyzeClassInitialization(threads = []) {
    const chains = buildClassInitializationChains(threads);
    annotateThreadsWithClassInitialization(threads, chains);
    return { threads, chains };
}

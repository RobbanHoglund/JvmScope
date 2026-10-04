/** Resolve JVM-reported deadlock entries without treating names as unique IDs. */
import { resolveThreadReference } from './identity.js';

export function resolveDeadlockParticipants(threads, item) {
    return {
        waiter: resolveThreadReference(threads, item),
        owner: resolveThreadReference(threads, {
            sourceKey: item?.heldBySourceKey,
            threadName: item?.heldBy,
            heldLockId: item?.waitingLockId,
        }),
    };
}

export function annotateDeadlocks(threads, cycles) {
    const warnings = [];
    for (const thread of threads) {
        thread.isDeadlocked = false;
        thread.deadlockCycleId = null;
        thread.deadlockHeldBy = null;
        thread.deadlockWaitingLockId = null;
        thread.deadlockWaitingLockType = null;
        thread.deadlockHoldingLockId = null;
        thread.deadlockHoldingLockType = null;
    }
    for (const cycle of cycles) {
        for (const item of cycle.threads) {
            const { waiter, owner } = resolveDeadlockParticipants(threads, item);
            item.sourceKey = waiter.thread?.sourceKey || null;
            item.mappingStatus = waiter.status;
            item.mappingReason = waiter.reason;
            item.heldBySourceKey = owner.thread?.sourceKey || null;
            item.heldByMappingStatus = owner.status;
            if (!waiter.thread) warnings.push(`Deadlock thread "${item.threadName}" could not be mapped uniquely (${waiter.reason}).`);
            if (!owner.thread) warnings.push(`Deadlock owner "${item.heldBy}" could not be mapped uniquely (${owner.reason}).`);

            if (waiter.thread) {
                Object.assign(waiter.thread, {
                    isDeadlocked: true,
                    deadlockCycleId: cycle.id,
                    deadlockHeldBy: item.heldBy,
                    deadlockWaitingLockId: item.waitingLockId,
                    deadlockWaitingLockType: item.waitingLockType,
                });
            }
            if (owner.thread) {
                Object.assign(owner.thread, {
                    isDeadlocked: true,
                    deadlockCycleId: cycle.id,
                    deadlockHoldingLockId: item.waitingLockId,
                    deadlockHoldingLockType: item.waitingLockType,
                });
            }
        }
    }
    return warnings;
}

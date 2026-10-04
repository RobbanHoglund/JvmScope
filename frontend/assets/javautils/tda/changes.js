import {
    ALLOCATION_RATE_THRESHOLDS,
    createRunnableCpuThresholds,
    RUNNABLE_CPU_THRESHOLDS,
} from './classification.js';
import { canCompareThreadCollections } from './snapshot-quality.js';
import { normalizeStackFrame } from './parser.js';

/** Pure adjacent-snapshot thread change analysis. This module has no DOM or D3 dependencies. */

function text(value) {
    return String(value ?? '').trim();
}

function canonicalLocks(thread, property) {
    if (thread?.lockDataAvailable === false) return null;
    const locks = thread?.[property];
    if (!Array.isArray(locks)) return null;
    return locks
        .map((lock) => [
            text(lock?.semantic),
            text(lock?.lockId).toLowerCase(),
            text(lock?.lockType),
        ].join('|'))
        .sort();
}

function equalArrays(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addTextChange(changes, type, label, previousValue, currentValue) {
    const previous = text(previousValue);
    const current = text(currentValue);
    if (!previous || !current || previous === current) return;
    changes.push({ type, label, previous, current });
}

function detectMaterialChanges(previous, current, cpuThresholds) {
    const changes = [];

    addTextChange(changes, 'name', 'Thread name', previous.threadName, current.threadName);
    addTextChange(changes, 'state', 'Java state', previous.javaState, current.javaState);

    const previousTopFrame = text(previous.topFrame);
    const currentTopFrame = text(current.topFrame);
    if (
        previousTopFrame &&
        currentTopFrame &&
        normalizeStackFrame(previousTopFrame) !== normalizeStackFrame(currentTopFrame)
    ) {
        changes.push({
            type: 'top-frame',
            label: 'Top frame',
            previous: previousTopFrame,
            current: currentTopFrame,
        });
    }

    for (const lockProperty of ['heldLocks', 'waitingLocks']) {
        const previousLocks = canonicalLocks(previous, lockProperty);
        const currentLocks = canonicalLocks(current, lockProperty);
        if (previousLocks && currentLocks && !equalArrays(previousLocks, currentLocks)) {
            changes.push({
                type: lockProperty === 'heldLocks' ? 'held-locks' : 'waiting-locks',
                label: lockProperty === 'heldLocks' ? 'Held locks' : 'Waiting locks',
                previous: previousLocks,
                current: currentLocks,
            });
        }
    }

    if (Boolean(previous.isDeadlocked) !== Boolean(current.isDeadlocked)) {
        changes.push({
            type: 'deadlock',
            label: 'Deadlock membership',
            previous: Boolean(previous.isDeadlocked),
            current: Boolean(current.isDeadlocked),
        });
    }

    if (
        current.cpuDeltaStatus === 'computed' &&
        current.cpuIntervalQuality !== 'estimated' &&
        Number.isFinite(current.cpuRatePercent) &&
        Number.isFinite(current.cpuIntervalMs) &&
        current.cpuIntervalMs >= cpuThresholds.minimumIntervalMs &&
        current.cpuRatePercent >= cpuThresholds.applicationFindingPercent
    ) {
        changes.push({
            type: 'cpu-activity',
            label: 'Measured CPU activity',
            previous: previous.cpuMs ?? null,
            current: current.cpuMs ?? null,
            deltaMs: current.cpuDeltaMs,
            ratePercent: current.cpuRatePercent,
            intervalMs: current.cpuIntervalMs,
        });
    }

    if (
        current.allocationDeltaStatus === 'computed' &&
        current.allocationIntervalQuality !== 'estimated' &&
        Number.isFinite(current.allocationRateBytesPerSecond) &&
        Number.isFinite(current.allocationIntervalMs) &&
        current.allocationIntervalMs >= ALLOCATION_RATE_THRESHOLDS.minimumIntervalMs &&
        current.allocationRateBytesPerSecond >= ALLOCATION_RATE_THRESHOLDS.findingBytesPerSecond
    ) {
        changes.push({
            type: 'allocation-activity',
            label: 'Measured allocation activity',
            previous: previous.allocatedBytes ?? null,
            current: current.allocatedBytes ?? null,
            deltaBytes: current.allocatedDeltaBytes,
            rateBytesPerSecond: current.allocationRateBytesPerSecond,
            intervalMs: current.allocationIntervalMs,
        });
    }

    return changes;
}

function changeRecord(status, thread, previous = null, changes = []) {
    return {
        status,
        reason: thread?.seriesMatchReason || null,
        previousDumpIndex: previous?.dumpIndex ?? null,
        previousSourceKey: previous?.thread?.sourceKey ?? null,
        previousState: previous?.thread?.javaState ?? null,
        previousTopFrame: previous?.thread?.topFrame ?? null,
        previousHeldLockCount: Array.isArray(previous?.thread?.heldLocks) ? previous.thread.heldLocks.length : null,
        previousWaitingLockCount: Array.isArray(previous?.thread?.waitingLocks) ? previous.thread.waitingLocks.length : null,
        previousCpuMs: previous?.thread?.cpuMs ?? null,
        previousAllocatedBytes: previous?.thread?.allocatedBytes ?? null,
        changes,
    };
}

function endedThreadSummary(thread) {
    return {
        sourceKey: thread?.sourceKey || null,
        seriesKey: thread?.seriesKey || null,
        threadName: thread?.threadName || '—',
        javaState: thread?.javaState || null,
        topFrame: thread?.topFrame || null,
    };
}

/**
 * Annotates current threads and each dump transition. Only exact TDA-200 matches
 * can be continued or compared. Ambiguous identity suppresses ended claims for
 * that whole transition because the missing predecessor cannot be known safely.
 */
export function annotateThreadChanges(dumps, series, {
    cpuThresholds = RUNNABLE_CPU_THRESHOLDS,
} = {}) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const normalizedSeries = Array.isArray(series) ? series : [];
    const activeCpuThresholds = cpuThresholds === RUNNABLE_CPU_THRESHOLDS
        ? cpuThresholds
        : createRunnableCpuThresholds(cpuThresholds);
    const diagnostics = {
        baselineThreads: 0,
        newThreads: 0,
        endedThreads: 0,
        continuedThreads: 0,
        unresolvedThreads: 0,
        changedThreads: 0,
        materialChanges: 0,
        endedTransitionsSuppressed: 0,
    };

    normalizedDumps.forEach((dump, dumpPosition) => {
        const threads = Array.isArray(dump?.threads) ? dump.threads : [];
        const dumpIndex = dump?.index ?? dumpPosition;
        if (dumpPosition === 0) {
            threads.forEach((thread) => {
                thread.snapshotChange = changeRecord('baseline', thread);
            });
            dump.threadChanges = {
                baselineCount: threads.length,
                newCount: 0,
                endedCount: 0,
                continuedCount: 0,
                changedCount: 0,
                unresolvedCount: 0,
                endedStatus: 'not-applicable',
                endedThreads: [],
            };
            diagnostics.baselineThreads += threads.length;
            return;
        }

        const previousDump = normalizedDumps[dumpPosition - 1];
        const collectionReliable = canCompareThreadCollections(previousDump, dump);
        const previousThreads = Array.isArray(previousDump?.threads) ? previousDump.threads : [];
        const previousBySourceKey = new Map(
            previousThreads.map((thread) => [thread.sourceKey, { dumpIndex: previousDump.index ?? dumpPosition - 1, thread }]),
        );
        const claimedPreviousSourceKeys = new Set();
        let newCount = 0;
        let continuedCount = 0;
        let changedCount = 0;
        let unresolvedCount = 0;

        for (const thread of threads) {
            if (thread.seriesMatchStatus === 'ambiguous') {
                thread.snapshotChange = changeRecord('unresolved', thread);
                unresolvedCount += 1;
                diagnostics.unresolvedThreads += 1;
                continue;
            }

            const previous = thread.seriesMatchStatus === 'matched'
                ? previousBySourceKey.get(thread.previousSourceKey)
                : null;
            if (!previous) {
                const status = thread.seriesMatchStatus === 'matched' || !collectionReliable ? 'unresolved' : 'new';
                thread.snapshotChange = changeRecord(status, thread);
                if (status === 'new') {
                    newCount += 1;
                    diagnostics.newThreads += 1;
                } else {
                    unresolvedCount += 1;
                    diagnostics.unresolvedThreads += 1;
                }
                continue;
            }

            claimedPreviousSourceKeys.add(previous.thread.sourceKey);
            const changes = collectionReliable ? detectMaterialChanges(previous.thread, thread, activeCpuThresholds) : [];
            thread.snapshotChange = changeRecord('continued', thread, previous, changes);
            continuedCount += 1;
            diagnostics.continuedThreads += 1;
            diagnostics.materialChanges += changes.length;
            if (changes.length) {
                changedCount += 1;
                diagnostics.changedThreads += 1;
            }
        }

        const endedReliable = collectionReliable && unresolvedCount === 0;
        const endedThreads = endedReliable
            ? previousThreads
                .filter((thread) => !claimedPreviousSourceKeys.has(thread.sourceKey))
                .map(endedThreadSummary)
            : [];
        const endedCount = endedReliable ? endedThreads.length : null;
        if (endedReliable) diagnostics.endedThreads += endedThreads.length;
        else diagnostics.endedTransitionsSuppressed += 1;

        dump.threadChanges = {
            dumpIndex,
            baselineCount: 0,
            newCount: collectionReliable ? newCount : null,
            endedCount,
            continuedCount,
            changedCount: collectionReliable ? changedCount : null,
            unresolvedCount,
            endedStatus: endedReliable ? 'computed' : !collectionReliable ? 'snapshot-incomplete' : 'identity-unresolved',
            endedThreads,
        };
    });

    const seriesByKey = new Map(normalizedSeries.map((threadSeries) => [threadSeries.seriesKey, threadSeries]));
    normalizedSeries.forEach((threadSeries) => {
        threadSeries.baselineOccurrences = 0;
        threadSeries.newOccurrences = 0;
        threadSeries.continuedOccurrences = 0;
        threadSeries.unresolvedOccurrences = 0;
        threadSeries.changedOccurrences = 0;
        threadSeries.materialChanges = 0;
        threadSeries.endedAfterDumpIndexes = [];
    });
    normalizedDumps.forEach((dump, dumpPosition) => {
        (dump?.threads || []).forEach((thread) => {
            const threadSeries = seriesByKey.get(thread.seriesKey);
            if (!threadSeries || !thread.snapshotChange) return;
            const statusProperty = `${thread.snapshotChange.status}Occurrences`;
            if (Object.hasOwn(threadSeries, statusProperty)) threadSeries[statusProperty] += 1;
            if (thread.snapshotChange.changes.length) {
                threadSeries.changedOccurrences += 1;
                threadSeries.materialChanges += thread.snapshotChange.changes.length;
            }
        });
        for (const ended of dump?.threadChanges?.endedThreads || []) {
            const threadSeries = seriesByKey.get(ended.seriesKey);
            if (threadSeries) {
                threadSeries.endedAfterDumpIndexes.push(
                    normalizedDumps[dumpPosition - 1]?.index ?? dumpPosition - 1,
                );
            }
        }
    });

    return {
        dumps: normalizedDumps,
        series: normalizedSeries,
        diagnostics,
    };
}

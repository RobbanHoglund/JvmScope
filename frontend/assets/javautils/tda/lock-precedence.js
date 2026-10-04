/**
 * Pure lock-observation and contention-precedence analysis.
 *
 * A thread dump can prove that a lock is listed as held at one endpoint. Across
 * snapshots it can only show endpoint changes, never the exact acquire/release
 * time or uninterrupted ownership, so this module preserves that distinction.
 */

import { canCompareThreadCollections } from './snapshot-quality.js';
import { threadComparisonInterval } from './time-quality.js';

function text(value) {
    return String(value ?? '').trim();
}

function normalized(value) {
    return text(value).toLowerCase();
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function lockIdentity(lock) {
    const lockId = normalized(lock?.lockId);
    if (!lockId) return null;
    return `${lockId}|${normalized(lock?.lockType)}`;
}

function lockObservation(lock) {
    return {
        lockId: text(lock?.lockId) || null,
        lockType: text(lock?.lockType) || null,
        kind: text(lock?.kind) || null,
    };
}

function heldLocksByIdentity(thread) {
    const locks = new Map();
    for (const lock of Array.isArray(thread?.heldLocks) ? thread.heldLocks : []) {
        const identity = lockIdentity(lock);
        if (identity && !locks.has(identity)) locks.set(identity, lockObservation(lock));
    }
    return locks;
}

function comparisonInterval(previousOccurrence, currentOccurrence, dumpsByIndex) {
    return threadComparisonInterval(
        dumpsByIndex.get(previousOccurrence.dumpIndex),
        dumpsByIndex.get(currentOccurrence.dumpIndex),
        previousOccurrence.thread, currentOccurrence.thread,
    );
}

function emptyTransitions(status) {
    return {
        status,
        intervalMs: null,
        intervalBasis: 'unavailable',
        observedAtBothEndpoints: [],
        contentionAtBothEndpoints: [],
        appearedSincePrevious: [],
        noLongerObservedSincePrevious: [],
        qualification: 'Lock snapshots do not prove an exact acquire or release time, uninterrupted ownership, or application-level causality.',
    };
}

function isContendedWait(lock) {
    return lock?.kind === 'monitor-enter' || lock?.kind === 'synchronizer-park';
}

function severityFor(score) {
    if (score >= 90) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'info';
}

function initialAssessment(thread) {
    const confirmedHolds = [...heldLocksByIdentity(thread).values()];
    return {
        tier: confirmedHolds.length ? 'confirmed-hold' : 'none',
        severityScore: confirmedHolds.length ? 10 : 0,
        severity: confirmedHolds.length ? 'info' : 'info',
        confirmedHolds,
        observedContentions: [],
        likelyBlockers: [],
        transitions: emptyTransitions(
            thread?.seriesMatchStatus === 'ambiguous' ? 'identity-unavailable' : 'first-occurrence',
        ),
    };
}

function annotateDumpRelationships(threads) {
    const ownersByLockId = new Map();
    const waiters = [];

    for (const thread of threads) {
        thread.lockAssessment = initialAssessment(thread);
        for (const lock of thread.lockAssessment.confirmedHolds) {
            const id = normalized(lock.lockId);
            if (!ownersByLockId.has(id)) ownersByLockId.set(id, []);
            ownersByLockId.get(id).push({ thread, lock });
        }
        for (const lock of Array.isArray(thread?.waitingLocks) ? thread.waitingLocks : []) {
            if (isContendedWait(lock) && text(lock.lockId)) waiters.push({ thread, lock: lockObservation(lock) });
        }
    }

    const waitersByOwnerLock = new Map();
    for (const waiter of waiters) {
        const owners = ownersByLockId.get(normalized(waiter.lock.lockId)) || [];
        const ownerSourceKeys = [...new Set(owners.map(({ thread }) => thread.sourceKey).filter(Boolean))].sort();
        const ownerResolution = ownerSourceKeys.length === 1
            ? 'unique-observed-owner'
            : ownerSourceKeys.length > 1
                ? 'multiple-observed-owners'
                : 'owner-not-observed';
        waiter.thread.lockAssessment.observedContentions.push({
            ...waiter.lock,
            ownerSourceKeys,
            ownerResolution,
            qualification: 'The dump shows a wait on this lock. Listed owners are observed at the same snapshot and do not prove the root cause or wait duration.',
        });

        if (ownerResolution !== 'unique-observed-owner') continue;
        const owner = owners[0];
        const key = `${owner.thread.sourceKey}|${normalized(owner.lock.lockId)}`;
        if (!waitersByOwnerLock.has(key)) {
            waitersByOwnerLock.set(key, { owner: owner.thread, lock: owner.lock, waiters: [] });
        }
        waitersByOwnerLock.get(key).waiters.push(waiter.thread);
    }

    for (const { owner, lock, waiters: blockedWaiters } of waitersByOwnerLock.values()) {
        const waiterSourceKeys = [...new Set(blockedWaiters.map((thread) => thread.sourceKey).filter(Boolean))].sort();
        owner.lockAssessment.likelyBlockers.push({
            ...lock,
            waiterSourceKeys,
            waiterCount: waiterSourceKeys.length,
            qualification: 'This thread is observed holding a lock while matched threads wait for it in the same snapshot. It may be delaying them; the dump does not prove causality or duration.',
        });
    }

    for (const thread of threads) {
        const assessment = thread.lockAssessment;
        if (thread.isDeadlocked) {
            assessment.tier = 'deadlock';
            assessment.severityScore = 100;
        } else if (assessment.observedContentions.length > 0) {
            assessment.tier = 'contention';
            assessment.severityScore = 60;
        } else if (assessment.likelyBlockers.length > 0) {
            assessment.tier = 'likely-blocker';
            const waiters = assessment.likelyBlockers.reduce((total, entry) => total + entry.waiterCount, 0);
            assessment.severityScore = Math.min(55, 30 + (waiters * 10));
        }
        assessment.severity = severityFor(assessment.severityScore);
    }
}

function annotateTransitions(dumps, series) {
    const dumpsByIndex = new Map(dumps.map((dump, position) => [dump?.index ?? position, dump]));
    for (const threadSeries of series) {
        const occurrences = [...(threadSeries?.occurrences || [])]
            .sort((left, right) => left.dumpIndex - right.dumpIndex);
        for (let index = 1; index < occurrences.length; index += 1) {
            const previous = occurrences[index - 1];
            const current = occurrences[index];
            const thread = current.thread;
            if (!thread?.lockAssessment) continue;

            const adjacent = current.dumpIndex === previous.dumpIndex + 1;
            const exactContinuation = thread.seriesMatchStatus === 'matched'
                && thread.seriesMatchConfidence === 'exact'
                && thread.previousSourceKey === previous.sourceKey;
            if (!adjacent || !exactContinuation) {
                thread.lockAssessment.transitions = emptyTransitions(
                    adjacent ? 'identity-unavailable' : 'snapshot-gap',
                );
                continue;
            }

            const incompleteSnapshot = !canCompareThreadCollections(
                dumpsByIndex.get(previous.dumpIndex), dumpsByIndex.get(current.dumpIndex),
            );
            if (incompleteSnapshot || !previous.thread?.lockAssessment || previous.thread.lockDataAvailable === false || thread.lockDataAvailable === false) {
                thread.lockAssessment.transitions = emptyTransitions('observation-unavailable');
                continue;
            }
            const previousLocks = heldLocksByIdentity(previous.thread);
            const currentLocks = heldLocksByIdentity(thread);
            const interval = comparisonInterval(previous, current, dumpsByIndex);
            const observedAtBothEndpoints = [];
            const appearedSincePrevious = [];
            const noLongerObservedSincePrevious = [];

            for (const [identity, lock] of currentLocks) {
                if (previousLocks.has(identity)) observedAtBothEndpoints.push(lock);
                else appearedSincePrevious.push(lock);
            }
            for (const [identity, lock] of previousLocks) {
                if (!currentLocks.has(identity)) noLongerObservedSincePrevious.push(lock);
            }

            thread.lockAssessment.transitions = {
                status: 'compared',
                intervalMs: interval.intervalMs,
                intervalBasis: interval.basis,
                observedAtBothEndpoints,
                contentionAtBothEndpoints: Number.isFinite(interval.intervalMs) && interval.intervalMs > 0
                    ? thread.lockAssessment.likelyBlockers.filter((currentBlocker) =>
                        currentBlocker.waiterCount >= 3
                        && previous.thread.lockAssessment.likelyBlockers.some((previousBlocker) =>
                            previousBlocker.waiterCount >= 3
                            && lockIdentity(previousBlocker) === lockIdentity(currentBlocker)))
                    : [],
                appearedSincePrevious,
                noLongerObservedSincePrevious,
                qualification: 'Endpoint observations show only what was listed in adjacent snapshots. They do not prove an exact acquire/release time, uninterrupted ownership, or application-level causality.',
            };
        }
    }
}

/**
 * Builds a conservative hierarchy for deadlocks, direct lock contention, likely
 * blockers, and direct held-lock observations. It requires exact adjacent
 * identity before comparing lock endpoints and intentionally never reports a
 * measured hold duration or a confirmed release.
 */
export function annotateLockPrecedence(dumps, series) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const normalizedSeries = Array.isArray(series) ? series : [];

    const diagnostics = {
        confirmedHeldLocks: 0,
        observedContentions: 0,
        likelyBlockers: 0,
        comparedTransitions: 0,
        identityUnavailableTransitions: 0,
        snapshotGapTransitions: 0,
    };

    for (const dump of normalizedDumps) {
        const threads = Array.isArray(dump?.threads) ? dump.threads : [];
        annotateDumpRelationships(threads);
        for (const thread of threads) {
            diagnostics.confirmedHeldLocks += thread.lockAssessment.confirmedHolds.length;
            diagnostics.observedContentions += thread.lockAssessment.observedContentions.length;
            diagnostics.likelyBlockers += thread.lockAssessment.likelyBlockers.length;
        }
    }

    annotateTransitions(normalizedDumps, normalizedSeries);
    for (const dump of normalizedDumps) {
        for (const thread of dump?.threads || []) {
            const status = thread.lockAssessment?.transitions?.status;
            if (status === 'compared') diagnostics.comparedTransitions += 1;
            else if (status === 'identity-unavailable') diagnostics.identityUnavailableTransitions += 1;
            else if (status === 'snapshot-gap') diagnostics.snapshotGapTransitions += 1;
        }
    }

    return { dumps: normalizedDumps, series: normalizedSeries, diagnostics };
}

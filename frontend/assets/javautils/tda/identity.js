/** Pure within-snapshot identity helpers. This module has no DOM or D3 dependencies. */

import { threadElapsedComparison } from './time-quality.js';

function normalizedIdentityValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

function preferredSourceKeyBase(thread, snapshotIndex, sourceIndex) {
    if (thread?.tid) return `snapshot:${snapshotIndex}:tid:${normalizedIdentityValue(thread.tid)}`;
    if (thread?.jvmId != null) return `snapshot:${snapshotIndex}:jvm:${thread.jvmId}`;
    if (thread?.nid) return `snapshot:${snapshotIndex}:nid:${normalizedIdentityValue(thread.nid)}`;
    return `snapshot:${snapshotIndex}:source:${sourceIndex}`;
}

const SERIES_ID_FIELDS = [
    { property: 'tid', reason: 'exact-tid' },
    { property: 'jvmId', reason: 'exact-jvm-id' },
    { property: 'nid', reason: 'exact-nid-and-name', requiresName: true },
];

function compareSeriesIdentity(current, previous) {
    const equal = [];
    const conflicting = [];

    for (const field of SERIES_ID_FIELDS) {
        const currentValue = normalizedIdentityValue(current?.[field.property]);
        const previousValue = normalizedIdentityValue(previous?.[field.property]);
        if (!currentValue || !previousValue) continue;
        if (currentValue === previousValue) equal.push(field);
        else conflicting.push(field);
    }

    const hasPartialConflict = equal.length > 0 && conflicting.length > 0;
    if (hasPartialConflict) return { matched: false, hasPartialConflict: true, reason: null };

    const strongest = equal.find((field) =>
        !field.requiresName || String(current?.threadName || '') === String(previous?.threadName || ''),
    );
    if (strongest && threadElapsedComparison(previous, current).status === 'regressed') {
        return { matched: false, hasElapsedConflict: true, reason: null };
    }
    return {
        matched: Boolean(strongest),
        hasPartialConflict: false,
        reason: strongest?.reason || null,
    };
}

function createSeriesKey(thread, dumpIndex, threadIndex, usedKeys) {
    const sourceKey = thread?.sourceKey || `snapshot:${dumpIndex}:source:${threadIndex + 1}`;
    const base = `series:${sourceKey}`;
    let candidate = base;
    let suffix = 2;
    while (usedKeys.has(candidate)) {
        candidate = `${base}:${suffix}`;
        suffix += 1;
    }
    usedKeys.add(candidate);
    return candidate;
}

function startThreadSeries(thread, dumpIndex, threadIndex, usedKeys, status, reason) {
    thread.seriesKey = createSeriesKey(thread, dumpIndex, threadIndex, usedKeys);
    thread.seriesMatchStatus = status;
    thread.seriesMatchReason = reason;
    thread.seriesMatchConfidence = 'none';
    thread.previousSourceKey = null;
}

function indexThreadsByIdentity(threads) {
    const indexes = new Map(SERIES_ID_FIELDS.map((field) => [field.property, new Map()]));
    for (const thread of threads) {
        for (const field of SERIES_ID_FIELDS) {
            const value = normalizedIdentityValue(thread?.[field.property]);
            if (!value) continue;
            const index = indexes.get(field.property);
            if (!index.has(value)) index.set(value, []);
            index.get(value).push(thread);
        }
    }
    return indexes;
}

function identityCandidates(thread, indexes) {
    const candidates = new Set();
    for (const field of SERIES_ID_FIELDS) {
        const value = normalizedIdentityValue(thread?.[field.property]);
        if (!value) continue;
        for (const previous of indexes.get(field.property).get(value) || []) {
            candidates.add(previous);
        }
    }
    return candidates;
}

/**
 * Assigns a unique deterministic source key within one snapshot. A source-order
 * suffix is used only when the preferred JVM identifier itself is duplicated.
 */
export function assignThreadSourceKeys(threads, snapshotIndex = 0) {
    const bases = (threads || []).map((thread, index) => preferredSourceKeyBase(thread, snapshotIndex, index + 1));
    const counts = new Map();
    bases.forEach((base) => counts.set(base, (counts.get(base) || 0) + 1));

    return (threads || []).map((thread, index) => {
        const base = bases[index];
        thread.sourceKey = counts.get(base) === 1 ? base : `${base}:source:${index + 1}`;
        thread.seriesKey = thread.seriesKey || null;
        return thread;
    });
}

/**
 * Correlates threads only with the immediately preceding snapshot. A match must
 * be one-to-one and use compatible exact JVM identifiers; names and stacks are
 * never sufficient. A missing PID cannot bridge two different known processes.
 * Every unmatched or ambiguous thread starts a new series.
 */
export function correlateThreadsAcrossSnapshots(dumps) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const usedSeriesKeys = new Set();
    let matchedThreads = 0;
    let ambiguousThreads = 0;
    let identityComparisons = 0;
    let lastKnownProcessId = '';
    let processSegment = 0;

    normalizedDumps.forEach((dump, dumpPosition) => {
        const threads = Array.isArray(dump?.threads) ? dump.threads : [];
        const processId = normalizedIdentityValue(dump?.processId);
        const differentProcess = processId && lastKnownProcessId && processId !== lastKnownProcessId;
        if (differentProcess) processSegment += 1;
        if (dump) dump.correlationProcessSegment = processSegment;
        if (processId) lastKnownProcessId = processId;
        const previousThreads = !differentProcess && dumpPosition > 0 && Array.isArray(normalizedDumps[dumpPosition - 1]?.threads)
            ? normalizedDumps[dumpPosition - 1].threads
            : [];
        const previousIdentityIndexes = indexThreadsByIdentity(previousThreads);

        const proposals = threads.map((thread) => {
            const candidates = [];
            let hasPartialConflict = false;
            let hasElapsedConflict = false;
            for (const previous of identityCandidates(thread, previousIdentityIndexes)) {
                identityComparisons += 1;
                const comparison = compareSeriesIdentity(thread, previous);
                if (comparison.hasPartialConflict) hasPartialConflict = true;
                if (comparison.hasElapsedConflict) hasElapsedConflict = true;
                if (comparison.matched) candidates.push({ thread: previous, reason: comparison.reason });
            }
            return { candidates, hasPartialConflict, hasElapsedConflict };
        });

        const claimCounts = new Map();
        for (const proposal of proposals) {
            if (proposal.candidates.length !== 1) continue;
            const previous = proposal.candidates[0].thread;
            claimCounts.set(previous, (claimCounts.get(previous) || 0) + 1);
        }

        threads.forEach((thread, threadIndex) => {
            const proposal = proposals[threadIndex];
            const uniqueCandidate = proposal.candidates.length === 1 ? proposal.candidates[0] : null;
            const isOneToOne = uniqueCandidate && claimCounts.get(uniqueCandidate.thread) === 1;

            if (proposal.hasElapsedConflict) {
                startThreadSeries(thread, dump.index ?? dumpPosition, threadIndex, usedSeriesKeys, 'ambiguous', 'elapsed-counter-regressed');
                ambiguousThreads += 1;
                return;
            }

            if (isOneToOne) {
                thread.seriesKey = uniqueCandidate.thread.seriesKey;
                thread.seriesMatchStatus = 'matched';
                thread.seriesMatchReason = uniqueCandidate.reason;
                thread.seriesMatchConfidence = 'exact';
                thread.previousSourceKey = uniqueCandidate.thread.sourceKey || null;
                matchedThreads += 1;
                return;
            }

            const isAmbiguous = proposal.candidates.length > 1 || (uniqueCandidate && !isOneToOne);
            if (isAmbiguous) {
                startThreadSeries(thread, dump.index ?? dumpPosition, threadIndex, usedSeriesKeys, 'ambiguous', 'ambiguous-identity');
                ambiguousThreads += 1;
                return;
            }

            const reason = dumpPosition === 0
                ? 'first-snapshot'
                : differentProcess
                    ? 'different-process'
                    : proposal.hasPartialConflict
                        ? 'conflicting-identifiers'
                        : 'no-adjacent-match';
            startThreadSeries(thread, dump.index ?? dumpPosition, threadIndex, usedSeriesKeys, 'new', reason);
        });
    });

    const seriesByKey = new Map();
    normalizedDumps.forEach((dump, dumpPosition) => {
        (dump?.threads || []).forEach((thread) => {
            if (!seriesByKey.has(thread.seriesKey)) {
                seriesByKey.set(thread.seriesKey, {
                    seriesKey: thread.seriesKey,
                    occurrences: [],
                });
            }
            seriesByKey.get(thread.seriesKey).occurrences.push({
                dumpIndex: dump.index ?? dumpPosition,
                sourceKey: thread.sourceKey || null,
                thread,
            });
        });
    });

    return {
        dumps: normalizedDumps,
        series: Array.from(seriesByKey.values()),
        diagnostics: {
            matchedThreads,
            ambiguousThreads,
            seriesCount: seriesByKey.size,
            identityComparisons,
        },
    };
}

/** Resolves a text-derived thread reference conservatively. */
export function resolveThreadReference(threads, reference) {
    if (reference?.sourceKey) {
        const exact = (threads || []).filter((thread) => thread.sourceKey === reference.sourceKey);
        if (exact.length === 1) {
            return { status: 'resolved', reason: 'exact-source-key', thread: exact[0], candidateSourceKeys: [exact[0].sourceKey] };
        }
    }
    if (reference?.threadName == null) {
        return { status: 'missing', reason: 'name-not-supplied', thread: null, candidateSourceKeys: [] };
    }
    const threadName = String(reference.threadName);
    const candidates = (threads || []).filter((thread) => thread.threadName === threadName);

    if (candidates.length === 0) {
        return { status: 'missing', reason: 'name-not-found', thread: null, candidateSourceKeys: [] };
    }
    if (candidates.length === 1) {
        return { status: 'resolved', reason: 'unique-name', thread: candidates[0], candidateSourceKeys: [candidates[0].sourceKey] };
    }

    const lockId = normalizedIdentityValue(reference?.waitingLockId ?? reference?.heldLockId);
    if (lockId) {
        const lockProperty = reference?.waitingLockId != null ? 'waitingLocks' : 'heldLocks';
        const lockMatches = candidates.filter((thread) =>
            (thread[lockProperty] || []).some((lock) => normalizedIdentityValue(lock.lockId) === lockId),
        );
        if (lockMatches.length === 1) {
            return {
                status: 'resolved',
                reason: lockProperty === 'waitingLocks' ? 'name-and-waiting-lock' : 'name-and-held-lock',
                thread: lockMatches[0],
                candidateSourceKeys: [lockMatches[0].sourceKey],
            };
        }
    }

    return {
        status: 'ambiguous',
        reason: 'duplicate-name-without-unique-evidence',
        thread: null,
        candidateSourceKeys: candidates.map((thread) => thread.sourceKey),
    };
}

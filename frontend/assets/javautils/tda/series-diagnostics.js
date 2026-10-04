/**
 * Pure cross-snapshot diagnostic aggregation.
 *
 * This module only compares exact, adjacent thread-series occurrences. It
 * summarizes diagnostic endpoint observations and temporal lock associations;
 * it never converts those associations into proven durations or causes.
 */

import { hasThreadDiagnostic } from './diagnostics.js';

const SERIES_QUALIFICATION =
    'Cross-snapshot diagnostics summarize exact endpoint observations. They do not prove continuous behavior, duration, useful-progress loss, or application-level causality.';

const ROOT_CAUSE_EVIDENCE = Object.freeze({
    level: 'heuristic',
    label: 'HEURISTIC LINK',
    basis: 'Exact thread-series correlation plus JVM lock observations at earlier snapshot endpoints.',
    qualification: 'The temporal association does not prove causality or that useful progress stopped.',
});

function text(value) {
    return String(value ?? '').trim();
}

function normalized(value) {
    return text(value).toLowerCase();
}

function sortedOccurrences(threadSeries) {
    return [...(Array.isArray(threadSeries?.occurrences) ? threadSeries.occurrences : [])]
        .filter((occurrence) => occurrence?.thread)
        .sort((left, right) => Number(left.dumpIndex) - Number(right.dumpIndex));
}

function continuityStatus(occurrences) {
    if (!occurrences.length) return 'insufficient-data';
    if (occurrences.some((occurrence) => occurrence.thread?.seriesMatchStatus === 'ambiguous')) {
        return 'identity-unavailable';
    }
    if (occurrences.length < 2) return 'insufficient-data';

    for (let index = 1; index < occurrences.length; index += 1) {
        const previous = occurrences[index - 1];
        const current = occurrences[index];
        if (current.dumpIndex !== previous.dumpIndex + 1) return 'snapshot-gap';
        const exactContinuation = current.thread?.seriesMatchStatus === 'matched'
            && current.thread?.seriesMatchConfidence === 'exact'
            && current.thread?.previousSourceKey === previous.sourceKey;
        if (!exactContinuation) return 'identity-unavailable';
    }

    return 'available';
}

function qualificationFor(status) {
    if (status === 'available') return SERIES_QUALIFICATION;
    if (status === 'identity-unavailable') {
        return 'A trend requires exact identity across adjacent snapshots; this series could not be correlated safely.';
    }
    if (status === 'snapshot-gap') {
        return 'A trend requires adjacent snapshot endpoints; this series contains a snapshot gap.';
    }
    return 'At least two exact adjacent snapshot occurrences are required before a trend can be reported.';
}

function diagnosticValues(thread) {
    const values = new Map();
    const scenarioKey = text(thread?.scenarioKey);
    if (scenarioKey) {
        values.set(scenarioKey, {
            key: scenarioKey,
            label: text(thread?.scenarioLabel) || scenarioKey,
            confidence: text(thread?.scenarioConfidence) || 'low',
            evidence: thread?.scenarioEvidence ? { ...thread.scenarioEvidence } : null,
            source: 'scenario',
        });
    }

    for (const finding of Array.isArray(thread?.findings) ? thread.findings : []) {
        const key = text(finding?.key);
        if (!key || values.has(key)) continue;
        values.set(key, {
            key,
            label: text(finding?.label) || key,
            confidence: text(finding?.confidence) || 'low',
            evidence: finding?.evidence ? { ...finding.evidence } : null,
            source: 'finding',
        });
    }
    return values;
}

function streakMetrics(observations) {
    let transitionCount = 0;
    let longestStreak = 0;
    let runningStreak = 0;

    observations.forEach((observed, index) => {
        if (index > 0 && observed !== observations[index - 1]) transitionCount += 1;
        if (observed) {
            runningStreak += 1;
            longestStreak = Math.max(longestStreak, runningStreak);
        } else {
            runningStreak = 0;
        }
    });

    return {
        transitionCount,
        currentStreak: observations.at(-1) ? runningStreak : 0,
        longestStreak,
    };
}

function diagnosticTrend(observations, status) {
    const streaks = streakMetrics(observations);
    if (status !== 'available' || observations.length < 2) {
        return {
            trend: 'insufficient-data',
            reason: qualificationFor(status),
            ...streaks,
        };
    }

    const firstObserved = observations[0];
    const currentlyObserved = observations.at(-1);
    if (!firstObserved && currentlyObserved) {
        return {
            trend: 'growing',
            reason: 'The diagnostic is absent at the first endpoint and present at the latest endpoint.',
            ...streaks,
        };
    }
    if (firstObserved && !currentlyObserved) {
        return {
            trend: 'shrinking',
            reason: 'The diagnostic is present at the first endpoint and absent at the latest endpoint.',
            ...streaks,
        };
    }
    if (streaks.transitionCount > 0) {
        return {
            trend: 'stable',
            reason: 'The diagnostic fluctuated between endpoints but has the same state at the first and latest endpoint.',
            ...streaks,
        };
    }
    return {
        trend: 'stable',
        reason: currentlyObserved
            ? 'The diagnostic is observed at every exact endpoint in this series.'
            : 'The diagnostic is not observed at either series endpoint.',
        ...streaks,
    };
}

function aggregateDiagnostics(occurrences, status) {
    const valuesByOccurrence = occurrences.map((occurrence) => diagnosticValues(occurrence.thread));
    const keys = [];
    const seenKeys = new Set();
    for (const values of valuesByOccurrence) {
        for (const key of values.keys()) {
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            keys.push(key);
        }
    }

    return keys.map((key) => {
        const observations = valuesByOccurrence.map((values) => values.has(key));
        const observedIndexes = observations
            .map((observed, index) => observed ? index : -1)
            .filter((index) => index >= 0);
        const latestValue = [...valuesByOccurrence]
            .reverse()
            .map((values) => values.get(key))
            .find(Boolean);
        const trend = diagnosticTrend(observations, status);

        return {
            key,
            label: latestValue?.label || key,
            source: latestValue?.source || 'diagnostic',
            confidence: latestValue?.confidence || 'low',
            evidence: latestValue?.evidence || null,
            count: observedIndexes.length,
            totalOccurrences: occurrences.length,
            firstObservedDumpIndex: occurrences[observedIndexes[0]]?.dumpIndex ?? null,
            lastObservedDumpIndex: occurrences[observedIndexes.at(-1)]?.dumpIndex ?? null,
            currentlyObserved: observations.at(-1) || false,
            ...trend,
        };
    });
}

function lockObservations(thread) {
    const assessment = thread?.lockAssessment || {};
    const observations = [];
    for (const contention of Array.isArray(assessment.observedContentions)
        ? assessment.observedContentions : []) {
        if (!text(contention?.lockId)) continue;
        observations.push({
            lockId: text(contention.lockId),
            relation: 'previously-waited-on-lock',
            ownerResolution: text(contention.ownerResolution) || 'unknown',
            waiterCount: null,
        });
    }
    for (const blocker of Array.isArray(assessment.likelyBlockers) ? assessment.likelyBlockers : []) {
        if (!text(blocker?.lockId)) continue;
        const waiterCount = blocker?.waiterCount == null || blocker.waiterCount === ''
            ? null
            : Number(blocker.waiterCount);
        observations.push({
            lockId: text(blocker.lockId),
            relation: 'previously-held-lock-with-waiters',
            ownerResolution: 'observed-holder',
            waiterCount: Number.isFinite(waiterCount) ? waiterCount : null,
        });
    }
    return observations;
}

function rootCauseReason(link) {
    if (link.relation === 'previously-waited-on-lock') {
        return `The same exactly correlated thread was previously observed waiting for lock ${link.lockId} before possible livelock was inferred.`;
    }
    return `The same exactly correlated thread was previously observed holding lock ${link.lockId} while waiters existed before possible livelock was inferred.`;
}

function buildRootCauseLinks(occurrences, status) {
    if (status !== 'available') return [];
    // The latest livelock endpoint represents the final observed state. Earlier
    // lock evidence is linked to it without claiming that the evidence caused it.
    const livelockOccurrence = [...occurrences]
        .reverse()
        .find((occurrence) => hasThreadDiagnostic(occurrence.thread, 'possible-livelock'));
    if (!livelockOccurrence) return [];

    const links = new Map();
    for (const occurrence of occurrences) {
        if (occurrence.dumpIndex >= livelockOccurrence.dumpIndex) continue;
        for (const observation of lockObservations(occurrence.thread)) {
            const key = `${observation.relation}|${normalized(observation.lockId)}`;
            const existing = links.get(key);
            if (existing) {
                existing.lastObservedDumpIndex = occurrence.dumpIndex;
                existing.observationCount += 1;
                if (observation.waiterCount != null) {
                    existing.maximumObservedWaiters = Math.max(
                        existing.maximumObservedWaiters || 0,
                        observation.waiterCount,
                    );
                }
                continue;
            }
            const link = {
                lockId: observation.lockId,
                relation: observation.relation,
                ownerResolution: observation.ownerResolution,
                firstObservedDumpIndex: occurrence.dumpIndex,
                lastObservedDumpIndex: occurrence.dumpIndex,
                livelockDumpIndex: livelockOccurrence.dumpIndex,
                observationCount: 1,
                maximumObservedWaiters: observation.waiterCount,
                evidence: { ...ROOT_CAUSE_EVIDENCE },
                qualification: ROOT_CAUSE_EVIDENCE.qualification,
            };
            link.reason = rootCauseReason(link);
            links.set(key, link);
        }
    }

    return [...links.values()].sort((left, right) =>
        left.firstObservedDumpIndex - right.firstObservedDumpIndex
        || left.lockId.localeCompare(right.lockId));
}

/** Builds an immutable-style summary for one exact thread series. */
export function summarizeThreadSeries(threadSeries) {
    const occurrences = sortedOccurrences(threadSeries);
    const status = continuityStatus(occurrences);
    return {
        seriesKey: threadSeries?.seriesKey || null,
        status,
        occurrenceCount: occurrences.length,
        firstObservedDumpIndex: occurrences[0]?.dumpIndex ?? null,
        lastObservedDumpIndex: occurrences.at(-1)?.dumpIndex ?? null,
        diagnostics: aggregateDiagnostics(occurrences, status),
        rootCauseLinks: buildRootCauseLinks(occurrences, status),
        qualification: qualificationFor(status),
    };
}

/**
 * Attaches one shared cross-snapshot summary to its series and thread
 * occurrences. Thread objects are already shared by the dump and series models.
 */
export function annotateSeriesDiagnostics(dumps, series) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const normalizedSeries = Array.isArray(series) ? series : [];
    const diagnostics = {
        seriesAnalyzed: 0,
        availableSeries: 0,
        insufficientSeries: 0,
        identityUnavailableSeries: 0,
        snapshotGapSeries: 0,
        diagnosticAggregates: 0,
        rootCauseLinks: 0,
    };

    for (const threadSeries of normalizedSeries) {
        const summary = summarizeThreadSeries(threadSeries);
        threadSeries.crossSnapshotDiagnostics = summary;
        for (const occurrence of threadSeries?.occurrences || []) {
            if (occurrence?.thread) occurrence.thread.crossSnapshotDiagnostics = summary;
        }

        diagnostics.seriesAnalyzed += 1;
        diagnostics.diagnosticAggregates += summary.diagnostics.length;
        diagnostics.rootCauseLinks += summary.rootCauseLinks.length;
        if (summary.status === 'available') diagnostics.availableSeries += 1;
        else if (summary.status === 'identity-unavailable') diagnostics.identityUnavailableSeries += 1;
        else if (summary.status === 'snapshot-gap') diagnostics.snapshotGapSeries += 1;
        else diagnostics.insufficientSeries += 1;
    }

    return { dumps: normalizedDumps, series: normalizedSeries, diagnostics };
}

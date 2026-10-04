/** Pure cross-snapshot metric analysis. This module has no DOM or D3 dependencies. */

import { threadComparisonInterval } from './time-quality.js';

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function intervalBetween(previousOccurrence, currentOccurrence, dumpsByIndex) {
    const previousDump = dumpsByIndex.get(previousOccurrence.dumpIndex);
    const currentDump = dumpsByIndex.get(currentOccurrence.dumpIndex);
    return threadComparisonInterval(previousDump, currentDump, previousOccurrence.thread, currentOccurrence.thread);
}

function initializeThread(thread, status = 'first-occurrence') {
    thread.cpuDeltaMs = null;
    thread.cpuIntervalMs = null;
    thread.cpuRatePercent = null;
    thread.cpuRateBasis = 'unavailable';
    thread.cpuDeltaStatus = status;
    thread.cpuIntervalQuality = 'unavailable';
    thread.cpuIntervalUncertaintyMs = null;
    thread.cpuIntervalReason = null;
    thread.allocatedDeltaBytes = null;
    thread.allocationIntervalMs = null;
    thread.allocationRateBytesPerSecond = null;
    thread.allocationRateBasis = 'unavailable';
    thread.allocationDeltaStatus = status;
    thread.allocationIntervalQuality = 'unavailable';
    thread.allocationIntervalReason = null;
}

/**
 * Adds CPU and allocated-byte counter deltas plus interval-normalized rates to
 * exact correlated series. Rates use the finer consistent interval source.
 * Conflicting clocks, counter resets and unavailable intervals are
 * reported independently and never guessed.
 */
export function annotateCpuRates(dumps, series) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];
    const normalizedSeries = Array.isArray(series) ? series : [];
    const dumpsByIndex = new Map();
    normalizedDumps.forEach((dump, position) => {
        dumpsByIndex.set(dump?.index ?? position, dump);
        (dump?.threads || []).forEach((thread) => initializeThread(
            thread,
            thread?.seriesMatchStatus === 'ambiguous' ? 'identity-ambiguous' : 'first-occurrence',
        ));
    });

    const diagnostics = {
        deltasComputed: 0,
        ratesComputed: 0,
        countersReset: 0,
        countersMissing: 0,
        intervalsUnavailable: 0,
        allocationDeltasComputed: 0,
        allocationRatesComputed: 0,
        allocationCountersReset: 0,
        allocationCountersMissing: 0,
        allocationIntervalsUnavailable: 0,
    };

    for (const threadSeries of normalizedSeries) {
        const occurrences = [...(threadSeries?.occurrences || [])]
            .sort((a, b) => a.dumpIndex - b.dumpIndex);
        let cpuDeltaSamples = 0;
        let cpuRateSamples = 0;
        let totalCpuDeltaMs = 0;
        let ratedCpuDeltaMs = 0;
        let totalCpuIntervalMs = 0;
        let allocationDeltaSamples = 0;
        let allocationRateSamples = 0;
        let totalAllocatedDeltaBytes = 0;
        let ratedAllocatedDeltaBytes = 0;
        let totalAllocationIntervalMs = 0;

        for (let index = 1; index < occurrences.length; index += 1) {
            const previous = occurrences[index - 1];
            const current = occurrences[index];
            const thread = current.thread;
            const isAdjacent = current.dumpIndex === previous.dumpIndex + 1;
            const isExactContinuation = thread?.seriesMatchStatus === 'matched'
                && thread.previousSourceKey === previous.sourceKey;

            if (!isAdjacent || !isExactContinuation) {
                initializeThread(thread, isAdjacent ? 'identity-unavailable' : 'snapshot-gap');
                continue;
            }

            const interval = intervalBetween(previous, current, dumpsByIndex);

            const previousCpuMs = finiteNumber(previous.thread?.cpuMs);
            const currentCpuMs = finiteNumber(thread?.cpuMs);
            if (previousCpuMs == null || currentCpuMs == null) {
                thread.cpuDeltaMs = null;
                thread.cpuIntervalMs = null;
                thread.cpuRatePercent = null;
                thread.cpuRateBasis = 'unavailable';
                thread.cpuDeltaStatus = 'counter-missing';
                diagnostics.countersMissing += 1;
            } else if (currentCpuMs < previousCpuMs) {
                thread.cpuDeltaStatus = 'counter-reset';
                diagnostics.countersReset += 1;
            } else {
                const cpuDeltaMs = currentCpuMs - previousCpuMs;
                thread.cpuDeltaMs = cpuDeltaMs;
                thread.cpuDeltaStatus = 'computed';
                diagnostics.deltasComputed += 1;
                cpuDeltaSamples += 1;
                totalCpuDeltaMs += cpuDeltaMs;
                thread.cpuIntervalMs = interval.intervalMs;
                thread.cpuRateBasis = interval.basis;
                thread.cpuIntervalQuality = interval.quality;
                thread.cpuIntervalUncertaintyMs = interval.uncertaintyMs;
                thread.cpuIntervalReason = interval.reason;
                if (interval.intervalMs == null) {
                    thread.cpuDeltaStatus = interval.quality === 'conflicting' ? 'interval-conflict' : 'interval-unavailable';
                    diagnostics.intervalsUnavailable += 1;
                } else {
                    thread.cpuRatePercent = Number(((cpuDeltaMs / interval.intervalMs) * 100).toFixed(6));
                    cpuRateSamples += 1;
                    ratedCpuDeltaMs += cpuDeltaMs;
                    totalCpuIntervalMs += interval.intervalMs;
                    diagnostics.ratesComputed += 1;
                }
            }

            const previousAllocatedBytes = finiteNumber(previous.thread?.allocatedBytes);
            const currentAllocatedBytes = finiteNumber(thread?.allocatedBytes);
            if (previousAllocatedBytes == null || currentAllocatedBytes == null) {
                thread.allocationDeltaStatus = 'counter-missing';
                diagnostics.allocationCountersMissing += 1;
            } else if (currentAllocatedBytes < previousAllocatedBytes) {
                thread.allocationDeltaStatus = 'counter-reset';
                diagnostics.allocationCountersReset += 1;
            } else {
                const allocatedDeltaBytes = currentAllocatedBytes - previousAllocatedBytes;
                thread.allocatedDeltaBytes = allocatedDeltaBytes;
                thread.allocationDeltaStatus = 'computed';
                diagnostics.allocationDeltasComputed += 1;
                allocationDeltaSamples += 1;
                totalAllocatedDeltaBytes += allocatedDeltaBytes;
                thread.allocationIntervalMs = interval.intervalMs;
                thread.allocationRateBasis = interval.basis;
                thread.allocationIntervalQuality = interval.quality;
                thread.allocationIntervalReason = interval.reason;
                if (interval.intervalMs == null) {
                    thread.allocationDeltaStatus = interval.quality === 'conflicting' ? 'interval-conflict' : 'interval-unavailable';
                    diagnostics.allocationIntervalsUnavailable += 1;
                } else {
                    thread.allocationRateBytesPerSecond = Number(
                        ((allocatedDeltaBytes * 1000) / interval.intervalMs).toFixed(3),
                    );
                    allocationRateSamples += 1;
                    ratedAllocatedDeltaBytes += allocatedDeltaBytes;
                    totalAllocationIntervalMs += interval.intervalMs;
                    diagnostics.allocationRatesComputed += 1;
                }
            }
        }

        threadSeries.cpuDeltaSamples = cpuDeltaSamples;
        threadSeries.cpuRateSamples = cpuRateSamples;
        threadSeries.totalCpuDeltaMs = cpuDeltaSamples ? totalCpuDeltaMs : null;
        threadSeries.totalCpuIntervalMs = cpuRateSamples ? totalCpuIntervalMs : null;
        threadSeries.averageCpuRatePercent = cpuRateSamples
            ? Number(((ratedCpuDeltaMs / totalCpuIntervalMs) * 100).toFixed(6))
            : null;
        threadSeries.allocationDeltaSamples = allocationDeltaSamples;
        threadSeries.allocationRateSamples = allocationRateSamples;
        threadSeries.totalAllocatedDeltaBytes = allocationDeltaSamples ? totalAllocatedDeltaBytes : null;
        threadSeries.totalAllocationIntervalMs = allocationRateSamples ? totalAllocationIntervalMs : null;
        threadSeries.averageAllocationRateBytesPerSecond = allocationRateSamples
            ? Number(((ratedAllocatedDeltaBytes * 1000) / totalAllocationIntervalMs).toFixed(3))
            : null;
    }

    return {
        dumps: normalizedDumps,
        series: normalizedSeries,
        diagnostics,
    };
}

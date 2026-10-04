/** Pure evidence rules for thread classifications. This module has no DOM or D3 dependencies. */

export function isPossibleStarvationCandidate(thread) {
    const transitions = thread?.lockAssessment?.transitions;
    return !thread?.isDeadlocked
        && transitions?.status === 'compared'
        && Number.isFinite(transitions.intervalMs)
        && Number(transitions.intervalMs) > 0
        && Array.isArray(transitions.contentionAtBothEndpoints)
        && transitions.contentionAtBothEndpoints.length > 0;
}

const DEFAULT_RUNNABLE_CPU_THRESHOLDS = Object.freeze({
    minimumIntervalMs: 1000,
    applicationFindingPercent: 2,
    applicationScenarioPercent: 5,
    applicationFindingHighPercent: 20,
    applicationScenarioHighPercent: 10,
    infrastructureFindingPercent: 5,
    infrastructureScenarioPercent: 10,
    infrastructureFindingHighPercent: 15,
    infrastructureScenarioHighPercent: 10,
    livelockPercent: 1,
});

const THRESHOLD_KEYS = Object.freeze(Object.keys(DEFAULT_RUNNABLE_CPU_THRESHOLDS));
const validatedThresholdObjects = new WeakSet();

function validateThresholdOrdering(thresholds, prefix) {
    const finding = thresholds[`${prefix}FindingPercent`];
    const scenario = thresholds[`${prefix}ScenarioPercent`];
    const scenarioHigh = thresholds[`${prefix}ScenarioHighPercent`];
    const findingHigh = thresholds[`${prefix}FindingHighPercent`];
    if (!(finding <= scenario && scenario <= scenarioHigh && scenarioHigh <= findingHigh)) {
        throw new RangeError(
            `${prefix} CPU threshold ordering must be finding <= scenario <= scenario high <= finding high`,
        );
    }
}

export function createRunnableCpuThresholds(overrides = {}) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new TypeError('CPU threshold overrides must be an object');
    }
    const unknownKeys = Object.keys(overrides).filter((key) => !THRESHOLD_KEYS.includes(key));
    if (unknownKeys.length) {
        throw new TypeError(`Unknown CPU threshold: ${unknownKeys.join(', ')}`);
    }

    const thresholds = { ...DEFAULT_RUNNABLE_CPU_THRESHOLDS, ...overrides };
    for (const key of THRESHOLD_KEYS) {
        if (!Number.isFinite(thresholds[key]) || thresholds[key] < 0) {
            throw new RangeError(`${key} must be a non-negative finite number`);
        }
    }
    if (thresholds.minimumIntervalMs <= 0) {
        throw new RangeError('minimumIntervalMs must be greater than zero');
    }
    validateThresholdOrdering(thresholds, 'application');
    validateThresholdOrdering(thresholds, 'infrastructure');
    const frozenThresholds = Object.freeze(thresholds);
    validatedThresholdObjects.add(frozenThresholds);
    return frozenThresholds;
}

function resolveRunnableCpuThresholds(thresholds) {
    return validatedThresholdObjects.has(thresholds)
        ? thresholds
        : createRunnableCpuThresholds(thresholds);
}

export const RUNNABLE_CPU_THRESHOLDS = createRunnableCpuThresholds();

export const ALLOCATION_RATE_THRESHOLDS = Object.freeze({
    minimumIntervalMs: 1000,
    findingBytesPerSecond: 1024 ** 2,
    scenarioBytesPerSecond: 10 * 1024 ** 2,
    highBytesPerSecond: 64 * 1024 ** 2,
});

export const RUNNABLE_CPU_THRESHOLD_PROFILES = Object.freeze({
    balanced: Object.freeze({
        id: 'balanced',
        label: 'Balanced',
        description: 'Preserves the established analyzer thresholds for general-purpose workloads.',
        thresholds: RUNNABLE_CPU_THRESHOLDS,
    }),
    sensitive: Object.freeze({
        id: 'sensitive',
        label: 'Sensitive',
        description: 'Surfaces lower sustained CPU rates for latency-sensitive environments.',
        thresholds: createRunnableCpuThresholds({
            applicationFindingPercent: 1,
            applicationScenarioPercent: 3,
            applicationFindingHighPercent: 12,
            applicationScenarioHighPercent: 7,
            infrastructureFindingPercent: 3,
            infrastructureScenarioPercent: 6,
            infrastructureFindingHighPercent: 12,
            infrastructureScenarioHighPercent: 9,
            livelockPercent: 0.5,
        }),
    }),
    'high-throughput': Object.freeze({
        id: 'high-throughput',
        label: 'High-throughput',
        description: 'Requires higher sustained CPU rates in high-throughput environments.',
        thresholds: createRunnableCpuThresholds({
            applicationFindingPercent: 5,
            applicationScenarioPercent: 10,
            applicationFindingHighPercent: 30,
            applicationScenarioHighPercent: 20,
            infrastructureFindingPercent: 10,
            infrastructureScenarioPercent: 20,
            infrastructureFindingHighPercent: 35,
            infrastructureScenarioHighPercent: 25,
            livelockPercent: 2,
        }),
    }),
});

export function resolveRunnableCpuThresholdProfileId(profileId) {
    const normalized = String(profileId || '').trim().toLowerCase();
    return Object.hasOwn(RUNNABLE_CPU_THRESHOLD_PROFILES, normalized) ? normalized : 'balanced';
}

export function getRunnableCpuThresholdProfile(profileId = 'balanced') {
    return RUNNABLE_CPU_THRESHOLD_PROFILES[resolveRunnableCpuThresholdProfileId(profileId)];
}

export function runnableCpuThresholdProfileFromSearch(search) {
    const params = new URLSearchParams(String(search || ''));
    return resolveRunnableCpuThresholdProfileId(params.get('cpuProfile'));
}

export function updateRunnableCpuThresholdProfileSearch(search, profileId) {
    const params = new URLSearchParams(String(search || ''));
    const resolvedProfileId = resolveRunnableCpuThresholdProfileId(profileId);
    if (resolvedProfileId === 'balanced') {
        params.delete('cpuProfile');
    } else {
        params.set('cpuProfile', resolvedProfileId);
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function basisLabel(basis) {
    if (basis === 'snapshot-time') return 'snapshot timestamps';
    if (basis === 'thread-elapsed') return 'thread elapsed counters';
    return 'an unavailable interval source';
}

function unavailable(status) {
    return {
        available: false,
        status,
        ratePercent: null,
        intervalMs: null,
        hotFinding: false,
        hotScenario: false,
        scenarioConfidence: null,
        scenarioSeverity: null,
        findingConfidence: null,
        findingSeverity: null,
        findingThresholdPercent: null,
        scenarioThresholdPercent: null,
        reason: null,
    };
}

/**
 * Evaluates measured interval CPU evidence without attributing it to the state
 * or stack observed at the interval's final endpoint. Lifetime cpuMs/elapsedS
 * counters are intentionally ignored.
 */
export function evaluateMeasuredCpu(thread, {
    kind = 'application',
    thresholds = RUNNABLE_CPU_THRESHOLDS,
} = {}) {
    const activeThresholds = resolveRunnableCpuThresholds(thresholds);
    if (thread?.cpuDeltaStatus !== 'computed') {
        return unavailable(thread?.cpuDeltaStatus || 'rate-unavailable');
    }

    const ratePercent = finiteNumber(thread?.cpuRatePercent);
    const intervalMs = finiteNumber(thread?.cpuIntervalMs);
    if (ratePercent == null || intervalMs == null || intervalMs <= 0) return unavailable('rate-unavailable');
    if (thread.cpuIntervalQuality === 'estimated') return unavailable('interval-imprecise');

    const infrastructure = kind === 'infrastructure';
    const findingThreshold = infrastructure
        ? activeThresholds.infrastructureFindingPercent
        : activeThresholds.applicationFindingPercent;
    const scenarioThreshold = infrastructure
        ? activeThresholds.infrastructureScenarioPercent
        : activeThresholds.applicationScenarioPercent;
    const findingHighThreshold = infrastructure
        ? activeThresholds.infrastructureFindingHighPercent
        : activeThresholds.applicationFindingHighPercent;
    const scenarioHighThreshold = infrastructure
        ? activeThresholds.infrastructureScenarioHighPercent
        : activeThresholds.applicationScenarioHighPercent;
    const shortInterval = intervalMs < activeThresholds.minimumIntervalMs;
    // The default 250 ms floor assumes the selected interval source resolves well below it;
    // HotSpot elapsed= counters are typically emitted at roughly 10 ms resolution.
    const minimumStrongIntervalMs = activeThresholds.minimumIntervalMs / 4;
    const strongShortInterval = shortInterval
        && intervalMs >= minimumStrongIntervalMs
        && ratePercent >= findingHighThreshold;
    if (shortInterval && !strongShortInterval) return unavailable('sample-too-short');

    const hotFinding = ratePercent >= findingThreshold;
    const hotScenario = ratePercent >= scenarioThreshold;
    const findingHigh = ratePercent >= findingHighThreshold;
    const scenarioHigh = ratePercent >= scenarioHighThreshold;

    return {
        available: true,
        status: strongShortInterval ? 'measured-high-rate-short-interval' : 'measured-rate',
        ratePercent,
        intervalMs,
        hotFinding,
        hotScenario,
        scenarioConfidence: hotScenario ? (scenarioHigh ? 'high' : 'medium') : null,
        scenarioSeverity: hotScenario ? (scenarioHigh ? 'high' : 'medium') : null,
        findingConfidence: hotFinding ? (findingHigh ? 'high' : 'medium') : null,
        findingSeverity: hotFinding ? (findingHigh ? 'high' : 'medium') : null,
        findingThresholdPercent: findingThreshold,
        scenarioThresholdPercent: scenarioThreshold,
        reason: `Measured ${ratePercent.toFixed(1)}% CPU over ${(intervalMs / 1000).toFixed(2)}s since the previous snapshot using ${basisLabel(thread.cpuRateBasis)}; finding threshold ${findingThreshold.toFixed(1)}%, scenario threshold ${scenarioThreshold.toFixed(1)}%${strongShortInterval ? `; retained despite the short interval because it exceeds the ${findingHighThreshold.toFixed(1)}% high-rate threshold` : ''}`,
    };
}

/**
 * Evaluates measured CPU that can also be attributed to a runnable endpoint.
 * Use this stricter form for stack- and state-based scenarios such as spinning
 * or livelock, not for reporting the interval measurement itself.
 */
export function evaluateRunnableCpu(thread, {
    kind = 'application',
    hasBlockingPrimitive = false,
    thresholds = RUNNABLE_CPU_THRESHOLDS,
} = {}) {
    const state = String(thread?.javaState || '');
    if (state !== 'RUNNABLE' && !thread?.isCarrierThread) return unavailable('not-runnable');

    const evidence = evaluateMeasuredCpu(thread, { kind, thresholds });
    if (!evidence.available) return evidence;
    if (hasBlockingPrimitive) return unavailable('blocking-primitive');
    return evidence;
}

function unavailableAllocation(status) {
    return {
        available: false,
        status,
        rateBytesPerSecond: null,
        intervalMs: null,
        hotFinding: false,
        hotScenario: false,
        confidence: null,
        severity: null,
        reason: null,
    };
}

/**
 * Evaluates current heap-allocation activity from exact adjacent counter
 * deltas. This intentionally says nothing about retained/live heap or leaks.
 */
export function evaluateAllocationRate(thread, {
    thresholds = ALLOCATION_RATE_THRESHOLDS,
} = {}) {
    if (thread?.allocationDeltaStatus !== 'computed') {
        return unavailableAllocation(thread?.allocationDeltaStatus || 'rate-unavailable');
    }
    const rateBytesPerSecond = finiteNumber(thread?.allocationRateBytesPerSecond);
    const intervalMs = finiteNumber(thread?.allocationIntervalMs);
    if (rateBytesPerSecond == null || intervalMs == null || intervalMs <= 0) {
        return unavailableAllocation('rate-unavailable');
    }
    if (thread.allocationIntervalQuality === 'estimated') return unavailableAllocation('interval-imprecise');
    if (intervalMs < thresholds.minimumIntervalMs) {
        return unavailableAllocation('sample-too-short');
    }

    const hotFinding = rateBytesPerSecond >= thresholds.findingBytesPerSecond;
    const hotScenario = rateBytesPerSecond >= thresholds.scenarioBytesPerSecond;
    const high = rateBytesPerSecond >= thresholds.highBytesPerSecond;
    const mibPerSecond = rateBytesPerSecond / (1024 ** 2);
    return {
        available: true,
        status: 'measured-rate',
        rateBytesPerSecond,
        intervalMs,
        hotFinding,
        hotScenario,
        confidence: hotScenario ? (high ? 'high' : 'medium') : null,
        severity: hotScenario ? (high ? 'high' : 'medium') : null,
        reason: `Measured ${mibPerSecond.toFixed(2)} MiB/s heap allocation over ${(intervalMs / 1000).toFixed(2)}s since the previous snapshot using ${basisLabel(thread.allocationRateBasis)}; cumulative allocation does not measure retained/live heap`,
    };
}

export function hasMeasuredLivelockCpuEvidence(thread, {
    thresholds = RUNNABLE_CPU_THRESHOLDS,
} = {}) {
    const activeThresholds = resolveRunnableCpuThresholds(thresholds);
    const evidence = evaluateRunnableCpu(thread, { thresholds: activeThresholds });
    return evidence.available
        && evidence.ratePercent >= activeThresholds.livelockPercent;
}

export const LIVELOCK_STACK_SIGNAL = /(?:^|[./$])(?:tryLock|yield|parkNanos|onSpinWait|compareAndSet)\s*\(/i;

/**
 * A runnable thread with measured CPU activity whose frames show an explicit
 * spin, retry, or park primitive. This is an interpretation helper, not a JVM diagnosis.
 */
export function isPossibleLivelockCandidate(thread, {
    stackText = '',
    thresholds = RUNNABLE_CPU_THRESHOLDS,
} = {}) {
    return String(thread?.javaState || '') === 'RUNNABLE'
        && hasMeasuredLivelockCpuEvidence(thread, { thresholds })
        && LIVELOCK_STACK_SIGNAL.test(String(stackText || ''));
}

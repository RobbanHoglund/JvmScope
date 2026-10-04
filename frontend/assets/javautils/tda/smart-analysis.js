import { diagnosticEvidenceFor, hasThreadDiagnostic } from './diagnostics.js';
import { isPossibleStarvationCandidate } from './classification.js';

const SEVERITY_ORDER = Object.freeze({
    critical: 4,
    high: 3,
    medium: 2,
    info: 1,
});

const CONFIDENCE_ORDER = Object.freeze({
    high: 3,
    medium: 2,
    low: 1,
});

const ACQUISITION_CONTENTION_DIAGNOSTICS = Object.freeze([
    'monitor-contention',
    'reentrant-lock-contention',
    'rwlock-reader-wait',
    'rwlock-writer-lock',
]);

function normalizedSeverity(value, fallback = 'info') {
    const severity = String(value || '').toLowerCase();
    return SEVERITY_ORDER[severity] ? severity : fallback;
}

function normalizedConfidence(value, fallback = 'low') {
    const confidence = String(value || '').toLowerCase();
    return CONFIDENCE_ORDER[confidence] ? confidence : fallback;
}

function diagnosticRecord(thread, key) {
    if (thread?.scenarioKey === key) {
        return {
            severity: thread.scenarioSeverity,
            confidence: thread.scenarioConfidence,
            reason: thread.scenarioReason,
        };
    }

    return (Array.isArray(thread?.findings) ? thread.findings : [])
        .find((finding) => finding?.key === key) || null;
}

function highestSeverity(records, fallback = 'medium') {
    if (!records.length) return normalizedSeverity(fallback);

    return records.slice(1).reduce((highest, record) => {
        const severity = normalizedSeverity(record?.severity, fallback);
        return SEVERITY_ORDER[severity] > SEVERITY_ORDER[highest] ? severity : highest;
    }, normalizedSeverity(records[0]?.severity, fallback));
}

function lowestConfidence(records, fallback = 'medium') {
    if (!records.length) return normalizedConfidence(fallback);

    return records.slice(1).reduce((lowest, record) => {
        const confidence = normalizedConfidence(record?.confidence, fallback);
        return CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[lowest] ? confidence : lowest;
    }, normalizedConfidence(records[0]?.confidence, fallback));
}

function threadIdentity(thread) {
    const sourceKey = String(thread?.sourceKey || '').trim();
    if (sourceKey) return `source:${sourceKey}`;

    const index = Number(thread?.index);
    if (Number.isInteger(index) && index > 0) return `index:${index}`;

    return `name:${String(thread?.threadName || 'unknown')}`;
}

function threadReference(thread) {
    const index = Number(thread?.index);
    return {
        sourceKey: String(thread?.sourceKey || ''),
        index: Number.isInteger(index) && index > 0 ? index : null,
        name: String(thread?.threadName || 'unknown'),
        state: String(thread?.javaState || 'UNKNOWN'),
    };
}

function uniqueThreadReferences(threads) {
    const seen = new Set();
    const references = [];

    for (const thread of Array.isArray(threads) ? threads : []) {
        if (!thread) continue;
        const identity = threadIdentity(thread);
        if (seen.has(identity)) continue;
        seen.add(identity);
        references.push(threadReference(thread));
    }

    return references.sort((left, right) => {
        const leftIndex = left.index ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = right.index ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.name.localeCompare(right.name);
    });
}

function uniqueValues(values) {
    const list = Array.isArray(values) ? values : [];
    return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}

function lockIdsForThread(thread) {
    return uniqueValues([
        thread?.waitingToLock?.lockId,
        ...(Array.isArray(thread?.waitingLocks) ? thread.waitingLocks : []).map((lock) => lock?.lockId),
        ...(Array.isArray(thread?.waitingSynchronizers) ? thread.waitingSynchronizers : []).map((lock) => lock?.lockId),
    ]);
}

function temporalFact(threads, diagnosticKey) {
    let best = null;

    for (const thread of Array.isArray(threads) ? threads : []) {
        const diagnostics = Array.isArray(thread?.crossSnapshotDiagnostics?.diagnostics)
            ? thread.crossSnapshotDiagnostics.diagnostics : [];
        const diagnostic = diagnostics
            .find((entry) => entry?.key === diagnosticKey);
        if (!diagnostic) continue;

        const count = Number(diagnostic.count || 0);
        const total = Number(diagnostic.totalOccurrences || 0);
        if (count < 2 || total < count) continue;
        if (!best || count > best.count || (count === best.count && total > best.total)) {
            best = { count, total, trend: String(diagnostic.trend || 'stable') };
        }
    }

    return best
        ? { label: 'Cross-snapshot evidence', value: `${best.count}/${best.total} exact endpoints · ${best.trend}` }
        : null;
}

function makeFinding({
    id,
    diagnosticKey,
    title,
    summary,
    severity,
    confidence,
    threads,
    facts = [],
    resourceIds = [],
    recommendation,
}) {
    const evidence = diagnosticEvidenceFor(diagnosticKey);
    return {
        id,
        diagnosticKey,
        title,
        summary,
        severity: normalizedSeverity(severity, 'medium'),
        confidence: normalizedConfidence(confidence, 'medium'),
        evidence,
        qualification: evidence.qualification,
        threads: uniqueThreadReferences(threads),
        facts: facts.filter((fact) => fact?.label && fact?.value),
        resourceIds: uniqueValues(resourceIds),
        recommendation,
    };
}

function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(1)}%` : 'Unavailable';
}

function formatByteRate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Unavailable';
    if (number >= 1024 ** 3) return `${(number / 1024 ** 3).toFixed(1)} GiB/s`;
    if (number >= 1024 ** 2) return `${(number / 1024 ** 2).toFixed(1)} MiB/s`;
    if (number >= 1024) return `${(number / 1024).toFixed(1)} KiB/s`;
    return `${number.toFixed(0)} B/s`;
}

function addDeadlockFinding(findings, snapshot, threads) {
    const cycles = Array.isArray(snapshot?.deadlocks) ? snapshot.deadlocks : [];
    const deadlockedThreads = threads.filter((thread) => thread?.isDeadlocked);
    if (!cycles.length && !deadlockedThreads.length) return;
    const cycleCount = cycles.length;
    const reportedEntries = cycles.flatMap((cycle) => Array.isArray(cycle?.threads) ? cycle.threads : []);
    const reportSummary = cycleCount
        ? `${cycleCount} JVM-reported cycle${cycleCount === 1 ? '' : 's'} with ${reportedEntries.length} reported participant entries.`
        : 'Deadlock-marked thread blocks are present; the cycle report is unavailable.';
    const mappingWarnings = uniqueValues(snapshot?.diagnostics?.identityWarnings);

    const lockIds = cycles.flatMap((cycle) =>
        (Array.isArray(cycle?.threads) ? cycle.threads : []).flatMap((thread) => [
            thread?.waitingLockId,
            thread?.holdingLockId,
        ]));

    findings.push(makeFinding({
        id: 'confirmed-deadlock',
        diagnosticKey: 'deadlock',
        title: 'Confirmed Java deadlock',
        summary: `${reportSummary} ${deadlockedThreads.length} thread block${deadlockedThreads.length === 1 ? '' : 's'} matched.${mappingWarnings.length ? ' Some participant mappings are missing or ambiguous; inspect the mapping warnings below.' : ''}`,
        severity: 'critical',
        confidence: 'high',
        threads: deadlockedThreads,
        resourceIds: lockIds,
        facts: [
            { label: 'JVM-reported cycles', value: cycleCount ? String(cycleCount) : 'Unavailable' },
            { label: 'Reported participant entries', value: cycleCount ? String(reportedEntries.length) : 'Unavailable' },
            { label: 'Matched thread blocks', value: String(deadlockedThreads.length) },
            ...mappingWarnings.map((value) => ({ label: 'Participant mapping warning', value })),
        ],
        recommendation: 'Inspect the reported lock order and change acquisition ordering so every participant follows one consistent order.',
    }));
}

function addClassInitializationFinding(findings, snapshot) {
    const chains = (Array.isArray(snapshot?.classInitializationChains)
        ? snapshot.classInitializationChains : [])
        .filter((chain) => chain?.stallCandidate);
    if (!chains.length) return;

    const threads = chains.flatMap((chain) => [
        chain?.initializer,
        ...(Array.isArray(chain?.initializers) ? chain.initializers : []),
        ...(Array.isArray(chain?.waiters) ? chain.waiters : []),
    ]);
    const waiterCount = chains.reduce((total, chain) => total + Number(chain?.waiterCount || 0), 0);
    const temporal = temporalFact(threads, 'class-initialization-stall');

    findings.push(makeFinding({
        id: 'class-initialization-stall',
        diagnosticKey: 'class-initialization-stall',
        title: 'Class initialization may be stalled',
        summary: `${waiterCount} thread${waiterCount === 1 ? '' : 's'} wait across ${chains.length} class initialization chain${chains.length === 1 ? '' : 's'}, while the observed initializer is itself waiting in this snapshot.`,
        severity: 'high',
        confidence: 'medium',
        threads,
        resourceIds: chains.flatMap((chain) =>
            (Array.isArray(chain?.initializerWaitingResources)
                ? chain.initializerWaitingResources : [])
                .map((resource) => resource?.lockId || resource?.lockType)),
        facts: [
            { label: 'Affected classes', value: uniqueValues(chains.map((chain) => chain?.className)).join(', ') },
            { label: 'Waiting threads', value: String(waiterCount) },
            temporal,
        ],
        recommendation: 'Inspect the initializer stack and remove blocking startup work, circular class loading, or external waits from static initialization.',
    }));
}

function addLockBottleneckFinding(findings, snapshot, threads) {
    const bySourceKey = new Map(threads.filter((thread) => thread?.sourceKey)
        .map((thread) => [thread.sourceKey, thread]));
    // Use the same uniquely resolved relationships as the dependency analysis.
    // Legacy counts/diagnostic labels must not reintroduce ambiguous owners.
    const relationships = threads.filter((thread) => !thread?.isDeadlocked).flatMap((owner) =>
        (Array.isArray(owner?.lockAssessment?.likelyBlockers) ? owner.lockAssessment.likelyBlockers : [])
            .filter((record) => record?.lockId)
            .map((record) => ({
                owner,
                lockId: record.lockId,
                waiters: uniqueValues(record.waiterSourceKeys)
                    .map((key) => bySourceKey.get(key)).filter((waiter) => waiter && waiter !== owner),
            })).filter((record) => record.waiters.length));
    const blockers = [...new Set(relationships.map((record) => record.owner))];
    if (!blockers.length) return;

    const records = blockers
        .map((thread) => diagnosticRecord(thread, 'likely-lock-bottleneck'))
        .filter(Boolean);
    const waiters = relationships.flatMap((record) => record.waiters);
    const waiterCount = uniqueThreadReferences(waiters).length;
    const severity = waiterCount >= 10 ? 'high' : highestSeverity(records, 'medium');
    const temporal = temporalFact(blockers, 'likely-lock-bottleneck');

    findings.push(makeFinding({
        id: 'likely-lock-bottleneck',
        diagnosticKey: 'likely-lock-bottleneck',
        title: 'Likely lock bottleneck',
        summary: `${blockers.length} observed lock holder${blockers.length === 1 ? '' : 's'} may be delaying ${waiterCount} dependent thread${waiterCount === 1 ? '' : 's'}. The dependency is observed, but the root cause remains an inference.`,
        severity,
        confidence: lowestConfidence(records, 'low'),
        threads: [...blockers, ...waiters],
        resourceIds: relationships.map((record) => record.lockId),
        facts: [
            { label: 'Candidate blockers', value: String(blockers.length) },
            { label: 'Dependent waiters', value: String(waiterCount) },
            temporal,
        ],
        recommendation: 'Inspect the holder stacks first, then reduce critical-section duration or split highly contended locks where the application contract permits it.',
    }));
}

function isObservedContentionThread(thread) {
    if (thread?.isDeadlocked) return false;
    return thread?.lockAssessment?.tier === 'contention'
        && Array.isArray(thread.lockAssessment.observedContentions)
        && thread.lockAssessment.observedContentions.length > 0
        && ACQUISITION_CONTENTION_DIAGNOSTICS.some((key) =>
            hasThreadDiagnostic(thread, key));
}

function addObservedContentionFinding(findings, threads) {
    const contendedThreads = threads.filter(isObservedContentionThread);
    if (!contendedThreads.length) return;

    const resourceIds = contendedThreads.flatMap(lockIdsForThread);
    const distinctResources = uniqueValues(resourceIds).length;
    const severity = contendedThreads.length >= 3 ? 'high' : 'medium';
    const temporal = ACQUISITION_CONTENTION_DIAGNOSTICS
        .map((key) => temporalFact(contendedThreads, key))
        .find(Boolean);

    findings.push(makeFinding({
        id: 'observed-lock-contention',
        diagnosticKey: 'observed-lock-contention',
        title: 'Observed lock contention',
        summary: `${contendedThreads.length} thread${contendedThreads.length === 1 ? '' : 's'} are waiting to acquire ${distinctResources || 'one or more'} observed JVM lock resource${distinctResources === 1 ? '' : 's'} in this snapshot.`,
        severity,
        confidence: 'high',
        threads: contendedThreads,
        resourceIds,
        facts: [
            { label: 'Waiting threads', value: String(contendedThreads.length) },
            { label: 'Distinct lock resources', value: String(distinctResources) },
            temporal,
        ],
        recommendation: 'Inspect owners and waiting stacks in the dependency map. Several close snapshots help distinguish a transient wait from sustained contention.',
    }));
}

function addMeasuredCpuFinding(findings, threads) {
    const hotThreads = threads.filter((thread) =>
        hasThreadDiagnostic(thread, 'cpu-hot')
        && thread?.cpuDeltaStatus === 'computed'
        && Number.isFinite(Number(thread?.cpuRatePercent))
        && Number(thread.cpuRatePercent) > 0);
    if (!hotThreads.length) return;

    const records = hotThreads.map((thread) => diagnosticRecord(thread, 'cpu-hot')).filter(Boolean);
    const highestRate = Math.max(...hotThreads.map((thread) => Number(thread?.cpuRatePercent || 0)));
    const temporal = temporalFact(hotThreads, 'cpu-hot');

    findings.push(makeFinding({
        id: 'cpu-hot',
        diagnosticKey: 'cpu-hot',
        title: 'Measured CPU-hot application threads',
        summary: `${hotThreads.length} application thread${hotThreads.length === 1 ? '' : 's'} ${hotThreads.length === 1 ? 'exceeds' : 'exceed'} the configured CPU threshold over a validated adjacent-snapshot interval. The endpoint state describes capture time and does not erase CPU measured earlier in the interval.`,
        severity: highestSeverity(records, 'medium'),
        confidence: lowestConfidence(records, 'medium'),
        threads: hotThreads,
        facts: [
            { label: 'Highest measured CPU rate', value: formatPercent(highestRate) },
            { label: 'Measured hot threads', value: String(hotThreads.length) },
            temporal,
        ],
        recommendation: 'Inspect the hottest thread stacks and compare several adjacent intervals before optimizing the repeated application path.',
    }));
}

function addMeasuredInfrastructureCpuFinding(findings, threads) {
    const hotThreads = threads.filter((thread) =>
        hasThreadDiagnostic(thread, 'infra-hot')
        && thread?.cpuDeltaStatus === 'computed'
        && Number.isFinite(Number(thread?.cpuRatePercent))
        && Number(thread.cpuRatePercent) > 0);
    if (!hotThreads.length) return;

    const records = hotThreads.map((thread) => diagnosticRecord(thread, 'infra-hot')).filter(Boolean);
    const highestRate = Math.max(...hotThreads.map((thread) => Number(thread?.cpuRatePercent || 0)));
    const temporal = temporalFact(hotThreads, 'infra-hot');

    findings.push(makeFinding({
        id: 'infra-hot',
        diagnosticKey: 'infra-hot',
        title: 'Measured CPU-hot infrastructure threads',
        summary: `${hotThreads.length} selector or event-loop thread${hotThreads.length === 1 ? '' : 's'} ${hotThreads.length === 1 ? 'exceeds' : 'exceed'} the configured infrastructure CPU threshold over a validated adjacent-snapshot interval.`,
        severity: highestSeverity(records, 'medium'),
        confidence: lowestConfidence(records, 'medium'),
        threads: hotThreads,
        facts: [
            { label: 'Highest measured CPU rate', value: formatPercent(highestRate) },
            { label: 'Measured hot threads', value: String(hotThreads.length) },
            temporal,
        ],
        recommendation: 'Inspect selector or event-loop work for oversized callbacks, excessive task queues, or repeated I/O processing, then confirm with JFR.',
    }));
}

function addMeasuredAllocationFinding(findings, threads) {
    const hotThreads = threads.filter((thread) =>
        hasThreadDiagnostic(thread, 'allocation-hot')
        && thread?.allocationDeltaStatus === 'computed'
        && Number.isFinite(Number(thread?.allocationRateBytesPerSecond))
        && Number(thread.allocationRateBytesPerSecond) > 0);
    if (!hotThreads.length) return;

    const records = hotThreads.map((thread) => diagnosticRecord(thread, 'allocation-hot')).filter(Boolean);
    const highestRate = Math.max(...hotThreads.map((thread) =>
        Number(thread?.allocationRateBytesPerSecond || 0)));
    const temporal = temporalFact(hotThreads, 'allocation-hot');

    findings.push(makeFinding({
        id: 'allocation-hot',
        diagnosticKey: 'allocation-hot',
        title: 'Measured high allocation throughput',
        summary: `${hotThreads.length} thread${hotThreads.length === 1 ? '' : 's'} have a high allocated-byte rate between adjacent snapshots. This measures allocation churn, not retained heap or a memory leak.`,
        severity: highestSeverity(records, 'medium'),
        confidence: lowestConfidence(records, 'medium'),
        threads: hotThreads,
        facts: [
            { label: 'Highest allocation rate', value: formatByteRate(highestRate) },
            { label: 'Measured hot allocators', value: String(hotThreads.length) },
            temporal,
        ],
        recommendation: 'Inspect allocation-heavy stacks with JFR or an allocation profiler, and verify retained memory separately before concluding that a leak exists.',
    }));
}

function addHeuristicFinding(findings, threads, config) {
    const affected = threads.filter((thread) => hasThreadDiagnostic(thread, config.diagnosticKey)
        && (!config.isEligible || config.isEligible(thread)));
    if (!affected.length) return;

    const records = affected
        .map((thread) => diagnosticRecord(thread, config.diagnosticKey))
        .filter(Boolean);
    const temporal = temporalFact(affected, config.diagnosticKey);

    findings.push(makeFinding({
        ...config,
        severity: highestSeverity(records, config.severity),
        confidence: lowestConfidence(records, config.confidence),
        threads: affected,
        facts: [
            { label: 'Affected threads', value: String(affected.length) },
            temporal,
        ],
    }));
}

function buildLimitations({
    threads,
    snapshotIndex,
    snapshotCount,
    analysisStatus,
    parserWarnings,
}) {
    const limitations = [];
    const cpuCounters = threads
        .filter((thread) => thread?.cpuMs != null && Number.isFinite(Number(thread.cpuMs))).length;
    const allocationCounters = threads
        .filter((thread) => thread?.allocatedBytes != null
            && Number.isFinite(Number(thread.allocatedBytes))).length;
    const measuredCpuRates = threads.filter((thread) => thread?.cpuDeltaStatus === 'computed').length;
    const measuredAllocationRates = threads
        .filter((thread) => thread?.allocationDeltaStatus === 'computed').length;

    if (analysisStatus === 'partial') {
        const warning = uniqueValues(parserWarnings).join(' ');
        limitations.push(`The input appears partial or truncated. Findings may omit missing threads or relationships.${warning ? ` ${warning}` : ''}`);
    }

    if (snapshotCount < 2) {
        limitations.push('Only one snapshot is available. Duration, progress, CPU rate, allocation rate, livelock, and leak-like growth cannot be established reliably.');
    } else if (snapshotIndex === 0) {
        limitations.push('This is the first snapshot. CPU and allocation rates require selecting a later adjacent snapshot.');
    }

    if (!cpuCounters) {
        limitations.push('This dump format exposes no per-thread CPU counters, so CPU-hot analysis is unavailable.');
    } else if (snapshotIndex > 0 && !measuredCpuRates) {
        limitations.push('No safe adjacent CPU interval could be computed for the selected snapshot.');
    }

    if (!allocationCounters) {
        limitations.push('This dump format exposes no per-thread allocated-byte counters. Allocation-hot analysis is unavailable.');
    } else if (snapshotIndex > 0 && !measuredAllocationRates) {
        limitations.push('No safe adjacent allocation interval could be computed for the selected snapshot.');
    }

    return {
        limitations,
        coverage: {
            threads: threads.length,
            snapshots: snapshotCount,
            cpuCounters,
            allocationCounters,
            measuredCpuRates,
            measuredAllocationRates,
        },
    };
}

function compareFindings(left, right) {
    const severityDifference = SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity];
    if (severityDifference) return severityDifference;

    const confidenceDifference = CONFIDENCE_ORDER[right.confidence] - CONFIDENCE_ORDER[left.confidence];
    if (confidenceDifference) return confidenceDifference;
    return left.title.localeCompare(right.title);
}

function countFindings(findings) {
    const counts = { critical: 0, high: 0, medium: 0, info: 0, total: findings.length };
    for (const finding of findings) counts[finding.severity] += 1;
    return counts;
}

export function analyzeSnapshotProblems({
    snapshot = null,
    snapshotIndex = null,
    snapshotCount = 1,
    analysisStatus = 'success',
    parserWarnings = [],
} = {}) {
    const threads = Array.isArray(snapshot?.threads) ? snapshot.threads : [];
    const normalizedSnapshotIndex = Number.isInteger(Number(snapshotIndex))
        ? Math.max(0, Number(snapshotIndex))
        : Math.max(0, Number(snapshot?.index || 0));
    const normalizedSnapshotCount = Number.isInteger(Number(snapshotCount))
        ? Math.max(1, Number(snapshotCount))
        : 1;
    const findings = [];

    addDeadlockFinding(findings, snapshot, threads);
    addClassInitializationFinding(findings, snapshot);
    addLockBottleneckFinding(findings, snapshot, threads);
    addObservedContentionFinding(findings, threads);
    addMeasuredCpuFinding(findings, threads);
    addMeasuredInfrastructureCpuFinding(findings, threads);
    addMeasuredAllocationFinding(findings, threads);
    addHeuristicFinding(findings, threads, {
        id: 'possible-livelock',
        diagnosticKey: 'possible-livelock',
        title: 'Possible livelock',
        summary: 'Measured CPU activity and an explicit retry, spin, CAS, yield, or short-park frame appear together. A thread dump cannot prove that useful progress has stopped.',
        severity: 'medium',
        confidence: 'low',
        recommendation: 'Capture several close snapshots or a short JFR recording and verify repeated state changes without completed work.',
    });
    addHeuristicFinding(findings, threads, {
        id: 'possible-starvation',
        diagnosticKey: 'possible-starvation',
        isEligible: isPossibleStarvationCandidate,
        title: 'Possible thread starvation',
        summary: 'The same uniquely resolved lock holder has at least three waiters at both adjacent snapshot endpoints. This can suggest starvation, but does not establish uninterrupted waiting or loss of progress.',
        severity: 'medium',
        confidence: 'low',
        recommendation: 'Compare several snapshots, inspect pool saturation, and verify whether queued work completes before changing pool or lock settings.',
    });

    findings.sort(compareFindings);
    const counts = countFindings(findings);
    const coverageResult = buildLimitations({
        threads,
        snapshotIndex: normalizedSnapshotIndex,
        snapshotCount: normalizedSnapshotCount,
        analysisStatus,
        parserWarnings,
    });

    const headline = counts.critical
        ? `${counts.critical} critical problem${counts.critical === 1 ? '' : 's'} detected`
        : counts.high
            ? `${counts.high} high-severity finding${counts.high === 1 ? '' : 's'} detected`
            : counts.total
                ? `${counts.total} potential problem${counts.total === 1 ? '' : 's'} detected`
                : 'No material problem detected by current rules';

    return {
        status: counts.total ? 'findings' : 'no-material-findings',
        headline,
        summary: counts.total
            ? `${counts.total} prioritized finding${counts.total === 1 ? '' : 's'} from JVM facts, measured intervals, and explicitly qualified inferences.`
            : 'The available evidence contains no configured material finding. This is not proof that the application is healthy.',
        findings,
        counts,
        limitations: coverageResult.limitations,
        coverage: coverageResult.coverage,
    };
}

import { formatSnapshotTime } from './time-quality.js';

export const THREAD_DETAILS_TAB_ORDER = ['overview', 'locks', 'history'];

function hasValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
}

function formatBytes(value) {
    if (!Number.isFinite(value)) return '—';
    if (value < 1024) return `${value.toFixed(0)} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(2)} KiB`;
    if (value < 1024 ** 3) return `${(value / (1024 ** 2)).toFixed(2)} MiB`;
    return `${(value / (1024 ** 3)).toFixed(2)} GiB`;
}

function formatMetric(value, unit) {
    if (!hasValue(value) || !Number.isFinite(Number(value))) return '—';
    return `${Number(value).toFixed(2)} ${unit}`;
}

function normalizeLockObservations(locks) {
    const observations = Array.isArray(locks) ? locks : [];
    const unique = new Map();

    for (const lock of observations) {
        const lockId = hasValue(lock?.lockId) ? String(lock.lockId).trim() : '';
        const lockType = hasValue(lock?.lockType) ? String(lock.lockType).trim() : '';
        if (!lockId && !lockType) continue;

        const kind = hasValue(lock?.kind) ? String(lock.kind).trim() : '';
        const ownerJvmId = hasValue(lock?.ownerJvmId) ? String(lock.ownerJvmId) : null;
        unique.set(`${lockId}|${lockType}|${kind}`, { lockId, lockType, kind,
            ...(ownerJvmId == null ? {} : { ownerJvmId }) });
    }

    return [...unique.values()];
}

function normalizeClassInitializationRelations(thread) {
    return (Array.isArray(thread?.classInitializationChains) ? thread.classInitializationChains : [])
        .map((entry) => {
            const chain = entry?.chain || {};
            return {
                role: hasValue(entry?.role) ? String(entry.role) : 'participant',
                className: hasValue(chain.className) ? String(chain.className) : 'Unknown class',
                status: hasValue(chain.status) ? String(chain.status) : 'unknown',
                waiterCount: Number.isFinite(chain.waiterCount) ? chain.waiterCount : 0,
                initializerThreadName: hasValue(chain.initializer?.threadName)
                    ? String(chain.initializer.threadName) : null,
                initializerState: hasValue(chain.initializerState) ? String(chain.initializerState) : null,
                initializerWaitingResources: normalizeLockObservations(chain.initializerWaitingResources),
                qualification: hasValue(chain.qualification) ? String(chain.qualification) : '',
            };
        });
}

export function getThreadDetailsTabOrder() {
    return [...THREAD_DETAILS_TAB_ORDER];
}

export function classifyStackTraceLine(line) {
    const trimmed = String(line ?? '').trim();
    if (!trimmed) return 'empty';
    if (trimmed.startsWith('"')) return 'header';
    if (trimmed.startsWith('java.lang.Thread.State:')) return 'state';
    if (trimmed.startsWith('at ')) return 'frame';
    if (trimmed.startsWith('- locked')
        || trimmed.startsWith('- waiting')
        || trimmed.startsWith('- parking')) return 'lock';
    if (trimmed.startsWith('Locked ownable synchronizers:')
        || /^--- .+ ---$/.test(trimmed)) return 'section';
    return 'detail';
}

export function buildThreadDetailsViewModel(thread = {}, { snapshot = null, snapshotIndex = 0, snapshotCount = 1 } = {}) {
    const title = hasValue(thread.threadName) ? String(thread.threadName).trim() : 'Thread';
    const stateValue = hasValue(thread.javaState) ? String(thread.javaState).trim() : '—';
    const detailValue = hasValue(thread.javaStateDetail) ? String(thread.javaStateDetail).trim() : '';
    const heldLocks = normalizeLockObservations(thread.heldLocks);
    const waitingLocks = normalizeLockObservations(thread.waitingLocks);
    const reportedLocksHeld = Number.isFinite(thread.locksHeldCount) ? thread.locksHeldCount : 0;
    const locksHeldCount = Math.max(reportedLocksHeld, heldLocks.length);
    const locksHeldValue = thread.lockDataAvailable === false ? '—' : String(locksHeldCount);
    const carrierValue = thread.isVirtualThread === true
        ? (hasValue(thread.carrierThreadId)
            ? `#${thread.carrierThreadId}${thread.carrierSourceKey ? '' : ' (not resolved in dump)'}`
            : 'Not reported')
        : (thread.isCarrierThread ? 'Carrier thread' : (thread.isVirtualThread === false ? 'Platform thread' : 'Not reported'));
    const classInitialization = normalizeClassInitializationRelations(thread);
    const classInitializationRoles = [...new Set(classInitialization.map((relation) => relation.role))];
    const summaryMeta = [
        { label: 'Java state', value: detailValue ? `${stateValue} · ${detailValue}` : stateValue },
        { label: 'JVM ID', value: hasValue(thread.jvmId) ? `#${thread.jvmId}` : '—' },
        { label: 'Native ID', value: hasValue(thread.nid) ? String(thread.nid) : '—' },
        { label: 'Locks held', value: locksHeldValue },
        ...(thread.isVirtualThread != null ? [{ label: 'Thread kind', value: thread.isVirtualThread ? 'Virtual' : 'Platform' }] : []),
        { label: 'Deadlock', value: thread.isDeadlocked ? 'Confirmed' : 'No' },
        { label: 'Carrier', value: carrierValue },
        ...(classInitialization.length ? [{
            label: 'Class init',
            value: classInitializationRoles.join(', '),
        }] : []),
    ].filter((item) => item.value !== null && item.value !== undefined);

    const hasAssessment = hasValue(thread.scenarioKey) || hasValue(thread.scenarioLabel);
    const assessmentReason = hasValue(thread.scenarioReason)
        ? String(thread.scenarioReason)
        : hasAssessment
            ? 'No diagnostic explanation was supplied for this classification.'
            : 'This does not establish that the thread is problem-free. Review its stack and behavior across snapshots.';

    const evidence = thread.scenarioEvidence || {};
    const evidenceLabel = hasValue(evidence.label) ? String(evidence.label) : 'UNCLASSIFIED';
    const evidenceBasis = hasValue(evidence.basis) ? String(evidence.basis) : 'No evidence basis available';
    const evidenceQualification = hasValue(evidence.qualification)
        ? String(evidence.qualification)
        : 'The analyzer did not assign a qualification for this conclusion.';

    // Source evidence is independent of the readable presentation. Keep source
    // indentation and trailing lines for Original and raw copying.
    const rawBlockText = Array.isArray(thread.rawBlock) ? thread.rawBlock.join('\n') : '';
    const fallbackHeader = hasValue(thread.rawHeaderLine)
        ? String(thread.rawHeaderLine).trim()
        : (hasValue(thread.threadName)
            ? `"${String(thread.threadName).trim()}"`
            : '');
    const fallbackStackLines = [
        ...(fallbackHeader ? [fallbackHeader] : []),
        ...(Array.isArray(thread.mountedVirtualStackLines) ? thread.mountedVirtualStackLines : []),
        ...(Array.isArray(thread.carrierStackLines) ? ['--- CARRIER STACK ---', ...thread.carrierStackLines] : []),
    ].filter((line) => hasValue(line));
    const isFileDump = ['hotspot-file-json', 'hotspot-file-text'].includes(thread.format);
    const readableFileLines = [
        `${JSON.stringify(typeof thread.threadName === 'string' ? thread.threadName : title)}${hasValue(thread.jvmId) ? ` #${thread.jvmId}` : ''}${thread.isVirtualThread === true ? ' virtual' : ''}`,
        ...(hasValue(thread.javaState) ? [`   java.lang.Thread.State: ${stateValue}${detailValue ? ` (${detailValue})` : ''}`] : []),
        ...(Array.isArray(thread.stackLines) ? thread.stackLines : []).filter(hasValue).map(line => `    ${String(line).trim()}`),
    ];
    const stackText = isFileDump ? readableFileLines.join('\n') : rawBlockText.trim() || fallbackStackLines.join('\n');
    const rawText = rawBlockText || (hasValue(thread.rawHeaderLine) ? String(thread.rawHeaderLine) : '');

    const coreFacts = [
        ...(hasValue(thread.stateText) && String(thread.stateText).trim().toUpperCase() !== stateValue.toUpperCase()
            ? [{ label: 'JVM status', value: String(thread.stateText) }] : []),
        { label: 'Daemon', value: typeof thread.daemon === 'boolean' ? (thread.daemon ? 'Yes' : 'No') : '—' },
        { label: 'CPU total', value: formatMetric(thread.cpuMs, 'ms') },
        { label: 'CPU delta', value: formatMetric(thread.cpuDeltaMs, 'ms') },
        { label: 'Allocated total', value: hasValue(thread.allocated) ? String(thread.allocated) : formatBytes(thread.allocatedBytes) },
        { label: 'Allocation delta', value: formatBytes(thread.allocatedDeltaBytes) },
        {
            label: 'Allocation rate',
            value: Number.isFinite(thread.allocationRateBytesPerSecond)
                ? `${thread.allocationIntervalQuality === 'estimated' ? '≈ ' : ''}${formatBytes(thread.allocationRateBytesPerSecond)}/s`
                : '—',
        },
        { label: 'Elapsed', value: formatMetric(thread.elapsedS, 's') },
        { label: 'Stack frames', value: Number.isFinite(thread.stackFrames) ? String(thread.stackFrames) : '—' },
    ];

    const tabs = THREAD_DETAILS_TAB_ORDER.map((tabId) => ({
        id: tabId,
        label: {
            overview: 'Overview',
            locks: 'Locks',
            history: 'History',
        }[tabId],
    }));

    return {
        title,
        summaryMeta,
        tabs,
        context: {
            label: `Snapshot ${snapshotIndex + 1} of ${snapshotCount}`,
            source: snapshot?.sourceLabel || 'Source not reported',
            time: formatSnapshotTime(snapshot),
        },
        cpuComparison: {
            label: Number.isFinite(thread.cpuDeltaMs) && snapshotIndex > 0
                ? `Snapshot ${snapshotIndex} → ${snapshotIndex + 1}` : 'No comparable CPU sample',
            intervalMs: thread.cpuIntervalMs,
            basis: thread.cpuRateBasis,
            status: thread.cpuDeltaStatus,
            ...(thread.cpuIntervalReason ? { reason: thread.cpuIntervalReason } : {}),
        },
        assessment: {
            matched: hasAssessment,
            title: hasValue(thread.scenarioLabel) ? String(thread.scenarioLabel)
                : hasAssessment ? 'Diagnostic assessment' : 'No diagnostic rule matched',
            reason: assessmentReason,
            confidence: hasValue(thread.scenarioConfidence) ? String(thread.scenarioConfidence) : '—',
            evidenceLabel,
            evidenceBasis,
            evidenceQualification,
            score: Number.isFinite(thread.scenarioPatternScore)
                ? `${String(thread.scenarioPatternScore)}/100`
                : '—',
        },
        coreFacts,
        rawText,
        stackText,
        hasOriginal: hasValue(rawText),
        originalLabel: thread.format === 'hotspot-file-json' ? 'Original JSON' : 'Original',
        hasCarrier: Boolean(thread.isCarrierThread),
        hasDeadlock: Boolean(thread.isDeadlocked),
        hasHistory: Boolean(thread.crossSnapshotDiagnostics),
        hasClassInitialization: classInitialization.length > 0,
        classInitialization,
        history: {
            summary: thread.crossSnapshotDiagnostics || null,
            scenarioKey: hasValue(thread.scenarioKey) ? String(thread.scenarioKey) : '',
        },
        hasLocks: locksHeldCount > 0
            || waitingLocks.length > 0
            || Boolean(thread.lockAssessment && thread.lockAssessment.tier !== 'none')
            || Array.isArray(thread.contentionChains) && thread.contentionChains.length > 0,
        lockEvidence: {
            heldLocks,
            waitingLocks,
            assessment: thread.lockAssessment || null,
        },
    };
}

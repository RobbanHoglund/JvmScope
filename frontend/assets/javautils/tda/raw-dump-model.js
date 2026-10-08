import { parseModernLockLine } from './dump-to-file.js';

const CONTENDED_WAIT_KINDS = new Set(['monitor-enter', 'synchronizer-park']);

export const RAW_DUMP_FILTERS = Object.freeze({
    everything: 'Everything',
    problems: 'Problems only',
    contended: 'Contended only',
    deadlocks: 'Confirmed deadlocks',
    blocked: 'BLOCKED threads',
    holders: 'Lock holders',
    holdingAndWaiting: 'Holding and waiting',
    monitorEnter: 'Waiting to enter synchronized',
    monitorHolders: 'Holding synchronized monitors',
    synchronizerWait: 'Waiting for synchronizer',
    synchronizerHolders: 'Holding synchronizers',
    notificationWait: 'Object.wait / notification waits',
    classInitialization: 'Class initialization dependencies',
    unresolved: 'Owner not observed',
    selectedLock: 'Selected lock neighborhood',
});

const EVIDENCE_LABELS = Object.freeze({
    monitor: 'HOLDING MONITOR',
    'monitor-enter': 'WAITING TO ENTER MONITOR',
    'monitor-wait': 'OBJECT.WAIT / NOTIFICATION',
    'synchronizer-park': 'WAITING FOR SYNCHRONIZER',
    'ownable-synchronizer': 'HOLDING SYNCHRONIZER',
    'class-initialization-wait': 'WAITING FOR CLASS INITIALIZATION',
});

const LINE_PATTERNS = Object.freeze([
    { kind: 'monitor-enter', pattern: /^\s*-\s+(?:waiting to lock|waiting to re-lock in wait\(\)) <(?<lockId>0x[0-9a-f]+)>\s+\((?<lockType>[^)]+)\)/i },
    { kind: 'monitor-wait', pattern: /^\s*-\s+waiting on <(?<lockId>0x[0-9a-f]+)>\s+\((?<lockType>[^)]+)\)/i },
    { kind: 'synchronizer-park', pattern: /^\s*-\s+parking to wait for\s+<(?<lockId>0x[0-9a-f]+)>\s+\((?<lockType>[^)]+)\)/i },
    { kind: 'monitor', pattern: /^\s*-\s+locked <(?<lockId>0x[0-9a-f]+)>\s+\((?<lockType>[^)]+)\)/i },
]);
const OWNABLE_HEADER = /^\s*Locked ownable synchronizers:\s*$/;
const OWNABLE_LINE = /^\s*-\s+<(?<lockId>0x[0-9a-f]+)>\s+\((?<lockType>[^)]+)\)/i;

function normalizedLockId(lockId) {
    return String(lockId || '').trim().toLocaleLowerCase();
}

function uniqueBySourceKey(threads) {
    return [...new Map(threads.filter(Boolean).map((thread) => [thread.sourceKey, thread])).values()];
}

function occurrencesForThread(thread, sourceLines) {
    if (thread.format === 'hotspot-file-json') {
        return [...thread.heldLocks, ...thread.waitingLocks].map(lock => {
            const relative = thread.rawBlock.findIndex(line => line.includes(JSON.stringify(lock.lockId).slice(1, -1)));
            const lineNumber = thread.rawStartLine + Math.max(0, relative);
            return { ...lock, lineNumber, sourceKey: thread.sourceKey,
                normalizedLockId: normalizedLockId(lock.lockId), label: EVIDENCE_LABELS[lock.kind],
                text: sourceLines[lineNumber - 1] || '' };
        });
    }
    const occurrences = [];
    let inOwnableSynchronizers = false;
    for (let lineNumber = thread.rawStartLine; lineNumber <= thread.rawEndLine; lineNumber += 1) {
        const text = sourceLines[lineNumber - 1] ?? '';
        if (OWNABLE_HEADER.test(text)) {
            inOwnableSynchronizers = true;
            continue;
        }
        let match = null;
        let kind = null;
        if (inOwnableSynchronizers) {
            match = text.match(OWNABLE_LINE);
            kind = match ? 'ownable-synchronizer' : null;
        } else {
            const definition = LINE_PATTERNS.find((candidate) => candidate.pattern.test(text));
            if (definition) {
                match = text.match(definition.pattern);
                kind = definition.kind;
            }
        }
        const modern = parseModernLockLine(text);
        if (modern) { match = { groups: modern }; kind = modern.kind; }
        if (!match?.groups || !kind) continue;
        if (kind === 'monitor' && Array.isArray(thread.heldLocks)
            && !thread.heldLocks.some(lock => normalizedLockId(lock.lockId) === normalizedLockId(match.groups.lockId))) continue;
        occurrences.push({
            lineNumber,
            sourceKey: thread.sourceKey,
            lockId: match.groups.lockId,
            normalizedLockId: normalizedLockId(match.groups.lockId),
            lockType: match.groups.lockType,
            kind,
            label: EVIDENCE_LABELS[kind],
            text,
        });
    }
    return occurrences;
}

function classInitializationOccurrencesForThread(thread, sourceLines) {
    return (Array.isArray(thread?.classInitializationWaits) ? thread.classInitializationWaits : [])
        .filter((wait) => Number.isInteger(wait?.rawLineNumber))
        .map((wait) => ({
            lineNumber: wait.rawLineNumber,
            sourceKey: thread.sourceKey,
            className: wait.className,
            kind: 'class-initialization-wait',
            label: EVIDENCE_LABELS['class-initialization-wait'],
            text: sourceLines[wait.rawLineNumber - 1] ?? wait.rawLine ?? '',
        }));
}

function resourceCategory(kinds) {
    const monitor = kinds.has('monitor') || kinds.has('monitor-enter') || kinds.has('monitor-wait');
    const synchronizer = kinds.has('ownable-synchronizer') || kinds.has('synchronizer-park');
    if (monitor && synchronizer) return 'mixed';
    return synchronizer ? 'synchronizer' : 'monitor';
}

function buildLockIndex(threads, occurrences) {
    const locks = new Map();
    const threadBySourceKey = new Map(threads.map((thread) => [thread.sourceKey, thread]));
    for (const occurrence of occurrences) {
        const key = occurrence.normalizedLockId;
        if (!locks.has(key)) {
            locks.set(key, {
                lockId: occurrence.lockId,
                normalizedLockId: key,
                lockType: occurrence.lockType || '',
                kinds: new Set(),
                occurrences: [],
                owners: [],
                contendedWaiters: [],
                notificationWaiters: [],
                unresolved: false,
            });
        }
        const lock = locks.get(key);
        lock.kinds.add(occurrence.kind);
        lock.occurrences.push(occurrence);
        if (!lock.lockType && occurrence.lockType) lock.lockType = occurrence.lockType;
        const thread = threadBySourceKey.get(occurrence.sourceKey);
        if (occurrence.kind === 'monitor' || occurrence.kind === 'ownable-synchronizer') lock.owners.push(thread);
        else if (CONTENDED_WAIT_KINDS.has(occurrence.kind)) lock.contendedWaiters.push(thread);
        else if (occurrence.kind === 'monitor-wait') lock.notificationWaiters.push(thread);
    }
    for (const lock of locks.values()) {
        lock.owners = uniqueBySourceKey(lock.owners);
        lock.contendedWaiters = uniqueBySourceKey(lock.contendedWaiters);
        lock.notificationWaiters = uniqueBySourceKey(lock.notificationWaiters);
        lock.unresolved = lock.contendedWaiters.length > 0 && lock.owners.length === 0;
        lock.resourceCategory = resourceCategory(lock.kinds);
        lock.observedKinds = [...lock.kinds];
        lock.totalOccurrences = lock.occurrences.length;
    }
    return locks;
}

function buildThreadBlock(thread, sourceLines, threadOccurrences, lockIndex) {
    const heldMonitors = threadOccurrences.filter((item) => item.kind === 'monitor');
    const heldSynchronizers = threadOccurrences.filter((item) => item.kind === 'ownable-synchronizer');
    const monitorEntryWaits = threadOccurrences.filter((item) => item.kind === 'monitor-enter');
    const synchronizerWaits = threadOccurrences.filter((item) => item.kind === 'synchronizer-park');
    const notificationWaits = threadOccurrences.filter((item) => item.kind === 'monitor-wait');
    const classInitializationWaits = threadOccurrences
        .filter((item) => item.kind === 'class-initialization-wait');
    const classInitializationRelations = Array.isArray(thread?.classInitializationChains)
        ? thread.classInitializationChains : [];
    const classInitializationInitializer = classInitializationRelations
        .some((entry) => entry?.role === 'initializer');
    const contendedWaits = [...monitorEntryWaits, ...synchronizerWaits];
    const heldResources = [...heldMonitors, ...heldSynchronizers];
    const unresolvedWaits = contendedWaits.filter((wait) => lockIndex.get(wait.normalizedLockId)?.unresolved);
    const blockedWaiterSourceKeys = new Set();
    for (const held of heldResources) {
        for (const waiter of lockIndex.get(held.normalizedLockId)?.contendedWaiters || []) {
            blockedWaiterSourceKeys.add(waiter.sourceKey);
        }
    }
    const holdingAndWaiting = heldResources.length > 0 && contendedWaits.length > 0;
    const problem = Boolean(thread.isDeadlocked)
        || thread.javaState === 'BLOCKED'
        || contendedWaits.length > 0
        || blockedWaiterSourceKeys.size > 0
        || holdingAndWaiting
        || classInitializationWaits.length > 0
        || classInitializationInitializer;
    return {
        sourceKey: thread.sourceKey,
        thread,
        startLine: thread.rawStartLine,
        endLine: thread.rawEndLine,
        lines: sourceLines.slice(thread.rawStartLine - 1, thread.rawEndLine),
        occurrences: threadOccurrences,
        heldMonitors,
        heldSynchronizers,
        monitorEntryWaits,
        synchronizerWaits,
        notificationWaits,
        classInitializationWaits,
        classInitializationRelations,
        classInitializationInitializer,
        classInitializationBlockedWaiterCount: Number(thread.classInitializationBlockedWaiterCount || 0),
        contendedWaits,
        heldResources,
        unresolvedWaits,
        blockedWaiterCount: blockedWaiterSourceKeys.size,
        blockedWaiterSourceKeys: [...blockedWaiterSourceKeys],
        holdingAndWaiting,
        problem,
        initiallyExpanded: false,
        confirmedDeadlock: Boolean(thread.isDeadlocked),
    };
}

function buildRawSections(sourceLines, blocks) {
    const sections = [];
    let cursor = 1;
    for (const block of [...blocks].sort((left, right) => left.startLine - right.startLine)) {
        if (cursor < block.startLine) {
            sections.push({
                id: `raw:${cursor}-${block.startLine - 1}`,
                startLine: cursor,
                endLine: block.startLine - 1,
                lines: sourceLines.slice(cursor - 1, block.startLine - 1),
            });
        }
        cursor = block.endLine + 1;
    }
    if (cursor <= sourceLines.length) {
        sections.push({
            id: `raw:${cursor}-${sourceLines.length}`,
            startLine: cursor,
            endLine: sourceLines.length,
            lines: sourceLines.slice(cursor - 1),
        });
    }
    return sections;
}

function blockPriority(block) {
    if (block.confirmedDeadlock) return 0;
    if (block.classInitializationInitializer) return 1;
    if (block.classInitializationWaits.length) return 2;
    if (block.thread.javaState === 'BLOCKED') return 3;
    if (block.contendedWaits.length) return 4;
    if (block.blockedWaiterCount) return 5;
    if (block.holdingAndWaiting) return 6;
    return 7;
}

export function sortRawDumpThreadBlocks(blocks) {
    return [...blocks].sort((left, right) => {
        const priority = blockPriority(left) - blockPriority(right);
        if (priority) return priority;
        const name = String(left.thread.threadName || '').localeCompare(String(right.thread.threadName || ''));
        return name || String(left.sourceKey).localeCompare(String(right.sourceKey));
    });
}

export function filterRawDumpThreadBlocks(model, filterId = 'everything', selectedLockId = '') {
    const selectedLock = model.lockIndex.get(normalizedLockId(selectedLockId));
    const relatedSourceKeys = new Set([
        ...(selectedLock?.owners || []),
        ...(selectedLock?.contendedWaiters || []),
        ...(selectedLock?.notificationWaiters || []),
    ].map((thread) => thread.sourceKey));
    const predicates = {
        everything: () => true,
        problems: (block) => block.problem,
        contended: (block) => block.contendedWaits.length > 0 || block.blockedWaiterCount > 0,
        deadlocks: (block) => block.confirmedDeadlock,
        blocked: (block) => block.thread.javaState === 'BLOCKED',
        holders: (block) => block.heldResources.length > 0,
        holdingAndWaiting: (block) => block.holdingAndWaiting,
        monitorEnter: (block) => block.monitorEntryWaits.length > 0,
        monitorHolders: (block) => block.heldMonitors.length > 0,
        synchronizerWait: (block) => block.synchronizerWaits.length > 0,
        synchronizerHolders: (block) => block.heldSynchronizers.length > 0,
        notificationWait: (block) => block.notificationWaits.length > 0,
        classInitialization: (block) => block.classInitializationWaits.length > 0
            || block.classInitializationInitializer,
        unresolved: (block) => block.unresolvedWaits.length > 0,
        selectedLock: (block) => relatedSourceKeys.has(block.sourceKey),
    };
    const predicate = predicates[filterId] || predicates.everything;
    return model.threadBlocks.filter(predicate);
}

export function buildRawDumpModel({ rawText = '', threads = [] } = {}) {
    const sourceText = String(rawText);
    const sourceLines = sourceText.split('\n');
    const validThreads = threads.filter((thread) => Number.isInteger(thread.rawStartLine)
        && Number.isInteger(thread.rawEndLine)
        && thread.rawStartLine >= 1
        && thread.rawEndLine >= thread.rawStartLine);
    const lockOccurrences = validThreads.flatMap((thread) => occurrencesForThread(thread, sourceLines));
    const classInitializationOccurrences = validThreads
        .flatMap((thread) => classInitializationOccurrencesForThread(thread, sourceLines));
    const occurrences = [...lockOccurrences, ...classInitializationOccurrences];
    const lockIndex = buildLockIndex(validThreads, lockOccurrences);
    const occurrencesBySourceKey = new Map();
    for (const occurrence of occurrences) {
        if (!occurrencesBySourceKey.has(occurrence.sourceKey)) occurrencesBySourceKey.set(occurrence.sourceKey, []);
        occurrencesBySourceKey.get(occurrence.sourceKey).push(occurrence);
    }
    const threadBlocks = validThreads.map((thread) => buildThreadBlock(
        thread, sourceLines, occurrencesBySourceKey.get(thread.sourceKey) || [], lockIndex,
    ));
    const blockBySourceKey = new Map(threadBlocks.map((block) => [block.sourceKey, block]));
    const counts = {
        all: threadBlocks.length,
        problems: threadBlocks.filter((block) => block.problem).length,
        deadlocks: threadBlocks.filter((block) => block.confirmedDeadlock).length,
        blocked: threadBlocks.filter((block) => block.thread.javaState === 'BLOCKED').length,
        waiting: threadBlocks.filter((block) => block.thread.javaState === 'WAITING').length,
        timedWaiting: threadBlocks.filter((block) => block.thread.javaState === 'TIMED_WAITING').length,
        contendedWaiters: threadBlocks.filter((block) => block.contendedWaits.length > 0).length,
        observedOwners: threadBlocks.filter((block) => block.blockedWaiterCount > 0).length,
        holdingAndWaiting: threadBlocks.filter((block) => block.holdingAndWaiting).length,
        unresolved: threadBlocks.filter((block) => block.unresolvedWaits.length > 0).length,
        classInitializationWaiters: threadBlocks
            .filter((block) => block.classInitializationWaits.length > 0).length,
        classInitializationInitializers: threadBlocks
            .filter((block) => block.classInitializationInitializer).length,
    };
    return {
        rawText: sourceText,
        sourceLines,
        exactSourceText: sourceLines.join('\n'),
        threads: validThreads,
        threadBlocks,
        sortedThreadBlocks: sortRawDumpThreadBlocks(threadBlocks),
        blockBySourceKey,
        rawSections: buildRawSections(sourceLines, threadBlocks),
        occurrences,
        classInitializationOccurrences,
        lockIndex,
        counts,
    };
}

export function evidenceLabelForKind(kind) {
    return EVIDENCE_LABELS[kind] || '';
}

// Search the source, including collapsed/unmounted evidence, in display order.
// Matching original strings keeps offsets correct when case folding changes length.
export function findRawDumpMatches(sourceLines, query, ranges = [{ startLine: 1, endLine: sourceLines.length }]) {
    query = String(query ?? '');
    if (!query || query.length > 512) return [];
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const matches = [];
    for (const range of ranges) {
        for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber++) {
            const line = sourceLines[lineNumber - 1] ?? '';
            expression.lastIndex = 0;
            let match;
            while ((match = expression.exec(line))) {
                matches.push({ lineNumber, start: match.index, end: match.index + match[0].length,
                    sourceKey: range.sourceKey ?? null });
            }
        }
    }
    return matches;
}

/**
 * Pure visibility, compaction, and role-highlighting helpers for the dependency graph.
 *
 * Keeping these decisions DOM-free makes the graph's progressive-disclosure behaviour
 * deterministic and independently testable.
 */

function text(value) {
    return value == null ? '' : String(value).trim();
}

function endpointId(endpoint) {
    return typeof endpoint === 'object' && endpoint ? endpoint.id : endpoint;
}

function numeric(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export const CONTENTION_DENSITY_PROFILES = Object.freeze({
    compact: Object.freeze({
        id: 'compact',
        label: 'Compact',
        maxLocks: 5,
        maxWaitersPerLock: 6,
    }),
    balanced: Object.freeze({
        id: 'balanced',
        label: 'Balanced',
        maxLocks: 10,
        maxWaitersPerLock: 12,
    }),
    complete: Object.freeze({
        id: 'complete',
        label: 'Complete',
        maxLocks: Number.POSITIVE_INFINITY,
        maxWaitersPerLock: Number.POSITIVE_INFINITY,
    }),
});

export function contentionDensityProfile(value) {
    return CONTENTION_DENSITY_PROFILES[value] || CONTENTION_DENSITY_PROFILES.compact;
}

export function resourceKindVisible(resourceKind, {
    showMonitors = true,
    showSynchronizers = true,
} = {}) {
    const kind = text(resourceKind).toLowerCase();
    if (kind === 'monitor') return Boolean(showMonitors);
    if (kind === 'class-initialization') return Boolean(showMonitors);
    if (kind === 'synchronizer') return Boolean(showSynchronizers);
    if (kind === 'mixed') return Boolean(showMonitors || showSynchronizers);
    return Boolean(showMonitors || showSynchronizers);
}

function lockPriority(lockNode) {
    const waiterCount = Array.isArray(lockNode?.waiterIds) ? lockNode.waiterIds.length : 0;
    const ownerCount = Array.isArray(lockNode?.ownerIds) ? lockNode.ownerIds.length : 0;
    let score = waiterCount * 10_000 + ownerCount * 1_500;
    if (ownerCount > 0) score += 4_000;
    if (lockNode?.resourceKind === 'monitor') score += 250;
    if (lockNode?.deadlocked) score += 10_000_000;
    return score;
}

function waiterPriority(threadNode) {
    let score = numeric(threadNode?.severityScore) * 10;
    if (threadNode?.deadlocked) score += 10_000_000;
    if (threadNode?.state === 'BLOCKED') score += 1_000_000;
    else if (threadNode?.state === 'WAITING') score += 350_000;
    else if (threadNode?.state === 'TIMED_WAITING') score += 250_000;
    if (threadNode?.role === 'waiter-owner') score += 50_000;
    score += Math.min(10_000, numeric(threadNode?.findingCount) * 250);
    return score;
}

/**
 * Selects a bounded, high-signal contention subgraph.
 *
 * The returned lock and waiter IDs are only projection limits. The full model remains
 * intact for search, the inspector, and focused-neighbourhood drill-down.
 */
export function buildContentionVisibility({
    lockNodes = [],
    threadNodes = [],
    density = 'compact',
    showMonitors = true,
    showSynchronizers = true,
    showUnresolved = true,
} = {}) {
    const profile = contentionDensityProfile(density);
    const normalizedLocks = Array.isArray(lockNodes) ? lockNodes : [];
    const threadById = new Map((Array.isArray(threadNodes) ? threadNodes : []).map((node) => [node.id, node]));
    const contendedLocks = normalizedLocks.filter((node) => (node?.waiterIds?.length || 0) > 0 || node?.deadlocked);
    const typeVisibleLocks = contendedLocks.filter((node) => resourceKindVisible(node.resourceKind, {
        showMonitors,
        showSynchronizers,
    }));
    const eligibleLocks = typeVisibleLocks.filter((node) => showUnresolved || (node.ownerIds?.length || 0) > 0 || node.deadlocked);

    const selectedLocks = [...eligibleLocks]
        .sort((left, right) => {
            const scoreDelta = lockPriority(right) - lockPriority(left);
            if (scoreDelta) return scoreDelta;
            return text(left?.lockId).localeCompare(text(right?.lockId));
        })
        .slice(0, profile.maxLocks);

    const selectedLockIds = new Set(selectedLocks.map((node) => node.id));
    const visibleWaiterIdsByLock = new Map();
    const hiddenWaiterCountByLock = new Map();
    let visibleWaiterObservationCount = 0;
    let hiddenWaiterObservationCount = 0;

    for (const lockNode of selectedLocks) {
        const waiterIds = [...new Set(Array.isArray(lockNode.waiterIds) ? lockNode.waiterIds : [])]
            .sort((leftId, rightId) => {
                const left = threadById.get(leftId);
                const right = threadById.get(rightId);
                const scoreDelta = waiterPriority(right) - waiterPriority(left);
                if (scoreDelta) return scoreDelta;
                return text(left?.label || leftId).localeCompare(text(right?.label || rightId));
            });
        const visibleWaiterIds = new Set(waiterIds.slice(0, profile.maxWaitersPerLock));
        const hiddenCount = Math.max(0, waiterIds.length - visibleWaiterIds.size);
        visibleWaiterIdsByLock.set(lockNode.id, visibleWaiterIds);
        hiddenWaiterCountByLock.set(lockNode.id, hiddenCount);
        visibleWaiterObservationCount += visibleWaiterIds.size;
        hiddenWaiterObservationCount += hiddenCount;
    }

    return {
        profile,
        contendedLockCount: contendedLocks.length,
        eligibleLockCount: eligibleLocks.length,
        selectedLocks,
        selectedLockIds,
        visibleWaiterIdsByLock,
        hiddenWaiterCountByLock,
        visibleWaiterObservationCount,
        hiddenWaiterObservationCount,
        hiddenLockCount: Math.max(0, eligibleLocks.length - selectedLocks.length),
        filteredByTypeCount: Math.max(0, contendedLocks.length - typeVisibleLocks.length),
        filteredUnresolvedCount: Math.max(0, typeVisibleLocks.length - eligibleLocks.length),
    };
}

function markKindRole(role, resourceKind, relation) {
    const kind = text(resourceKind).toLowerCase();
    const waiter = relation === 'waiter';
    const holder = relation === 'holder';
    if (kind === 'monitor' || kind === 'mixed') {
        if (waiter) role.monitorWaiter = true;
        if (holder) role.monitorHolder = true;
    }
    if (kind === 'synchronizer' || kind === 'mixed') {
        if (waiter) role.synchronizerWaiter = true;
        if (holder) role.synchronizerHolder = true;
    }
    if (waiter) role.anyWaiter = true;
    if (holder) role.anyHolder = true;
}

/**
 * Builds exact thread roles from parsed resource edges. Object.wait()/notification
 * edges are intentionally excluded from "waiting to enter synchronized".
 */
export function buildThreadLockRoleIndex({
    threadNodes = [],
    lockNodes = [],
    resourceEdges = [],
} = {}) {
    const roles = new Map();
    for (const threadNode of Array.isArray(threadNodes) ? threadNodes : []) {
        roles.set(threadNode.id, {
            monitorWaiter: false,
            monitorHolder: false,
            synchronizerWaiter: false,
            synchronizerHolder: false,
            anyWaiter: false,
            anyHolder: false,
            deadlocked: Boolean(threadNode.deadlocked),
        });
    }

    const lockById = new Map((Array.isArray(lockNodes) ? lockNodes : []).map((node) => [node.id, node]));
    for (const edge of Array.isArray(resourceEdges) ? resourceEdges : []) {
        const sourceId = endpointId(edge?.source);
        const targetId = endpointId(edge?.target);
        if (edge?.type === 'wait' || edge?.type === 'park') {
            const role = roles.get(sourceId);
            const lockNode = lockById.get(targetId);
            if (role && lockNode) markKindRole(role, lockNode.resourceKind, 'waiter');
        } else if (edge?.type === 'hold') {
            const role = roles.get(targetId);
            const lockNode = lockById.get(sourceId);
            if (role && lockNode) markKindRole(role, lockNode.resourceKind, 'holder');
        }
    }
    return roles;
}

export function threadMatchesHighlightMode(threadNode, role, mode = 'none') {
    if (!threadNode || threadNode.type !== 'thread' || !role || mode === 'none') return false;
    if (mode === 'monitor-waiter') return role.monitorWaiter;
    if (mode === 'monitor-holder') return role.monitorHolder;
    if (mode === 'monitor-both') return role.monitorWaiter && role.monitorHolder;
    if (mode === 'synchronizer-waiter') return role.synchronizerWaiter;
    if (mode === 'synchronizer-holder') return role.synchronizerHolder;
    if (mode === 'synchronizer-both') return role.synchronizerWaiter && role.synchronizerHolder;
    if (mode === 'any-waiter') return role.anyWaiter;
    if (mode === 'any-holder') return role.anyHolder;
    if (mode === 'any-both') return role.anyWaiter && role.anyHolder;
    if (mode === 'deadlock') return role.deadlocked || Boolean(threadNode.deadlocked);
    return false;
}

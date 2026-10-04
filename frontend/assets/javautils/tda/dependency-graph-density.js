/**
 * Density and progressive-disclosure helpers for the dependency graph.
 *
 * Keep this module DOM-free so the behaviour can be covered by Node tests.
 */

export const DEFAULT_DEPENDENCY_GRAPH_OPTIONS = Object.freeze({
    view: 'resource',
    scope: 'contention',
    density: 'compact',
    layout: 'flow',
    labels: 'smart',
    highlight: 'none',
    showMonitors: true,
    showSynchronizers: true,
    showUnresolved: true,
    showWaits: true,
    showHolds: true,
    showAwaits: false,
    showMounts: false,
    showEdgeLabels: false,
});

export function smartLabelBudget(nodeCount) {
    const count = Math.max(0, Number(nodeCount) || 0);
    if (count <= 12) return count;
    if (count <= 36) return 16;
    if (count <= 90) return 22;
    if (count <= 180) return 24;
    if (count <= 360) return 20;
    return 16;
}

export function graphNodePriority(node) {
    if (!node) return Number.NEGATIVE_INFINITY;

    const degree = Number(node._visibleDegree) || 0;
    const waits = Number(node._visibleWaits) || 0;
    const holds = Number(node._visibleHolds) || 0;
    const ownerFanOut = Array.isArray(node.dependencySourceIds) ? node.dependencySourceIds.length : 0;
    const dependencyFanOut = Array.isArray(node.dependencyTargetIds) ? node.dependencyTargetIds.length : 0;
    const waiterCount = Array.isArray(node.waiterIds) ? node.waiterIds.length : 0;
    const awaiterCount = Array.isArray(node.awaiterIds) ? node.awaiterIds.length : 0;

    let score = degree * 120 + waits * 180 + holds * 120;
    if (node.deadlocked) score += 1_000_000;
    if (node.observedCycleId) score += 500_000;

    if (node.type === 'lock') {
        score += waiterCount * 8_000;
        score += Math.min(awaiterCount, 8) * 180;
        if (waiterCount > 0) score += 120_000;
        if (node.ownerIds?.length) score += 3_000;
    } else if (node.type === 'thread') {
        if (node.state === 'BLOCKED') score += 150_000;
        if (ownerFanOut > 0) score += 110_000 + ownerFanOut * 9_000;
        if (dependencyFanOut > 0) score += 75_000 + dependencyFanOut * 6_000;
        if (node.role === 'waiter-owner') score += 30_000;
        if (node.carrier) score += 1_000;
    } else if (node.type === 'virtual-thread') {
        score += 500;
    }

    return score;
}

export function selectSmartLabelNodeIds(nodes) {
    const normalized = Array.isArray(nodes) ? nodes : [];
    const budget = smartLabelBudget(normalized.length);
    if (!budget) return new Set();

    return new Set(
        [...normalized]
            .filter((node) => (Number(node?._visibleDegree) || 0) > 0 || node?.deadlocked)
            .sort((left, right) => {
                const priorityDelta = graphNodePriority(right) - graphNodePriority(left);
                if (priorityDelta) return priorityDelta;
                return String(left?.id || '').localeCompare(String(right?.id || ''));
            })
            .slice(0, budget)
            .map((node) => node.id),
    );
}

export function projectionDensity({ nodeCount = 0, resourceCount = 0, edgeCount = 0 } = {}) {
    const nodes = Math.max(0, Number(nodeCount) || 0);
    const resources = Math.max(0, Number(resourceCount) || 0);
    const edges = Math.max(0, Number(edgeCount) || 0);
    const dense = nodes >= 220 || resources >= 120 || edges >= 320;
    const extreme = nodes >= 700 || resources >= 450 || edges >= 900;
    return { dense, extreme, nodeCount: nodes, resourceCount: resources, edgeCount: edges };
}

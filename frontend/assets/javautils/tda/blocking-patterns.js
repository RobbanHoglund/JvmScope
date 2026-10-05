import { buildThreadDependencyGraph } from './dependency-graph.js';
import { canCompareThreadCollections } from './snapshot-quality.js';

export const BLOCKING_LIMITS = 'Observed dependencies are snapshot facts, not continuous waits, application progress, CPU load or business impact. Lock addresses are used only within a snapshot. Matching thread identifiers do not establish the same process across hosts or restarts.';

function evidence(node, dump) {
    return { sourceKey: node.sourceKey, seriesKey: node.rawThread.seriesKey, name: node.label,
        snapshotIndex: dump.index, sourceId: dump.sourceId ?? null, sourceLabel: dump.sourceLabel ?? 'Input',
        sourceSnapshotIndex: dump.sourceSnapshotIndex ?? dump.index, timestamp: dump.timestampRaw ?? dump.timestamp,
        processId: dump.processId ?? null, startLine: node.rawStartLine, endLine: node.rawEndLine,
        state: node.state, topFrame: node.topFrame, identity: node.rawThread.seriesMatchStatus };
}

/** Every graph is built from ONE snapshot. Only endpoint series, never lock addresses, cross time. */
export function buildBlockingPatterns(dumps = []) {
    const patterns = new Map();
    for (const dump of dumps) {
        const graph = buildThreadDependencyGraph(dump.threads, dump.deadlocks);
        const nodes = new Map(graph.threadNodes.map(n => [n.id, n]));
        const incoming = new Map();
        for (const edge of graph.dependencyEdges) {
            if (!incoming.has(edge.target)) incoming.set(edge.target, []);
            incoming.get(edge.target).push(edge);
        }
        for (const blockerId of incoming.keys()) {
            const blocker = nodes.get(blockerId);
            const key = blocker.rawThread.seriesKey || blocker.sourceKey;
            const visited = new Set([blockerId]), queue = [blockerId], relations = new Map();
            for (let cursor = 0; cursor < queue.length; cursor++) {
                for (const edge of incoming.get(queue[cursor]) || []) {
                    relations.set(edge.id, edge);
                    if (!visited.has(edge.source)) { visited.add(edge.source); queue.push(edge.source); }
                }
            }
            visited.delete(blockerId);
            const definite = new Set([blockerId]), definiteQueue = [blockerId];
            for (let cursor = 0; cursor < definiteQueue.length; cursor++) {
                for (const edge of incoming.get(definiteQueue[cursor]) || []) {
                    if (edge.ambiguousOwner || definite.has(edge.source)) continue;
                    definite.add(edge.source); definiteQueue.push(edge.source);
                }
            }
            definite.delete(blockerId);
            const direct = new Set((incoming.get(blockerId) || []).filter(e => !e.ambiguousOwner && e.source !== blockerId).map(e => e.source));
            const current = {
                snapshotIndex: dump.index, complete: dump.parsingStatus === 'success', blocker: evidence(blocker, dump),
                directCount: direct.size, dependentCount: definite.size, indirectCount: [...definite].filter(id => !direct.has(id)).length,
                uncertainDependentCount: [...visited].filter(id => !definite.has(id)).length,
                dependents: [...visited].map(id => ({ ...evidence(nodes.get(id), dump), uncertain: !definite.has(id) })),
                sourceKeys: [blocker.sourceKey, ...[...visited].map(id => nodes.get(id).sourceKey)],
                relations: [...relations.values()].map(edge => ({
                    key: `${nodes.get(edge.source).rawThread.seriesKey || edge.source}→${nodes.get(edge.target).rawThread.seriesKey || edge.target}`,
                    waiter: evidence(nodes.get(edge.source), dump), owner: evidence(nodes.get(edge.target), dump),
                    locks: edge.locks, kinds: edge.waitKinds, ambiguous: edge.ambiguousOwner,
                    cycle: Boolean(edge.observedCycle), confirmedDeadlock: Boolean(edge.confirmedDeadlock), change: 'uncertain',
                })),
                noLongerObserved: [], comparison: 'unavailable',
            };
            if (!patterns.has(key)) patterns.set(key, { key, title: `Dependencies on ${blocker.label}`, observations: [] });
            patterns.get(key).observations.push(current);
        }
    }
    const byIndex = new Map(dumps.map(d => [d.index, d]));
    for (const pattern of patterns.values()) {
        let recurrence = 0;
        for (let index = 1; index < pattern.observations.length; index++) {
            const prev = pattern.observations[index - 1], current = pattern.observations[index];
            const prevDump = byIndex.get(prev.snapshotIndex), currentDump = byIndex.get(current.snapshotIndex);
            const thread = currentDump.threads.find(t => t.sourceKey === current.blocker.sourceKey);
            const comparable = current.snapshotIndex === prev.snapshotIndex + 1
                && canCompareThreadCollections(prevDump, currentDump) && thread?.seriesMatchConfidence === 'exact'
                && thread.previousSourceKey === prev.blocker.sourceKey;
            if (!comparable) continue;
            recurrence++;
            current.comparison = 'adjacent comparable snapshots';
            const previousRelations = new Map(prev.relations.map(r => [r.key, r]));
            const currentRelations = new Map(current.relations.map(r => [r.key, r]));
            const previousThreads = new Map(prevDump.threads.map(t => [t.seriesKey, t]));
            const exact = e => [e.waiter, e.owner].every(endpoint => {
                const t = currentDump.threads.find(t => t.sourceKey === endpoint.sourceKey);
                return t?.seriesMatchConfidence === 'exact' && t.previousSourceKey === previousThreads.get(t.seriesKey)?.sourceKey;
            });
            for (const relation of current.relations) {
                relation.change = relation.ambiguous || !exact(relation) ? 'uncertain'
                    : previousRelations.has(relation.key) ? 'observed again' : 'newly observed';
            }
            const uncertainCollection = currentDump.threads.some(t => t.seriesMatchStatus === 'ambiguous');
            current.noLongerObserved = prev.relations.filter(r => !r.ambiguous && !currentRelations.has(r.key))
                .map(r => ({ ...r, change: uncertainCollection ? 'uncertain' : 'not observed in this snapshot' }));
        }
        pattern.comparableRecurrences = recurrence;
        pattern.peakDependents = Math.max(...pattern.observations.map(o => o.dependentCount));
        pattern.priorityReason = `Ranked by peak unique observed dependents (${pattern.peakDependents}), then adjacent comparable recurrences (${recurrence}). Counts are lower bounds in partial snapshots; uncertain owners are counted separately.`;
        pattern.limitations = BLOCKING_LIMITS;
    }
    return [...patterns.values()].sort((a, b) => b.peakDependents - a.peakDependents || b.comparableRecurrences - a.comparableRecurrences || a.key.localeCompare(b.key));
}

export function patternSnapshot(pattern, dumps, snapshotIndex) {
    const observation = pattern?.observations.find(o => o.snapshotIndex === snapshotIndex);
    if (observation) return { status: 'observed', observation };
    const current = dumps.find(d => d.index === snapshotIndex);
    const previous = pattern?.observations.filter(o => o.snapshotIndex < snapshotIndex).at(-1);
    const previousDump = dumps.find(d => d.index === previous?.snapshotIndex);
    const comparable = previous && canCompareThreadCollections(previousDump, current)
        && !current.threads.some(t => t.seriesMatchStatus === 'ambiguous');
    return { status: comparable ? 'not observed' : 'uncertain', observation: null };
}

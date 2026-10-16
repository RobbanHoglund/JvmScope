import { escapeAttr, escapeHtml } from './ui-safety.js';

const threadNode = (thread, name, role = 'Thread') => ({
    kind: 'thread', label: name || thread?.threadName || 'Unnamed thread', role,
    sourceKey: thread?.sourceKey || '', detail: thread?.javaState || 'Thread block not mapped',
});
const resourceNode = (id, type, role = 'Lock') => ({
    kind: 'resource', label: type?.replace(/^(?:a|an)\s+/, '') || 'Lock type not reported',
    detail: id || 'Lock identity not reported', role,
});

/** A closed loop requires resolved identities and the reported owner links.
 * Input order and thread names alone never establish a return edge. */
export function deadlockDiagrams(cycle, threads = []) {
    const items = cycle.threads || [];
    const byKey = new Map(threads.filter(t => t.sourceKey).map(t => [t.sourceKey, t]));
    const byWaiter = new Map(items.map((item, index) => [item.sourceKey, index]));
    const ordered = [];
    let current = 0;
    const seen = new Set();
    const fullyMapped = items.length > 0 && byWaiter.size === items.length
        && items.every(item => byKey.has(item.sourceKey) && byKey.has(item.heldBySourceKey)
            && byWaiter.has(item.heldBySourceKey));
    if (fullyMapped) {
        while (!seen.has(current)) {
            seen.add(current);
            ordered.push(items[current]);
            current = byWaiter.get(items[current].heldBySourceKey);
        }
    }
    if (fullyMapped && current === 0 && ordered.length === items.length) {
        const nodes = ordered.flatMap(item => [
            threadNode(byKey.get(item.sourceKey), item.threadName),
            resourceNode(item.waitingLockId, item.waitingLockType),
        ]);
        return [{ closed: true, tone: 'deadlock', label: `JVM-reported deadlock cycle ${cycle.id}`,
            nodes, edges: nodes.map((_, index) => ({ from: index, to: (index + 1) % nodes.length,
                kind: index % 2 ? 'owner' : 'wait', label: index % 2 ? 'held by' : 'waits for' })) }];
    }
    return items.map(item => ({ closed: false, tone: 'deadlock', label: `Reported dependency for ${item.threadName}`,
        nodes: [threadNode(byKey.get(item.sourceKey), item.threadName),
            resourceNode(item.waitingLockId, item.waitingLockType),
            threadNode(byKey.get(item.heldBySourceKey), item.heldBy || 'Owner not reported', 'Reported owner')],
        edges: [{ from: 0, to: 1, kind: 'wait', label: 'waits for' },
            ...(item.heldBy ? [{ from: 1, to: 2, kind: 'owner', label: 'held by' }] : [])],
    }));
}

function groupNode(threads, role, emptyLabel) {
    return { kind: 'group', role, threads: threads || [], label: emptyLabel,
        detail: `${threads?.length || 0} thread${threads?.length === 1 ? '' : 's'}` };
}

export function contentionDiagram(chain, confirmed = false) {
    const owners = chain.owners || [];
    return { closed: false, tone: confirmed ? 'deadlock' : 'contention', label: `Lock dependency ${chain.lockId}`,
        nodes: [groupNode(chain.waiters, 'Waiting threads', 'No waiters observed'),
            resourceNode(chain.lockId, chain.lockType),
            groupNode(owners, 'Observed owners', 'Owner not observed')],
        edges: [{ from: 0, to: 1, kind: 'wait', label: 'waits for' },
            ...(owners.length ? [{ from: 1, to: 2, kind: 'owner', label: 'held by' }] : [])],
    };
}

export function classInitializationDiagram(chain) {
    const initializer = chain.initializer;
    return { closed: false, tone: 'initialization', label: `Class initialization dependency ${chain.className}`,
        nodes: [groupNode(chain.waiters, 'Waiting threads', 'No waiters observed'),
            { kind: 'resource', role: 'Class initialization', label: chain.className, detail: 'Completion awaited' },
            groupNode(initializer ? [initializer] : chain.initializers,
                initializer ? 'Initializer via <clinit>' : 'Initializer unresolved',
                'Initializer not observed')],
        edges: [{ from: 0, to: 1, kind: 'wait', label: 'awaits init' },
            ...(initializer ? [{ from: 1, to: 2, kind: 'owner', label: 'initialized by' }] : [])],
    };
}

function threadButton(thread) {
    const name = thread.threadName || 'Unnamed thread';
    return `<button type="button" class="relationship-thread-btn" data-source-key="${escapeAttr(thread.sourceKey || '')}"
        ${thread.sourceKey ? '' : 'disabled'} aria-label="Details for ${escapeAttr(name)}">${escapeHtml(name)}</button>`;
}

function nodeContent(node) {
    const heading = `<span class="relationship-node-role">${escapeHtml(node.role)}</span>`;
    if (node.kind === 'group') {
        const threads = node.threads || [];
        return `${heading}<span class="relationship-node-count">${escapeHtml(node.detail)}</span>
            <div class="relationship-thread-list">${threads.slice(0, 3).map(threadButton).join('') || `<span>${escapeHtml(node.label)}</span>`}</div>
            ${threads.length > 3 ? `<details class="relationship-more"><summary>Show all ${threads.length} threads</summary>
                <div class="relationship-thread-list">${threads.slice(3).map(threadButton).join('')}</div></details>` : ''}`;
    }
    return `${heading}<strong class="relationship-node-name">${escapeHtml(node.label)}</strong>
        <span class="relationship-node-detail">${escapeHtml(node.detail)}</span>
        ${node.sourceKey ? '<span class="relationship-node-action">View thread details</span>' : ''}`;
}

export function renderRelationshipDiagram(model) {
    const accessibleName = node => node.kind === 'group' && node.threads?.length
        ? node.threads.map(t => t.threadName || 'Unnamed thread').join(', ') : node.label;
    return `<figure class="relationship-figure is-${escapeAttr(model.tone)}" aria-label="${escapeAttr(model.label)}">
        <ul class="sr-only">${model.edges.map(edge => `<li>${escapeHtml(accessibleName(model.nodes[edge.from]))}
            ${escapeHtml(edge.label)} ${escapeHtml(accessibleName(model.nodes[edge.to]))}.</li>`).join('')}</ul>
        <div class="relationship-canvas" data-relationship-diagram data-closed="${Boolean(model.closed)}" data-edges="${escapeAttr(JSON.stringify(model.edges))}">
            <svg class="relationship-connectors" aria-hidden="true"></svg>
            ${model.nodes.map((node, index) => {
                const button = node.kind === 'thread' && node.sourceKey;
                const attrs = button ? `type="button" data-source-key="${escapeAttr(node.sourceKey)}" aria-label="Details for ${escapeAttr(node.label)}"` : '';
                return `<${button ? 'button' : 'div'} class="relationship-node is-${escapeAttr(node.kind)} ${button ? 'relationship-thread-btn' : ''}"
                    data-rel-node="${index}" ${attrs}>${nodeContent(node)}</${button ? 'button' : 'div'}>`;
            }).join('')}
        </div>
        <figcaption class="relationship-legend"><span class="relationship-legend-wait">Solid arrow: waits for</span>
            <span class="relationship-legend-owner">Dashed arrow: ${model.tone === 'initialization' ? 'initialized by' : 'held by'}</span>
            ${model.closed ? '<strong>JVM-confirmed circular wait</strong>' : ''}</figcaption>
    </figure>`;
}

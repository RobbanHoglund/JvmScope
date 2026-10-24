// Text lives in ordinary HTML cards: it never shrinks with an SVG viewBox.
// SVG contains only measured connectors between explicitly resolved participants.
const ns = 'http://www.w3.org/2000/svg';
function svg(tag, attributes = {}) {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
}
function textNode(tag, className, text) {
    const node = document.createElement(tag); node.className = className; node.textContent = text || ''; return node;
}

export function createDeadlockGraph({ participants, selectedId, label, t, onSelect }) {
    const shown = participants.slice(0, 8), graph = document.createElement('div');
    graph.className = 'graph'; graph.setAttribute('role', 'group'); graph.setAttribute('aria-label', label);
    const paths = svg('svg', { 'aria-hidden': 'true', class: 'graph-paths' });
    const defs = svg('defs'), marker = svg('marker', { id: 'deadlock-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto' });
    marker.append(svg('path', { d: 'M0 0 10 5 0 10z', fill: 'var(--critical)' })); defs.append(marker); paths.append(defs);
    const connections = svg('g'); paths.append(connections); graph.append(paths);
    const cards = document.createElement('div'); cards.className = 'graph-cards'; graph.append(cards);
    const nodes = new Map();
    for (const p of shown) {
        const card = document.createElement('button'); card.type = 'button'; card.className = `node${selectedId === p.id ? ' selected' : ''}`;
        card.dataset.participant = p.id; card.setAttribute('aria-label', `${p.name}. ${t('waiting')} ${p.waitingLockType || p.waitingLockId || '—'}. ${t('source')}`);
        card.setAttribute('aria-pressed', selectedId === p.id ? 'true' : 'false');
        card.append(textNode('strong', 'node-name', p.name), textNode('span', 'node-state', t(p.mappingStatus === 'resolved' ? 'mappedParticipant' : 'unmappedParticipant')));
        const lock = textNode('span', 'node-lock', `${t('waiting')}: ${p.waitingLockType || '—'}`);
        lock.append(textNode('code', '', p.waitingLockId)); card.append(lock);
        card.title = [p.name, p.topFrame].filter(Boolean).join('\n');
        card.addEventListener('click', () => onSelect(p)); cards.append(card); nodes.set(p.id, card);
    }
    function draw() {
        const bounds = graph.getBoundingClientRect(); if (!bounds.width) return;
        const layout = shown.length === 2 && bounds.width >= 560 ? 'pair'
            : shown.length === 3 && bounds.width >= 560 ? 'triangle' : 'stack';
        if (graph.dataset.layout !== layout) graph.dataset.layout = layout;
        const box = graph.getBoundingClientRect();
        paths.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
        const positions = new Map([...nodes].map(([id, node]) => {
            const r = node.getBoundingClientRect();
            return [id, { x: r.x - box.x, y: r.y - box.y, w: r.width, h: r.height, cx: r.x - box.x + r.width / 2, cy: r.y - box.y + r.height / 2 }];
        }));
        connections.replaceChildren();
        for (const [index, p] of shown.entries()) {
            const a = positions.get(p.id), b = positions.get(p.ownerId);
            if (!b || a === b || p.mappingStatus !== 'resolved' || p.ownerMappingStatus !== 'resolved') continue;
            let d;
            if (layout === 'pair') {
                const top = index === 0, y1 = top ? a.y - 3 : a.y + a.h + 3, y2 = top ? b.y - 5 : b.y + b.h + 5;
                const bend = top ? 4 : box.height - 4;
                d = `M${a.cx} ${y1} C${a.cx} ${bend},${b.cx} ${bend},${b.cx} ${y2}`;
            } else if (layout === 'triangle') {
                const dx = b.cx - a.cx, dy = b.cy - a.cy, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
                const radius = (r, gap) => Math.min((r.w / 2 + gap) / Math.max(Math.abs(ux), .001), (r.h / 2 + gap) / Math.max(Math.abs(uy), .001));
                const start = radius(a, 3), end = radius(b, 5);
                d = `M${a.cx + ux * start} ${a.cy + uy * start} L${b.cx - ux * end} ${b.cy - uy * end}`;
            } else {
                const forwards = b.cy > a.cy, x1 = forwards ? a.x + a.w + 3 : a.x - 3, x2 = forwards ? b.x + b.w + 5 : b.x - 5;
                const lane = forwards ? box.width - 8 - index * 3 : 8 + index * 3;
                d = `M${x1} ${a.cy} C${lane} ${a.cy},${lane} ${b.cy},${x2} ${b.cy}`;
            }
            const edge = svg('path', { d, class: 'edge', 'marker-end': 'url(#deadlock-arrow)' });
            edge.dataset.from = p.id; edge.dataset.to = p.ownerId; connections.append(edge);
        }
    }
    const observer = new ResizeObserver(draw); observer.observe(graph);
    for (const node of nodes.values()) observer.observe(node);
    return { element: graph, dispose: () => observer.disconnect() };
}

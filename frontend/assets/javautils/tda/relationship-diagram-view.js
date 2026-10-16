import { escapeAttr, escapeHtml } from './ui-safety.js';

let nextId = 0;

/** Native HTML cards keep text readable and keyboard accessible. SVG paths are
 * laid out against their measured heights, including expanded thread groups. */
export function createRelationshipDiagramsView() {
    let observer;
    let frame;
    let records = [];
    function draw({ canvas, nodes, edges, closed, id }) {
        const width = canvas.clientWidth;
        if (!width || !canvas.getClientRects().length) return;
        const gutter = closed ? 48 : 12;
        const gap = 100;
        const maxColumns = closed ? Math.min(3, nodes.length / 2) : 3;
        const fits = count => width >= count * 172 + (count - 1) * gap + gutter + 12;
        const columns = fits(maxColumns) ? maxColumns : closed && maxColumns >= 2 && fits(2) ? 2 : 1;
        const nodeWidth = Math.min(260, (width - gutter - 12 - (columns - 1) * gap) / columns);
        const left = gutter + Math.max(0, (width - gutter - 12 - columns * nodeWidth - (columns - 1) * gap) / 2);
        for (const node of nodes) node.style.width = `${nodeWidth}px`;
        const heights = nodes.map(node => node.offsetHeight);
        const rows = Math.ceil(nodes.length / columns);
        let top = 18;
        const positions = [];
        for (let row = 0; row < rows; row++) {
            const count = Math.min(columns, nodes.length - row * columns);
            const rowHeight = Math.max(...heights.slice(row * columns, row * columns + count));
            for (let col = 0; col < count; col++) {
                const index = row * columns + col;
                const position = { x: left + (closed && row % 2 ? columns - col - 1 : col) * (nodeWidth + gap),
                    y: top + (rowHeight - heights[index]) / 2, w: nodeWidth, h: heights[index] };
                positions.push(position);
                Object.assign(nodes[index].style, { left: `${position.x}px`, top: `${position.y}px` });
            }
            top += rowHeight + (row < rows - 1 ? 74 : 0);
        }
        const height = top + (closed ? 54 : 18);
        canvas.style.height = `${height}px`;
        const svg = canvas.querySelector('svg');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.innerHTML = `<defs>${['wait', 'owner'].map(kind => `<marker id="${id}-${kind}" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path class="relationship-arrow-${kind}" d="M0,0 L8,4 L0,8 Z"/></marker>`).join('')}</defs>`
            + edges.map((edge, index) => {
                const a = positions[edge.from], b = positions[edge.to];
                const closing = closed && index === edges.length - 1;
                let path, lx, ly, rotate = '';
                if (closing) {
                    const rail = left - 28;
                    path = `M${a.x + a.w / 2},${a.y + a.h} V${height - 20} H${rail} V${b.y + b.h / 2} H${b.x - 3}`;
                    lx = rail - 7; ly = (b.y + b.h / 2 + height - 20) / 2;
                    rotate = ` transform="rotate(-90 ${lx} ${ly})"`;
                } else if (Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < 1) {
                    const right = b.x > a.x;
                    path = `M${right ? a.x + a.w : a.x},${a.y + a.h / 2} H${right ? b.x - 3 : b.x + b.w + 3}`;
                    lx = right ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2;
                    ly = a.y + a.h / 2 - 13;
                } else {
                    path = `M${a.x + a.w / 2},${a.y + a.h} V${b.y - 3}`;
                    lx = a.x + a.w / 2 + 56; ly = (a.y + a.h + b.y) / 2 + 4;
                }
                return `<g class="relationship-edge is-${escapeAttr(edge.kind)} ${closing ? 'is-closing' : ''}" data-from="${edge.from}" data-to="${edge.to}">
                    <path d="${path}" marker-end="url(#${id}-${escapeAttr(edge.kind)})"/>
                    <text x="${lx}" y="${ly}"${rotate}>${escapeHtml(edge.label)}</text></g>`;
            }).join('');
    }
    function schedule() {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => records.forEach(draw));
    }
    return {
        refresh(roots) {
            observer?.disconnect();
            cancelAnimationFrame(frame);
            records = roots.filter(Boolean).flatMap(root => [...root.querySelectorAll('[data-relationship-diagram]')])
                .map(canvas => ({ canvas, nodes: [...canvas.querySelectorAll('[data-rel-node]')],
                    edges: JSON.parse(canvas.dataset.edges), closed: canvas.dataset.closed === 'true', id: `rel-${++nextId}` }));
            observer = new ResizeObserver(schedule);
            for (const { canvas, nodes } of records) {
                observer.observe(canvas);
                nodes.forEach(node => observer.observe(node));
            }
            schedule();
        },
    };
}

// Keep large raw captures out of the DOM until their lines approach the viewport.
// Chunk heights are measured before eviction so wrapping retains scroll position.
export const RAW_LINE_WINDOW_THRESHOLD = 1000;
const CHUNK_LINES = 100;

export function createRawDumpLineRenderer({ popup, root, sourceLines, appendLine, removeMatches, ready = true }) {
    const chunks = new Map();
    let destroyed = false;
    const observer = sourceLines.length > RAW_LINE_WINDOW_THRESHOLD && popup.IntersectionObserver
        ? new popup.IntersectionObserver(entries => {
            if (destroyed) return;
            for (const entry of entries) {
                const chunk = chunks.get(entry.target);
                if (!chunk) continue;
                if (entry.isIntersecting) mount(chunk);
                else if (chunk.mounted) {
                    const selection = popup.getSelection();
                    if (selection?.rangeCount && !selection.isCollapsed
                        && selection.getRangeAt(0).intersectsNode(chunk.node)) continue;
                    chunk.node.style.minHeight = `${chunk.node.getBoundingClientRect().height}px`;
                    removeMatches(chunk.node);
                    chunk.node.replaceChildren();
                    chunk.mounted = false;
                }
            }
        }, { root, rootMargin: '600px 0px' }) : null;

    function mount(chunk) {
        if (chunk.mounted || destroyed) return;
        chunk.node.style.minHeight = '';
        const fragment = popup.document.createDocumentFragment();
        for (let line = chunk.startLine; line <= chunk.endLine; line++) {
            appendLine(fragment, sourceLines[line - 1], line, chunk.occurrences?.get(line), chunk.decorate);
        }
        chunk.node.appendChild(fragment);
        chunk.mounted = true;
    }

    function append(container, { startLine, endLine, occurrences, decorate = true }) {
        if (!observer) {
            for (let line = startLine; line <= endLine; line++) {
                appendLine(container, sourceLines[line - 1], line, occurrences?.get(line), decorate);
            }
            return;
        }
        for (let start = startLine; start <= endLine; start += CHUNK_LINES) {
            const node = popup.document.createElement('div');
            node.className = 'raw-workspace-line-chunk';
            const end = Math.min(endLine, start + CHUNK_LINES - 1);
            node.style.minHeight = `${(end - start + 1) * 20}px`;
            const chunk = { node, startLine: start, endLine: end, occurrences, decorate, mounted: false };
            chunks.set(node, chunk);
            container.appendChild(node);
            if (ready) observer.observe(node);
        }
    }

    function remove(container) {
        for (const [node] of chunks) {
            if (!container.contains(node)) continue;
            observer.unobserve(node);
            chunks.delete(node);
        }
        removeMatches(container);
        container.replaceChildren();
    }

    return {
        append, remove,
        activate() {
            if (ready || destroyed) return;
            ready = true;
            for (const node of chunks.keys()) observer?.observe(node);
        },
        reveal(lineNumber) {
            for (const chunk of chunks.values()) {
                if (lineNumber >= chunk.startLine && lineNumber <= chunk.endLine) { mount(chunk); break; }
            }
            return root.querySelector(`.raw-workspace-line[data-line-number="${lineNumber}"]`);
        },
        resetHeights() {
            for (const chunk of chunks.values()) {
                if (!chunk.mounted) chunk.node.style.minHeight = `${(chunk.endLine - chunk.startLine + 1) * 20}px`;
            }
        },
        destroy() { destroyed = true; observer?.disconnect(); chunks.clear(); },
    };
}

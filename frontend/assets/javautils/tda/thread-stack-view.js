import { classifyStackTraceLine } from './thread-modal.js';
import { escapeHtml } from './ui-safety.js';

const MAX_MATCHES = 1000;
const bindings = new WeakMap();

// Package hints are navigation aids, never diagnostic or severity labels.
export function stackFrameGroup(line) {
    if (classifyStackTraceLine(line) !== 'frame') return null;
    const frame = String(line).trim().slice(3);
    const owner = frame.split('(')[0].replace(/\/0x[0-9a-f]+(?=\.)/gi, '').split('/').at(-1);
    if (/^(?:java\.|javax\.(?:net|crypto|security)\.|jdk\.|sun\.|com\.sun\.)/.test(owner)) return 'jvm';
    if (/^(?:org\.(?:springframework|apache|hibernate|postgresql|eclipse)\.|com\.(?:zaxxer|fasterxml|google)\.|io\.(?:netty|micrometer)\.|jakarta\.|javax\.|kotlin\.|groovy\.)/.test(owner)) return 'library';
    return 'other';
}

export function renderThreadStackMarkup(text, query = '', { decorate = true } = {}) {
    const expression = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
    let matchCount = 0;
    let capped = false;
    const lines = String(text ?? '').split('\n');
    const html = lines.map(line => {
        const kind = !decorate ? 'detail' : /^\s*-\s+<[^>]+>/.test(line) ? 'lock' : classifyStackTraceLine(line);
        const group = decorate ? stackFrameGroup(line) : null;
        let content = '';
        let cursor = 0;
        if (expression) {
            expression.lastIndex = 0;
            let match;
            while ((match = expression.exec(line))) {
                if (matchCount >= MAX_MATCHES) { capped = true; break; }
                content += escapeHtml(line.slice(cursor, match.index));
                content += `<mark class="thread-stack-match" data-match-index="${matchCount}">${escapeHtml(match[0])}</mark>`;
                cursor = match.index + match[0].length;
                matchCount += 1;
            }
        }
        content += escapeHtml(line.slice(cursor));
        const title = group ? { jvm: 'JVM frame', library: 'Library frame (package hint)', other: 'Other frame (often application code)' }[group] : '';
        return `<span class="thread-stack-line is-${kind}${group ? ` is-${group}` : ''}"${title ? ` title="${title}"` : ''}>${content}</span>`;
    }).join('\n');
    return { html, matchCount, capped, lineCount: lines.length };
}

export function bindThreadStackControls(root, model) {
    // The body survives reopening, but its controls are replaced. Release the
    // previous Ctrl+F listener rather than retaining detached search fields.
    bindings.get(root)?.abort();
    const controller = new AbortController();
    bindings.set(root, controller);
    const code = root.querySelector('.thread-details-code');
    const input = root.querySelector('#threadStackSearch');
    const status = root.querySelector('#threadStackSearchStatus');
    const previous = root.querySelector('#threadStackPrevious');
    const next = root.querySelector('#threadStackNext');
    const colors = root.querySelector('#threadStackColors');
    const stackView = root.querySelector('#threadStackView');
    const originalView = root.querySelector('#threadOriginalView');
    const legend = root.querySelector('.thread-stack-legend');
    let view = 'stack';
    const positions = { stack: { top: 0, left: 0 }, original: { top: 0, left: 0 } };
    let matches = [];
    let current = -1;
    let presentation = { lineCount: 0, capped: false };

    function updateStatus() {
        previous.disabled = next.disabled = matches.length === 0;
        status.textContent = input.value
            ? (matches.length ? `${current + 1} / ${matches.length}${presentation.capped ? '+' : ''} matches` : 'No matches')
            : `${presentation.lineCount} lines`;
        input.setAttribute('aria-invalid', input.value && !matches.length ? 'true' : 'false');
        status.title = presentation.capped ? 'The first 1000 matches are highlighted. Refine the search to find later occurrences.' : '';
    }

    function navigate(direction) {
        if (!matches.length) return;
        if (current >= 0) matches[current].classList.remove('is-current');
        current = (current + direction + matches.length) % matches.length;
        matches[current].classList.add('is-current');
        matches[current].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        updateStatus();
    }

    function render(scroll = { top: code.scrollTop, left: code.scrollLeft }) {
        const original = view === 'original';
        const text = original ? model.rawText : model.stackText || 'No stack data is available for this thread.';
        presentation = renderThreadStackMarkup(text, input.value, { decorate: !original });
        code.innerHTML = presentation.html;
        code.scrollTop = scroll.top;
        code.scrollLeft = scroll.left;
        matches = [...code.querySelectorAll('.thread-stack-match')];
        current = -1;
        if (matches.length) navigate(1);
        else updateStatus();
    }

    function updateViewControls() {
        const original = view === 'original';
        stackView.setAttribute('aria-pressed', String(!original));
        originalView.setAttribute('aria-pressed', String(original));
        code.setAttribute('aria-label', original ? `${model.originalLabel} thread dump` : 'Readable thread stack');
        input.setAttribute('aria-label', original ? `Search ${model.originalLabel.toLowerCase()}` : 'Search this stack');
        input.placeholder = original ? `Search ${model.originalLabel.toLowerCase()} (Ctrl+F)` : 'Search this stack (Ctrl+F)';
        colors.disabled = original;
        code.classList.toggle('is-plain', original || !colors.checked);
        legend.classList.toggle('hidden', original || !colors.checked);
    }

    function selectView(next) {
        if (next === view || (next === 'original' && !model.hasOriginal)) return;
        positions[view] = { top: code.scrollTop, left: code.scrollLeft };
        view = next;
        updateViewControls();
        render(positions[view]);
    }

    stackView.addEventListener('click', () => selectView('stack'));
    originalView.addEventListener('click', () => selectView('original'));
    input.addEventListener('input', () => render());
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { navigate(event.shiftKey ? -1 : 1); event.preventDefault(); }
        if (event.key === 'Escape' && input.value) {
            input.value = '';
            render();
            event.preventDefault();
            event.stopPropagation();
        }
    });
    previous.addEventListener('click', () => navigate(-1));
    next.addEventListener('click', () => navigate(1));
    colors.addEventListener('change', updateViewControls);
    root.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            input.focus();
            input.select();
            event.preventDefault();
        }
    }, { signal: controller.signal });
    updateViewControls();
    render();
}

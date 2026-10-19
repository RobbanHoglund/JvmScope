import { bindCaptureDrop } from './file-drop.js';

// Start actions reuse the analyzer's existing input and validation paths.
export function bindAnalyzerStart({ choose, paste, sample }) {
    const actions = { choose, paste, sample };
    document.querySelectorAll('[data-start-action]').forEach(button => {
        button.addEventListener('click', () => actions[button.dataset.startAction]?.());
    });
}

export function renderAnalyzerStart(hasCapture) {
    if (!document.body) return;
    const active = document.activeElement;
    const start = document.getElementById('analyzerStart');
    document.body.classList.toggle('analyzer-empty', !hasCapture);
    start.hidden = hasCapture;
    // Loading or clearing can hide the control that had keyboard focus.
    if (hasCapture && start.contains(active)) document.getElementById('searchInput')?.focus();
    else if (!hasCapture && active?.closest('[data-capture-only]')) {
        start.querySelector('[data-start-action="choose"]')?.focus();
    }
}

export function bindAnalyzerDropZones(onDrop) {
    bindCaptureDrop(onDrop, { onActive(active) {
        for (const zone of document.querySelectorAll('#analyzerStart, #tableContainer')) {
            zone.classList.toggle('is-dragging', active);
            zone.querySelector('.drop-overlay')?.classList.toggle('hidden', !active);
        }
    } });
}

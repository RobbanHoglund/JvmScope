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
    for (const zone of document.querySelectorAll('#analyzerStart, #tableContainer')) {
        let depth = 0;
        const overlay = zone.querySelector('.drop-overlay');
        const show = () => { zone.classList.add('is-dragging'); overlay?.classList.remove('hidden'); };
        const hide = () => { zone.classList.remove('is-dragging'); overlay?.classList.add('hidden'); };
        zone.addEventListener('dragenter', event => { event.preventDefault(); depth++; show(); });
        zone.addEventListener('dragover', event => { event.preventDefault(); show(); });
        zone.addEventListener('dragleave', event => {
            event.preventDefault();
            depth = Math.max(0, depth - 1);
            if (!depth) hide();
        });
        zone.addEventListener('drop', event => {
            event.preventDefault();
            depth = 0;
            hide();
            const files = Array.from(event.dataTransfer?.files || []);
            if (files.length) return onDrop(files);
        });
    }
    for (const name of ['dragover', 'drop']) document.addEventListener(name, event => event.preventDefault());
}

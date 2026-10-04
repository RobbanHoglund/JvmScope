/** A shared, keyboard-accessible library. Opening it never changes the current capture. */
export function createExamplePicker({ samples, analyzer, button, onLoad }) {
    if (!button || !document.createElement) return { open() {} };
    const dialog = document.createElement('dialog');
    dialog.id = 'exampleModal';
    dialog.className = 'modal hidden example-modal';
    dialog.setAttribute('aria-labelledby', 'exampleModalTitle');
    dialog.setAttribute('aria-describedby', 'exampleModalDescription');
    dialog.innerHTML = `
        <div class="modal-backdrop" data-example-close></div>
        <div class="modal-dialog">
            <div class="modal-header">
                <div><h2 class="modal-title" id="exampleModalTitle"></h2>
                <p class="example-description" id="exampleModalDescription">Choose a small, named example to explore the analyzer. Loading an example replaces the current ${analyzer === 'tda' ? 'session' : 'capture'}.</p></div>
                <button class="modal-close" type="button" aria-label="Close example library" data-example-close>×</button>
            </div>
            <div class="example-toolbar">
                <label for="exampleSearch">Search examples</label>
                <input id="exampleSearch" type="search" placeholder="Search symptoms or Java versions…" maxlength="160" autocomplete="off" />
                <label class="sr-only" for="exampleVersion">Java version / format</label>
                <select id="exampleVersion"><option value="">All versions / formats</option></select>
                <output id="exampleCount" role="status" aria-live="polite" aria-atomic="true"></output>
            </div>
            <div class="modal-body"><div class="example-grid"></div>
                <p class="example-empty" hidden>No examples match. Try another search or choose all versions.</p></div>
            <div class="modal-footer"><span>Controlled test data · Analyzed in your browser</span>
                <button class="btn" type="button" data-example-close>Close</button></div>
        </div>`;
    document.body.append(dialog);
    dialog.querySelector('#exampleModalTitle').textContent = analyzer === 'tda' ? 'Thread dump examples' : 'TLS log examples';
    const input = dialog.querySelector('#exampleSearch');
    const versions = dialog.querySelector('#exampleVersion');
    const grid = dialog.querySelector('.example-grid');
    let opener = button;
    for (const version of new Set(samples.map(sample => sample.version))) {
        const option = document.createElement('option');
        option.value = version;
        option.textContent = version;
        versions.append(option);
    }
    const cards = samples.map(sample => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'example-card';
        card.dataset.exampleId = sample.id;
        for (const [className, text] of [['example-title', sample.title], ['example-meta', `${sample.version} · ${sample.origin}`], ['example-summary', sample.description]]) {
            const span = document.createElement('span');
            span.className = className;
            span.textContent = text;
            card.append(span);
        }
        card.addEventListener('click', async () => { close(); await onLoad(sample); });
        grid.append(card);
        return { card, sample, text: `${sample.title} ${sample.version} ${sample.origin} ${sample.description}`.toLowerCase() };
    });
    function render() {
        const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        let matches = 0;
        for (const { card, sample, text } of cards) {
            card.hidden = Boolean(versions.value && versions.value !== sample.version) || !terms.every(term => text.includes(term));
            if (!card.hidden) matches++;
        }
        dialog.querySelector('#exampleCount').textContent = `${matches} of ${samples.length} examples`;
        dialog.querySelector('.example-empty').hidden = matches > 0;
        dialog.querySelector('.modal-body').scrollTo({ top: 0 });
    }
    function close() {
        dialog.close();
        dialog.classList.add('hidden');
        opener?.focus({ preventScroll: true });
    }
    function open(trigger = button) {
        opener = trigger;
        input.value = '';
        versions.value = '';
        render();
        dialog.classList.remove('hidden');
        dialog.showModal();
        input.focus({ preventScroll: true });
    }
    input.addEventListener('input', render);
    input.addEventListener('search', render);
    versions.addEventListener('change', render);
    // Search inputs otherwise consume the first Escape to clear their native value.
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelectorAll('[data-example-close]').forEach(control => control.addEventListener('click', close));
    button.addEventListener('click', () => open(button));
    document.querySelectorAll('[data-example-open]').forEach(control => control.addEventListener('click', () => open(control)));
    return { open };
}

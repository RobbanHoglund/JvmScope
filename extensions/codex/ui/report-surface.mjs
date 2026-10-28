const copy = {
    en: { open: 'Open analysis', opening: 'Opening…', back: 'Back to summary',
        fallback: 'Analysis opened here. Use “Back to summary” to keep the conversation compact.',
        stay: 'The host kept this view open. Use its close control to return to the conversation.' },
    sv: { open: 'Öppna analys', opening: 'Öppnar…', back: 'Till sammanfattningen',
        fallback: 'Analysen visas här. Välj ”Till sammanfattningen” för att göra konversationen kompakt igen.',
        stay: 'Klienten behöll den här vyn öppen. Använd dess stängningsknapp för att återgå till konversationen.' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; }
export function createReportSurface({ container, analysis, bridge, locale, compact }) {
    let hostMode = 'inline', expanded = false, fallback = false, busy = false, ready = false, operation = 0, notice = '';
    let summary, previousFocus;
    const t = key => copy[locale()][key];
    function draw(focus = false) {
        if (!ready) return;
        container.dataset.surface = expanded ? 'analysis' : 'summary';
        if (expanded) {
            const bar = el('div', 'analysis-toolbar'), back = el('button', 'surface-back', t('back'));
            back.type = 'button'; back.disabled = busy; back.addEventListener('click', close);
            bar.append(back, el('span', 'muted', 'JvmScope'));
            const children = [bar];
            if (notice || fallback) { const status = el('p', 'surface-status', t(notice || 'fallback')); status.setAttribute('role', 'status'); children.push(status); }
            children.push(analysis); container.replaceChildren(...children);
            if (focus) {
                const heading = analysis.querySelector('h1');
                if (heading) { heading.tabIndex = -1; heading.focus(); }
            }
        } else {
            container.replaceChildren(summary);
            const open = summary.querySelector('.open-analysis');
            open.textContent = t(busy ? 'opening' : 'open'); open.disabled = busy;
            if (focus) open.focus();
        }
    }
    async function open() {
        const id = ++operation; busy = true; notice = ''; draw();
        let result;
        try { result = await bridge.requestDisplayMode('fullscreen'); } catch { /* Explicit, reversible local expansion is the fallback. */ }
        if (id !== operation) return;
        if (['inline', 'fullscreen'].includes(result?.mode)) hostMode = result.mode;
        expanded = true; fallback = hostMode !== 'fullscreen'; busy = false; draw(!previousFocus?.isConnected);
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    async function close() {
        const id = ++operation;
        previousFocus = analysis.contains(document.activeElement) ? document.activeElement : null;
        if (hostMode === 'fullscreen') {
            busy = true; draw();
            let result;
            try { result = await bridge.requestDisplayMode('inline'); } catch { /* Do not claim the host closed a view it kept open. */ }
            if (id !== operation) return;
            if (result?.mode === 'inline') hostMode = 'inline';
            if (hostMode === 'fullscreen') { busy = false; notice = 'stay'; draw(); return; }
        }
        expanded = false; fallback = false; busy = false; notice = ''; draw(true);
    }
    return {
        update() {
            ready = true; summary = compact();
            const openButton = el('button', 'open-analysis', t('open')); openButton.type = 'button';
            openButton.addEventListener('click', open); summary.append(openButton);
            draw();
        },
        context(context) {
            if (!['inline', 'fullscreen'].includes(context.displayMode) || context.displayMode === hostMode) return;
            hostMode = context.displayMode; expanded = hostMode === 'fullscreen'; fallback = false; notice = '';
            draw();
        },
    };
}

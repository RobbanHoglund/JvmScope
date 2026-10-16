const STORAGE_KEY = 'jvmscope.tls.workspace-ratio';
const DIVIDER_WIDTH = 14;
const TABLE_MIN_WIDTH = 560;
const INSPECTOR_MIN_WIDTH = 500;

// Resizing changes presentation only; interaction selection and evidence stay
// owned by the existing table and inspector. A narrow viewport stacks both.
export function bindTlsWorkspace(workspace, divider) {
    if (!workspace || !divider || typeof ResizeObserver !== 'function') return { update() {} };
    let preferred = 50;
    let current = 50;
    let minimum = 0;
    let maximum = 100;
    let available = 0;
    let drag = null;
    let scheduled = false;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const value = saved === null || saved.trim() === '' ? NaN : Number(saved);
        if (Number.isFinite(value) && value >= 0 && value <= 100) preferred = value;
    } catch { /* Resizing also works when storage is unavailable. */ }

    function persist() {
        try { localStorage.setItem(STORAGE_KEY, String(preferred)); } catch { /* Keep the in-memory preference. */ }
    }

    function finishDrag(save) {
        if (!drag) return;
        const previous = drag;
        drag = null;
        if (!save) preferred = previous.preferred;
        workspace.classList.remove('is-resizing');
        if (divider.hasPointerCapture(previous.id)) divider.releasePointerCapture(previous.id);
        if (save) persist();
        update();
    }

    function update() {
        available = workspace.clientWidth - DIVIDER_WIDTH;
        const enabled = document.body.classList.contains('tls-investigating')
            && innerWidth > 1200 && workspace.clientHeight > 0
            && available >= TABLE_MIN_WIDTH + INSPECTOR_MIN_WIDTH;
        workspace.dataset.resizable = String(enabled);
        divider.hidden = !enabled;
        if (!enabled) {
            finishDrag(false);
            if (document.activeElement === divider) document.getElementById('tlsTableScroll')?.focus({ preventScroll: true });
            return;
        }
        minimum = TABLE_MIN_WIDTH / available * 100;
        maximum = (available - INSPECTOR_MIN_WIDTH) / available * 100;
        current = Math.max(minimum, Math.min(maximum, preferred));
        workspace.style.setProperty('--tls-table-fraction', `${current}fr`);
        workspace.style.setProperty('--tls-inspector-fraction', `${100 - current}fr`);
        divider.setAttribute('aria-valuemin', minimum.toFixed(1));
        divider.setAttribute('aria-valuemax', maximum.toFixed(1));
        divider.setAttribute('aria-valuenow', current.toFixed(1));
        divider.setAttribute('aria-valuetext', `${Math.round(current)}% table, ${Math.round(100 - current)}% details`);
    }

    function resize(value) {
        preferred = Math.max(minimum, Math.min(maximum, value));
        update();
    }

    divider.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary || divider.hidden || drag) return;
        event.preventDefault();
        divider.focus({ preventScroll: true });
        drag = { id: event.pointerId, preferred };
        divider.setPointerCapture(event.pointerId);
        workspace.classList.add('is-resizing');
    });
    divider.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        resize((event.clientX - workspace.getBoundingClientRect().left - DIVIDER_WIDTH / 2) / available * 100);
    });
    divider.addEventListener('pointerup', event => { if (drag?.id === event.pointerId) finishDrag(true); });
    divider.addEventListener('pointercancel', event => { if (drag?.id === event.pointerId) finishDrag(false); });
    divider.addEventListener('lostpointercapture', event => { if (drag?.id === event.pointerId) finishDrag(false); });
    divider.addEventListener('dblclick', () => { preferred = 50; update(); persist(); });
    divider.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(false); return; }
        if (divider.hidden || drag) return;
        const step = event.shiftKey ? 10 : 2;
        const value = { ArrowLeft: current - step, ArrowRight: current + step, Home: minimum, End: maximum }[event.key];
        if (value === undefined) return;
        event.preventDefault();
        resize(value);
        persist();
    });
    const observer = new ResizeObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; update(); });
    });
    observer.observe(workspace);
    update();
    return { update };
}

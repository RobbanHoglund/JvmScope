import { panWindow } from './presentation.js';

// Stable controls remain in the DOM while the main timeline redraws.
export function createOverview({ element, plot, selection, from, to, getRange, onChange }) {
    let cachedModel, drag, frame;
    const redraw = range => {
        onChange(range, false);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => onChange(getRange(), true));
    };
    selection.addEventListener('pointerdown', event => {
        if (event.button !== 0 || selection.disabled) return;
        drag = { x: event.clientX, range: [...getRange()] };
        selection.setPointerCapture(event.pointerId);
        event.preventDefault();selection.focus({ preventScroll: true });
    });
    selection.addEventListener('pointermove', event => {
        if (!drag) return;
        redraw(panWindow(drag.range, (event.clientX - drag.x) / element.clientWidth * 1000));
    });
    const finish = () => { drag = null; };
    selection.addEventListener('pointerup', finish);
    selection.addEventListener('pointercancel', finish);
    selection.addEventListener('lostpointercapture', finish);
    selection.addEventListener('keydown', event => {
        const range = getRange(), step = Math.max(.001, (range[1] - range[0]) * .1);
        const delta = { ArrowLeft: -step, ArrowRight: step, Home: -1000, End: 1000 }[event.key];
        if (delta === undefined) return;
        event.preventDefault();redraw(panWindow(range, delta));
    });
    element.addEventListener('pointerdown', event => {
        if (event.target !== element && event.target !== plot || selection.disabled) return;
        const range = getRange(), center = (event.clientX - element.getBoundingClientRect().left) / element.clientWidth * 1000;
        redraw(panWindow(range, center - (range[0] + range[1]) / 2));
    });
    return {
        update(model, range, label) {
            selection.disabled = model.start === null;
            from.disabled = to.disabled = selection.disabled;
            from.value = range[0];to.value = range[1];
            selection.style.left = range[0] / 10 + '%';
            selection.style.width = (range[1] - range[0]) / 10 + '%';
            selection.setAttribute('aria-label', `Move visible interval: ${label}. Use left and right arrows.`);
            from.setAttribute('aria-valuetext', label.split(' – ')[0]);
            to.setAttribute('aria-valuetext', label.split(' – ')[1] || 'Unavailable');
            if (model === cachedModel) return;
            cachedModel = model;drag = null;cancelAnimationFrame(frame);
            const bins = new Float64Array(400), span = Math.max(1, model.end - model.start);
            for (const event of model.events) {
                if (event.kind !== 'pause' || event.startMs === null) continue;
                const bin = Math.max(0, Math.min(399, Math.floor((event.startMs - model.start) / span * 400)));
                bins[bin] = Math.max(bins[bin], event.durationMs);
            }
            const max = Math.max(.01, ...bins), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', Array.from(bins, (value, i) => value ? `M${i*2.5+1},46v-${Math.max(2, value/max*38)}` : '').join(' '));
            plot.replaceChildren(path);
        },
    };
}

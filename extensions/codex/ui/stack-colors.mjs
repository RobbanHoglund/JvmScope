import { renderThreadStackMarkup } from '../../../frontend/assets/javautils/tda/thread-stack-view.js';

const copy = {
    en: { colors: 'Colors', key: 'Stack color key', jvm: 'JVM', library: 'Libraries', other: 'Other / application', lock: 'Locks',
        hint: 'Package-name hints, not diagnostic severity. Other frames may include unrecognized libraries.',
        jvmFrame: 'JVM frame', libraryFrame: 'Library frame (package hint)', otherFrame: 'Other frame (often application code)' },
    sv: { colors: 'Färger', key: 'Stackens färgnyckel', jvm: 'JVM', library: 'Bibliotek', other: 'Övrigt / applikation', lock: 'Lås',
        hint: 'Ledtrådar från paketnamn, inte felets allvarlighetsgrad. Övriga ramar kan även vara okända bibliotek.',
        jvmFrame: 'JVM-ram', libraryFrame: 'Biblioteksram (ledtråd från paketnamn)', otherFrame: 'Övrig ram (ofta applikationskod)' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; }
// A presentation choice for this report pane, shared by its source readers.
// Separate report tabs have their own module state; no browser storage is used.
let colorsEnabled = true;

// Use the application's escaped renderer on the original text, before adding
// physical line numbers. Numeric prefixes must not change frame classification.
export function stackColors({ pre, controls, locale }) {
    const t = key => copy[locale][key], label = el('label', 'stack-color-toggle'), checkbox = el('input', '');
    checkbox.type = 'checkbox'; checkbox.checked = colorsEnabled; label.title = t('hint');
    label.append(checkbox, document.createTextNode(t('colors'))); controls.append(label);
    const legend = el('div', 'stack-color-key'); legend.setAttribute('aria-label', t('key')); legend.title = t('hint');
    for (const kind of ['jvm', 'library', 'other', 'lock']) legend.append(el('span', `is-${kind}`, t(kind)));
    pre.classList.add('colored-stack');
    pre.dataset.colored = String(colorsEnabled); legend.hidden = !colorsEnabled;
    checkbox.addEventListener('change', () => {
        colorsEnabled = checkbox.checked;
        for (const input of document.querySelectorAll('.stack-color-toggle input')) input.checked = colorsEnabled;
        for (const source of document.querySelectorAll('.colored-stack')) source.dataset.colored = String(colorsEnabled);
        for (const key of document.querySelectorAll('.stack-color-key')) key.hidden = !colorsEnabled;
    });
    return { legend, paint(lines) {
        if (!lines.length) { pre.replaceChildren(); return; }
        // This shared renderer escapes every source character; no capture text
        // is interpolated as markup, attributes or CSS.
        pre.innerHTML = renderThreadStackMarkup(lines.map(l => l.text).join('\n')).html;
        [...pre.children].forEach((row, i) => {
            row.prepend(el('span', 'source-line-number', `${lines[i].line}  `));
            for (const kind of ['jvm', 'library', 'other']) if (row.classList.contains(`is-${kind}`)) row.title = t(`${kind}Frame`);
        });
    } };
}

export function coloredEvidence(lines, locale) {
    const box = el('div', 'source-evidence'), controls = el('div', 'stack-controls'), pre = el('pre', 'evidence');
    const colors = stackColors({ pre, controls, locale }); colors.paint(lines);
    box.append(controls, colors.legend, pre); return box;
}

import { groupStacks } from './stack-groups.mjs';
const copy = {
    en: { title: 'Stack overview', threads: 'threads', thread: 'thread', frames: 'identical frames', original: 'Choose a thread to read its original stack below.',
        note: 'Equal frames and Java state do not establish a shared request or lock.',
        partial: 'Partial stack · kept separate', missing: 'No stack frames recorded', originalLabel: 'Original source', scope: 'The assessment above covers the full selection.' },
    sv: { title: 'Stacköversikt', threads: 'trådar', thread: 'tråd', frames: 'identiska stackramar', original: 'Välj en tråd för att läsa dess originalstack nedan.',
        note: 'Lika stackramar och Java-tillstånd bevisar inte ett gemensamt anrop eller lås.',
        partial: 'Ofullständig stack · visas separat', missing: 'Inga stackramar registrerade', originalLabel: 'Originalkälla', scope: 'Bedömningen ovan gäller hela urvalet.' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; }
export function stackSelection({ threads, locale, selectedKey, hasAssessment, onSelect }) {
    const t = key => copy[locale][key], box = el('section', 'stack-selection'), buttons = [];
    box.append(el('h2', '', t('title')), el('p', 'muted selection-instruction', hasAssessment ? t('scope') : t('original')));
    const groups = groupStacks(threads);
    for (const group of groups) {
        const card = el('article', 'stack-group'), head = el('div', 'stack-group-head');
        head.append(el('strong', '', `${group.threads.length} ${t(group.threads.length === 1 ? 'thread' : 'threads')}`),
            el('span', 'thread-state', group.threads[0].state || '—'));
        card.append(head);
        if (group.frames.length) card.append(el('code', 'group-top-frame', group.frames[0].replace(/^at\s+/, '')));
        else card.append(el('p', 'muted', t('missing')));
        if (group.threads.length > 1) {
            const details = el('details', 'shared-stack'), frames = el('ol', 'shared-frames');
            details.append(el('summary', '', `${group.frames.length} ${t('frames')}`));
            for (const frame of group.frames) { const li = el('li', ''); li.append(el('code', '', frame.replace(/^at\s+/, ''))); frames.append(li); }
            details.append(frames); card.append(details);
        } else if (!group.complete && group.frames.length) card.append(el('p', 'muted', t('partial')));
        const members = el('div', 'stack-members'); members.setAttribute('role', 'group'); members.setAttribute('aria-label', t('originalLabel'));
        for (const thread of group.threads) {
            const b = el('button', 'stack-member', thread.name); b.type = 'button'; b.dataset.sourceKey = thread.sourceKey;
            b.setAttribute('aria-pressed', String(thread.sourceKey === selectedKey)); b.setAttribute('aria-controls', 'selected-stack-source');
            b.addEventListener('click', () => {
                for (const item of buttons) item.setAttribute('aria-pressed', String(item === b));
                onSelect(thread.sourceKey);
            }); buttons.push(b); members.append(b);
        }
        card.append(members); box.append(card);
    }
    if (groups.some(g => g.threads.length > 1)) box.append(el('p', 'muted group-qualification', t('note')));
    return box;
}

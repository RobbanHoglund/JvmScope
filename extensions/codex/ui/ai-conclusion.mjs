const copy = {
    en: { title: 'AI conclusion', next: 'Next check', snapshot: 'Snapshot', snapshots: 'Snapshots', original: 'Original language',
        note: 'AI interpretation of the selected evidence. Rule findings and source details follow below.' },
    sv: { title: 'AI-bedömning', next: 'Nästa kontroll', snapshot: 'Snapshot', snapshots: 'Snapshots', original: 'Originalspråk',
        note: 'AI-tolkning av det valda underlaget. Regelfynd och källdetaljer följer nedan.' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; }
export function aiConclusionView({ conclusion, reportId, scope, locale }) {
    // Never carry an assessment across reports, snapshots or thread selections.
    if (!conclusion || conclusion.reportId !== reportId || JSON.stringify(conclusion.scope) !== JSON.stringify(scope)) return null;
    const t = key => copy[locale][key], box = el('section', 'ai-conclusion');
    box.setAttribute('aria-label', t('title'));
    const header = el('div', 'ai-conclusion-head');
    header.append(el('h2', '', t('title')), el('span', 'muted', `${t(scope.snapshots.length === 1 ? 'snapshot' : 'snapshots')} ${scope.snapshots.map(i => i + 1).join(', ')}`));
    box.append(header);
    for (const [key, cls] of [['summary', 'ai-conclusion-summary'], ['nextCheck', 'ai-conclusion-next']]) {
        const p = el('p', cls); if (key === 'nextCheck') p.append(el('strong', '', `${t('next')}: `));
        const text = el('span', '', conclusion[key]); text.lang = conclusion.language; p.append(text); box.append(p);
    }
    if (conclusion.language !== locale) box.append(el('p', 'muted ai-conclusion-language', `${t('original')}: ${conclusion.language === 'sv' ? 'Svenska' : 'English'}`));
    box.append(el('p', 'muted ai-conclusion-note', t('note')));
    return box;
}

import { aiConclusionView } from './ai-conclusion.mjs';
import { findingCopy, findingOverview } from './finding-copy.mjs';
const words = {
    en: { title: 'Thread analysis', focused: 'Thread assessment', comparison: 'Snapshot comparison', language: 'Report language',
        none: 'No prioritized findings', critical: 'Critical', high: 'High priority', medium: 'Review', info: 'Information',
        snapshot: 'Snapshot', of: 'of', records: 'thread records', record: 'thread record', selected: 'selected threads', selectedOne: 'selected thread',
        noCycle: 'No JVM-reported deadlock in this snapshot.', noFindings: 'No prioritized findings from the available evidence. This does not establish health.',
        cycles: 'JVM-reported deadlock cycles', cycle: 'JVM-reported deadlock cycle', cyclesScope: 'In the selected snapshot; may include other threads.',
        observed: 'Snapshots with JVM-reported cycles', findings: 'rule findings', rule: 'Analyzer result',
        comparisonNote: 'Open the analysis to compare recorded counters and the availability of each interval.',
        evidence: 'Stack evidence is available for this selection. No separate AI assessment has been prepared.',
        partial: 'Partial capture or parser warnings. Review coverage before drawing conclusions.',
        single: 'One snapshot cannot establish wait duration, progress or CPU/allocation rates.',
        next: 'Next check', inspect: 'Inspect the affected stacks and lock acquisition paths.',
        repeat: 'If symptoms persist, compare another capture and check the affected request’s timing.',
        empty: 'No snapshots are available on this page. Open the analysis to return to the first page.',
        example: 'Synthetic example', local: 'Parsed locally · results shared with your AI host' },
    sv: { title: 'Trådanalys', focused: 'Trådbedömning', comparison: 'Jämför snapshots', language: 'Rapportspråk',
        none: 'Inga prioriterade fynd', critical: 'Kritisk', high: 'Hög prioritet', medium: 'Granska', info: 'Information',
        snapshot: 'Snapshot', of: 'av', records: 'trådposter', record: 'trådpost', selected: 'valda trådar', selectedOne: 'vald tråd',
        noCycle: 'Ingen JVM-rapporterad deadlock i denna snapshot.', noFindings: 'Inga prioriterade fynd i tillgängligt underlag. Det bevisar inte att allt fungerar.',
        cycles: 'JVM-rapporterade deadlockcykler', cycle: 'JVM-rapporterad deadlockcykel', cyclesScope: 'I vald snapshot; kan omfatta andra trådar.',
        observed: 'Snapshots med JVM-rapporterade cykler', findings: 'regelfynd', rule: 'Analysresultat',
        comparisonNote: 'Öppna analysen för att jämföra registrerade räknare och underlaget för varje intervall.',
        evidence: 'Stackunderlag finns för urvalet. Ingen separat AI-bedömning har gjorts.',
        partial: 'Ofullständigt underlag eller parservarningar. Granska täckningen innan du drar slutsatser.',
        single: 'En snapshot kan inte fastställa väntans längd, framsteg eller CPU-/allokeringstakt.',
        next: 'Nästa kontroll', inspect: 'Granska berörda stackar och kodvägarnas låsordning.',
        repeat: 'Om symtomen kvarstår, jämför en ny dump och kontrollera det berörda anropets tidsåtgång.',
        empty: 'Den här sidan saknar snapshots. Öppna analysen för att återgå till första sidan.',
        example: 'Syntetiskt exempel', local: 'Parsas lokalt · resultat delas med din AI-klient' },
};
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls; if (text != null) n.textContent = text; return n; }
export function compactReport({ report, snapshot, focused, view, conclusion, scope, locale, onLanguage }) {
    const t = key => words[locale][key], card = el('section', 'compact-report');
    const comparison = !focused && view === 'comparison';
    const snapshots = focused ? [] : comparison ? report.snapshots.items : [snapshot].filter(Boolean);
    const counts = snapshots.reduce((sum, s) => { for (const k of ['critical', 'high', 'medium', 'info']) sum[k] += s.analysis?.counts?.[k] || 0; return sum; }, { critical: 0, high: 0, medium: 0, info: 0 });
    const cycles = focused?.snapshotDeadlockCycles ?? snapshots.reduce((n, s) => n + (s.deadlocks?.total || 0), 0);
    const severity = cycles ? 'critical' : Object.keys(counts).find(k => counts[k]);
    const header = el('header', 'compact-header'), title = el('div', 'compact-title');
    title.append(el('span', 'eyebrow', 'JVMSCOPE / JAVA'), el('h1', '', t(focused ? 'focused' : comparison ? 'comparison' : 'title')));
    const language = el('select', 'compact-language'); language.setAttribute('aria-label', t('language'));
    for (const [key, label] of [['en', 'English'], ['sv', 'Svenska']]) { const o = el('option', '', label); o.value = key; language.append(o); }
    language.value = locale; language.addEventListener('change', () => onLanguage(language.value));
    header.append(title, language); card.append(header);
    if (!focused && !snapshots.length) { card.append(el('p', 'compact-qualification', t('empty'))); return card; }
    if (severity) {
        const alert = el('div', `compact-alert ${severity}`);
        const heading = el('strong', '', `${t(severity)} · ${comparison && cycles ? `${t('observed')}: ${snapshots.filter(s => s.deadlocks?.total).length} / ${snapshots.length}` : cycles ? `${cycles} ${t(cycles === 1 ? 'cycle' : 'cycles')}` : `${counts[severity]} ${t('findings')}`}`);
        if (severity === 'critical' || severity === 'high') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
            const path = document.createElementNS(svg.namespaceURI, 'path');
            path.setAttribute('d', 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1'); path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8'); svg.append(path); heading.prepend(svg);
        }
        alert.append(heading);
        if (focused && cycles) alert.append(el('p', '', t('cyclesScope')));
        const first = snapshots.flatMap(s => s.analysis?.findings?.items || []).find(f => f.severity === severity);
        if (first && !cycles) alert.append(el('p', '', findingCopy(first, locale).title));
        card.append(alert);
    }
    const assessment = aiConclusionView({ conclusion, reportId: focused?.reportId || report.reportId, scope, locale, compact: true });
    if (assessment) card.append(assessment);
    else {
        const result = el('section', 'compact-result'); result.append(el('h2', '', t('rule')));
        const first = snapshots.flatMap(s => s.analysis?.findings?.items || [])[0];
        result.append(el('p', '', focused ? t('evidence') : comparison ? t('comparisonNote') : first ? findingOverview(first, locale) : t('noCycle')));
        if (!focused && !comparison && !first) result.append(el('p', 'muted', t('noFindings')));
        if (!focused && !comparison) { const next = el('p', 'compact-next'); next.append(el('strong', '', `${t('next')}: `), el('span', '', t(first || cycles ? 'inspect' : 'repeat'))); result.append(next); }
        card.append(result);
    }
    const partial = focused ? focused.warnings?.length : report.status === 'partial' || report.warnings?.length;
    if (partial) card.append(el('p', 'compact-coverage', t('partial')));
    else if ((focused?.snapshotCount ?? report.snapshotCount) === 1) card.append(el('p', 'compact-qualification', t('single')));
    const context = el('div', 'compact-context');
    const number = focused?.snapshotNumber ?? (snapshot?.index + 1);
    context.append(el('p', '', comparison ? `${t('snapshot')} ${snapshots.map(s => s.index + 1).join(', ')} · ${t('of')} ${report.snapshotCount}` : `${t('snapshot')} ${number} / ${focused?.snapshotCount ?? report.snapshotCount} · ${focused ? `${focused.threads.length} ${t(focused.threads.length === 1 ? 'selectedOne' : 'selected')}` : `${snapshot.threadCount} ${t(snapshot.threadCount === 1 ? 'record' : 'records')}`}`));
    const sources = focused ? [focused.source] : comparison ? report.sources.filter(s => snapshots.some(snapshot => snapshot.sourcePath === s.path)) : report.sources.filter(s => s.path === snapshot?.sourcePath);
    context.append(el('p', 'compact-filename', sources.map(s => s.name).join(' · ')));
    const selected = focused?.threads || (scope.sourceKeys || []).map(key => snapshot?.threadInventory?.items.find(t => t.sourceKey === key)
        || snapshot?.deadlocks?.items.flatMap(c => c.participants.items).find(p => p.id === key)).filter(Boolean);
    if (selected.length) context.append(el('p', 'compact-selection', selected.map(t => t.name).join(' · ')));
    if (report?.example?.synthetic) context.append(el('span', 'example-label', t('example')));
    card.append(context, el('p', 'compact-privacy', t('local'))); return card;
}

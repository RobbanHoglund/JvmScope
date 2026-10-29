import { stackSource } from './stack-source.mjs';
import { formatRate } from './comparison.mjs';
import { aiConclusionView } from './ai-conclusion.mjs';
const words = {
    en: { title: 'Selected threads', language: 'Report language', snapshot: 'Snapshot', selected: 'selected threads', selectedSingle: 'selected thread',
        overview: 'All threads', compare: 'Compare snapshots', allocation: 'Allocation', state: 'State', unknown: 'Unavailable',
        interval: 'Rates over snapshot interval', noInterval: 'No comparable baseline; CPU and allocation rates are unavailable.',
        noCounters: 'CPU and allocation rates are unavailable for this thread; review measurement coverage below.',
        evidenceOnly: 'Stack evidence — no separate AI assessment has been prepared for this selection.',
        scope: 'CPU is relative to one logical CPU. Allocation rate is not retained memory.',
        stack: 'Recorded stack', frameNote: 'Highlights use package names to select frames outside the JDK; they may be application or library code.',
        full: 'Full thread block', more: 'Next source lines', lines: 'Lines', noSource: 'No exact physical source range is available for this thread.',
        noFrames: 'No stack frames in the available source lines.', loading: 'Checking source…', checked: 'Source hash verified',
        cycles: 'JVM-reported deadlock cycles elsewhere or among these threads in this snapshot', info: 'Report information',
        local: 'Parsed locally · results are shared with your AI host', timing: 'Evidence / plugin work',
        host: 'Source links and the host editor are independent. Timings exclude model reasoning and host rendering.' },
    sv: { title: 'Valda trådar', language: 'Rapportspråk', snapshot: 'Snapshot', selected: 'valda trådar', selectedSingle: 'vald tråd',
        overview: 'Alla trådar', compare: 'Jämför snapshots', allocation: 'Allokering', state: 'Tillstånd', unknown: 'Ej tillgängligt',
        interval: 'Mätvärden över snapshotintervallet', noInterval: 'Jämförbar startpunkt saknas; CPU- och allokeringstakt kan inte beräknas.',
        noCounters: 'CPU- och allokeringstakt saknas för denna tråd; se mätunderlaget nedan.',
        evidenceOnly: 'Stackunderlag — ingen separat AI-bedömning har gjorts för detta urval.',
        scope: 'CPU anges relativt en logisk CPU. Allokeringstakt är inte kvarhållet minne.',
        stack: 'Registrerad stack', frameNote: 'Urvalet använder paketnamn för ramar utanför JDK; de kan tillhöra applikationen eller ett bibliotek.',
        full: 'Hela trådblocket', more: 'Nästa källrader', lines: 'Rader', noSource: 'Exakta fysiska källrader saknas för denna tråd.',
        noFrames: 'Inga stackramar i de tillgängliga källraderna.', loading: 'Kontrollerar källa…', checked: 'Källfilens hash verifierad',
        cycles: 'JVM-rapporterade deadlockcykler i denna snapshot, bland dessa eller andra trådar', info: 'Rapportinformation',
        local: 'Parsas lokalt · resultat delas med din AI-klient', timing: 'Källkontroll / pluginarbete',
        host: 'Källänkar och klientens editor fungerar oberoende. Tiderna inkluderar inte AI-modellen eller klientens rendering.' },
};
function el(tag, className, text) { const n = document.createElement(tag); n.className = className || ''; if (text != null) n.textContent = text; return n; }
function button(label, action) { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', action); return b; }
export function threadDetailsView({ data, locale, version, conclusion, canRead, onLanguage, onNavigate, onNext }) {
    const t = key => words[locale][key], view = el('section', 'thread-focus');
    const header = el('header', 'header'), heading = el('div');
    heading.append(el('span', 'eyebrow', 'JVMSCOPE / JAVA DIAGNOSTICS'), el('h1', '', t('title')));
    const language = el('select'); language.setAttribute('aria-label', t('language'));
    for (const [key, label] of [['en', 'English'], ['sv', 'Svenska']]) { const o = el('option', '', label); o.value = key; language.append(o); }
    language.value = locale; language.addEventListener('change', () => onLanguage(language.value)); header.append(heading, language); view.append(header);
    const assessment = aiConclusionView({ conclusion, reportId: data.reportId, locale,
        scope: { view: 'threads', snapshots: [data.snapshotIndex], sourceKeys: data.threads.map(t => t.sourceKey).sort() } });
    if (assessment) view.append(assessment);
    else view.append(el('p', 'muted focus-evidence-only', t('evidenceOnly')));
    const context = el('div', 'snapshot-context');
    context.append(el('strong', '', `${t('snapshot')} ${data.snapshotNumber} / ${data.snapshotCount} · ${data.threads.length} ${t(data.threads.length === 1 ? 'selectedSingle' : 'selected')}`), el('p', 'filename', data.source.name)); view.append(context);
    const nav = el('nav', 'focus-navigation');
    for (const [key, label] of [['snapshot', `${t('overview')} · snapshot ${data.snapshotNumber}`], ['comparison', t('compare')]]) {
        if (key === 'comparison' && data.snapshotCount < 2) continue;
        const b = button(label, async () => { b.disabled = true; try { await onNavigate(key); } catch (e) { b.disabled = !canRead; view.append(el('p', 'error', e.message)); } });
        b.disabled = !canRead; nav.append(b);
    }
    view.append(nav);
    for (const thread of data.threads) {
        const card = el('article', 'thread-focus-card'); card.dataset.sourceKey = thread.sourceKey;
        const head = el('div', 'focus-card-head'); head.append(el('h2', '', thread.name), el('span', 'thread-state', thread.state || t('unknown'))); card.append(head);
        const hasRate = thread.cpu.percent != null || thread.allocation.bytesPerSecond != null || thread.allocation.boundsBytesPerSecond != null;
        if (hasRate) {
            const metrics = el('div', 'thread-rates');
            for (const [key, label] of [['cpu', 'CPU'], ['allocation', t('allocation')]]) {
                const m = el('div'); m.append(el('span', 'muted', label), el('strong', '', formatRate(thread, key, locale))); metrics.append(m);
            }
            card.append(metrics, el('p', 'muted thread-interval', thread.baseline ? `${t('interval')}: ${thread.baseline.snapshotNumber} → ${data.snapshotNumber}` : t('noInterval')),
                el('p', 'muted focus-scope', t('scope')));
        } else {
            card.append(el('p', 'muted thread-metrics-note', t(thread.baseline ? 'noCounters' : 'noInterval')));
        }
        const highlight = thread.highlights.items[0];
        if (highlight) {
            const match = highlight.text.match(/^(.*)\(([^()]*)\)$/), line = el('div', 'stack-highlight');
            line.append(el('span', 'muted', t('stack')));
            if (match) { line.append(el('code', 'frame-method', match[1].split('.').slice(-2).join('.')), el('strong', 'frame-location', match[2])); }
            else line.append(el('code', 'frame-method', highlight.text));
            line.title = highlight.text; card.append(line);
        } else card.append(el('p', 'muted', thread.context.range ? t('noFrames') : t('noSource')));
        if (thread.lines.length) card.append(stackSource({ thread, locale, canRead, onNext }));
        view.append(card);
    }
    if (data.snapshotDeadlockCycles) view.append(el('p', 'muted focus-related', `${data.snapshotDeadlockCycles} ${t('cycles')}.`));
    const info = el('details', 'coverage focus-information'); info.append(el('summary', '', `${t('info')} · v${version}`));
    for (const note of [t('checked'), t('frameNote'), t('host'), ...data.warnings, ...data.qualifications,
        `${t('timing')}: ${data.timing.readAndHashMs} / ${data.timing.toolWorkMs} ms`]) info.append(el('p', '', note));
    for (const thread of data.threads) info.append(el('p', '', `${thread.name}: CPU ${thread.cpu.status} (${thread.cpu.intervalMs ?? '—'} ms); ${t('allocation')} ${thread.allocation.status} (${thread.allocation.intervalMs ?? '—'} ms)`));
    view.append(info, el('footer', 'footer', t('local'))); return view;
}

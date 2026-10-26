import { formatRate } from './comparison.mjs';
const words = {
    en: { title: 'Selected threads', language: 'Report language', snapshot: 'Snapshot', selected: 'selected threads',
        overview: 'Snapshot overview', compare: 'Compare snapshots', allocation: 'Allocation', state: 'State', unknown: 'Unavailable',
        interval: 'Rates over snapshot interval', noInterval: 'No comparable baseline; rates are unavailable.',
        scope: 'CPU is relative to one logical CPU. Allocation rate is not retained memory.',
        stack: 'Recorded stack', frameNote: 'Highlights use package names to select frames outside the JDK; they may be application or library code.',
        full: 'Full thread block', more: 'Next source lines', lines: 'Lines', noSource: 'No exact physical source range is available for this thread.',
        noFrames: 'No stack frames in the available source lines.', loading: 'Checking source…', checked: 'Source hash verified',
        cycles: 'JVM-reported deadlock cycles elsewhere or among these threads in this snapshot', info: 'Report information',
        local: 'Parsed locally · results are shared with your AI host', timing: 'Evidence / plugin work',
        host: 'Source links and the host editor are independent. Timings exclude model reasoning and host rendering.' },
    sv: { title: 'Valda trådar', language: 'Rapportspråk', snapshot: 'Snapshot', selected: 'valda trådar',
        overview: 'Snapshotöversikt', compare: 'Jämför snapshots', allocation: 'Allokering', state: 'Tillstånd', unknown: 'Ej tillgängligt',
        interval: 'Mätvärden över snapshotintervallet', noInterval: 'Jämförbar startpunkt saknas; mätvärden är inte tillgängliga.',
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
export function threadDetailsView({ data, locale, version, canRead, onLanguage, onNavigate, onNext }) {
    const t = key => words[locale][key], view = el('section', 'thread-focus');
    const header = el('header', 'header'), heading = el('div');
    heading.append(el('span', 'eyebrow', 'JVMSCOPE / JAVA DIAGNOSTICS'), el('h1', '', t('title')));
    const language = el('select'); language.setAttribute('aria-label', t('language'));
    for (const [key, label] of [['en', 'English'], ['sv', 'Svenska']]) { const o = el('option', '', label); o.value = key; language.append(o); }
    language.value = locale; language.addEventListener('change', () => onLanguage(language.value)); header.append(heading, language); view.append(header);
    const context = el('div', 'snapshot-context');
    context.append(el('strong', '', `${t('snapshot')} ${data.snapshotNumber} / ${data.snapshotCount} · ${data.threads.length} ${t('selected')}`), el('p', 'filename', data.source.name)); view.append(context);
    const nav = el('nav', 'focus-navigation');
    for (const [key, label] of [['snapshot', t('overview')], ['comparison', t('compare')]]) {
        if (key === 'comparison' && data.snapshotCount < 2) continue;
        const b = button(label, async () => { b.disabled = true; try { await onNavigate(key); } catch (e) { b.disabled = !canRead; view.append(el('p', 'error', e.message)); } });
        b.disabled = !canRead; nav.append(b);
    }
    view.append(nav, el('p', 'muted focus-scope', t('scope')));
    for (const thread of data.threads) {
        const card = el('article', 'thread-focus-card'); card.dataset.sourceKey = thread.sourceKey;
        const head = el('div', 'focus-card-head'); head.append(el('h2', '', thread.name), el('span', 'thread-state', thread.state || t('unknown'))); card.append(head);
        const metrics = el('div', 'thread-rates');
        for (const [key, label] of [['cpu', 'CPU'], ['allocation', t('allocation')]]) {
            const m = el('div'); m.append(el('span', 'muted', label), el('strong', '', formatRate(thread, key, locale))); metrics.append(m);
        }
        card.append(metrics, el('p', 'muted thread-interval', thread.baseline ? `${t('interval')}: ${thread.baseline.snapshotNumber} → ${data.snapshotNumber}` : t('noInterval')));
        const highlight = thread.highlights.items[0];
        if (highlight) {
            const match = highlight.text.match(/^(.*)\(([^()]*)\)$/), line = el('div', 'stack-highlight');
            line.append(el('span', 'muted', t('stack')));
            if (match) { line.append(el('code', 'frame-method', match[1].split('.').slice(-2).join('.')), el('strong', 'frame-location', match[2])); }
            else line.append(el('code', 'frame-method', highlight.text));
            line.title = highlight.text; card.append(line);
        } else card.append(el('p', 'muted', thread.context.range ? t('noFrames') : t('noSource')));
        if (thread.lines.length) {
            const full = el('details', 'thread-stack'), summary = el('summary', '', `${t('full')} · ${t('lines')} ${thread.context.range.startLine}–${thread.context.range.endLine}`);
            const pre = el('pre', 'evidence', thread.lines.map(l => `${l.line}  ${l.text}`).join('\n'));
            full.append(summary, pre);
            if (thread.nextLine) {
                const more = button(t('more'), async () => {
                    more.disabled = true; more.textContent = t('loading');
                    try {
                        const result = await onNext(thread);
                        thread.lines.push(...result.lines); thread.nextLine = result.nextLine;
                        pre.textContent = thread.lines.map(l => `${l.line}  ${l.text}`).join('\n');
                        if (!thread.nextLine) more.remove();
                    } catch (e) { full.append(el('p', 'error', e.message)); }
                    finally { more.disabled = !canRead; more.textContent = t('more'); }
                }); more.disabled = !canRead; full.append(more);
            }
            card.append(full);
        }
        view.append(card);
    }
    if (data.snapshotDeadlockCycles) view.append(el('p', 'muted focus-related', `${data.snapshotDeadlockCycles} ${t('cycles')}.`));
    const info = el('details', 'coverage focus-information'); info.append(el('summary', '', `${t('info')} · v${version}`));
    for (const note of [t('checked'), t('frameNote'), t('host'), ...data.warnings, ...data.qualifications,
        `${t('timing')}: ${data.timing.readAndHashMs} / ${data.timing.toolWorkMs} ms`]) info.append(el('p', '', note));
    for (const thread of data.threads) info.append(el('p', '', `${thread.name}: CPU ${thread.cpu.status} (${thread.cpu.intervalMs ?? '—'} ms); ${t('allocation')} ${thread.allocation.status} (${thread.allocation.intervalMs ?? '—'} ms)`));
    view.append(info, el('footer', 'footer', t('local'))); return view;
}

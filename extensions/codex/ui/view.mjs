import { version } from '../package.json';
import { createBridge } from './bridge.mjs';
import { findingCopy, findingOverview } from './finding-copy.mjs';
import { createDeadlockGraph } from './deadlock-graph.mjs';
import { comparisonView } from './comparison.mjs';
import { groupFindings } from './finding-groups.mjs';
import { threadDetailsView } from './thread-details.mjs';
import { threadInventoryView } from './thread-inventory.mjs';
import { overviewThread } from '../src/stack-context.mjs';
import { overviewThreadView } from './overview-thread.mjs';
import { aiConclusionView } from './ai-conclusion.mjs';
import { compactReport } from './compact-report.mjs';
import { createReportSurface } from './report-surface.mjs';

const app = document.getElementById('app'), root = document.createElement('div');
root.className = 'analysis-content';
let focusedThreads = null;
let reportTimings = null;
let aiConclusion = null;
let overviewSourceKey = null;
let navigationEpoch = 0;
let report, snapshotIndex = 0, cycleIndex = 0, selection = null, activeView = 'snapshot', comparisonMetric = 'cpu', comparisonLimit = 8, locale = 'en', evidenceEpoch = 0, disposeGraph = () => {};
const copy = {
    en: { title: 'Thread analysis', critical: 'Critical', high: 'High', medium: 'Review', info: 'Information', neutral: 'No prioritized findings',
        records: 'Parsed thread records', javaStates: 'With Java state', prioritized: 'Prioritized findings',
        noFindings: 'No prioritized findings from the available evidence. This does not establish health.',
        conclusion: 'Snapshot conclusion', cycleConclusion: 'JVM-reported deadlock cycles', nextCapture: 'If symptoms persist, compare another capture and inspect the relevant thread stacks.',
        comparisonTitle: 'Snapshot comparison', compare: 'Compare snapshots', snapshotView: 'Snapshot details', cached: 'Cached analysis', context: 'Viewing snapshot', editorContext: 'Evidence inside this report follows the selected snapshot. A file opened from chat may show another snapshot.',
        example: 'Synthetic example · bundled Java deadlock', holding: 'Holds', unknownHolding: 'Not established in the matched thread block', moreLocks: 'additional reported locks',
        snapshots: 'Snapshots analyzed', cyclesCount: 'Cycles · selected snapshot', threadsCount: 'Matched deadlocked threads', files: 'Selected capture files', snapshot: 'Snapshot',
        graph: 'Deadlock dependencies', graphNote: 'Reported by the JVM · selected snapshot', cycle: 'Cycle', participants: 'participants',
        legend: 'Arrow: waiting thread → thread holding the named lock.', select: 'Select a thread to inspect its source evidence.',
        waiting: 'Waits for', heldBy: 'Held by', source: 'Source evidence', frame: 'Stack frame', viewLines: 'View source lines', pending: 'Checking source hash…', lines: 'Lines',
        evidenceUnavailable: 'Exact source lines are unavailable for this participant. Inspect its identity in the capture.',
        hostUnavailable: 'Interactive source tools are unavailable in this host. Ask for these source lines in the conversation.',
        noCycle: 'No JVM-reported deadlock in this snapshot', noCycleNote: 'This does not exclude contention or deadlocks outside the capture’s coverage.',
        action: 'Recommended next check', recommendation: 'Review the lock acquisition paths and make their ordering consistent. Validate the change against the affected code.',
        findings: 'Findings in this snapshot', relatedFinding: 'Related interpretation · same locks and waiting threads', relatedHint: 'Includes a possible bottleneck interpretation for the same locks.', details: 'Evidence and qualifications', coverage: 'Coverage and limitations',
        partial: 'Partial capture or parser warnings — review coverage before drawing conclusions.',
        truncated: 'This view contains a bounded subset. Counts include omitted items; inspect the capture for the remaining evidence.',
        graphLimited: 'Graph limited to the first 8 reported participants. Omitted or unresolved relationships are not drawn.',
        unmapped: 'Some participants or owners could not be matched. The JVM report is retained; missing edges are not inferred.',
        local: 'Parsed locally · results are shared with your AI host', information: 'Report information', timing: 'Read / analysis', workerTiming: 'Worker round trip, including read and analysis', reportTiming: 'Cached report preparation', uiTiming: 'Local UI construction', timingScope: 'These timings exclude AI reasoning and host display latency; local UI construction excludes layout and paint.', next: 'Next snapshots', previous: 'Previous snapshots',
        load: 'Loading…', locked: 'JVM-REPORTED DEADLOCK', confirmedTitle: 'Confirmed Java deadlock', noHost: 'This report needs an MCP Apps host. Ask for a concise text analysis if the component is unavailable.',
        viewRange: 'Displayed snapshots', noData: 'The host did not deliver the report data. Ask it to run analyze_thread_dumps, then render_thread_report in this session.',
        cycleHint: 'Cycle counts apply to this snapshot. Repeated observations are not counted as distinct incidents.',
        refreshed: 'Source hash matches the analyzed capture.', readMore: 'Next source lines', language: 'Report language', original: 'Original analyzer diagnostics (English)', originalFinding: 'Untranslated finding (English)', mappedParticipant: 'JVM-reported participant', unmappedParticipant: 'Unmatched participant', observed: 'Snapshots with reported cycles', originalCount: 'Reported participant entries'  },
    sv: { title: 'Trådanalys', critical: 'Kritisk', high: 'Hög', medium: 'Granska', info: 'Information', neutral: 'Inga prioriterade fynd',
        records: 'Inlästa trådposter', javaStates: 'Med Java-tillstånd', prioritized: 'Prioriterade fynd',
        noFindings: 'Inga prioriterade fynd utifrån tillgängligt underlag. Det bevisar inte att allt fungerar.',
        conclusion: 'Slutsats för denna snapshot', cycleConclusion: 'JVM-rapporterade deadlockcykler', nextCapture: 'Om symtomen kvarstår, jämför en ny dump och granska de berörda trådarnas stackar.',
        comparisonTitle: 'Jämför snapshots', compare: 'Jämför snapshots', snapshotView: 'Snapshotdetaljer', cached: 'Sparad analys', context: 'Visar snapshot', editorContext: 'Källbevis i rapporten följer vald snapshot. En fil öppnad från chatten kan visa en annan snapshot.',
        example: 'Syntetiskt exempel · medföljande Java-deadlock', holding: 'Håller', unknownHolding: 'Inte fastställt i det matchade trådblocket', moreLocks: 'ytterligare rapporterade lås',
        snapshots: 'Analyserade snapshots', cyclesCount: 'Cykler · vald snapshot', threadsCount: 'Matchade deadlock-trådar', files: 'Valda dumpfiler', snapshot: 'Snapshot',
        graph: 'Deadlock och låsberoenden', graphNote: 'Rapporterat av JVM · vald snapshot', cycle: 'Cykel', participants: 'deltagare',
        legend: 'Pil: väntande tråd → tråden som håller det angivna låset.', select: 'Välj en tråd för att granska källbevisen.',
        waiting: 'Väntar på', heldBy: 'Hålls av', source: 'Källbevis', frame: 'Stackram', viewLines: 'Visa källrader', pending: 'Kontrollerar källfilens hash…', lines: 'Rader',
        evidenceUnavailable: 'Exakta källrader saknas för deltagaren. Granska trådens identitet i dumpen.',
        hostUnavailable: 'Interaktiva källverktyg är inte tillgängliga här. Be om dessa källrader i konversationen.',
        noCycle: 'Ingen JVM-rapporterad deadlock i denna snapshot', noCycleNote: 'Det utesluter inte låskonkurrens eller deadlocks utanför dumpens täckning.',
        action: 'Rekommenderad nästa kontroll', recommendation: 'Granska kodvägarna som tar låsen och gör låsordningen konsekvent. Verifiera ändringen mot den berörda koden.',
        findings: 'Fynd i denna snapshot', relatedFinding: 'Relaterad tolkning · samma lås och väntande trådar', relatedHint: 'Innehåller en tolkning av möjlig flaskhals vid samma lås.', details: 'Bevis och reservationer', coverage: 'Täckning och begränsningar',
        partial: 'Ofullständigt underlag eller parservarningar — granska täckningen innan du drar slutsatser.',
        truncated: 'Vyn visar ett begränsat urval. Antalen omfattar även utelämnade poster; granska dumpen för resterande bevis.',
        graphLimited: 'Grafen visar högst 8 rapporterade deltagare. Utelämnade eller olösta relationer ritas inte ut.',
        unmapped: 'Vissa deltagare eller ägare kunde inte matchas. JVM-rapporten finns kvar; saknade pilar gissas inte.',
        local: 'Parsas lokalt · resultat delas med din AI-klient', information: 'Rapportinformation', timing: 'Läsning / analys', workerTiming: 'Workeranrop, inklusive läsning och analys', reportTiming: 'Förberedelse av sparad rapport', uiTiming: 'Lokal uppbyggnad av vyn', timingScope: 'Tiderna inkluderar inte AI-modellens arbete eller klientens visningsfördröjning; lokal uppbyggnad exkluderar layout och uppritning.', next: 'Nästa snapshots', previous: 'Föregående snapshots',
        load: 'Laddar…', locked: 'JVM-RAPPORTERAD DEADLOCK', confirmedTitle: 'Bekräftad Java-deadlock', noHost: 'Rapporten behöver en klient med MCP Apps-stöd. Be om en kort textanalys om komponenten inte kan visas.',
        viewRange: 'Visade snapshots', noData: 'Klienten skickade inga rapportdata. Be den köra analyze_thread_dumps och sedan render_thread_report i samma session.',
        cycleHint: 'Cykelantalet gäller vald snapshot. Upprepade observationer räknas inte som separata incidenter.',
        refreshed: 'Källfilens hash stämmer med den analyserade dumpen.', readMore: 'Nästa källrader', language: 'Rapportspråk', original: 'Originaldiagnostik från analysverktyget (engelska)', originalFinding: 'Ej översatt fynd (engelska)', mappedParticipant: 'JVM-rapporterad deltagare', unmappedParticipant: 'Ej matchad deltagare', observed: 'Snapshots med rapporterade cykler', originalCount: 'Rapporterade deltagarposter'  },
};
const t = key => copy[locale][key] || key;
const items = value => Array.isArray(value?.items) ? value.items : [];
const text = value => value == null ? '' : String(value);
function el(tag, className = '', value) { const node = document.createElement(tag); node.className = className; if (value != null) node.textContent = text(value); return node; }
function append(parent, ...children) { parent.append(...children.filter(Boolean)); return parent; }
function icon(kind = 'alert') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svg.namespaceURI, 'path');
    p.setAttribute('d', kind === 'brand' ? 'M4 5h6v6H4z M14 13h6v6h-6z M7 11v5h7 M10 8h7v5' : 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1');
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); svg.append(p); return svg;
}
function button(label, handler) { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', handler); return b; }
function badge(severity) { const type = ['critical', 'high', 'medium', 'info'].includes(severity) ? severity : 'neutral'; return append(el('span', `badge ${type}`), type !== 'neutral' ? icon() : null, el('span', '', t(type))); }
const current = () => items(report?.snapshots)[snapshotIndex];
function applyContext(context) {
    if (['light', 'dark'].includes(context.theme)) document.documentElement.dataset.theme = context.theme;
    document.documentElement.lang = locale;
    surface.context(context);
}
function receive(result) {
    reportTimings = result?._meta?.jvmscopeTimings || null;
    aiConclusion = result?._meta?.jvmscopeConclusion || null;
    const focused = result?._meta?.jvmscopeThreadDetails;
    if (focused?.view === 'threads' && Array.isArray(focused.threads) && focused.source) {
        if (['en', 'sv'].includes(result._meta.jvmscopeLanguage)) locale = result._meta.jvmscopeLanguage;
        document.documentElement.lang = locale; focusedThreads = focused; evidenceEpoch++;
        clearTimeout(dataDeadline); render(); return;
    }
    const candidate = result?._meta?.jvmscopeReport || result?.structuredContent;
    if (candidate?.analyzer !== 'threads' || !Array.isArray(candidate.snapshots?.items) || !Array.isArray(candidate.sources)) return;
    if (['en', 'sv'].includes(result?._meta?.jvmscopeLanguage)) locale = result._meta.jvmscopeLanguage;
    document.documentElement.lang = locale;
    const focus = result?._meta?.jvmscopeFocus;
    overviewSourceKey = focus?.sourceKey || null;
    report = candidate; focusedThreads = null;
    activeView = focus?.view || 'snapshot';
    snapshotIndex = Math.max(0, focus?.snapshotIndex != null ? items(report.snapshots).findIndex(s => s.index === focus.snapshotIndex)
        : items(report.snapshots).findIndex(s => s.deadlocks?.total));
    cycleIndex = 0; selection = null; evidenceEpoch++;
    if (focus?.sourceKey) {
        const cycles = items(current()?.deadlocks);
        const found = cycles.findIndex(c => items(c.participants).some(p => p.id === focus.sourceKey));
        if (found >= 0) { cycleIndex = found; selection = items(cycles[found].participants).find(p => p.id === focus.sourceKey); }
        else {
            const metric = current()?.measurements?.threads.items.find(t => t.sourceKey === focus.sourceKey);
            const listed = current()?.threadInventory?.items.find(t => t.sourceKey === focus.sourceKey);
            if (listed) selection = { id: listed.sourceKey, name: listed.name, evidence: listed.range };
            else if (metric) selection = { id: metric.sourceKey, name: metric.name, evidence: metric.current.range };
        }
    }
    clearTimeout(dataDeadline); render();
}
const bridge = createBridge({ onResult: receive, onContext: applyContext, onUnavailable() {
    const node = document.getElementById('loading'); if (node) node.textContent = t('noHost');
} });
function assessmentScope() {
    if (focusedThreads) return { view: 'threads', snapshots: [focusedThreads.snapshotIndex], sourceKeys: focusedThreads.threads.map(t => t.sourceKey).sort() };
    return { view: activeView, snapshots: activeView === 'comparison' ? report.snapshots.items.map(s => s.index) : [current()?.index],
        ...(activeView === 'snapshot' && overviewSourceKey ? { sourceKeys: selection ? [selection.id] : [] } : {}) };
}
const surface = createReportSurface({ container: app, analysis: root, bridge, locale: () => locale,
    compact: () => compactReport({ report, snapshot: current(), focused: focusedThreads, view: activeView,
        conclusion: aiConclusion, scope: assessmentScope(), locale,
        onLanguage(language) { locale = language; document.documentElement.lang = locale; render(); } }) });
const dataDeadline = setTimeout(() => { const node = document.getElementById('loading'); if (node) node.textContent = t('noData'); }, 12000);

// Responses may arrive out of order. Only the latest still-current user action
// may replace the view; a new host result or local render invalidates older work.
async function navigate(request) {
    const epoch = ++navigationEpoch, isCurrent = () => epoch === navigationEpoch;
    try {
        const result = await request(isCurrent);
        if (isCurrent()) receive(result);
    } catch (error) { if (isCurrent()) throw error; }
}
const navigateTool = (name, args) => navigate(() => bridge.callTool(name, args));

function drawGraph(cycle) {
    const graph = createDeadlockGraph({ participants: items(cycle.participants), selectedId: selection?.id,
        label: `${t('cycle')} ${cycle.id}: ${t('graph')}`, t, onSelect(p) {
            selection = p; render();
            [...root.querySelectorAll('.node')].find(node => node.dataset.participant === p.id)?.focus({ preventScroll: true });
            void showEvidence(p, p.evidence?.startLine);
        } });
    disposeGraph = graph.dispose; return graph.element;
}
function evidencePanel(p) {
    const panel = el('section', 'detail'); panel.id = 'detail';
    panel.append(el('h3', '', p.name));
    if (p.waitingLockId) panel.append(el('p', '', `${t('waiting')}: ${p.waitingLockType || ''} ${p.waitingLockId}`));
    if (p.ownerName) panel.append(el('p', '', `${t('heldBy')}: ${p.ownerName}`));
    if (p.topFrame) {
        const location = p.topFrame.match(/\(([^()\r\n]+\.java:\d+)\)$/)?.[1];
        if (location) {
            const summary = append(el('summary'), el('span', 'muted', `${t('frame')}: `), el('code', '', location));
            panel.append(append(el('details', 'stack-frame'), summary, el('code', 'frame', p.topFrame)));
        } else panel.append(el('code', 'frame', p.topFrame));
    }
    const source = report.sources.find(s => s.path === current().sourcePath);
    const location = `${t('snapshot')} ${current().index + 1} · ${source?.name || ''}${p.evidence ? ` · ${t('lines')} ${p.evidence.startLine}–${p.evidence.endLine}` : ''}`;
    append(panel, el('p', 'muted', location));
    const content = el('div'); content.id = 'source-content'; content.setAttribute('aria-live', 'polite');
    content.textContent = p.evidence ? (bridge.canCallTools ? '' : t('hostUnavailable')) : t('evidenceUnavailable');
    const label = p.evidence ? `${t('viewLines')} ${p.evidence.startLine}–${p.evidence.endLine}` : t('source');
    const read = button(label, () => showEvidence(p, p.evidence?.startLine)); read.disabled = !p.evidence || !bridge.canCallTools;
    append(panel, append(el('div', 'evidence-actions'), read), content); return panel;
}
async function showEvidence(p, startLine) {
    const container = document.getElementById('source-content');
    if (!container || !p.evidence || !bridge.canCallTools) return;
    const epoch = ++evidenceEpoch; container.replaceChildren(el('p', 'muted', t('pending')));
    const source = report.sources.find(s => s.path === current().sourcePath);
    const endLine = Math.min(p.evidence.endLine, startLine + 59);
    try {
        const response = await bridge.callTool('read_thread_evidence', { reportId: report.reportId, snapshotIndex: current().index, sourceKey: p.id, startLine });
        if (epoch !== evidenceEpoch || !root.contains(container)) return;
        const data = response.structuredContent;
        if (!data?.lines || data.source?.sha256 !== source.sha256 || data.context?.snapshotIndex !== current().index || data.context?.sourceKey !== p.id) throw new Error('The host returned mismatched source evidence.');
        container.replaceChildren(el('p', 'evidence-context muted', `${t('snapshot')} ${data.context.snapshotNumber} · ${source.name} · ${t('lines')} ${data.lines[0]?.line}–${data.lines.at(-1)?.line}`), el('p', 'muted', t('refreshed')), el('pre', 'evidence', data.lines.map(l => `${l.line}  ${l.text}`).join('\n')));
        if (endLine < p.evidence.endLine) container.append(button(t('readMore'), () => showEvidence(p, endLine + 1)));
    } catch (error) { if (epoch === evidenceEpoch && root.contains(container)) container.replaceChildren(el('p', 'error', error.message)); }
}
async function loadPage(offset, b) {
    b.disabled = true; b.textContent = t('load');
    const args = { reportId: report.reportId, language: locale, view: activeView, offset, limit: report.snapshots.limit || 10 };
    const paths = report.sources.map(s => s.path);
    try {
        await navigate(async isCurrent => {
            try { return await bridge.callTool('render_thread_report', args); }
            catch (error) {
                if (!isCurrent()) return;
                if (!error.message.startsWith('SNAPSHOTS_NOT_CACHED:')) throw error;
                const analysis = await bridge.callTool('analyze_thread_dumps', { paths, offset, limit: args.limit });
                if (!isCurrent()) return;
                return bridge.callTool('render_thread_report', { ...args, reportId: analysis.structuredContent.reportId });
            }
        });
    }
    catch (e) { b.disabled = false; b.textContent = e.message; }
}
function footer() {
    const information = append(el('details', 'report-information'), el('summary', '', `${t('information')} · v${version}`),
        el('p', '', t('editorContext')), el('p', '', `${t('timing')}: ${report.timing?.readMs ?? '—'} / ${report.timing?.analysisMs ?? '—'} ms`),
        el('p', '', `${t('workerTiming')}: ${report.timing?.workerRoundTripMs ?? '—'} ms`),
        el('p', '', `${t('reportTiming')}: ${reportTimings?.reportPreparationMs ?? '—'} ms`),
        el('p', 'ui-timing'), el('p', '', t('timingScope')));
    return append(el('footer', 'footer'), el('span', '', t('local')), information);
}
async function switchView(view, b) {
    if (view === activeView) return;
    if (!bridge.canCallTools) {
        if (view === 'comparison' && !canCompareLocally()) return;
        activeView = view; render(); return;
    }
    b.disabled = true;
    try { await navigateTool('render_thread_report', { reportId: report.reportId, language: locale, view,
        ...(view === 'comparison' ? { offset: 0, limit: 4 } : {
            snapshotIndex: current().index, offset: report.snapshots.offset, limit: report.snapshots.limit || 10 }) }); }
    catch (error) { b.disabled = false; b.textContent = error.message; }
}
const canCompareLocally = () => report.snapshots.offset === 0 && report.snapshots.items.length === report.snapshotCount && report.snapshotCount <= 4;
async function switchSnapshot(select) {
    const index = Number(select.value);
    if (!bridge.canCallTools) { snapshotIndex = index; cycleIndex = 0; selection = null; render(); return; }
    select.disabled = true;
    try { await navigateTool('render_thread_report', { reportId: report.reportId, language: locale, view: 'snapshot',
        snapshotIndex: report.snapshots.items[index].index, offset: report.snapshots.offset, limit: report.snapshots.limit || 10 }); }
    catch (error) { select.disabled = false; select.value = snapshotIndex; root.append(el('p', 'error', error.message)); }
}
async function comparisonEvidence(endpoint, content) {
    const epoch = ++evidenceEpoch;
    const response = await bridge.callTool('read_thread_evidence', { reportId: report.reportId,
        snapshotIndex: endpoint.snapshotIndex, sourceKey: endpoint.sourceKey });
    if (epoch !== evidenceEpoch || !root.contains(content)) return;
    const data = response.structuredContent;
    if (data.context?.snapshotIndex !== endpoint.snapshotIndex || data.context?.sourceKey !== endpoint.sourceKey || data.source?.sha256 !== endpoint.sha256)
        throw new Error('The host returned mismatched source evidence.');
    content.replaceChildren(el('p', 'evidence-context muted', `${t('snapshot')} ${data.context.snapshotNumber} · ${data.context.name} · ${t('lines')} ${data.lines[0]?.line}–${data.lines.at(-1)?.line}`),
        el('pre', 'evidence', data.lines.map(l => `${l.line}  ${l.text}`).join('\n')));
    if (data.nextLine) content.append(el('p', 'note', t('truncated')));
}
async function focusSnapshot(endpoint) {
    try { await navigateTool('inspect_thread_details', { reportId: report.reportId, language: locale,
        snapshotIndex: endpoint.snapshotIndex, sourceKeys: [endpoint.sourceKey] }); }
    catch (error) { root.append(el('p', 'error', error.message)); }
}
function findingCard(f, related = []) {
    const card = el('article', 'finding'), translated = findingCopy(f, locale);
    card.dataset.finding = f.id;
    const title = el('span', 'finding-title', translated.title); title.setAttribute('role', 'heading'); title.setAttribute('aria-level', '3');
    const summary = append(el('summary', 'finding-summary'), append(el('span', 'finding-top'), badge(f.severity), title), el('span', 'finding-overview', findingOverview(f, locale)));
    const details = append(el('details', 'finding-disclosure'), summary);
    if (translated.original) details.append(el('p', 'muted', t('originalFinding')));
    append(details, el('p', 'finding-description', translated.summary), el('p', '', translated.qualification));
    if (f.id !== 'confirmed-deadlock') details.append(el('p', 'finding-action', translated.recommendation));
    details.append(el('p', 'muted', t('original')));
    append(details, el('p', '', `${f.evidence?.label || ''}: ${f.qualification || f.evidence?.qualification || ''}`));
    for (const fact of items(f.facts)) details.append(el('p', '', `${fact.label}: ${fact.value}`));
    const sourceButtons = el('div', 'evidence-actions');
    for (const thread of items(f.threads)) {
        if (!thread.startLine) continue;
        sourceButtons.append(button(`${t('source')}: ${thread.name}`, () => {
            selection = { id: thread.sourceKey, name: thread.name, evidence: { startLine: thread.startLine, endLine: thread.endLine } };
            const old = document.getElementById('detail'); if (old) old.remove();
            details.append(evidencePanel(selection)); void showEvidence(selection, thread.startLine);
        }));
    }
    if ([f.threads, f.facts, f.resourceIds].some(p => p?.nextOffset != null)) details.append(el('p', 'note', t('truncated')));
    if (sourceButtons.childElementCount) details.append(sourceButtons);
    if (related.length) {
        summary.append(el('span', 'related-hint', t('relatedHint')));
        const section = append(el('section', 'related-findings'), el('p', 'related-label', t('relatedFinding')));
        for (const interpretation of related) section.append(findingCard(interpretation));
        details.append(section);
    }
    append(card, details); return card;
}
function render() {
    navigationEpoch++;
    const started = performance.now();
    renderContent();
    surface.update();
    const timing = root.querySelector('.ui-timing');
    if (timing) timing.textContent = `${t('uiTiming')}: ${(performance.now() - started).toFixed(2)} ms`;
}
function renderContent() {
    disposeGraph();
    if (focusedThreads) {
        const data = focusedThreads;
        root.replaceChildren(threadDetailsView({ data, locale, version, conclusion: aiConclusion, canRead: bridge.canCallTools,
            onLanguage(language) { locale = language; document.documentElement.lang = locale; render(); },
            async onNavigate(view) { await navigateTool('render_thread_report', { reportId: data.reportId, language: locale, view,
                ...(view === 'comparison' ? { offset: 0, limit: 4 } : { snapshotIndex: data.snapshotIndex, limit: 1 }) }); },
            async onNext(thread) {
                const response = await bridge.callTool('read_thread_evidence', { reportId: data.reportId, snapshotIndex: data.snapshotIndex,
                    sourceKey: thread.sourceKey, startLine: thread.nextLine });
                const result = response.structuredContent;
                if (result.context?.sourceKey !== thread.sourceKey || result.context?.snapshotIndex !== data.snapshotIndex || result.source?.sha256 !== data.source.sha256)
                    throw new Error('The host returned mismatched source evidence.');
                return result;
            } })); return;
    }
    const snapshot = current();
    if (!snapshot) {
        const back = button(t('previous'), () => loadPage(0, back)); back.disabled = !bridge.canCallTools;
        root.replaceChildren(append(el('div', 'empty'), el('h1', '', t('title')), el('p', '', t('noData')), back)); return;
    }
    evidenceEpoch++;
    root.replaceChildren();
    const counts = snapshot.analysis?.counts || {};
    const severity = ['critical', 'high', 'medium', 'info'].find(s => counts[s]) || 'neutral';
    const heading = append(el('div'), append(el('div', 'brand'), icon('brand'), el('span', 'eyebrow', 'JVMSCOPE / JAVA DIAGNOSTICS')),
        el('h1', '', t(activeView === 'comparison' ? 'comparisonTitle' : 'title')), activeView !== 'comparison' ? el('p', 'muted', `${t('files')}: ${report.sources.length} · Snapshots: ${report.snapshotCount}`) : null);
    const language = el('select'); language.setAttribute('aria-label', t('language'));
    for (const [value, label] of [['en', 'English'], ['sv', 'Svenska']]) { const option = el('option', '', label); option.value = value; language.append(option); }
    language.value = locale; language.addEventListener('change', () => { locale = language.value; document.documentElement.lang = locale; render(); });
    append(root, append(el('header', 'header'), heading, append(el('div', 'header-actions'), badge(severity), language)));
    const assessment = aiConclusionView({ conclusion: aiConclusion, reportId: report.reportId, locale, scope: assessmentScope() });
    if (assessment) root.append(assessment);
    if (report.example?.synthetic) root.append(el('p', 'example-label muted', t('example')));
    if (report.snapshotCount > 1) {
        const tabs = el('nav', 'view-tabs'); tabs.setAttribute('aria-label', t('title'));
        for (const [view, label] of [['snapshot', t('snapshotView')], ['comparison', t('compare')]]) {
            const b = button(label, () => switchView(view, b)); b.setAttribute('aria-pressed', String(activeView === view));
            b.disabled = !bridge.canCallTools && view === 'comparison' && !canCompareLocally(); tabs.append(b);
        }
        root.append(tabs);
    }
    if (activeView === 'comparison') {
        root.append(comparisonView({ report, locale, metric: comparisonMetric, rowLimit: comparisonLimit, canRead: bridge.canCallTools,
            onMetric(metric) { comparisonMetric = metric; comparisonLimit = 8; render(); }, onMore() { comparisonLimit += 8; render(); },
            onEvidence: comparisonEvidence, onSnapshot: focusSnapshot }));
        const navigation = el('div', 'toolbar');
        for (const [offset, label] of [[report.snapshots.offset > 0 ? Math.max(0, report.snapshots.offset - report.snapshots.limit) : null, t('previous')], [report.snapshots.nextOffset, t('next')]]) {
            if (offset == null) continue; const b = button(label, () => loadPage(offset, b)); b.disabled = !bridge.canCallTools; navigation.append(b);
        }
        root.append(navigation, footer()); return;
    }
    const stats = el('div', 'summary');
    const deadlock = snapshot.analysis?.deadlockSummary;
    const focus = overviewThread(snapshot, selection?.id);
    const conclusion = el('section', 'snapshot-conclusion');
    conclusion.setAttribute('aria-label', t('conclusion'));
    conclusion.append(el('span', 'muted', `${assessment ? (locale === 'sv' ? 'Analysunderlag' : 'Analysis evidence') : t('conclusion')} · ${snapshot.index + 1} / ${report.snapshotCount}`));
    if (!assessment || snapshot.deadlocks?.total)
        conclusion.append(el('h2', '', snapshot.deadlocks?.total ? `${snapshot.deadlocks.total} ${t('cycleConclusion')}` : t('noCycle')));
    if (report.status === 'partial' || report.warnings?.length) conclusion.append(el('p', 'note', t('partial')));
    const firstFinding = items(snapshot.analysis?.findings)[0];
    if (!assessment) {
        if (snapshot.deadlocks?.total) conclusion.append(el('p', '', t('recommendation')));
        else if (firstFinding) conclusion.append(el('p', '', findingOverview(firstFinding, locale)), el('p', 'muted', t('noCycleNote')));
        else conclusion.append(el('p', 'no-findings', t('noFindings')));
    }
    if (focus && !snapshot.deadlocks?.total) conclusion.append(overviewThreadView({ focus, locale, canRead: bridge.canCallTools,
        showNextCheck: !assessment, concise: !!assessment,
        async onOpen(sourceKey) { await navigateTool('inspect_thread_details', { reportId: report.reportId, language: locale,
            snapshotIndex: snapshot.index, sourceKeys: [sourceKey] }); } }));
    else if (!assessment && !snapshot.deadlocks?.total && !firstFinding) conclusion.append(el('p', 'muted', t('nextCapture')));
    if (!assessment || focus || snapshot.deadlocks?.total || report.status === 'partial' || report.warnings?.length) root.append(conclusion);
    const cards = snapshot.deadlocks?.total
        ? [[deadlock?.cycles ?? snapshot.deadlocks.total, t('cyclesCount'), true], [deadlock?.matchedThreads ?? '—', t('threadsCount')], [report.snapshotCount, t('snapshots')]]
        : [[snapshot.threadCount, t('records')], [snapshot.threadSummary?.withJavaState ?? '—', t('javaStates')], [snapshot.analysis?.findings.total ?? 0, t('prioritized')]];
    for (const [value, label, alert] of cards)
        stats.append(append(el('div', `stat${alert ? ' alert' : ''}`), el('strong', '', value), el('span', '', label)));
    root.append(stats);
    if (report.snapshotCount > 1 && report.deadlockObservations) root.append(el('p', 'muted observation', `${t('observed')}: ${report.deadlockObservations.snapshotsWithCycles}/${report.snapshotCount}. ${t('cycleHint')}`));
    if (deadlock && deadlock.reportedParticipants !== deadlock.matchedThreads) root.append(el('p', 'note', `${t('originalCount')}: ${deadlock.reportedParticipants} · ${t('threadsCount')}: ${deadlock.matchedThreads}`));
    if (report.snapshotCount > 1) {
    const toolbar = el('div', 'toolbar'), select = el('select'); select.setAttribute('aria-label', t('snapshot'));
    items(report.snapshots).forEach((s, i) => { const source = report.sources.find(c => c.path === s.sourcePath); const o = el('option', '', `${s.index + 1} · ${source?.name || s.sourcePath}`); o.value = i; select.append(o); });
    select.value = snapshotIndex; select.addEventListener('change', () => { void switchSnapshot(select); });
    toolbar.append(append(el('label', '', t('snapshot')), select));
    if (report.snapshots.offset) { const b = button(t('previous'), () => loadPage(Math.max(0, report.snapshots.offset - (report.snapshots.limit || 10)), b)); b.disabled = !bridge.canCallTools; toolbar.append(b); }
    if (report.snapshots.nextOffset != null) { const b = button(t('next'), () => loadPage(report.snapshots.nextOffset, b)); b.disabled = !bridge.canCallTools; toolbar.append(b); }
    root.append(toolbar);
    }
    if (report.snapshots.total > items(report.snapshots).length) root.append(el('p', 'muted', `${t('viewRange')}: ${report.snapshots.offset + 1}–${report.snapshots.offset + items(report.snapshots).length} / ${report.snapshots.total}`));
    const src = report.sources.find(s => s.path === snapshot.sourcePath);
    const context = el('div', 'snapshot-context');
    context.append(el('strong', '', `${t('context')} ${snapshot.index + 1} / ${report.snapshotCount}`));
    const filename = el('p', 'filename', src?.name || snapshot.sourcePath); filename.title = snapshot.sourcePath;
    context.append(filename); root.append(context);
    const cycles = items(snapshot.deadlocks), panel = el('section', 'panel');
    if (cycles.length) {
        const cycle = cycles[cycleIndex] || cycles[0];
        const head = append(el('div', 'panel-head'), append(el('div'), el('h2', '', t('graph')), el('p', 'muted', `${t('graphNote')} ${snapshot.index + 1}`)));
        if (cycles.length > 1) {
            const chooser = el('select'); chooser.setAttribute('aria-label', t('cycle'));
            cycles.forEach((c, i) => { const o = el('option', '', `${t('cycle')} ${c.id} · ${c.participants.total} ${t('participants')}`); o.value = i; chooser.append(o); });
            chooser.value = cycleIndex; chooser.addEventListener('change', () => { cycleIndex = Number(chooser.value); selection = null; render(); }); head.append(chooser);
        }
        append(panel, head, drawGraph(cycle), el('p', 'legend', `${t('legend')} ${t('select')}`));
        if (cycle.participants.total > 8) panel.append(el('p', 'note', t('graphLimited')));
        if (items(cycle.participants).some(p => p.mappingStatus !== 'resolved' || p.ownerMappingStatus !== 'resolved')) panel.append(el('p', 'note', t('unmapped')));
        if (snapshot.deadlocks.nextOffset != null || cycle.participants.nextOffset != null) panel.append(el('p', 'note', t('truncated')));
        if (selection && items(cycle.participants).some(p => p.id === selection.id)) panel.append(evidencePanel(selection));
        root.append(panel);
    }
    if (selection && !cycles.some(c => items(c.participants).some(p => p.id === selection.id))) {
        if (focus && cycles.length) root.append(overviewThreadView({ focus, locale, canRead: bridge.canCallTools,
            async onOpen(sourceKey) { await navigateTool('inspect_thread_details', { reportId: report.reportId, language: locale,
                snapshotIndex: snapshot.index, sourceKeys: [sourceKey] }); } }));
        else if (!focus) root.append(evidencePanel(selection));
    }
    const findings = el('section', 'findings');
    if (snapshot.analysis?.findings.total) findings.append(el('h2', '', t('findings')));
    for (const { finding, related } of groupFindings(items(snapshot.analysis?.findings))) findings.append(findingCard(finding, related));
    if (snapshot.analysis?.findings?.nextOffset != null) findings.append(el('p', 'note', t('truncated')));
    if (snapshot.analysis?.findings.total) root.append(findings);
    root.append(threadInventoryView({ snapshot, snapshotCount: report.snapshotCount, locale, canRead: bridge.canCallTools,
        async onOpen(endpoint) { await navigateTool('inspect_thread_details', { reportId: report.reportId, language: locale,
            snapshotIndex: endpoint.snapshotIndex, sourceKeys: [endpoint.sourceKey] }); } }));
    const limitations = append(el('details', 'coverage'), el('summary', '', t('coverage'))), list = el('ul');
    for (const warning of [...(report.warnings || []), ...(snapshot.analysis?.limitations || []), ...(report.limitations || [])]) list.append(el('li', '', warning));
    for (const s of report.sourceResults || []) if (!s.accepted) list.append(el('li', '', `Rejected input: ${s.name || s.label || s.sourceId}`));
    limitations.append(el('p', 'muted', t('original')), list); root.append(limitations);
    root.append(footer());
}
void bridge.initialize();


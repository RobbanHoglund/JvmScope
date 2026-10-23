import { createBridge } from './bridge.mjs';

const root = document.getElementById('app');
let report, snapshotIndex = 0, cycleIndex = 0, selection = null, locale = navigator.language?.startsWith('sv') ? 'sv' : 'en', evidenceEpoch = 0;
const copy = {
    en: { title: 'Thread analysis', critical: 'Critical', high: 'High', medium: 'Review', info: 'Information', neutral: 'No prioritized findings',
        snapshots: 'Snapshots in this analysis', criticalCount: 'Critical findings · all snapshots', files: 'Selected capture files', snapshot: 'Snapshot',
        graph: 'Deadlock dependencies', graphNote: 'Reported by the JVM · selected snapshot', cycle: 'Cycle', participants: 'reported participants',
        legend: 'Arrow: waiting thread → thread holding the named lock.', select: 'Select a thread to inspect its source evidence.',
        waiting: 'Waits for', heldBy: 'Held by', source: 'Source evidence', pending: 'Checking source hash…', lines: 'Lines',
        evidenceUnavailable: 'Exact source lines are unavailable for this participant. Inspect its identity in the capture.',
        hostUnavailable: 'Interactive source tools are unavailable in this host. Ask for these source lines in the conversation.',
        noCycle: 'No JVM-reported deadlock in this snapshot', noCycleNote: 'This does not exclude contention or deadlocks outside the capture’s coverage.',
        action: 'Recommended next check', recommendation: 'Review the lock acquisition paths and make their ordering consistent. Validate the change against the affected code.',
        findings: 'Findings in this snapshot', details: 'Evidence and qualifications', coverage: 'Coverage and limitations',
        partial: 'Partial capture or parser warnings — review coverage before drawing conclusions.',
        truncated: 'This view contains a bounded subset. Counts include omitted items; inspect the capture for the remaining evidence.',
        graphLimited: 'Graph limited to the first 8 reported participants. Omitted or unresolved relationships are not drawn.',
        unmapped: 'Some participants or owners could not be matched. The JVM report is retained; missing edges are not inferred.',
        local: 'Parsed locally · results are shared with your AI host', timing: 'Read / analysis', next: 'Next snapshots', previous: 'Previous snapshots',
        load: 'Loading…', locked: 'JVM-REPORTED DEADLOCK', confirmedTitle: 'Confirmed Java deadlock', noHost: 'This report needs an MCP Apps host. Ask for a concise text analysis if the component is unavailable.',
        viewRange: 'Displayed snapshots', noData: 'The host did not deliver the report data. Ask it to run analyze_thread_dumps, then render_thread_report in this session.',
        cycleHint: 'Cycle counts apply to this snapshot. Repeated observations are not counted as distinct incidents.',
        refreshed: 'Source hash matches the analyzed capture.', readMore: 'Next source lines' },
    sv: { title: 'Trådanalys', critical: 'Kritisk', high: 'Hög', medium: 'Granska', info: 'Information', neutral: 'Inga prioriterade fynd',
        snapshots: 'Snapshots i analysen', criticalCount: 'Kritiska fynd · alla snapshots', files: 'Valda dumpfiler', snapshot: 'Snapshot',
        graph: 'Deadlock och låsberoenden', graphNote: 'Rapporterat av JVM · vald snapshot', cycle: 'Cykel', participants: 'rapporterade deltagare',
        legend: 'Pil: väntande tråd → tråden som håller det angivna låset.', select: 'Välj en tråd för att granska källbevisen.',
        waiting: 'Väntar på', heldBy: 'Hålls av', source: 'Källbevis', pending: 'Kontrollerar källfilens hash…', lines: 'Rader',
        evidenceUnavailable: 'Exakta källrader saknas för deltagaren. Granska trådens identitet i dumpen.',
        hostUnavailable: 'Interaktiva källverktyg är inte tillgängliga här. Be om dessa källrader i konversationen.',
        noCycle: 'Ingen JVM-rapporterad deadlock i denna snapshot', noCycleNote: 'Det utesluter inte låskonkurrens eller deadlocks utanför dumpens täckning.',
        action: 'Rekommenderad nästa kontroll', recommendation: 'Granska kodvägarna som tar låsen och gör låsordningen konsekvent. Verifiera ändringen mot den berörda koden.',
        findings: 'Fynd i denna snapshot', details: 'Bevis och reservationer', coverage: 'Täckning och begränsningar',
        partial: 'Ofullständigt underlag eller parservarningar — granska täckningen innan du drar slutsatser.',
        truncated: 'Vyn visar ett begränsat urval. Antalen omfattar även utelämnade poster; granska dumpen för resterande bevis.',
        graphLimited: 'Grafen visar högst 8 rapporterade deltagare. Utelämnade eller olösta relationer ritas inte ut.',
        unmapped: 'Vissa deltagare eller ägare kunde inte matchas. JVM-rapporten finns kvar; saknade pilar gissas inte.',
        local: 'Parsas lokalt · resultat delas med din AI-klient', timing: 'Läsning / analys', next: 'Nästa snapshots', previous: 'Föregående snapshots',
        load: 'Laddar…', locked: 'JVM-RAPPORTERAD DEADLOCK', confirmedTitle: 'Bekräftad Java-deadlock', noHost: 'Rapporten behöver en klient med MCP Apps-stöd. Be om en kort textanalys om komponenten inte kan visas.',
        viewRange: 'Visade snapshots', noData: 'Klienten skickade inga rapportdata. Be den köra analyze_thread_dumps och sedan render_thread_report i samma session.',
        cycleHint: 'Cykelantalet gäller vald snapshot. Upprepade observationer räknas inte som separata incidenter.',
        refreshed: 'Källfilens hash stämmer med den analyserade dumpen.', readMore: 'Nästa källrader' },
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
    if (context.locale) locale = context.locale.startsWith('sv') ? 'sv' : 'en';
    document.documentElement.lang = locale;
    if (report) render();
}
function receive(result) {
    const candidate = result?._meta?.jvmscopeReport || result?.structuredContent;
    if (candidate?.analyzer !== 'threads' || !Array.isArray(candidate.snapshots?.items) || !Array.isArray(candidate.sources)) return;
    report = candidate; snapshotIndex = Math.max(0, items(report.snapshots).findIndex(s => s.deadlocks?.total)); cycleIndex = 0; selection = null; evidenceEpoch++;
    clearTimeout(dataDeadline); render();
}
const bridge = createBridge({ onResult: receive, onContext: applyContext, onUnavailable() {
    const node = document.getElementById('loading'); if (node) node.textContent = t('noHost');
} });
const dataDeadline = setTimeout(() => { const node = document.getElementById('loading'); if (node) node.textContent = t('noData'); }, 12000);

function svgEl(tag, attrs = {}, value) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, text(val));
    if (value != null) node.textContent = text(value);
    return node;
}
function short(value, length = 25) { const v = text(value); return v.length > length ? `${v.slice(0, length - 1)}…` : v; }
function drawGraph(cycle) {
    const participants = items(cycle.participants).slice(0, 8);
    const graph = el('div', 'graph');
    const narrow = window.innerWidth <= 540;
    if (narrow && participants.length > 2) {
        const rows = el('div', 'compact-graph');
        for (const p of participants) rows.append(button(`${p.name} → ${p.ownerName || '?'}\n${t('waiting')}: ${p.waitingLockType || p.waitingLockId}`, () => {
            selection = p; render(); void showEvidence(p, p.evidence?.startLine);
        }));
        graph.append(rows); return graph;
    }
    const svg = svgEl('svg', { viewBox: narrow ? '0 0 360 400' : participants.length === 2 ? '0 35 860 320' : '0 0 860 390', role: 'group', 'aria-label': `${t('cycle')} ${cycle.id}: ${t('graph')}` });
    const defs = svgEl('defs'); const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgEl('path', { d: 'M0 0 10 5 0 10z', fill: 'var(--critical)' })); defs.append(marker); svg.append(defs);
    const positions = new Map(participants.map((p, i) => {
        if (narrow) return [p.id, { x: 180, y: 70 + i * 260 }];
        const angle = participants.length === 2 ? i * Math.PI : -Math.PI / 2 + i * Math.PI * 2 / participants.length;
        return [p.id, { x: 430 + Math.cos(angle) * 290, y: 195 + Math.sin(angle) * 140 }];
    }));
    for (const p of participants) {
        const a = positions.get(p.id), b = positions.get(p.ownerId);
        if (!b || p.ownerMappingStatus !== 'resolved' || p.mappingStatus !== 'resolved') continue;
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (!len) continue;
        const ux = dx / len, uy = dy / len;
        const radius = Math.min(98 / Math.max(.001, Math.abs(ux)), 40 / Math.max(.001, Math.abs(uy)));
        const start = narrow ? { x: a.x + uy * 94, y: a.y } : participants.length === 2 ? { x: a.x + ux * 20, y: a.y + ux * 34 } : { x: a.x + ux * radius, y: a.y + uy * radius };
        const end = narrow ? { x: b.x + uy * 94, y: b.y } : participants.length === 2 ? { x: b.x - ux * 20, y: b.y + ux * 34 } : { x: b.x - ux * radius, y: b.y - uy * radius };
        const bend = participants.length === 2 ? 115 : 28;
        const cx = narrow ? 180 + uy * 170 : (a.x + b.x) / 2 - uy * bend, cy = narrow ? 200 : (a.y + b.y) / 2 + ux * bend;
        const edge = svgEl('path', { d: `M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`, class: 'edge', 'marker-end': 'url(#arrow)' });
        edge.append(svgEl('title', {}, `${p.name} → ${p.ownerName}: ${p.waitingLockType} ${p.waitingLockId}`)); svg.append(edge);
        const labelX = (start.x + 2 * cx + end.x) / 4, labelY = (start.y + 2 * cy + end.y) / 4 - (narrow ? 0 : 9);
        const label = svgEl('text', { x: labelX, y: labelY, class: 'graph-label', 'text-anchor': 'middle', ...(narrow ? { transform: `rotate(${uy * 90} ${labelX} ${labelY})` } : {}) }, short(p.waitingLockType?.replace(/^a\s+/, ''), 28));
        label.append(svgEl('title', {}, p.waitingLockId)); svg.append(label);
    }
    svg.append(svgEl('text', { x: narrow ? 180 : 430, y: 190, 'text-anchor': 'middle', class: 'graph-center' }, t('locked')));
    svg.append(svgEl('text', { x: narrow ? 180 : 430, y: 212, 'text-anchor': 'middle', class: 'graph-center' }, `${cycle.participants.total} ${t('participants')}`));
    for (const p of participants) {
        const { x, y } = positions.get(p.id);
        const group = svgEl('g', { class: `node${selection?.id === p.id ? ' selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${p.name}. ${t('waiting')} ${p.waitingLockType}. ${t('source')}` });
        group.append(svgEl('rect', { x: x - 90, y: y - 32, width: 180, height: 64, rx: 11 }));
        group.append(svgEl('text', { x, y: y - 2, 'text-anchor': 'middle' }, short(p.name, 21)));
        group.append(svgEl('text', { x, y: y + 17, 'text-anchor': 'middle', class: 'node-state' }, p.mappingStatus === 'resolved' ? 'JVM participant' : 'Unresolved participant'));
        group.append(svgEl('title', {}, `${p.name}\n${p.topFrame || ''}`));
        const choose = () => { selection = p; render(); void showEvidence(p, p.evidence?.startLine); };
        group.addEventListener('click', choose);
        group.addEventListener('keydown', e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); choose(); } });
        svg.append(group);
    }
    graph.append(svg); return graph;
}
function evidencePanel(p) {
    const panel = el('section', 'detail'); panel.id = 'detail';
    append(panel, el('h3', '', p.name), el('p', '', `${t('waiting')}: ${p.waitingLockType || ''} ${p.waitingLockId || ''}`),
        el('p', '', `${t('heldBy')}: ${p.ownerName || '—'}`), el('code', 'frame', p.topFrame));
    const source = report.sources.find(s => s.path === current().sourcePath);
    const location = `${source?.name || ''}${p.evidence ? ` · ${t('lines')} ${p.evidence.startLine}–${p.evidence.endLine}` : ''}`;
    append(panel, el('p', 'muted', location));
    const content = el('div'); content.id = 'source-content'; content.setAttribute('aria-live', 'polite');
    content.textContent = p.evidence ? (bridge.canCallTools ? t('select') : t('hostUnavailable')) : t('evidenceUnavailable');
    const read = button(t('source'), () => showEvidence(p, p.evidence?.startLine)); read.disabled = !p.evidence || !bridge.canCallTools;
    append(panel, append(el('div', 'evidence-actions'), read), content); return panel;
}
async function showEvidence(p, startLine) {
    const container = document.getElementById('source-content');
    if (!container || !p.evidence || !bridge.canCallTools) return;
    const epoch = ++evidenceEpoch; container.replaceChildren(el('p', 'muted', t('pending')));
    const source = report.sources.find(s => s.path === current().sourcePath);
    const endLine = Math.min(p.evidence.endLine, startLine + 59);
    try {
        const response = await bridge.callTool('read_capture_lines', { path: source.path, sha256: source.sha256, startLine, endLine });
        if (epoch !== evidenceEpoch || !container.isConnected) return;
        const data = response.structuredContent;
        if (!data?.lines || data.source?.sha256 !== source.sha256) throw new Error('The host returned mismatched source evidence.');
        container.replaceChildren(el('p', 'muted', t('refreshed')), el('pre', 'evidence', data.lines.map(l => `${l.line}  ${l.text}`).join('\n')));
        if (endLine < p.evidence.endLine) container.append(button(t('readMore'), () => showEvidence(p, endLine + 1)));
    } catch (error) { if (epoch === evidenceEpoch && container.isConnected) container.replaceChildren(el('p', 'error', error.message)); }
}
async function loadPage(offset, b) {
    b.disabled = true; b.textContent = t('load');
    try { receive(await bridge.callTool('analyze_thread_dumps', { paths: report.sources.map(s => s.path), offset, limit: report.snapshots.limit || 10 })); }
    catch (e) { b.disabled = false; b.textContent = e.message; }
}
function render() {
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
        el('h1', '', t('title')), el('p', 'muted', `${t('files')}: ${report.sources.length} · Snapshots: ${report.snapshotCount}`));
    append(root, append(el('header', 'header'), heading, badge(severity)));
    const stats = el('div', 'summary');
    for (const [value, label, alert] of [[report.findingCounts?.critical || 0, t('criticalCount'), !!report.findingCounts?.critical], [report.snapshotCount, t('snapshots')], [snapshot.deadlocks?.total || 0, `${t('cycle')} · ${t('snapshot').toLowerCase()} ${snapshot.index + 1}`]])
        stats.append(append(el('div', `stat${alert ? ' alert' : ''}`), el('strong', '', value), el('span', '', label)));
    root.append(stats);
    const toolbar = el('div', 'toolbar'), select = el('select'); select.setAttribute('aria-label', t('snapshot'));
    items(report.snapshots).forEach((s, i) => { const source = report.sources.find(c => c.path === s.sourcePath); const o = el('option', '', `${s.index + 1} · ${source?.name || s.sourcePath}`); o.value = i; select.append(o); });
    select.value = snapshotIndex; select.addEventListener('change', () => { snapshotIndex = Number(select.value); cycleIndex = 0; selection = null; render(); });
    toolbar.append(append(el('label', '', t('snapshot')), select));
    if (report.snapshots.offset) { const b = button(t('previous'), () => loadPage(Math.max(0, report.snapshots.offset - (report.snapshots.limit || 10)), b)); b.disabled = !bridge.canCallTools; toolbar.append(b); }
    if (report.snapshots.nextOffset != null) { const b = button(t('next'), () => loadPage(report.snapshots.nextOffset, b)); b.disabled = !bridge.canCallTools; toolbar.append(b); }
    root.append(toolbar);
    if (report.snapshots.total > items(report.snapshots).length) root.append(el('p', 'muted', `${t('viewRange')}: ${report.snapshots.offset + 1}–${report.snapshots.offset + items(report.snapshots).length} / ${report.snapshots.total}`));
    const src = report.sources.find(s => s.path === snapshot.sourcePath);
    const filename = el('p', 'filename', src?.name || snapshot.sourcePath); filename.title = snapshot.sourcePath; root.append(filename);
    if (report.status === 'partial' || report.warnings?.length) root.append(el('p', 'note', t('partial')));
    const cycles = items(snapshot.deadlocks), panel = el('section', 'panel');
    if (cycles.length) {
        const cycle = cycles[cycleIndex] || cycles[0];
        const head = append(el('div', 'panel-head'), append(el('div'), el('h2', '', t('graph')), el('p', 'muted', t('graphNote'))));
        if (cycles.length > 1) {
            const chooser = el('select'); chooser.setAttribute('aria-label', t('cycle'));
            cycles.forEach((c, i) => { const o = el('option', '', `${t('cycle')} ${c.id} · ${c.participants.total} ${t('participants')}`); o.value = i; chooser.append(o); });
            chooser.value = cycleIndex; chooser.addEventListener('change', () => { cycleIndex = Number(chooser.value); selection = null; render(); }); head.append(chooser);
        }
        append(panel, head, drawGraph(cycle), el('p', 'legend', `${t('legend')} ${t('select')}`));
        const relationships = el('div', 'relations');
        for (const p of items(cycle.participants)) relationships.append(button(`${p.name} → ${p.ownerName || '?'}`, () => { selection = p; render(); void showEvidence(p, p.evidence?.startLine); }));
        panel.append(relationships);
        if (cycle.participants.total > 8) panel.append(el('p', 'note', t('graphLimited')));
        if (items(cycle.participants).some(p => p.mappingStatus !== 'resolved' || p.ownerMappingStatus !== 'resolved')) panel.append(el('p', 'note', t('unmapped')));
        if (snapshot.deadlocks.nextOffset != null || cycle.participants.nextOffset != null) panel.append(el('p', 'note', t('truncated')));
        if (selection) panel.append(evidencePanel(selection));
        append(root, panel, el('p', 'muted', t('cycleHint')), append(el('div', 'action'), el('h3', '', t('action')), el('p', '', t('recommendation'))));
    } else root.append(append(panel, append(el('div', 'no-cycle'), el('h2', '', t('noCycle')), el('p', '', t('noCycleNote')))));
    const findings = el('section', 'findings'); findings.append(el('h2', '', t('findings')));
    for (const f of items(snapshot.analysis?.findings)) {
        const card = el('article', 'finding');
        append(card, append(el('div', 'finding-top'), badge(f.severity), el('h3', '', f.id === 'confirmed-deadlock' ? t('confirmedTitle') : f.title)), el('p', '', f.summary));
        const details = append(el('details'), el('summary', '', t('details')));
        append(details, el('p', '', `${f.evidence?.label || ''}: ${f.qualification || f.evidence?.qualification || ''}`));
        for (const fact of items(f.facts)) details.append(el('p', '', `${fact.label}: ${fact.value}`));
        if (f.id !== 'confirmed-deadlock') details.append(el('p', '', f.recommendation));
        const sourceButtons = el('div', 'evidence-actions');
        for (const thread of items(f.threads)) {
            if (!thread.startLine) continue;
            sourceButtons.append(button(`${t('source')}: ${thread.name}`, () => {
                selection = { id: thread.sourceKey, name: thread.name, evidence: { startLine: thread.startLine, endLine: thread.endLine } };
                const old = document.getElementById('detail'); if (old) old.remove();
                card.append(evidencePanel(selection)); void showEvidence(selection, thread.startLine);
            }));
        }
        if ([f.threads, f.facts, f.resourceIds].some(p => p?.nextOffset != null)) details.append(el('p', 'note', t('truncated')));
        append(card, details, sourceButtons); findings.append(card);
    }
    if (snapshot.analysis?.findings?.nextOffset != null) findings.append(el('p', 'note', t('truncated')));
    root.append(findings);
    const limitations = append(el('details', 'coverage'), el('summary', '', t('coverage'))), list = el('ul');
    for (const warning of [...(report.warnings || []), ...(snapshot.analysis?.limitations || []), ...(report.limitations || [])]) list.append(el('li', '', warning));
    for (const s of report.sourceResults || []) if (!s.accepted) list.append(el('li', '', `Rejected input: ${s.name || s.label || s.sourceId}`));
    limitations.append(list); root.append(limitations);
    append(root, append(el('footer', 'footer'), el('span', '', t('local')), el('span', '', `${t('timing')}: ${report.timing?.readMs ?? '—'} / ${report.timing?.analysisMs ?? '—'} ms · v0.2.0`)));
}
void bridge.initialize();
window.matchMedia('(max-width: 540px)').addEventListener('change', () => { if (report) render(); });

const words = {
    en: { title: 'Snapshot comparison', subtitle: 'Adjacent intervals · cached analysis', cpu: 'CPU', allocation: 'Allocation',
        peakCpu: 'Peak thread CPU', peakAllocation: 'Peak thread allocation', hot: 'Threads above review thresholds',
        cpuNote: 'CPU is relative to one logical CPU. Each bar describes an interval, not an instantaneous sample.',
        allocationNote: 'Solid bar: lower bound. Striped end: uncertainty from rounded counters. Allocation is not retained memory.',
        snapshot: 'Snapshot', baseline: 'Baseline', endpoint: 'Endpoint', source: 'Source evidence', view: 'View this snapshot',
        missing: 'Unavailable', notShown: 'Not in the retained rows', noIntervals: 'No adjacent interval is available on this page. Select a page with later snapshots.',
        scope: 'Retained thread rows', rows: 'Displayed series', more: 'Show more threads', pending: 'Checking source hash…',
        noSource: 'No exact physical source range is available.', original: 'Original analyzer diagnostics',
        window: 'Snapshot window', limits: 'Rows are selected from each interval’s top CPU and allocation rates. Missing cells are not zero.',
        editor: 'These source controls include their snapshot. Chat links and the host editor are independent.', unavailableTools: 'Source tools are unavailable in this host.' },
    sv: { title: 'Jämför snapshots', subtitle: 'Intilliggande intervall · sparad analys', cpu: 'CPU', allocation: 'Allokering',
        peakCpu: 'Högsta CPU per tråd', peakAllocation: 'Högsta allokering per tråd', hot: 'Trådar över granskningsgränserna',
        cpuNote: 'CPU anges relativt en logisk CPU. Varje stapel beskriver ett intervall, inte en ögonblicksmätning.',
        allocationNote: 'Fylld stapel: nedre gräns. Randigt slut: osäkerhet från avrundade räknare. Allokering är inte kvarhållet minne.',
        snapshot: 'Snapshot', baseline: 'Start', endpoint: 'Slut', source: 'Källbevis', view: 'Visa denna snapshot',
        missing: 'Ej tillgängligt', notShown: 'Saknas i det sparade urvalet', noIntervals: 'Inget intilliggande intervall finns på denna sida. Välj en sida med senare snapshots.',
        scope: 'Sparade trådrader', rows: 'Visade serier', more: 'Visa fler trådar', pending: 'Kontrollerar källfilens hash…',
        noSource: 'Exakta fysiska källrader saknas.', original: 'Analysverktygets originaldiagnostik',
        window: 'Snapshot-urval', limits: 'Rader väljs bland varje intervalls högsta CPU- och allokeringsvärden. Saknade celler betyder inte noll.',
        editor: 'Källkontrollerna visar sin snapshot. Chattlänkar och klientens editor fungerar oberoende.', unavailableTools: 'Källverktyg är inte tillgängliga i denna klient.' },
};
function el(tag, className, text) { const n = document.createElement(tag); n.className = className || ''; if (text != null) n.textContent = text; return n; }
function button(text, action) { const b = el('button', '', text); b.type = 'button'; b.addEventListener('click', action); return b; }
const ranges = (row, metric) => metric === 'cpu' ? (row.cpu.percent == null ? null : { minimum: row.cpu.percent, maximum: row.cpu.percent })
    : row.allocation.boundsBytesPerSecond || (row.allocation.bytesPerSecond == null ? null : { minimum: row.allocation.bytesPerSecond, maximum: row.allocation.bytesPerSecond });
export function formatRate(row, metric, locale) {
    const r = ranges(row, metric); if (!r) return words[locale].missing;
    const nf = n => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
    if (metric === 'cpu') return `≈ ${nf(r.minimum)}%`;
    const scale = r.maximum >= 2 ** 20 ? 2 ** 20 : r.maximum >= 1024 ? 1024 : 1;
    const unit = scale === 2 ** 20 ? 'MiB/s' : scale === 1024 ? 'KiB/s' : 'B/s';
    // Round ranges outwards: the rendered interval must still contain the evidence.
    return row.allocation.boundsBytesPerSecond
        ? `${nf(Math.floor(r.minimum / scale * 10) / 10)}–${nf(Math.ceil(r.maximum / scale * 10) / 10)} ${unit}`
        : `≈ ${nf(r.minimum / scale)} ${unit}`;
}
export function comparisonView({ report, locale, metric, rowLimit, canRead, onMetric, onMore, onEvidence, onSnapshot }) {
    const t = key => words[locale][key], container = el('section', 'comparison');
    const head = el('div', 'comparison-head'); head.append(el('h2', '', t('title')), el('p', 'muted', t('subtitle'))); container.append(head);
    const intervals = report.snapshots.items.filter(s => s.measurements?.baselineSnapshotIndex != null);
    container.append(el('p', 'muted comparison-window', `${t('window')}: ${report.snapshots.offset + 1}–${report.snapshots.offset + report.snapshots.items.length} / ${report.snapshotCount}`));
    if (!intervals.length) { container.append(el('p', 'note', t('noIntervals'))); return container; }
    const summaries = el('div', 'interval-summaries');
    for (const { measurements: m } of intervals) {
        const card = el('article', 'interval-summary'), rows = m.threads.items;
        const cpu = [...rows].sort((a, b) => (b.cpu.percent ?? -1) - (a.cpu.percent ?? -1))[0];
        const allocation = [...rows].sort((a, b) => (ranges(b, 'allocation')?.minimum ?? -1) - (ranges(a, 'allocation')?.minimum ?? -1))[0];
        card.append(el('h3', '', `${t('snapshot')} ${m.baselineSnapshotIndex + 1} → ${m.endSnapshotIndex + 1}`));
        for (const [label, value] of [[t('peakCpu'), cpu ? formatRate(cpu, 'cpu', locale) : t('missing')],
            [t('peakAllocation'), allocation ? formatRate(allocation, 'allocation', locale) : t('missing')],
            [t('hot'), `${t('cpu')}: ${m.hotCpuThreads} · ${t('allocation')}: ${m.hotAllocationThreads}`]]) {
            const line = el('div', 'interval-stat'); line.append(el('span', '', label), el('strong', '', value)); card.append(line);
        }
        card.append(el('p', 'muted', `${t('scope')}: ${m.threads.shown}/${m.threads.total}`)); summaries.append(card);
    }
    container.append(summaries);
    const controls = el('div', 'metric-controls'); controls.setAttribute('aria-label', t('title'));
    for (const key of ['cpu', 'allocation']) { const b = button(t(key), () => onMetric(key)); b.setAttribute('aria-pressed', String(key === metric)); controls.append(b); }
    container.append(controls, el('p', 'metric-legend muted', t(metric === 'cpu' ? 'cpuNote' : 'allocationNote')));
    const groups = new Map();
    for (const s of intervals) for (const row of s.measurements.threads.items) {
        if (!groups.has(row.seriesKey)) groups.set(row.seriesKey, { name: row.name, bySnapshot: new Map(), maximum: -1 });
        const group = groups.get(row.seriesKey); group.bySnapshot.set(s.index, row);
        group.maximum = Math.max(group.maximum, ranges(row, metric)?.maximum ?? -1);
    }
    const ranked = [...groups.values()].sort((a, b) => b.maximum - a.maximum);
    const active = ranked.filter(r => r.maximum > 0);
    const visible = (rowLimit <= 8 && active.length ? active : ranked).slice(0, rowLimit);
    const maximum = Math.max(metric === 'cpu' ? 100 : 1, ...ranked.map(r => r.maximum));
    container.append(el('p', 'comparison-count muted', `${t('rows')}: ${visible.length} / ${ranked.length}. ${t('limits')}`));
    const chart = el('div', `metric-chart ${metric}`); chart.setAttribute('aria-label', t(metric));
    for (const group of visible) {
        const track = el('article', 'metric-row'); track.append(el('h3', 'metric-thread', group.name));
        const cells = el('div', 'metric-cells');
        for (const s of intervals) {
            const row = group.bySnapshot.get(s.index), r = row && ranges(row, metric);
            const label = `${s.measurements.baselineSnapshotIndex + 1} → ${s.index + 1}`;
            const cell = button('', () => {
                if (!row) return;
                for (const detail of container.querySelectorAll('.comparison-evidence')) detail.remove();
                for (const b of chart.querySelectorAll('.metric-cell')) b.setAttribute('aria-pressed', 'false');
                cell.setAttribute('aria-pressed', 'true');
                const detail = el('section', 'comparison-evidence');
                detail.append(el('h3', '', `${group.name} · ${t('snapshot')} ${label}`), el('p', 'muted', t('editor')));
                const actions = el('div', 'evidence-actions'), content = el('div', 'comparison-source'); content.setAttribute('aria-live', 'polite');
                for (const [key, endpoint] of [['baseline', row.baseline], ['endpoint', row.current]]) {
                    if (!endpoint) continue;
                    const b = button(`${t(key)} · ${t('snapshot')} ${endpoint.snapshotNumber}`, async () => {
                        content.replaceChildren(el('p', 'muted', `${t('snapshot')} ${endpoint.snapshotNumber} · ${endpoint.name} · ${endpoint.range?.startLine}–${endpoint.range?.endLine}`), el('p', 'muted', t('pending')));
                        try { await onEvidence(endpoint, content); } catch (error) { if (content.isConnected) content.append(el('p', 'error', error.message)); }
                    });
                    b.disabled = !endpoint.range || !canRead; b.title = !endpoint.range ? t('noSource') : !canRead ? t('unavailableTools') : endpoint.path;
                    actions.append(b);
                }
                const view = button(`${t('view')} ${row.current.snapshotNumber}`, () => onSnapshot(row.current));
                view.disabled = !canRead; actions.append(view);
                detail.append(actions, content); track.append(detail);
            });
            cell.className = 'metric-cell'; cell.disabled = !row; cell.setAttribute('aria-pressed', 'false');
            cell.setAttribute('aria-label', `${group.name} · ${t('snapshot')} ${label} · ${row ? formatRate(row, metric, locale) : t('notShown')}`);
            cell.append(el('span', 'metric-interval', `${t('snapshot')} ${label}`), el('strong', 'metric-value', row ? formatRate(row, metric, locale) : t('notShown')));
            const bar = el('span', 'measure-track'); bar.setAttribute('aria-hidden', 'true');
            if (r) {
                const floor = el('span', 'measure-floor'); floor.style.width = `${r.minimum / maximum * 100}%`; bar.append(floor);
                if (r.maximum > r.minimum) { const band = el('span', 'measure-bound'); band.style.left = `${r.minimum / maximum * 100}%`; band.style.width = `${(r.maximum - r.minimum) / maximum * 100}%`; bar.append(band); }
            }
            cell.append(bar);
            if (row) { const m = row[metric]; cell.title = `${t('snapshot')} ${label}\n${m.intervalMs == null ? t('missing') : `≈ ${m.intervalMs.toFixed(0)} ms`}\n${m.reason || m.status}\n${row.current.name} · ${row.current.range ? `${row.current.range.startLine}–${row.current.range.endLine}` : t('noSource')}`; }
            cells.append(cell);
        }
        track.append(cells); chart.append(track);
    }
    container.append(chart);
    if (ranked.length > visible.length) container.append(button(t('more'), onMore));
    const threshold = intervals[0].measurements.thresholds;
    container.append(el('p', 'muted comparison-thresholds', `${t('hot')}: CPU ≥ ${threshold.cpuPercent}% · ${t('allocation')} ≥ ${threshold.allocationBytesPerSecond / 2 ** 20} MiB/s.`));
    const details = el('details', 'coverage'); details.append(el('summary', '', t('original')));
    for (const text of [...(report.warnings || []), ...(report.limitations || []), ...intervals[0].measurements.qualifications]) details.append(el('p', '', text));
    container.append(details); return container;
}

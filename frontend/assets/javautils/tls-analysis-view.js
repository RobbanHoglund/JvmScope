import { facetLabel, failureLabel, selectTlsEntries, tlsFacetCounts, tlsTimeDomain,
    tlsTimelineBins, utcInputValue, parseUtcInput, validRange } from './tls-analysis-model.js';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const stamp = value => new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC');
const toggle = (values, key) => values.includes(key) ? values.filter(value => value !== key) : [...values, key];

export function createTlsAnalysisView({ filters, onChange, onClear }) {
    const byId = id => document.getElementById(id);
    const ui = Object.fromEntries(['tlsAnalysis', 'tlsAnalysisCount', 'tlsTimeline', 'tlsTimelineAxis',
        'tlsTimelineNote', 'tlsTimeFrom', 'tlsTimeTo', 'tlsTimeApply', 'tlsTimeClear', 'tlsTimeError',
        'tlsZoomIn', 'tlsZoomOut', 'tlsZoomReset', 'tlsZoomSelection', 'tlsPanBack', 'tlsPanForward',
        'tlsUntimed', 'tlsHostOptions', 'tlsSniOptions', 'tlsHostSearch', 'tlsSniSearch',
        'tlsHostCount', 'tlsSniCount', 'tlsFailureGroups', 'tlsActiveFilters', 'tlsClearFilters',
        'tlsSelectionSummary', 'tlsFailureSearch', 'tlsFailureCount', 'tlsTimelineScale', 'tlsTimelineEmpty'].map(id => [id, byId(id)]));
    let entries = [], domain = null, viewport = null, drag = null, displayedRange = null;

    function notify() { onChange(); }
    function changeViewport(next) {
        if (!domain) return;
        const width = Math.min(domain.end - domain.start, Math.max(1, Math.round(next.end - next.start)));
        const start = Math.max(domain.start, Math.min(domain.end - width, Math.round(next.start)));
        viewport = { start, end: start + width };
        renderTimeline();
    }
    function zoom(factor) {
        if (!viewport) return;
        const center = (viewport.start + viewport.end) / 2;
        const half = (viewport.end - viewport.start) * factor / 2;
        changeViewport({ start: center - half, end: center + half });
    }
    ui.tlsZoomIn.addEventListener('click', () => zoom(.5));
    ui.tlsZoomOut.addEventListener('click', () => zoom(2));
    ui.tlsZoomReset.addEventListener('click', () => changeViewport(domain));
    ui.tlsZoomSelection.addEventListener('click', () => { if (filters.range) changeViewport(filters.range); });
    for (const [button, direction] of [[ui.tlsPanBack, -1], [ui.tlsPanForward, 1]]) {
        button.addEventListener('click', () => {
            if (!viewport) return;
            const shift = (viewport.end - viewport.start) * direction * .75;
            changeViewport({ start: viewport.start + shift, end: viewport.end + shift });
        });
    }
    ui.tlsTimeApply.addEventListener('click', () => {
        const start = parseUtcInput(ui.tlsTimeFrom.value), end = parseUtcInput(ui.tlsTimeTo.value);
        if (!validRange({ start, end })) {
            ui.tlsTimeError.textContent = 'Enter valid UTC times. To must be later than From.';
            return;
        }
        filters.range = { start, end };
        filters.timeMode = 'all';
        ui.tlsTimeError.textContent = '';
        notify();
    });
    ui.tlsTimeClear.addEventListener('click', () => {
        filters.range = null; filters.timeMode = 'all'; ui.tlsTimeError.textContent = ''; notify();
    });
    ui.tlsUntimed.addEventListener('click', () => {
        filters.timeMode = filters.timeMode === 'untimed' ? 'all' : 'untimed';
        filters.range = null; notify();
    });
    ui.tlsClearFilters.addEventListener('click', () => { ui.tlsTimeError.textContent = ''; onClear(); });

    function listenFacet(container, field) {
        container.addEventListener('change', event => {
            const input = event.target.closest('input[data-key]');
            if (!input) return;
            filters[field] = toggle(filters[field], input.dataset.key);
            notify();
        });
    }
    listenFacet(ui.tlsHostOptions, 'hosts'); listenFacet(ui.tlsSniOptions, 'snis');
    ui.tlsHostSearch.addEventListener('input', renderFacets);
    ui.tlsSniSearch.addEventListener('input', renderFacets);
    ui.tlsFailureSearch.addEventListener('input', renderFacets);
    ui.tlsFailureGroups.addEventListener('click', event => {
        const button = event.target.closest('button[data-key]');
        if (!button) return;
        filters.failures = toggle(filters.failures, button.dataset.key); notify();
    });
    ui.tlsActiveFilters.addEventListener('click', event => {
        const button = event.target.closest('button[data-filter]');
        if (!button) return;
        const field = button.dataset.filter;
        if (['hosts', 'snis', 'failures'].includes(field)) filters[field] = filters[field].filter(key => key !== button.dataset.key);
        else if (field === 'range') { filters.range = null; ui.tlsTimeError.textContent = ''; }
        else if (field === 'timeMode') filters.timeMode = 'all';
        else if (field === 'warnings') filters.warnings = false;
        else filters[field] = field === 'search' ? '' : 'all';
        notify();
        // Removing a chip replaces its DOM node. Keep keyboard navigation in
        // the filter controls rather than dropping focus back to the document.
        (ui.tlsActiveFilters.querySelector('button') ?? document.getElementById('searchInput')).focus();
    });

    function pointerTime(event) {
        const rect = ui.tlsTimeline.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        return viewport.start + fraction * (viewport.end - viewport.start);
    }
    ui.tlsTimeline.addEventListener('pointerdown', event => {
        if (!viewport || event.button !== 0) return;
        drag = { pointer: event.pointerId, start: pointerTime(event), end: pointerTime(event), x: event.clientX };
        ui.tlsTimeline.setPointerCapture(event.pointerId);
        renderTimeline();
    });
    ui.tlsTimeline.addEventListener('pointermove', event => {
        if (!drag || drag.pointer !== event.pointerId) return;
        drag.end = pointerTime(event); renderTimeline();
    });
    ui.tlsTimeline.addEventListener('pointerup', event => {
        if (!drag || drag.pointer !== event.pointerId) return;
        let start = Math.floor(Math.min(drag.start, pointerTime(event)));
        let end = Math.ceil(Math.max(drag.start, pointerTime(event)));
        // A click selects one histogram interval; a drag selects the exact period.
        if (Math.abs(event.clientX - drag.x) < 3) {
            const width = (viewport.end - viewport.start) / 64;
            start = Math.floor(viewport.start + Math.floor((drag.start - viewport.start) / width) * width);
            end = Math.ceil(start + width);
        }
        start = Math.max(viewport.start, Math.min(viewport.end - 1, start));
        end = Math.min(viewport.end, Math.max(start + 1, end));
        drag = null;
        filters.range = { start, end }; filters.timeMode = 'all';
        ui.tlsTimeError.textContent = ''; notify();
    });
    const cancelDrag = () => { drag = null; renderTimeline(); };
    ui.tlsTimeline.addEventListener('pointercancel', cancelDrag);
    ui.tlsTimeline.addEventListener('lostpointercapture', () => { if (drag) cancelDrag(); });
    ui.tlsTimeline.addEventListener('keydown', event => { if (event.key === 'Escape') cancelDrag(); });

    // Popovers are native details: keyboard accessible and never trap focus.
    document.addEventListener('click', event => {
        document.querySelectorAll('.tls-facet[open], .tls-investigating .tls-period-menu[open]').forEach(facet => {
            // Filtering replaces clicked rows. Use the event's original path
            // so a click inside a freshly rendered menu still belongs to it.
            if (!event.composedPath().includes(facet)) facet.open = false;
        });
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        document.querySelectorAll('.tls-facet[open], .tls-investigating .tls-period-menu[open]').forEach(facet => {
            facet.open = false; facet.querySelector('summary').focus();
        });
    });

    function renderFacets() {
        for (const [field, stateKey, container, search] of [
            ['host', 'hosts', ui.tlsHostOptions, ui.tlsHostSearch], ['sni', 'snis', ui.tlsSniOptions, ui.tlsSniSearch],
        ]) {
            const focusedKey = container.querySelector('input:focus')?.dataset.key;
            const choices = tlsFacetCounts(entries, filters, field)
                .filter(item => facetLabel(item.key).toLowerCase().includes(search.value.trim().toLowerCase()));
            container.innerHTML = choices.map(({ key, count }) => `<label title="${escape(facetLabel(key))}">
                <input type="checkbox" data-key="${escape(key)}" ${filters[stateKey].includes(key) ? 'checked' : ''}>
                <span>${escape(facetLabel(key))}</span><strong>${count}</strong></label>`).join('')
                || '<p class="muted">No matching names</p>';
            if (focusedKey) [...container.querySelectorAll('input')].find(input => input.dataset.key === focusedKey)?.focus();
        }
        ui.tlsHostCount.textContent = filters.hosts.length ? ` · ${filters.hosts.length} selected` : ' · all';
        ui.tlsSniCount.textContent = filters.snis.length ? ` · ${filters.snis.length} selected` : ' · all';
        const allGroups = tlsFacetCounts(entries, filters, 'failure');
        const groups = allGroups.filter(group => failureLabel(group.key).toLowerCase().includes(ui.tlsFailureSearch.value.trim().toLowerCase()));
        ui.tlsFailureCount.textContent = filters.failures.length ? ` · ${filters.failures.length} selected`
            : ` · ${allGroups.length} types`;
        const focusedGroup = ui.tlsFailureGroups.querySelector('button:focus')?.dataset.key;
        ui.tlsFailureGroups.innerHTML = groups.map(({ key, count }) => `<button type="button" class="tls-category"
            data-key="${escape(key)}" aria-pressed="${filters.failures.includes(key)}"
            title="Observed diagnostic category; inspect Details for evidence."><span>${escape(failureLabel(key))}</span><strong>${count}</strong></button>`).join('')
            || `<span class="muted">${allGroups.length ? 'No matching categories.' : 'No failed interactions in this capture.'}</span>`;
        if (focusedGroup) [...ui.tlsFailureGroups.querySelectorAll('button')].find(button => button.dataset.key === focusedGroup)?.focus();
    }

    function renderChips() {
        const chips = [];
        const chip = (field, label, key = '') => chips.push(`<button type="button" data-filter="${field}" data-key="${escape(key)}"
            aria-label="Remove ${escape(label)}">${escape(label)} <span aria-hidden="true">×</span></button>`);
        if (filters.search) chip('search', `Search: ${filters.search}`);
        if (filters.outcome !== 'all') chip('outcome', `Outcome: ${filters.outcome}`);
        if (filters.warnings) chip('warnings', 'Warnings only');
        if (filters.direction !== 'all') chip('direction', `Direction: ${filters.direction}`);
        filters.hosts.forEach(key => chip('hosts', `Host: ${facetLabel(key)}`, key));
        filters.snis.forEach(key => chip('snis', `SNI: ${facetLabel(key)}`, key));
        filters.failures.forEach(key => chip('failures', `Failure: ${failureLabel(key)}`, key));
        if (filters.range) chip('range', `Period: ${stamp(filters.range.start)} → ${stamp(filters.range.end)} (end exclusive)`);
        if (filters.timeMode === 'untimed') chip('timeMode', 'Without timestamps only');
        ui.tlsActiveFilters.innerHTML = chips.join('');
        ui.tlsClearFilters.hidden = !chips.length;
    }

    function renderTimeline() {
        const selected = selectTlsEntries(entries, filters);
        const context = selectTlsEntries(entries, filters, ['range', 'timeMode']);
        const untimed = context.filter(entry => !entry.time).length;
        ui.tlsUntimed.textContent = `Without time: ${untimed}`;
        ui.tlsUntimed.setAttribute('aria-pressed', String(filters.timeMode === 'untimed'));
        ui.tlsUntimed.disabled = !untimed && filters.timeMode !== 'untimed';
        for (const id of ['tlsZoomIn', 'tlsZoomOut', 'tlsZoomReset', 'tlsTimeApply', 'tlsTimeFrom', 'tlsTimeTo']) ui[id].disabled = !domain;
        ui.tlsTimeClear.disabled = !filters.range && filters.timeMode === 'all';
        ui.tlsZoomSelection.disabled = !filters.range || !domain;
        ui.tlsPanBack.disabled = !viewport || viewport.start <= domain.start;
        ui.tlsPanForward.disabled = !viewport || viewport.end >= domain.end;
        if (!viewport) {
            ui.tlsTimeline.innerHTML = '';
            ui.tlsTimeline.hidden = true;
            ui.tlsTimelineEmpty.hidden = false;
            ui.tlsTimelineScale.textContent = 'Time unavailable';
            ui.tlsTimelineAxis.textContent = '';
            ui.tlsTimelineNote.textContent = 'All interactions remain available in the table. Times are not inferred.';
            ui.tlsTimeline.setAttribute('aria-label', 'No reliable timestamps in this capture');
            return;
        }
        ui.tlsTimeline.hidden = false;
        ui.tlsTimelineEmpty.hidden = true;
        const bins = tlsTimelineBins(selected, viewport), background = tlsTimelineBins(context, viewport);
        const max = Math.max(1, ...background.map(bin => bin.total));
        ui.tlsTimelineScale.textContent = `Up to ${max} starts per interval`;
        let svg = '<line x1="0" x2="1000" y1="104" y2="104" stroke="#536174"/>';
        bins.forEach((bin, index) => {
            const x = index * 1000 / bins.length, width = 1000 / bins.length - 2;
            svg += `<rect x="${x}" y="${104 - background[index].total / max * 84}" width="${width}" height="${background[index].total / max * 84}" fill="#64748b" opacity=".28"/>`;
            let y = 104;
            const end = viewport.start + (index + 1) / bins.length * (viewport.end - viewport.start);
            for (const [outcome, color] of [['success', '#65bd97'], ['failure', '#e28181'], ['unknown', '#ddbb6d']]) {
                const height = bin[outcome] / max * 84;
                y -= height;
                svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}">
                    <title>${escape(stamp(Math.floor(bin.start)))} – ${escape(stamp(Math.ceil(end)))}\nSelected starts: ${bin.success} success, ${bin.failure} failure, ${bin.unknown} unknown\nContext starts: ${background[index].total}</title></rect>`;
            }
        });
        const range = drag ? { start: Math.min(drag.start, drag.end), end: Math.max(drag.start, drag.end) } : filters.range;
        if (range && range.end > viewport.start && range.start < viewport.end) {
            const x = (Math.max(range.start, viewport.start) - viewport.start) / (viewport.end - viewport.start) * 1000;
            const right = (Math.min(range.end, viewport.end) - viewport.start) / (viewport.end - viewport.start) * 1000;
            svg += `<rect x="${x}" y="17" width="${Math.max(1, right - x)}" height="87" fill="#72a4d7" fill-opacity=".17" stroke="#9cc8f1" pointer-events="none"/>`;
        }
        ui.tlsTimeline.innerHTML = svg;
        ui.tlsTimelineAxis.innerHTML = [viewport.start, Math.floor((viewport.start + viewport.end) / 2), viewport.end]
            .map(time => `<span>${escape(stamp(time))}</span>`).join('');
        const starts = bins.reduce((sum, bin) => sum + bin.total, 0);
        ui.tlsTimelineNote.textContent = `${selected.length} shown · ${starts} starts in view · ${untimed} without time${filters.range ? ' (excluded from this period)' : ''}. Drag to select; zoom only changes the scale. Faint bars show context before the time filter.`;
        ui.tlsTimeline.setAttribute('aria-label', `Interaction starts in UTC. ${starts} selected starts in view. Use From UTC and To UTC to select a period with the keyboard.`);
    }

    return {
        setData(next) {
            entries = next; domain = tlsTimeDomain(entries); viewport = domain; drag = null; displayedRange = null;
            document.querySelectorAll('.tls-facet[open]').forEach(facet => { facet.open = false; });
            if (document.body?.classList.contains('tls-investigating')) document.getElementById('tlsPeriodMenu').open = false;
            ui.tlsHostSearch.value = ''; ui.tlsSniSearch.value = ''; ui.tlsFailureSearch.value = ''; ui.tlsTimeError.textContent = '';
            ui.tlsTimeFrom.value = domain ? utcInputValue(domain.start) : '';
            ui.tlsTimeTo.value = domain ? utcInputValue(domain.end) : '';
        },
        render() {
            ui.tlsAnalysis.hidden = !entries.length;
            const selected = selectTlsEntries(entries, filters);
            const counts = { success: 0, failure: 0, unknown: 0 };
            selected.forEach(entry => counts[entry.interaction.outcome in counts ? entry.interaction.outcome : 'unknown']++);
            ui.tlsAnalysisCount.textContent = `${selected.length} / ${entries.length} selected`;
            ui.tlsSelectionSummary.textContent = `Selection: ${counts.success} success · ${counts.failure} failure · ${counts.unknown} unknown`;
            const rangeKey = filters.range ? `${filters.range.start}:${filters.range.end}` : null;
            if (filters.range && rangeKey !== displayedRange) {
                ui.tlsTimeFrom.value = utcInputValue(filters.range.start);
                ui.tlsTimeTo.value = utcInputValue(filters.range.end);
            }
            displayedRange = rangeKey;
            renderTimeline(); renderFacets(); renderChips();
        },
    };
}

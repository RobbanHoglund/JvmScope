// Java TLS Log Analyzer 

import { TLS_FAILURE_HIGHLIGHT } from './tls-core.js';
import { bindAnalyzerStart, renderAnalyzerStart, bindAnalyzerDropZones } from './analyzer-start.js';
import { createHelpSearch } from './help-search.js';
import { TLS_EXAMPLES, readExample } from './example-catalog.js';
import { createExamplePicker } from './example-picker.js';
import { createTlsAnalysisClient } from './tls-analysis-client.js';
import { clientCertDisplay, clientCertificateDetailsText, certificateAuthoritiesDisplay, certificateAuthoritiesTooltip,
    certificateAuthoritiesDetailsText, certificateAuthoritiesTooltipBody, clientCertTooltipBody, cipherTooltipBody,
    peerHostTooltipBody, sniTooltipBody, tlsOutcomeDisplay, tlsDirectionDisplay, tlsMissingFactDisplay,
    tlsUncertaintyExplanation } from './tls-view-model.js';
import { explainIssueText } from './tls-explanations.js';
import { createLatestInputRequestGate } from './tda/input-request.js';
import { createTlsFilters, selectTlsEntries, facetKey, interactionTime, failureLabel } from './tls-analysis-model.js';
import { createTlsAnalysisView } from './tls-analysis-view.js';
import { createTlsInspector } from './tls-inspector-view.js';
import { tlsDiagnosis, tlsObservedSequence, reconcileTlsSelection } from './tls-sequence-model.js';


const UI = {
    fileInput: document.getElementById('fileInput'),
    fileName: document.getElementById('fileName'),
    searchInput: document.getElementById('searchInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    loadSampleBtn: document.getElementById('loadSampleBtn'),
    clearBtn: document.getElementById('clearBtn'),
    helpBtn: document.getElementById('howToUseBtn'),
    helpModal: document.getElementById('howToUseModal'),
    helpClose: document.getElementById('howToUseModalClose'),
    helpClose2: document.getElementById('howToUseModalClose2'),

    onlyFailuresToggle: document.getElementById('onlyFailuresToggle'),
    onlySuccessToggle: document.getElementById('onlySuccessToggle'),
    onlyWarningsToggle: document.getElementById('onlyWarningsToggle'),

    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    statsSummary: document.getElementById('statsSummary'),
    lastUpdated: document.getElementById('lastUpdated'),

    table: document.getElementById('tlsTable'),
    tbody: document.getElementById('tlsTableBody'),
    rowCount: document.getElementById('rowCount'),
    tableScroll: document.getElementById('tlsTableScroll'),
    emptyState: document.getElementById('emptyState'),

    modal: document.getElementById('tlsModal'),
    modalTitle: document.getElementById('tlsModalTitle'),
    modalBody: document.getElementById('tlsModalBody'),
    modalClose: document.getElementById('tlsModalClose'),
    modalClose2: document.getElementById('tlsModalClose2'),
    modalCopyBtn: document.getElementById('tlsModalCopyBtn'),

    // Drag & drop
    dropZone: document.getElementById('tableContainer'),
    dropOverlay: document.getElementById('dropOverlay'),

    issueModal: document.getElementById('issueModal'),
    issueModalTitle: document.getElementById('issueModalTitle'),
    issueModalBody: document.getElementById('issueModalBody'),
    issueModalClose: document.getElementById('issueModalClose'),
    issueModalClose2: document.getElementById('issueModalClose2'),
};


// --- Model ---
let allInteractions = [];
let filteredInteractions = [];
let lastLoadedText = '';
let sortState = { key: 'startTs', dir: 'desc' };
let directionFilter = 'all';
let analysisEntries = [];
let parsedAt = null;
let selectedInteraction = null;
let autoSelectInteraction = false;
const inspector = createTlsInspector({ root: document.getElementById('tlsInspector'),
    onDetails: openModalForInteraction, onStep: stepInteraction, copy: copyToClipboard });
const filters = createTlsFilters();
const analysisView = createTlsAnalysisView({ filters, onChange: () => {
    UI.searchInput.value = filters.search;
    UI.onlyFailuresToggle.checked = filters.outcome === 'failure';
    UI.onlySuccessToggle.checked = filters.outcome === 'success';
    UI.onlyWarningsToggle.checked = filters.warnings;
    directionFilter = filters.direction;
    updateDirectionFilterButtons();
    applyFiltersSortAndRender();
}, onClear: clearFilters });
const inputRequestGate = createLatestInputRequestGate();
const analysisClient = createTlsAnalysisClient();
const PAGE_SIZE = 200;
let tablePage = 0;
let exampleReadController = null;
function beginInputRequest() {
    analysisClient.cancel();
    exampleReadController?.abort();
    exampleReadController = null;
    return inputRequestGate.begin();
}
inspector.render(null, -1, 0);




// --- UI helpers ---
function escapeHtml(s) {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function fmtDuration(ms) {
    if (ms == null || ms < 0) return '—';
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(2)} s`;
    const m = Math.floor(s / 60);
    const rem = s - m * 60;
    return `${m}m ${rem.toFixed(1)}s`;
}

function fmtStart(tsRaw) {
    if (!tsRaw) return 'unknown';
    // show without trailing GMT for compactness
    return tsRaw.replace(' GMT', '');
}

function badgeOutcome(it) {
    const outcome = it.outcome;
    const cls =
        outcome === 'success' ? 'status-badge status-ok' : outcome === 'failure' ? 'status-badge status-bad' : 'status-badge status-warn';
    return `<span class="${cls}" title="${escapeHtml(tlsUncertaintyExplanation(it))}"><span>${escapeHtml(tlsOutcomeDisplay(it))}</span></span>`;
}

function badgeDirection(it) {
    const dir = it.direction;
    const icon = dir === 'outbound' ? '↗' : dir === 'inbound' ? '↘' : dir === 'both' ? '↔' : '?';
    const detail = dir === 'unknown' ? tlsUncertaintyExplanation(it)
        || 'No attributable ClientHello was captured; inbound or outbound direction cannot be established.' : '';
    return `<span class="pill tls-direction-badge" title="${escapeHtml(detail)}">${icon} ${escapeHtml(tlsDirectionDisplay(it))}</span>`;
}

function setLoading(on) {
    document.body?.classList.toggle('analyzer-busy', on);
    UI.loadingState.classList.toggle('hidden', !on);
}

function showError(msg) {
    UI.errorState.textContent = msg;
    UI.errorState.classList.remove('hidden');
}

function hideError() {
    UI.errorState.classList.add('hidden');
}

function applyFiltersSortAndRender() {
    tablePage = 0;
    renderAnalyzerStart(parsedAt !== null);
    filters.search = (UI.searchInput.value || '').trim();
    filters.outcome = UI.onlyFailuresToggle.checked ? 'failure' : UI.onlySuccessToggle.checked ? 'success' : 'all';
    filters.warnings = UI.onlyWarningsToggle.checked;
    filters.direction = directionFilter;
    filteredInteractions = selectTlsEntries(analysisEntries, filters).map(entry => entry.interaction);
    sortInPlace(filteredInteractions, sortState.key, sortState.dir);
    selectedInteraction = reconcileTlsSelection(selectedInteraction, filteredInteractions, autoSelectInteraction);
    autoSelectInteraction = false;
    renderTable(filteredInteractions);
    renderMeta(allInteractions, filteredInteractions);
    analysisView.render();
    renderInspector();
}

function renderInspector() {
    inspector.render(selectedInteraction, filteredInteractions.indexOf(selectedInteraction), filteredInteractions.length);
}

function selectInteraction(id) {
    selectedInteraction = filteredInteractions.find(item => item.id === id) || null;
    const index = filteredInteractions.indexOf(selectedInteraction);
    if (index >= 0 && Math.floor(index / PAGE_SIZE) !== tablePage) {
        tablePage = Math.floor(index / PAGE_SIZE);
        renderTable(filteredInteractions);
    }
    UI.tbody.querySelectorAll('tr').forEach(row => {
        const selected = Number(row.dataset.id) === selectedInteraction?.id;
        row.classList.toggle('tls-selected-row', selected);
        row.querySelector('.tls-select-btn')?.setAttribute('aria-pressed', String(selected));
    });
    renderInspector();
}

function stepInteraction(step) {
    const index = filteredInteractions.indexOf(selectedInteraction);
    const next = filteredInteractions[index + step];
    if (!next) return;
    selectInteraction(next.id);
    UI.tbody.querySelector(`tr[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
}

function clearFilters() {
    Object.assign(filters, createTlsFilters());
    UI.searchInput.value = '';
    UI.onlyFailuresToggle.checked = false;
    UI.onlySuccessToggle.checked = false;
    UI.onlyWarningsToggle.checked = false;
    directionFilter = 'all';
    updateDirectionFilterButtons();
    applyFiltersSortAndRender();
}

function sortInPlace(arr, key, dir) {
    const mult = dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
        const va = a[key];
        const vb = b[key];

        // numbers
        if (typeof va === 'number' && typeof vb === 'number') {
            return (va - vb) * mult;
        }

        // strings
        const sa = (va ?? '').toString();
        const sb = (vb ?? '').toString();
        return sa.localeCompare(sb) * mult;
    });
}

function diagnosticCellHtml(value) {
    if (value === 'Not captured') {
        return '<span class="cell-status cell-status-warn">Not captured</span>';
    }
    if (value === '—') {
        return '<span class="muted">—</span>';
    }
    return escapeHtml(value);
}

function ensureRichTooltip() {
    let tooltip = document.getElementById('richTooltip');
    if (tooltip) return tooltip;

    tooltip = document.createElement('div');
    tooltip.id = 'richTooltip';
    tooltip.className = 'rich-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    tooltip.innerHTML = '<div class="rich-tooltip-title"></div><div class="rich-tooltip-body"></div>';
    document.body.appendChild(tooltip);
    return tooltip;
}

function setupRichTooltips(rootEl) {
    if (!rootEl) return;

    const tooltip = ensureRichTooltip();
    const titleEl = tooltip.querySelector('.rich-tooltip-title');
    const bodyEl = tooltip.querySelector('.rich-tooltip-body');
    let activeTarget = null;

    function positionTooltip(x, y) {
        const margin = 12;
        const offset = 16;
        tooltip.hidden = false;

        const rect = tooltip.getBoundingClientRect();
        let left = x + offset;
        let top = y + offset;

        if (left + rect.width + margin > window.innerWidth) {
            left = Math.max(margin, x - rect.width - offset);
        }
        if (top + rect.height + margin > window.innerHeight) {
            top = Math.max(margin, y - rect.height - offset);
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function showTooltip(target, x, y) {
        if (!target) return;
        activeTarget = target;
        titleEl.textContent = target.getAttribute('data-tooltip-title') || '';
        bodyEl.textContent = target.getAttribute('data-tooltip-body') || '';
        positionTooltip(x, y);
    }

    function hideTooltip() {
        activeTarget = null;
        tooltip.hidden = true;
    }

    rootEl.addEventListener('pointerover', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-tooltip-body]') : null;
        if (!target || !rootEl.contains(target)) return;
        showTooltip(target, e.clientX, e.clientY);
    });

    rootEl.addEventListener('pointermove', (e) => {
        if (!activeTarget) return;
        positionTooltip(e.clientX, e.clientY);
    });

    rootEl.addEventListener('pointerout', (e) => {
        if (!activeTarget) return;
        const next = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[data-tooltip-body]') : null;
        if (next === activeTarget) return;
        hideTooltip();
    });

    rootEl.addEventListener('focusin', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-tooltip-body]') : null;
        if (!target || !rootEl.contains(target)) return;
        const rect = target.getBoundingClientRect();
        showTooltip(target, rect.left + rect.width / 2, rect.bottom);
    });

    rootEl.addEventListener('focusout', hideTooltip);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideTooltip();
    });
}

function renderTable(items) {
    UI.tbody.innerHTML = '';

    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    tablePage = Math.min(tablePage, pageCount - 1);
    const offset = tablePage * PAGE_SIZE;
    const pageItems = items.slice(offset, offset + PAGE_SIZE);
    const rows = pageItems.map((it) => {
        const missingFact = tlsMissingFactDisplay(it);
        const peerHost = it.peerHost || missingFact;
        const sni = it.sni || '—';
        const tls = it.tlsVersion || missingFact;
        const cipher = it.cipherSuite || missingFact;

        const warn = it.warnCount || 0;
        const warnCell = warn > 0
            ? `<span class="pill warning-count" data-tooltip-title="Warnings" data-tooltip-body="${escapeAttr([`${(it.warningHighlights || []).length} diagnostic keyword highlight(s).`, ...(it.correlationWarnings || [])].join('\n'))}">△ ${warn}</span>`
            : `<span class="muted">0</span>`;

        const threadCount = it.threadCount ?? '—';

        const hotClass = it.outcome === 'failure' ? 'hot-pr' : '';
        const selectedClass = it === selectedInteraction ? 'tls-selected-row' : '';
        const observed = tlsObservedSequence(it);
        const last = observed.filter(event => event.kind === 'handshake').at(-1);
        const start = interactionTime(it)
            ? new Date(it.startTs).toISOString().slice(11, 23) + ' UTC' : 'No reliable clock';
		
		const clientCert = clientCertDisplay(it);
            const certAuthorities = certificateAuthoritiesDisplay(it);

		  return `
		<tr class="${hotClass} ${selectedClass}" data-id="${it.id}">
		  <td class="mono-small"><button class="tls-select-btn" type="button" data-select-id="${it.id}" aria-label="Select interaction ${it.id}" aria-pressed="${it === selectedInteraction}">${it.id}</button></td>
		  <td>${badgeOutcome(it)}</td>
		  <td>${badgeDirection(it)}</td>
                <td class="mono-small" title="${escapeHtml(it.tidDisplay || '—')}">${escapeHtml(it.tidDisplay || '—')}</td>
              <td class="cell-host cell-truncate" data-tooltip-title="Peer host" data-tooltip-body="${escapeAttr(peerHostTooltipBody(it))}"><button class="tls-name-filter" type="button" data-name-field="hosts" data-name-key="${escapeAttr(facetKey(it.peerHost))}" aria-label="Filter host: ${escapeAttr(peerHost)}">${escapeHtml(peerHost)}</button>${UI.table.classList.contains('tls-investigation-columns') ? `<span class="tls-row-context" title="${escapeAttr(tlsDirectionDisplay(it))} · ${escapeAttr(tls)}">${escapeHtml(start)} ${it.direction === 'outbound' ? '↗' : it.direction === 'inbound' ? '↙' : ''}</span>` : ''}</td>
              <td class="cell-host cell-truncate" data-tooltip-title="Server Name Indication" data-tooltip-body="${escapeAttr(sniTooltipBody(it))}"><button class="tls-name-filter" type="button" data-name-field="snis" data-name-key="${escapeAttr(facetKey(it.sni))}" aria-label="Filter SNI: ${escapeAttr(sni)}">${diagnosticCellHtml(sni)}</button></td>
		  <td class="mono-small">${escapeHtml(tls)}</td>
              <td class="mono-small cell-cert" data-tooltip-title="Certificate authorities requested by server" data-tooltip-body="${escapeAttr(certificateAuthoritiesTooltipBody(it))}">
                ${diagnosticCellHtml(certAuthorities)}
              </td>
              <td class="mono-small cell-cert" data-tooltip-title="Client certificate selected" data-tooltip-body="${escapeAttr(clientCertTooltipBody(it))}">
                ${diagnosticCellHtml(clientCert)}
		  </td>
              <td class="mono-small cell-cipher" data-tooltip-title="Cipher suite" data-tooltip-body="${escapeAttr(cipherTooltipBody(it))}">${diagnosticCellHtml(cipher)}</td>
              <td class="mono-small cell-start cell-truncate" title="${escapeAttr(fmtStart(it.startTsRaw))}">${escapeHtml(interactionTime(it) ? fmtStart(it.startTsRaw) : 'No reliable clock')}</td>
		  <td class="mono-small">${escapeHtml(fmtDuration(it.durationMs))}</td>
		  <td class="mono-small right">${threadCount}</td>
		  <td class="mono-small right">${warnCell}</td>
		<td>
		  <div class="row-actions">
		    <button class="btn btn-sm details-btn" data-action="details" data-id="${it.id}" type="button">Details</button>

		    ${(it.outcome === 'failure')
                        ? `<button class="btn btn-sm explain-btn details-explain-icon" type="button" aria-label="Explain issues" data-issue="${escapeAttr(it.failureReason || it.outcomeReason || '')}" data-tooltip-title="Explain issues" data-tooltip-body="Open a diagnostic explanation for this failed TLS interaction.">?</button>`
                        : `<button class="btn btn-sm explain-btn details-explain-icon" type="button" aria-label="Explain issues" disabled data-tooltip-title="Explain issues" data-tooltip-body="Only available for failed interactions.">?</button>`
            }
		  </div>
		</td>
        <td class="tls-diagnosis-cell" title="${escapeAttr(it.failureReason || it.outcomeDetail || tlsDiagnosis(it))}"><strong>${escapeHtml(tlsDiagnosis(it))}</strong><span>${escapeHtml(last ? `${last.action} · ${last.title}` : 'No handshake messages captured')}</span></td>
      </tr>
    `;
    });

    UI.tbody.innerHTML = rows.join('');
    UI.rowCount.textContent = `${items.length > PAGE_SIZE ? `${offset + 1}–${offset + pageItems.length} of ` : ''}${items.length} / ${allInteractions.length} interactions`;
    document.getElementById('tlsPagination').classList.toggle('hidden', items.length <= PAGE_SIZE);
    document.getElementById('tlsPageLabel').textContent = `Page ${tablePage + 1} of ${pageCount}`;
    document.getElementById('tlsPreviousPage').disabled = tablePage === 0;
    document.getElementById('tlsNextPage').disabled = tablePage === pageCount - 1;
    UI.emptyState.classList.toggle('hidden', items.length > 0);
    UI.emptyState.innerHTML = allInteractions.length
        ? '<p>No interactions match your filters</p><span>Adjust the filters or search to show more interactions.</span>'
        : parsedAt !== null
            ? '<p>No TLS interactions detected</p><span>Check the capture format in Help or try the full sample.</span>'
            : '<p>Load a TLS log to begin</p><span>Choose a file, drop it here, or try the full sample.</span>';
}

function renderMeta(allItems, shownItems) {
    const total = allItems.length;
    if (!total) {
        UI.statsSummary.textContent = lastLoadedText.trim()
            ? 'No interactions detected. Is this a JSSE debug log (javax.net.ssl|...)?'
            : 'No data loaded.';
        UI.lastUpdated.textContent = '';
        return;
    }

    const success = allItems.filter((x) => x.outcome === 'success').length;
    const fail = allItems.filter((x) => x.outcome === 'failure').length;
    const unknown = total - success - fail;

    const warnTotal = allItems.reduce((sum, x) => sum + (x.warnCount || 0), 0);

    UI.statsSummary.innerHTML =
        `<span class="metric-chip">Total <span class="value">${total}</span></span>` +
        `<span class="metric-chip metric-success">Success <span class="value">${success}</span></span>` +
        `<span class="metric-chip metric-failure">Failure <span class="value">${fail}</span></span>` +
        `<span class="metric-chip metric-unknown">Unknown <span class="value">${unknown}</span></span>` +
        `<span class="metric-chip">Highlights <span class="value">${warnTotal}</span></span>` +
        `<span class="metric-chip showing">Showing <span class="value">${shownItems.length}</span></span>`;

    UI.lastUpdated.textContent = parsedAt ? `Parsed: ${parsedAt.toLocaleString()}` : '';
}


function escapeAttr(str) {
    return escapeHtml(str);
}

function updateSortingHeaders() {
    UI.table.querySelectorAll('th.sortable').forEach(th => {
        const active = th.getAttribute('data-key') === sortState.key;
        th.classList.toggle('active', active);
        th.setAttribute('aria-sort', active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '';
    });
}

function attachSorting() {
    const headers = UI.table.querySelectorAll('th.sortable');

    headers.forEach((th) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tls-sort-button';
        button.innerHTML = th.innerHTML;
        button.querySelector('.sort-indicator')?.setAttribute('aria-hidden', 'true');
        th.replaceChildren(button);
        th.setAttribute('scope', 'col');
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-key');
            if (!key) return;

            const isSame = sortState.key === key;
            sortState = {
                key,
                dir: isSame ? (sortState.dir === 'asc' ? 'desc' : 'asc') : 'asc',
            };

            updateSortingHeaders();

            applyFiltersSortAndRender();
        });
    });

    updateSortingHeaders();
}

function updateDirectionFilterButtons() {
    document.querySelectorAll('[data-direction-filter]').forEach((btn) => {
        const isActive = (btn.dataset.directionFilter || 'all') === directionFilter;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function setupDirectionFilter() {
    document.querySelectorAll('[data-direction-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const next = btn.dataset.directionFilter || 'all';
            directionFilter = ['all', 'inbound', 'outbound'].includes(next) ? next : 'all';
            updateDirectionFilterButtons();
            applyFiltersSortAndRender();
        });
    });

    updateDirectionFilterButtons();
}

function openModalForInteraction(id) {
    const it = allInteractions.find((x) => x.id === id);
    if (!it) return;

    const titleBits = [
        `#${it.id}`,
        tlsOutcomeDisplay(it).toUpperCase(),
        tlsDirectionDisplay(it),
        it.peerHost || `Host: ${tlsMissingFactDisplay(it).toLowerCase()}`,
        it.tlsVersion || `TLS: ${tlsMissingFactDisplay(it).toLowerCase()}`,
    ];

    UI.modalTitle.textContent = titleBits.join(' · ');

    const chips = [
        `<span class="chip">Start: <span class="mono">${escapeHtml(it.startTsRaw || 'unknown')}</span></span>`,
        `<span class="chip">End: <span class="mono">${escapeHtml(it.endTsRaw || 'unknown')}</span></span>`,
        `<span class="chip">Clock: <span class="mono">${escapeHtml(it.timeQuality || 'unknown')}</span></span>`,
        `<span class="chip" title="First to last observed record, including closure; not handshake latency">Observed span: <span class="mono">${escapeHtml(fmtDuration(it.durationMs))}</span></span>`,
        `<span class="chip">Threads: <strong>${it.threadCount ?? '—'}</strong></span>`,
        `<span class="chip">Lines: <strong>${it.lineCount || it.rawLines.length}</strong></span>`,
    ];

    const failureBlock = it.failureReason
        ? `
        <div class="block">
          <h3>Failure reason</h3>
          <div class="pr-card" style="margin:0;">
            <div class="mono">${escapeHtml(it.failureReason)}</div>
          </div>
        </div>
      `
        : '';

    const outcomeDetail = tlsUncertaintyExplanation(it) || it.outcomeDetail;
    const outcomeDetailBlock = outcomeDetail
        ? `
        <div class="block">
          <h3>Explanation</h3>
          <div class="pr-card" style="margin:0;">
            <div>${escapeHtml(outcomeDetail)}</div>
          </div>
        </div>
      `
        : '';
		const uniqueEvidenceText = (items) => items
		    .map(e => e.text)
		    .filter((v, idx, arr) => v && arr.indexOf(v) === idx);
		const evidenceItems = uniqueEvidenceText((it.failureEvidence || [])
		    .filter(e => e.phase !== 'post-handshake'));
		const postHandshakeEvidenceItems = uniqueEvidenceText((it.failureEvidence || [])
		    .filter(e => e.phase === 'post-handshake'));

		const evidenceBlock = evidenceItems.length
		    ? `
		      <div class="block">
		        <h3>Handshake diagnostics</h3>
		        <pre class="body-pre">${escapeHtml(evidenceItems.join('\n'))}</pre>
		      </div>
		    `
		    : '';
		const postHandshakeEvidenceBlock = postHandshakeEvidenceItems.length
		    ? `
		      <div class="block">
		        <h3>Diagnostics after the observed Finished exchange</h3>
		        <pre class="body-pre">${escapeHtml(postHandshakeEvidenceItems.join('\n'))}</pre>
		      </div>
		    `
		    : '';
    const highlights = (it.warningHighlights || []).slice(0, 50);
    const highlightsBlock = highlights.length
        ? `
      <div class="block">
        <h3>Highlights (matched failure keywords)</h3>
        <pre class="body-pre">${escapeHtml(highlights.join('\n'))}</pre>
      </div>
    `
        : '';

    const raw = it.rawLines || [];
    const rawHtml = raw.map((line) => renderRawLine(line)).join('');
	const certificateAuthoritiesDetails = certificateAuthoritiesDetailsText(it);

    UI.modalBody.innerHTML = `
    <div class="chips" style="margin-bottom: 0.8rem;">${chips.join('')}</div>

    <div class="pr-details-grid">
      <div class="pr-card pr-sticky">
        <div class="pr-card-title">Summary</div>

        <dl class="kv">
          <dt>Grouping</dt><dd>${escapeHtml(it.correlationQuality)}</dd>
          <dt>Outcome</dt><dd>${badgeOutcome(it)}</dd>
		  <dt>Direction</dt><dd>${badgeDirection(it)}</dd>
		  <dt>TID</dt><dd class="mono">${escapeHtml(it.tidDisplay || '—')}</dd>
		  <dt>Peer host</dt><dd class="mono">${escapeHtml(it.peerHost || tlsMissingFactDisplay(it))}</dd>
          <dt>SNI</dt><dd class="mono">${escapeHtml(it.sni || tlsMissingFactDisplay(it))}</dd>
          <dt>TLS</dt><dd class="mono">${escapeHtml(it.tlsVersion || tlsMissingFactDisplay(it))}</dd>
          <dt>Certificate authorities</dt>
		  <dd class="mono"><pre class="body-pre" style="margin:0; white-space:pre-wrap;">${escapeHtml(certificateAuthoritiesDetails)}</pre></dd>
          <dt>Cipher</dt><dd class="mono">${escapeHtml(it.cipherSuite || tlsMissingFactDisplay(it))}</dd>
		  <dt>Client cert</dt>
		  <dd class="mono">${escapeHtml(clientCertificateDetailsText(it))}</dd>
        </dl>

        <div class="pr-actions">
          <button class="btn btn-sm" type="button" id="copySummaryBtn">Copy summary</button>
        </div>

 
      </div>

      <div>
        ${failureBlock}
		${evidenceBlock}
		${postHandshakeEvidenceBlock}
		${outcomeDetailBlock}
        ${highlightsBlock}
        <div class="block">
          <h3>Raw lines</h3>
		  <div class="pr-card" style="padding:0.75rem;">
		    <div class="mono tls-raw-block">
		      ${rawHtml}
		    </div>
		  </div>
        </div>
      </div>
    </div>
  `;

    // copy handlers inside modal
    const copySummaryBtn = UI.modalBody.querySelector('#copySummaryBtn');
    if (copySummaryBtn) {
        copySummaryBtn.addEventListener('click', async () => {
            const summary = buildSummaryText(it);
            copySummaryBtn.disabled = true;
            const copied = await copyToClipboard(summary);
            if (copySummaryBtn.isConnected) flashButton(copySummaryBtn, copied ? 'Copied ✅' : 'Copy failed');
        });
    }

    const copyRaw = async () => {
        UI.modalCopyBtn.disabled = true;
        const copied = await copyToClipboard(it.rawLines.join('\n'));
        if (UI.modalCopyBtn.onclick === copyRaw) flashButton(UI.modalCopyBtn, copied ? 'Copied ✅' : 'Copy failed');
    };
    UI.modalCopyBtn.onclick = copyRaw;
    UI.modalCopyBtn.textContent = 'Copy raw';
    UI.modalCopyBtn.disabled = false;

    showDialog(UI.modal);
}

function buildSummaryText(it) {
    const events = [];
    if (it.sawClientHello) events.push('ClientHello');
    if (it.sawServerHello) events.push('ServerHello');
    if (it.sawCertRequest) events.push('CertificateRequest');
    if (it.sawCertificateAuthoritiesBlock) events.push('CertificateAuthorities');
    if (it.sawHandshakeFinished) events.push('HandshakeFinished');
    if (it.sawClientCertSelectionFailure) events.push('ClientCertSelectionFailed');

    let out = '';
    out += '=== TLS Interaction Summary ===\n';
    out += 'Analyzer: JvmScope · Java TLS Log Analyzer\n';
    out += `Outcome: ${String(it.outcome).toUpperCase()}\n`;
    const uncertainty = tlsUncertaintyExplanation(it);
    if (uncertainty) out += `Outcome explanation: ${uncertainty}\n`;
    out += `Start: ${it.startTsRaw || 'unknown'}\n`;
    out += `End:   ${it.endTsRaw || 'unknown'}\n`;
    out += `Clock quality: ${it.timeQuality || 'unknown'}\n`;
    out += `Observed span: ${fmtDuration(it.durationMs)}\n`;
    out += `Threads: ${it.threads && it.threads.size ? Array.from(it.threads).join(', ') : 'unknown'}\n`;
    out += `TLS version: ${it.tlsVersion || tlsMissingFactDisplay(it)}\n`;
	if ((it.certificateAuthorities || []).length) {
	    out += 'Certificate authorities:\n';
	    for (const authority of it.certificateAuthorities) out += `  - ${authority}\n`;
	} else if (it.sawCertRequest) {
	    out += `Certificate authorities: ${certificateAuthoritiesDetailsText(it)}\n`;
	} else {
	    out += 'Certificate authorities: not requested / not seen\n';
	}
	out += `Client certificate: ${clientCertificateDetailsText(it)}\n`;
    out += `Cipher suite: ${it.cipherSuite || tlsMissingFactDisplay(it)}\n`;
    out += `SNI: ${it.sni || tlsMissingFactDisplay(it)}\n`;
    out += `Peer host: ${it.peerHost || tlsMissingFactDisplay(it)}\n`;
	out += `Direction: ${tlsDirectionDisplay(it)}\n`;
	out += `TID: ${it.tidDisplay || 'unknown'}\n`;
	out += `Events: ${events.length ? events.join(', ') : 'none detected'}\n`;
    if (it.failureReason) out += `Failure reason: ${it.failureReason}\n`;
    if ((it.outcome || '').toLowerCase() === 'failure' && (it.warningHighlights || []).length) {
        out += 'Failure highlights:\n';
        for (const w of it.warningHighlights) out += `  - ${w}\n`;
    }
    out += `Line count: ${(it.rawLines || []).length}\n`;
    out += '\n=== Raw Lines ===\n';
    for (const l of it.rawLines || []) out += `${l}\n`;
    return out;
}

function renderRawLine(line) {
    const escaped = escapeHtml(line);
    // Highlight the same failure tokens used for warning counts (best-effort).
    if (!TLS_FAILURE_HIGHLIGHT.test(line)) {
    return `<div class="rawline" style="white-space:pre-wrap;">${escaped}</div>`;
    }

    // Replace each match with <mark> while keeping HTML safe.
    // We'll re-run on the original string and rebuild.
    const re = new RegExp(TLS_FAILURE_HIGHLIGHT.source, 'ig');
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        parts.push(escapeHtml(line.slice(last, start)));
        parts.push(`<mark>${escapeHtml(line.slice(start, end))}</mark>`);
        last = end;
    }
    parts.push(escapeHtml(line.slice(last)));
   return `<div class="rawline" style="white-space:pre-wrap;">${parts.join('')}</div>`;
}

function showDialog(dialogEl) {
    dialogEl.classList.remove('hidden');
    dialogEl.setAttribute('aria-hidden', 'false');
    if (typeof dialogEl.showModal === 'function') {
        try { dialogEl.showModal(); } catch { /* ignore */ }
    }
}

function closeDialog(dialogEl) {
    dialogEl.classList.add('hidden');
    dialogEl.setAttribute('aria-hidden', 'true');
    if (typeof dialogEl.close === 'function') {
        try { dialogEl.close(); } catch { /* ignore */ }
    }
}


function closeIssueModal() {
    if (!UI.issueModal) return;
    closeDialog(UI.issueModal);
}

UI.issueModal?.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeIssueModal();
});

UI.issueModal?.addEventListener("click", (e) => {
    if (e.target && e.target.getAttribute("data-close") === "issue") closeIssueModal();
});

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Both copy controls belong to TLS details. Native modal dialogs make
        // elements outside the dialog inert, so select the fallback inside it.
        const ta = document.createElement('textarea');
        const focused = document.activeElement;
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        try {
            (UI.modal.open ? UI.modal : document.body).appendChild(ta);
            ta.select();
            return document.execCommand('copy');
        } catch {
            return false;
        } finally {
            ta.remove();
            if (focused?.isConnected) focused.focus({ preventScroll: true });
        }
    }
}

function flashButton(btn, label, ms = 900) {
    const old = btn.textContent;
    const handler = btn.onclick;
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(() => {
        // The raw-copy button is reused when another interaction is opened.
        if (!btn.isConnected || btn.onclick !== handler) return;
        btn.textContent = old;
        btn.disabled = false;
    }, ms);
}

// --- Wiring ---
attachSorting();
setupDirectionFilter();
setupRichTooltips(UI.dropZone || UI.table);

const helpSearch = createHelpSearch(UI.helpModal);
UI.helpBtn.addEventListener('click', () => { showDialog(UI.helpModal); helpSearch.reset(); });
UI.helpClose.addEventListener('click', () => closeDialog(UI.helpModal));
UI.helpClose2.addEventListener('click', () => closeDialog(UI.helpModal));
UI.helpModal.addEventListener('cancel', e => {
    e.preventDefault();
    closeDialog(UI.helpModal);
});
UI.helpModal.addEventListener('click', e => {
    if (e.target instanceof Element && e.target.getAttribute('data-close') === 'help') closeDialog(UI.helpModal);
});


bindAnalyzerStart({ choose: () => UI.fileInput.click(), sample: () => UI.loadSampleBtn.click() });
bindAnalyzerDropZones(files => loadFile(files[0]));

UI.fileInput.addEventListener('change', async () => {
    const f = UI.fileInput.files && UI.fileInput.files[0];
    if (!f) return;
    await loadFile(f);
});

UI.refreshBtn.addEventListener('click', () => applyFiltersSortAndRender());
function setTableColumns(mode) {
    UI.table.classList.toggle('tls-overview-columns', mode === 'overview');
    UI.table.classList.toggle('tls-investigation-columns', mode === 'investigate');
    document.body.classList.toggle('tls-investigating', mode === 'investigate');
    document.getElementById('tlsPeriodMenu').open = mode !== 'investigate';
    for (const [id, value] of [['tlsInvestigateColumns', 'investigate'], ['tlsOverviewColumns', 'overview'], ['tlsAllColumns', 'all']]) {
        document.getElementById(id).setAttribute('aria-pressed', String(mode === value));
        document.getElementById(id).classList.toggle('active', mode === value);
    }
    UI.tableScroll.scrollLeft = 0;
    renderTable(filteredInteractions);
}
document.getElementById('tlsInvestigateColumns').addEventListener('click', () => setTableColumns('investigate'));
document.getElementById('tlsOverviewColumns').addEventListener('click', () => setTableColumns('overview'));
document.getElementById('tlsAllColumns').addEventListener('click', () => setTableColumns('all'));
UI.searchInput.addEventListener('input', debounce(applyFiltersSortAndRender, 120));

UI.onlyFailuresToggle.addEventListener('change', () => {
    if (UI.onlyFailuresToggle.checked) UI.onlySuccessToggle.checked = false;
    applyFiltersSortAndRender();
});
UI.onlySuccessToggle.addEventListener('change', () => {
    if (UI.onlySuccessToggle.checked) UI.onlyFailuresToggle.checked = false;
    applyFiltersSortAndRender();
});
UI.onlyWarningsToggle.addEventListener('change', () => applyFiltersSortAndRender());

async function loadTlsExample(sample) {
    const requestId = beginInputRequest();
    const controller = new AbortController();
    exampleReadController = controller;
    setLoading(true);
    hideError();
    try {
        const text = await readExample(sample, { signal: controller.signal });
        if (!inputRequestGate.isCurrent(requestId)) return;
        const prepared = await analysisClient.analyze(text);
        if (!prepared || !inputRequestGate.isCurrent(requestId)) return;
        if (!prepared.analysis.interactions.length) throw new Error('The downloaded file did not contain a supported TLS trace.');
        await loadText(text, sample.filename, requestId, prepared);
    } catch (error) {
        if (inputRequestGate.isCurrent(requestId)) showError(`Could not load example: ${error.message} Try again or choose a local log file. The current capture was kept.`);
    } finally {
        if (exampleReadController === controller) exampleReadController = null;
        if (inputRequestGate.isCurrent(requestId)) setLoading(false);
    }
}
createExamplePicker({ samples: TLS_EXAMPLES, analyzer: 'tls',
    button: document.getElementById('chooseExampleBtn'), onLoad: loadTlsExample });
UI.loadSampleBtn.addEventListener('click', () => loadTlsExample(TLS_EXAMPLES[0]));

UI.clearBtn.addEventListener('click', () => {
    analysisClient.cancel();
    tablePage = 0;
    exampleReadController?.abort();
    exampleReadController = null;
    inputRequestGate.invalidate();
    setLoading(false);
    lastLoadedText = '';
    allInteractions = [];
    selectedInteraction = null;
    filteredInteractions = [];
    analysisEntries = [];
    parsedAt = null;
    Object.assign(filters, createTlsFilters());
    analysisView.setData([]);
    renderInspector();
    UI.fileInput.value = '';
    UI.tableScroll.scrollLeft = 0;
    UI.tableScroll.scrollTop = 0;
    UI.fileName.textContent = 'No file loaded';
    UI.fileName.title = '';
    UI.searchInput.value = '';
    UI.onlyFailuresToggle.checked = false;
    UI.onlySuccessToggle.checked = false;
    UI.onlyWarningsToggle.checked = false;
    directionFilter = 'all';
    updateDirectionFilterButtons();
    hideError();
    renderTable([]);
    renderMeta([], []);
    analysisView.render();
    renderAnalyzerStart(false);
});


// Table click handler
UI.tbody.addEventListener('click', (e) => {
    // In some cases (rare, but it happens), `e.target` can be a Text node.
    // Text nodes don't have `.closest()`, which would break the handler and make the UI feel "unclickable".
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!el) return;

    const nameFilter = el.closest('button[data-name-field]');
    if (nameFilter) {
        filters[nameFilter.dataset.nameField] = [nameFilter.dataset.nameKey];
        applyFiltersSortAndRender();
        return;
    }

    const select = el.closest('[data-select-id]');
    if (select) { selectInteraction(Number(select.dataset.selectId)); return; }
    if (UI.table.classList.contains('tls-investigation-columns') && !el.closest('button') && !window.getSelection()?.toString()) {
        const row = el.closest('tr[data-id]');
        if (row) selectInteraction(Number(row.dataset.id));
    }
    const btn = el.closest('button[data-action="details"]');
    if (!btn) return;

    const id = Number(btn.getAttribute('data-id'));
    if (!Number.isFinite(id)) return;
    openModalForInteraction(id);
});
UI.tbody.addEventListener('keydown', event => {
    const focused = event.target.closest('.tls-select-btn');
    if (!focused || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    selectInteraction(Number(focused.dataset.selectId));
    stepInteraction(event.key === 'ArrowDown' ? 1 : -1);
    UI.tbody.querySelector(`[data-select-id="${selectedInteraction?.id}"]`)?.focus({ preventScroll: true });
});

// Modal close behavior
UI.modalClose.addEventListener('click', () => closeDialog(UI.modal));
UI.modalClose2.addEventListener('click', () => closeDialog(UI.modal));
UI.modal.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!el) return;
    const backdrop = el.closest('.modal-backdrop');
    if (backdrop) closeDialog(UI.modal);
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !UI.modal.classList.contains('hidden')) closeDialog(UI.modal);
});

async function loadFile(file) {
    const requestId = beginInputRequest();
    setLoading(true);
    hideError();
    try {
        const text = await file.text();
        if (!inputRequestGate.isCurrent(requestId)) return;
        await loadText(text, file.name, requestId);
    } catch (error) {
        if (inputRequestGate.isCurrent(requestId)) {
            showError(`Could not read file: ${error?.message || String(error)}`);
        }
    } finally {
        if (inputRequestGate.isCurrent(requestId)) setLoading(false);
    }
}

async function loadText(text, name, requestId = beginInputRequest(), exampleAnalysis = null) {
    if (!inputRequestGate.isCurrent(requestId)) return;
    setLoading(true);
    hideError();
    UI.tableScroll.scrollLeft = 0;
    UI.tableScroll.scrollTop = 0;

    try {
        const prepared = exampleAnalysis || await analysisClient.analyze(text);
        if (!prepared || !inputRequestGate.isCurrent(requestId)) return;
        const { analysis, entries } = prepared;
        lastLoadedText = text;
        UI.fileName.textContent = name;
        UI.fileName.title = name;
        allInteractions = analysis.interactions;
        selectedInteraction = null;
        autoSelectInteraction = true;
        analysisEntries = entries;
        parsedAt = new Date();
        // Names and periods belong to a particular capture. Generic controls
        // keep their existing behavior when the next file is loaded.
        filters.hosts = []; filters.snis = []; filters.failures = [];
        filters.range = null; filters.timeMode = 'all';
        analysisView.setData(analysisEntries);
        if (analysis.warnings.length) showError(analysis.warnings.join(' '));

        // default sort: most recent first by startTs
        sortState = { key: 'startTs', dir: 'desc' };
        updateSortingHeaders();

        applyFiltersSortAndRender();
    } catch (err) {
        console.error(err);
        if (inputRequestGate.isCurrent(requestId)) showError(`Parse error: ${err?.message || String(err)} The current capture was kept.`);
    } finally {
        if (inputRequestGate.isCurrent(requestId)) setLoading(false);
    }
}

for (const [id, step] of [['tlsPreviousPage', -1], ['tlsNextPage', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
        tablePage = Math.max(0, Math.min(Math.ceil(filteredInteractions.length / PAGE_SIZE) - 1, tablePage + step));
        renderTable(filteredInteractions);
        UI.tableScroll.scrollTop = 0;
    });
}
window.addEventListener('pagehide', () => analysisClient.cancel());

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}





UI.issueModalClose?.addEventListener('click', closeIssueModal);
UI.issueModalClose2?.addEventListener('click', closeIssueModal);


function openIssueModal(issueText) {
    const match = explainIssueText(issueText);

    const title = match ? `Explain issues: ${failureLabel(match.key)}` : "Explain issues";
    const explanation = match?.locallyRaised
        ? `The local JVM raised the TLS alert.\n\n${match.explanation}`
        : match?.explanation;
    const body = match
        ? `<pre class="body-pre">${escapeHtml(explanation)}</pre>`
        : `<div class="muted">No explanation found yet for:</div>
       <pre class="body-pre">${escapeHtml(String(issueText || "(empty)"))}</pre>
       <div class="muted" style="margin-top:10px;">Use Details to inspect the surrounding log messages for more context.</div>`;

    UI.issueModalTitle.textContent = title;
    UI.issueModalBody.innerHTML = body;

    showDialog(UI.issueModal);
}
document.getElementById("tlsTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest(".explain-btn");
    if (!btn) return;

    const issue = btn.getAttribute("data-issue") || "";
    openIssueModal(issue);
});

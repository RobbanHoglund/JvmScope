import { tlsObservedSequence, tlsDiagnosis, tlsCaptureCoverage } from './tls-sequence-model.js';
import { certificateAuthoritiesDetailsText, clientCertificateDetailsText, peerHostTooltipBody } from './tls-view-model.js';
import { explainIssueText } from './tls-explanations.js';

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const time = epoch => epoch == null ? 'No clock' : new Date(epoch).toISOString().slice(11, 23);
const elapsed = ms => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;

export function createTlsInspector({ root, onDetails, onStep, copy }) {
    let selected = null, sequence = [], activeTab = 'sequence', rawRendered = false;
    let sourceLines = [];
    function activateTab(name, focus = false) {
        activeTab = name;
        root.querySelectorAll('[role="tab"]').forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            if (focus && active) tab.focus();
        });
        root.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
        if (name === 'raw' && !rawRendered) {
            const lines = root.querySelector('.tls-inspector-raw');
            lines.innerHTML = selected.rawLines.map((line, index) => `<div class="tls-source-row" data-raw-index="${index}" tabindex="-1"><span class="tls-source-number">${sourceLine(index)}</span><span class="rawline">${escape(line)}</span></div>`).join('');
            rawRendered = true;
        }
    }
    function sourceLine(index) {
        return sourceLines[index] ?? '—';
    }
    function showRaw(index) {
        activateTab('raw');
        root.querySelectorAll('.tls-source-row.is-evidence').forEach(line => line.classList.remove('is-evidence'));
        const line = root.querySelector(`[data-raw-index="${index}"]`);
        if (!line) return;
        line.classList.add('is-evidence');
        root.querySelector('#tlsEvidenceLocation').textContent = `Selected evidence · source line ${sourceLine(index)}`;
        line.focus({ preventScroll: true });
        line.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    root.addEventListener('click', async event => {
        const button = event.target.closest('button');
        if (!button || !selected) return;
        if (button.dataset.tab) activateTab(button.dataset.tab);
        if (button.dataset.event != null) showRaw(sequence[Number(button.dataset.event)].rawIndex);
        if (button.dataset.step) onStep(Number(button.dataset.step));
        if (button.dataset.action === 'full') onDetails(selected.id);
        if (button.dataset.action === 'copy') {
            const original = button.textContent;
            button.disabled = true;
            const copied = await copy(selected.rawLines.join('\n'));
            if (!button.isConnected) return;
            button.textContent = copied ? 'Copied' : 'Copy failed — retry';
            setTimeout(() => {
                if (button.isConnected) { button.textContent = original; button.disabled = false; }
            }, 900);
        }
    });
    root.addEventListener('keydown', event => {
        const tab = event.target.closest('[role="tab"]');
        if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const names = ['sequence', 'certificates', 'raw'];
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 :
            (names.indexOf(activeTab) + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        activateTab(names[index], true);
    });
    function render(interaction, position, count) {
        if (selected === interaction && root.childElementCount) {
            const previous = root.querySelector('[data-step="-1"]'), next = root.querySelector('[data-step="1"]');
            if (previous) previous.disabled = position <= 0;
            if (next) next.disabled = position >= count - 1;
            return;
        }
        selected = interaction; rawRendered = false; activeTab = 'sequence'; sourceLines = [];
        root.dataset.selectedId = interaction?.id || '';
        if (!interaction) {
            root.innerHTML = `<div class="tls-inspector-empty"><span class="tls-empty-symbol" aria-hidden="true">↔</span><h2>Select an interaction</h2><p>Follow the observed handshake, inspect certificates, and jump directly to its raw evidence.</p><p class="muted">Use a row or its # button. Filters only change the list; they never trim an interaction's evidence.</p></div>`;
            return;
        }
        const it = interaction;
        sourceLines = Array(it.rawLines.length);
        for (const record of it.observedRecords || []) {
            for (let index = record.rawStart; index < record.rawEnd; index++) sourceLines[index] = record.sourceStart + index - record.rawStart;
        }
        sequence = tlsObservedSequence(it);
        const explanation = it.outcome === 'failure' ? explainIssueText(it.failureReason) : null;
        const span = it.durationMs >= 0 ? elapsed(it.durationMs) : 'Not captured';
        const verdictDetail = it.failureReason || it.outcomeDetail || (it.outcome === 'success'
            ? 'Local handshake completion observed; peer acceptance and application health are not established.'
            : 'No final outcome was captured.');
        const grouping = it.correlationQuality === 'thread-based'
            ? `Grouped by JVM thread ${it.tidDisplay}. Thread identity is not a connection ID.`
            : it.correlationQuality === 'ambiguous-thread'
                ? `Conflicting records share JVM thread ${it.tidDisplay}. This is an observation group, not a verified connection. ${it.correlationWarnings.join(' ')}`
            : it.correlationQuality === 'ambiguous-legacy'
                ? 'Interleaved legacy logging: connection identity is uncertain. No single-connection sequence is inferred.'
                : 'Legacy logging: handshake bodies have no reliable connection ID or timestamps.';
        const events = sequence.map((item, index) => {
            const flow = ['Produced', 'Sent'].includes(item.action) ? 'Local JVM → peer' : ['Consumed', 'Received'].includes(item.action) ? 'Peer → local JVM' : 'Local observation';
            const title = item.action === 'Received' ? item.title.replace(/^Received /, '') : item.action === 'Sent' ? item.title.replace(/^Sent /, '') : item.title;
            return `<li class="tls-event tls-event-${item.kind}"><div class="tls-event-clock"><time title="${escape(item.tsRaw || 'Timestamp not captured')}">${time(item.epochMillis)}</time></div><div class="tls-event-content"><div class="tls-event-title"><span class="tls-event-action">${escape(item.action)}</span><strong>${escape(title)}</strong></div><span class="tls-event-flow">${flow}${item.postHandshake ? ' · after completion' : ''}</span></div><button type="button" class="tls-evidence-link" data-event="${index}" aria-label="Show source line ${item.sourceLine}">L${item.sourceLine} ↗</button></li>`;
        }).join('');
        root.innerHTML = `
            <header class="tls-inspector-header"><div><span class="tls-eyebrow">Interaction #${it.id}</span><h2>${escape(it.peerHost || it.sni || 'Unknown endpoint')}</h2></div><div class="tls-inspector-navigation"><button class="btn btn-sm" data-step="-1" type="button" aria-label="Previous interaction" ${position <= 0 ? 'disabled' : ''}>↑</button><button class="btn btn-sm" data-step="1" type="button" aria-label="Next interaction" ${position >= count - 1 ? 'disabled' : ''}>↓</button><button class="btn btn-sm" data-action="full" type="button">Full details</button></div></header>
            <div class="tls-inspector-facts"><span class="tls-inspector-outcome tls-verdict-${it.outcome}">${escape(it.outcome)}</span><span>${escape(it.direction)}</span><span>${escape(it.tlsVersion || 'TLS not captured')}</span><span title="First to last observed log record, including closure. This is not handshake latency.">Observed span <strong>${span}</strong></span></div>
            <div class="tls-verdict tls-verdict-${it.outcome}" title="${escape(verdictDetail)}" ><strong>${escape(tlsDiagnosis(it))}</strong></div>
            <p class="tls-grouping-note">${escape(grouping)}</p>
            <div class="tls-inspector-tabs" role="tablist" aria-label="Interaction evidence"><button type="button" role="tab" id="tlsSequenceTab" aria-controls="tlsSequencePanel" aria-selected="true" data-tab="sequence">Sequence <span>${sequence.length}</span></button><button type="button" role="tab" id="tlsCertificatesTab" aria-controls="tlsCertificatesPanel" aria-selected="false" tabindex="-1" data-tab="certificates">Certificates</button><button type="button" role="tab" id="tlsRawTab" aria-controls="tlsRawPanel" aria-selected="false" tabindex="-1" data-tab="raw">Raw log <span>${it.rawLines.length}</span></button></div>
            <section class="tls-inspector-panel" id="tlsSequencePanel" role="tabpanel" aria-labelledby="tlsSequenceTab" data-panel="sequence"><p class="tls-sequence-note">File order · UTC. Produced / consumed describe JSSE observations; delivery is not verified.</p><p class="tls-coverage">${escape(tlsCaptureCoverage(it))}</p><ol class="tls-event-list">${events || '<li class="tls-no-events">No attributable handshake events captured. Inspect the raw log for context.</li>'}</ol>${explanation ? `<details class="tls-possible-explanation"><summary>Possible explanations and checks</summary><p class="tls-sequence-note">General guidance for this diagnostic. A cause must be confirmed against the observed evidence.</p><pre>${escape(explanation.explanation)}</pre></details>` : ''}</section>
            <section class="tls-inspector-panel" id="tlsCertificatesPanel" role="tabpanel" aria-labelledby="tlsCertificatesTab" data-panel="certificates" hidden><h3>Captured certificate information</h3><dl class="tls-certificate-facts"><dt>Peer host</dt><dd>${escape(it.peerHost || 'Not captured')}<small>${escape(peerHostTooltipBody(it))}</small></dd><dt>Requested name / SNI</dt><dd>${escape(it.sni || 'Not captured')}</dd><dt>Negotiated cipher</dt><dd>${escape(it.cipherSuite || 'Not captured')}</dd><dt>Certificate authorities requested by server</dt><dd><pre>${escape(certificateAuthoritiesDetailsText(it))}</pre></dd><dt>Client certificate</dt><dd><pre>${escape(clientCertificateDetailsText(it))}</pre></dd></dl><p class="tls-sequence-note">This summary does not establish certificate validity or peer trust. Full captured certificate records are available in Raw log.</p></section>
            <section class="tls-inspector-panel tls-raw-panel" id="tlsRawPanel" role="tabpanel" aria-labelledby="tlsRawTab" data-panel="raw" hidden><div class="tls-raw-toolbar"><span id="tlsEvidenceLocation">Complete interaction · original source line numbers</span><button class="btn btn-sm" type="button" data-action="copy">Copy raw</button></div><div class="tls-inspector-raw"></div></section>`;
        root.querySelectorAll('.tls-inspector-panel').forEach(panel => { panel.scrollTop = 0; });
        root.querySelectorAll('[role="tabpanel"]').forEach(panel => { panel.tabIndex = 0; });
    }
    return { render };
}

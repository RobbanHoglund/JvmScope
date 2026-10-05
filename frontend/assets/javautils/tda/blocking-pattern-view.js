import { escapeHtml as h, escapeAttr as a } from './ui-safety.js';
import { patternSnapshot } from './blocking-patterns.js';

export function renderBlockingPatternView(root, { patterns, summary, selectedKey, dumps, snapshotIndex, onSelect, onSnapshot, onThread, onReport }) {
    const pattern = patterns.find(p => p.key === selectedKey);
    const selectedObservation = patternSnapshot(pattern, dumps, snapshotIndex).observation;
    root.innerHTML = `<h3>Follow a blocking pattern</h3><p>Rank: peak unique observed dependents, then comparable recurrence. Snapshot observations only.</p>
        <label>Pattern <select id="blockingPatternSelect"><option value="">Full snapshot graph</option>${patterns.map(p => `<option value="${a(p.key)}"${p.key === selectedKey ? ' selected' : ''}>${h(p.title)} · peak ${p.peakDependents} · recurrence ${p.comparableRecurrences}</option>`).join('')}</select></label>
        ${summary?.status === 'limited' ? `<p role="status">${h(summary.reason)}</p>` : !patterns.length ? '<p>No identified blocker with observed dependents. Unresolved owners remain available in the full graph.</p>' : ''}
        ${pattern ? `<p>${h(pattern.priorityReason)}</p><div class="blocking-snapshots">${dumps.map(d => {
            const view = patternSnapshot(pattern, dumps, d.index), o = view.observation;
            return `<button class="btn btn-sm" data-blocking-snapshot="${d.index}" aria-pressed="${d.index === snapshotIndex}">#${d.index + 1}: ${o ? `${o.dependentCount} unique (${o.directCount} direct, ${o.indirectCount} indirect)${o.complete ? '' : ' · partial/lower bound'}${o.uncertainDependentCount ? ` + ${o.uncertainDependentCount} uncertain` : ''}` : h(view.status)}</button>`;
        }).join(' ')}</div>${renderObservation(patternSnapshot(pattern, dumps, snapshotIndex).observation)}<p class="muted">${h(pattern.limitations)}</p>
        ${onReport ? `<label>Report scope <select id="blockingReportScope"><option value="snapshot">Selected snapshot only</option><option value="pattern">All observed snapshots of this pattern</option></select></label> <button class="btn btn-sm" id="addBlockingReport"${selectedObservation ? '' : ' disabled'}>Add to report</button>` : ''}` : ''}`;
    root.querySelector('select').addEventListener('change', e => onSelect(e.target.value));
    root.querySelectorAll('[data-blocking-snapshot]').forEach(el => el.addEventListener('click', () => onSnapshot(Number(el.dataset.blockingSnapshot))));
    root.querySelectorAll('[data-blocking-thread]').forEach(el => el.addEventListener('click', () => onThread(el.dataset.blockingThread, el)));
    root.querySelector('#blockingReportScope')?.addEventListener('change', e => { root.querySelector('#addBlockingReport').disabled = !selectedObservation && e.target.value !== 'pattern'; });
    root.querySelector('#addBlockingReport')?.addEventListener('click', () => onReport(pattern, root.querySelector('#blockingReportScope').value === 'pattern'));
}
function threadLink(thread) {
    return `<button class="btn btn-sm" data-blocking-thread="${a(thread.sourceKey)}">${h(thread.name)} · snapshot raw L${thread.startLine ?? '?'}–${thread.endLine ?? '?'}</button>`;
}
function renderObservation(o) {
    if (!o) return '<p>No comparable observed relation in the selected snapshot. This does not establish that the problem was resolved.</p>';
    return `<p>Blocker ${threadLink(o.blocker)} · ${h(o.blocker.sourceLabel)} · snapshot #${o.snapshotIndex + 1} · ${h(o.blocker.timestamp || 'time unavailable')}</p>
        <ul>${o.relations.map(r => `<li>${threadLink(r.waiter)} → ${threadLink(r.owner)} · ${h(r.change)}${r.ambiguous ? ' · ambiguous owner' : ''}${r.cycle ? ' · cycle in this snapshot' : ''} · ${h(r.locks.map(l => `${l.lockId} ${l.lockType || ''}`).join(', '))}</li>`).join('')}
        ${o.noLongerObserved.map(r => `<li>${h(r.waiter.name)} → ${h(r.owner.name)} · ${h(r.change)} (previous snapshot evidence)</li>`).join('')}</ul>`;
}

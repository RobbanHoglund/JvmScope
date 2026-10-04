import { escapeAttr, escapeHtml } from './ui-safety.js';

const PREVIEW_COUNT = 3;

function threadButton(thread) {
    return `<button type="button" class="btn btn-sm contention-thread-btn"
        data-source-key="${escapeAttr(thread.sourceKey || '')}"
        title="Open thread details">${escapeHtml(thread.threadName || 'Unnamed thread')}</button>`;
}

export function isConfirmedContentionDeadlock(chain, cycles = []) {
    const lockId = String(chain.lockId || '').toLowerCase();
    return Boolean(lockId) && cycles.some(cycle => (cycle.threads || []).some(entry =>
        String(entry.waitingLockId || '').toLowerCase() === lockId));
}

function renderWaiters(waiters) {
    const preview = waiters.slice(0, PREVIEW_COUNT).map(threadButton).join('');
    if (waiters.length <= PREVIEW_COUNT) return preview;
    return `${preview}<details class="contention-waiters-more">
        <summary><span class="contention-show-all">Show all ${waiters.length}</span><span class="contention-show-fewer">Show fewer</span></summary>
        <div class="contention-thread-list">${waiters.slice(PREVIEW_COUNT).map(threadButton).join('')}</div>
    </details>`;
}

export function renderContentionTable(chains = [], cycles = []) {
    const sorted = [...chains].sort((a, b) => (b.waiters?.length || 0) - (a.waiters?.length || 0)
        || String(a.lockId).localeCompare(String(b.lockId)));
    return `<div class="contention-table-wrap"><table class="contention-table">
        <caption class="sr-only">Contended locks, ordered by number of waiting threads. Thread buttons open details.</caption>
        <thead><tr><th scope="col">Lock / type</th><th scope="col">Owning threads</th>
        <th scope="col">Waiting threads</th><th scope="col" class="contention-count">Count</th><th scope="col">Actions</th></tr></thead>
        <tbody>${sorted.map(chain => {
            const lockId = String(chain.lockId || 'Unknown lock');
            const lockType = String(chain.lockType || 'Unknown lock type');
            const shortId = lockId.length > 14 ? `0x…${lockId.slice(-8)}` : lockId;
            const shortType = lockType.replace(/^(?:a|an)\s+/, '').split('.').pop();
            const deadlock = isConfirmedContentionDeadlock(chain, cycles);
            return `<tr>
                <td><details class="contention-lock-details">
                    <summary><span><code title="${escapeAttr(lockId)}">${escapeHtml(shortId)}</code>
                        <span class="contention-lock-type">${escapeHtml(shortType)}</span></span>
                        ${deadlock ? '<span class="badge badge-failure contention-deadlock">💀 Deadlock</span>' : ''}
                    </summary>
                    <div class="contention-lock-evidence"><span>Full lock address</span><code>${escapeHtml(lockId)}</code>
                        <span>Type</span><code>${escapeHtml(lockType)}</code>
                        <button type="button" class="btn btn-sm contention-copy-btn" data-copy-lock="${escapeAttr(lockId)}">Copy address</button>
                    </div>
                </details></td>
                <td><div class="contention-thread-list">${(chain.owners || []).map(threadButton).join('') || '<span class="tda-value-neutral">Owner not observed</span>'}</div></td>
                <td><div class="contention-thread-list">${renderWaiters(chain.waiters || [])}</div></td>
                <td class="contention-count">${chain.waiters?.length || 0}</td>
                <td><button type="button" class="btn btn-sm contention-graph-btn" data-lock-id="${escapeAttr(lockId)}">Show in graph</button></td>
            </tr>`;
        }).join('')}</tbody>
    </table></div>`;
}

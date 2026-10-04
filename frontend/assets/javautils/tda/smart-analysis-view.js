import { escapeAttr, escapeHtml } from './ui-safety.js';

function remainingItems(items, limit, label, render) {
    if (items.length <= limit) return '';
    return `<details class="tda-detail-disclosure smart-analysis-overflow">
      <summary><span class="tda-detail-show">Show all ${items.length} ${label}</span><span class="tda-detail-hide">Show fewer ${label}</span></summary>
      <div class="smart-analysis-extra-items">${items.slice(limit).map(render).join('')}</div>
    </details>`;
}

export function renderSmartAnalysisThreadButtons(finding) {
    const threads = Array.isArray(finding?.threads) ? finding.threads : [];
    if (!threads.length) return '';
    const render = (thread) => `<button type="button" class="btn btn-sm smart-analysis-thread-btn"
      data-source-key="${escapeAttr(thread?.sourceKey || '')}"${thread?.sourceKey ? '' : ' disabled'}>${escapeHtml(thread?.name || 'unknown')}</button>`;
    return `<div class="smart-analysis-thread-list" aria-label="Affected threads">
      ${threads.slice(0, 8).map(render).join('')}
      ${remainingItems(threads, 8, 'threads', render)}
    </div>`;
}

export function renderSmartAnalysisResources(finding) {
    const resources = Array.isArray(finding?.resourceIds) ? finding.resourceIds : [];
    if (!resources.length) return '';
    const render = (resource) => `<span class="mono-small smart-analysis-resource">${escapeHtml(resource)}</span>`;
    return `<div class="smart-analysis-resources"><strong>Resources (${resources.length})</strong>
      <div class="smart-analysis-resource-list">${resources.slice(0, 6).map(render).join('')}</div>
      ${remainingItems(resources, 6, 'resources', render)}
    </div>`;
}

/** Pure presentation state for the chart-to-table filtering flow. */

function safeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function filterLabel(chartFilter) {
    const explicitLabel = String(chartFilter?.label ?? '').trim();
    if (explicitLabel) return explicitLabel;

    const kind = String(chartFilter?.kind ?? '').trim();
    const value = String(chartFilter?.value ?? '').trim();
    return kind && value ? `${kind} = ${value}` : '';
}

export function getChartFilterView(chartFilter, totalThreadCount, visibleThreadCount) {
    const totalThreads = safeCount(totalThreadCount);
    const visibleThreads = Math.min(totalThreads, safeCount(visibleThreadCount));
    const isActive = Boolean(
        chartFilter
        && typeof chartFilter === 'object'
        && String(chartFilter.kind ?? '').trim()
        && String(chartFilter.value ?? '').trim()
    );

    return {
        isActive,
        label: isActive ? filterLabel(chartFilter) : '',
        totalThreads,
        visibleThreads,
        hiddenThreads: totalThreads - visibleThreads,
        countText: `Showing ${visibleThreads} of ${totalThreads} threads after all active table filters`,
    };
}

export function getChartLegendItemView(kind, value, chartFilter) {
    const isSameKind = Boolean(chartFilter && chartFilter.kind === kind);
    const isActive = Boolean(isSameKind && chartFilter.value === value);

    return {
        isActive,
        ariaPressed: isActive ? 'true' : 'false',
        opacity: !isSameKind || isActive ? 1 : 0.34,
    };
}

// Presentation decisions stay independent of DOM rendering and parser rules.
export function eventWindow(events, event, start, end) {
    if (!Number.isFinite(event.startMs) || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    const timed = events.filter(e => Number.isFinite(e.startMs)).sort((a, b) => a.startMs - b.startMs);
    const index = timed.findIndex(e => e.id === event.id);
    const nearby = timed.slice(Math.max(0, index - 2), index + 3);
    const gaps = nearby.map(e => Math.abs(e.startMs - event.startMs)).filter(gap => gap > 0);
    const radius = Math.max(event.durationMs * 8, gaps.length ? Math.min(...gaps) * 4 : 0, .01);
    const neighbors = nearby.filter(e => Math.abs(e.startMs - event.startMs) <= radius);
    const from = Math.min(event.startMs, ...neighbors.map(e => e.startMs));
    const to = Math.max(event.endMs, ...neighbors.map(e => e.endMs));
    const padding = Math.max((to - from) * .12, event.durationMs * .5, .01);
    return [Math.max(start, from - padding), Math.min(end, to + padding)];
}

export function captureSummary(model, warnings = []) {
    const exceeded = model.events.filter(e => e.kind === 'pause' && e.durationMs > model.pauseBudgetMs).length;
    const critical = model.findings.filter(f => f.severity === 'critical').length;
    const pressure = model.findings.some(f => ['heap-occupancy', 'jvm-signal'].includes(f.rule));
    const reviews = model.findings.filter(f => f.severity !== 'info').length;
    const headline = !model.stats.pauses ? 'No completed stop-the-world pauses recorded.'
        : exceeded ? `${exceeded} recorded pause${exceeded === 1 ? '' : 's'} exceed${exceeded === 1 ? 's' : ''} your ${model.pauseBudgetMs} ms budget.`
        : `All ${model.stats.pauses} recorded pauses are within your ${model.pauseBudgetMs} ms budget.`;
    const detail = critical ? `${critical} critical JVM signal${critical === 1 ? '' : 's'} recorded. Inspect the evidence below.`
        : pressure ? 'Memory pressure indicators also need review; short pauses alone do not establish healthy memory behavior.'
        : reviews ? 'Other collection markers need review; inspect the recorded causes below.'
        : 'No warning or critical markers found in the analyzed records. This is not an application health assessment.';
    return { headline, detail: detail + (warnings.length ? ' Capture coverage notes apply.' : ''), severity: critical ? 'critical' : reviews ? 'warning' : 'info' };
}

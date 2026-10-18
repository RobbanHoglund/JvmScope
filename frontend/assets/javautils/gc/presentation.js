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

export function panWindow(range, delta) {
    const width = range[1] - range[0];
    const start = Math.max(0, Math.min(1000 - width, range[0] + delta));
    return [start, start + width];
}

// Explain recorded signals without adding new parser rules or diagnoses.
export function describeFinding(finding) {
    if (finding.rule !== 'jvm-signal') return { title: finding.title, detail: finding.detail };
    const text = finding.detail;
    const signals = [
        [/OutOfMemoryError/i, 'Out of memory reported', 'The JVM reported OutOfMemoryError. Check the original message for the affected resource and review surrounding collections.'],
        [/concurrent mode failure/i, 'CMS concurrent mode failure', 'The log records a concurrent mode failure. Review the associated pause, heap occupancy and nearby collections.'],
        [/promotion failed/i, 'Promotion failed', 'The JVM reported a failed promotion. Review surrounding collections and available heap space; this alone does not establish a memory leak.'],
        [/to-space exhausted|Evacuation Failure/i, 'Evacuation failure reported', 'The log reports an evacuation failure. Review the recorded cause, heap occupancy and subsequent collections.'],
        [/Allocation Stall/i, 'Allocation stall', 'An allocating thread stalled. This signal is kept separate from stop-the-world pause time.'],
        [/GC overhead limit/i, 'GC overhead limit reported', 'The JVM reported a GC overhead limit. Inspect the original message and surrounding collections.'],
    ];
    const match = signals.find(([pattern]) => pattern.test(text));
    return match ? { title: match[1], detail: match[2] } : { title: finding.title, detail: 'The JVM emitted a collector pressure signal. Inspect the original message and surrounding collections.' };
}

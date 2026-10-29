// Presentation grouping only. Never infer a relationship from equal counts/names.
function completeValues(page, key = value => value) {
    if (!page || page.offset !== 0 || page.nextOffset != null || !Array.isArray(page.items)
        || page.total !== page.items.length || !page.total) return null;
    const values = page.items.map(key);
    return values.every(value => typeof value === 'string' && value.length) ? new Set(values) : null;
}
function sameDependencies(observed, inferred) {
    const locks = completeValues(observed.resourceIds), otherLocks = completeValues(inferred.resourceIds);
    const waiters = completeValues(observed.threads, thread => thread.sourceKey);
    const participants = completeValues(inferred.threads, thread => thread.sourceKey);
    return locks && otherLocks && waiters && participants && locks.size === otherLocks.size
        && [...locks].every(lock => otherLocks.has(lock)) && [...waiters].every(key => participants.has(key));
}
export function groupFindings(findings) {
    const related = new Map(), consumed = new Set();
    for (const inferred of findings.filter(f => f.id === 'likely-lock-bottleneck')) {
        const observed = findings.find(f => f.id === 'observed-lock-contention' && sameDependencies(f, inferred));
        if (observed) {
            related.set(observed, [...(related.get(observed) || []), inferred]);
            consumed.add(inferred);
        }
    }
    return findings.filter(f => !consumed.has(f)).map(finding => ({ finding, related: related.get(finding) || [] }));
}

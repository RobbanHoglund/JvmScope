import { isTlsCorrelationAmbiguous } from './tls-core.js';

const rank = { critical: 0, high: 1, medium: 2, info: 3 };
const bounded = (value, limit) => {
    const text = String(value ?? '');
    return text.length <= limit ? text : text.slice(0, limit - 1) + '…';
};

/** Local findings from the actual evidence selection, never from model prose. */
export function aiFindingContext(evidence, edited = false) {
    const facts = JSON.parse(evidence.summary), groups = new Map();
    if (facts.interactions) {
        const items = facts.interactions;
        const failed = items.filter(it => it.outcome === 'failure' && !isTlsCorrelationAmbiguous(it));
        const uncertain = items.filter(isTlsCorrelationAmbiguous);
        const incomplete = items.filter(it => it.outcome !== 'success' && it.outcome !== 'failure' && !isTlsCorrelationAmbiguous(it));
        if (failed.length) groups.set('failure', { severity: 'high', title: 'TLS failure observed', detail: `Included interactions: ${failed.map(it => `#${it.id}`).join(', ')}. ${failed[0].diagnosis}`, qualification: 'A captured TLS failure does not establish the root cause or wider application impact.' });
        if (uncertain.length) groups.set('uncertain', { severity: 'medium', title: 'TLS grouping uncertain', detail: `Included interactions: ${uncertain.map(it => `#${it.id}`).join(', ')}.`, qualification: 'Messages cannot reliably be assigned to one connection; apparent outcomes need qualification.' });
        if (incomplete.length) groups.set('incomplete', { severity: 'info', title: 'TLS outcome not captured', detail: `Included interactions: ${incomplete.map(it => `#${it.id}`).join(', ')}.`, qualification: 'Missing Finished messages do not prove failure.' });
    } else {
        for (const snapshot of facts.snapshots || [facts]) {
            for (const finding of snapshot.findings || []) {
                if (!(finding.severity in rank)) continue;
                const key = finding.id || finding.title;
                if (!groups.has(key)) groups.set(key, { ...finding, summaries: [], snapshots: [], counts: [] });
                const group = groups.get(key);
                if (rank[finding.severity] < rank[group.severity]) group.severity = finding.severity;
                group.snapshots.push(snapshot.snapshot);
                if (finding.id === 'confirmed-deadlock') group.counts.push(`${snapshot.reportedDeadlockCycles} JVM-reported cycles and ${snapshot.deadlockCycles.reduce((n, c) => n + c.participants.filter(p => p.mappingStatus === 'resolved').length, 0)} mapped participant entries`);
                group.summaries.push(finding.id === 'confirmed-deadlock'
                    ? `#${snapshot.snapshot}: ${snapshot.reportedDeadlockCycles} JVM-reported cycles, ${snapshot.deadlockCycles.reduce((n, c) => n + c.participants.filter(p => p.mappingStatus === 'resolved').length, 0)} mapped participant entries.`
                    : finding.summary);
            }
        }
        for (const group of groups.values()) group.detail = group.id === 'confirmed-deadlock' ? (new Set(group.counts).size === 1
            ? `${group.counts[0]} in ${group.snapshots.length === 1 ? 'snapshot' : 'each selected snapshot'} (${group.snapshots.map(i => `#${i}`).join(', ')}).` : group.summaries.join(' '))
            : `Snapshots ${group.snapshots.map(i => `#${i}`).join(', ')}. ${[...new Set(group.summaries)].join(' ')}`;
    }
    return { scope: bounded(evidence.scope, 500), edited, findings: [...groups.values()].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 3).map(f => ({
        severity: f.severity, title: bounded(f.title, 160), detail: bounded(f.detail, 1600), qualification: bounded(f.qualification, 800),
    })) };
}

export function resolveThreadEvidence(reports, reportId, snapshotIndex, sourceKey) {
    const report = reports.get(reportId), snapshot = reports.snapshot(reportId, snapshotIndex);
    const metric = snapshot.measurements?.threads.items.find(t => t.sourceKey === sourceKey);
    if (metric) return metric.current;
    const source = report.sources.find(s => s.path === snapshot.sourcePath);
    const listed = snapshot.threadInventory?.items.find(t => t.sourceKey === sourceKey);
    if (listed) return { snapshotIndex, snapshotNumber: snapshotIndex + 1, sourceKey,
        threadName: listed.name, path: source.path, name: source.name, sha256: source.sha256, range: listed.range };
    const participant = snapshot.deadlocks.items.flatMap(c => c.participants.items).find(p => p.id === sourceKey && p.mappingStatus === 'resolved');
    const thread = snapshot.analysis.findings.items.flatMap(f => f.threads.items).find(t => t.sourceKey === sourceKey);
    if (!participant && !thread) throw new Error('Thread identity does not belong to the selected snapshot or its retained evidence.');
    return { snapshotIndex, snapshotNumber: snapshotIndex + 1, sourceKey,
        threadName: participant?.name || thread.name, path: source.path, name: source.name, sha256: source.sha256,
        range: participant?.evidence || (thread?.startLine ? { startLine: thread.startLine, endLine: thread.endLine } : null) };
}

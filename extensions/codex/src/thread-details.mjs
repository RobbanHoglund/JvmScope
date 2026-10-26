import { resolveThreadEvidence } from './thread-evidence.mjs';

export function stackHighlights(lines) {
    const frames = lines.flatMap(({ line, text }) => {
        const match = text.match(/^\s*at\s+(.+?)\s*$/);
        if (!match) return [];
        const frame = match[1], method = frame.slice(0, frame.indexOf('(')).replace(/^.*?\//, '');
        return [{ line, text: frame, jdk: /^(java\.|javax\.|jdk\.|sun\.|com\.sun\.)/.test(method) }];
    });
    // This is a display filter, not proof that a frame belongs to the application.
    const outside = frames.filter(f => !f.jdk && !f.text.includes('$$Lambda'));
    return { items: (outside.length ? outside : frames).slice(0, 3),
        selection: outside.length ? 'outside-jdk-packages' : 'first-recorded-frames',
        recordedFrames: frames.length };
}

export async function threadDetails(reports, jobs, { reportId, snapshotIndex, sourceKeys }, signal) {
    const started = performance.now();
    if (!sourceKeys.length || sourceKeys.length > 5 || new Set(sourceKeys).size !== sourceKeys.length)
        throw new Error('Choose one to five distinct thread sourceKeys from the selected snapshot.');
    const snapshot = reports.snapshot(reportId, snapshotIndex), report = reports.get(reportId);
    const selected = sourceKeys.map(key => resolveThreadEvidence(reports, reportId, snapshotIndex, key));
    const source = report.sources.find(s => s.path === snapshot.sourcePath);
    const evidence = await jobs.run('read_thread_ranges', { path: source.path, sha256: source.sha256,
        ranges: selected.filter(e => e.range).map(e => ({ sourceKey: e.sourceKey, startLine: e.range.startLine,
            endLine: Math.min(e.range.endLine, e.range.startLine + 59) })) }, signal);
    const threads = selected.map(context => {
        const measured = snapshot.measurements.threads.items.find(t => t.sourceKey === context.sourceKey);
        const ref = snapshot.analysis.findings.items.flatMap(f => f.threads.items).find(t => t.sourceKey === context.sourceKey);
        const lines = evidence.ranges.find(r => r.sourceKey === context.sourceKey)?.lines || [];
        return { sourceKey: context.sourceKey, name: context.threadName, state: measured?.state || ref?.state || null,
            cpu: measured?.cpu || { percent: null, status: 'not-retained' },
            allocation: measured?.allocation || { bytesPerSecond: null, boundsBytesPerSecond: null, status: 'not-retained' },
            baseline: measured?.baseline || null, context, lines, highlights: stackHighlights(lines),
            nextLine: lines.length && lines.at(-1).line < context.range.endLine ? lines.at(-1).line + 1 : null,
            citationLabel: `Snapshot ${snapshotIndex + 1} · ${context.threadName}${context.range ? ` · lines ${context.range.startLine}–${context.range.endLine}` : ''}` };
    });
    return { analyzer: 'threads', view: 'threads', reportId, snapshotIndex, snapshotNumber: snapshotIndex + 1,
        snapshotCount: report.snapshotCount, source: evidence.source, threads,
        snapshotDeadlockCycles: snapshot.analysis.deadlockSummary?.cycles || 0,
        warnings: report.warnings || [], qualifications: snapshot.measurements.qualifications,
        timing: { ...evidence.timing, toolWorkMs: Math.round(performance.now() - started), scope: 'Plugin work only; excludes model reasoning and host rendering.' } };
}

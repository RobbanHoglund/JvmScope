import { analyzeThreadDump } from './parser.js';
import { inputSourceLabel } from './input-feedback.js';

/** Parse each source independently: JSON and headerless dumps cannot be concatenated safely. */
export function parseThreadDumpSession(sources = []) {
    const snapshots = [];
    const sourceResults = Array.from(sources || []).map((value, position) => {
        const source = value && typeof value === 'object' ? value : { text: typeof value === 'string' ? value : '' };
        const label = inputSourceLabel(source);
        let result;
        try {
            result = analyzeThreadDump(source?.text, { snapshotIndexOffset: snapshots.length });
        } catch (error) {
            result = { status: 'unsupported', snapshots: [], diagnostics: {}, warnings: [error.message || 'The source could not be parsed.'] };
        }
        const accepted = result.status === 'success' || result.status === 'partial';
        if (accepted) {
            snapshots.push(...result.snapshots.map(snapshot => ({
                ...snapshot,
                sourceId: source?.id ?? `source:${position + 1}`,
                sourceLabel: label,
                sourceKind: source?.kind || 'file',
                sourceSnapshotIndex: snapshot.index - snapshots.length,
            })));
        }
        return { position, label, accepted, status: result.status, warnings: result.warnings,
            diagnostics: result.diagnostics, snapshotCount: accepted ? result.snapshots.length : 0 };
    });
    const accepted = sourceResults.filter(source => source.accepted);
    const sum = key => accepted.reduce((total, source) => total + (source.diagnostics[key] || 0), 0);
    const status = !snapshots.length
        ? sourceResults.every(source => source.status === 'empty') ? 'empty' : 'unsupported'
        : accepted.some(source => source.status === 'partial') ? 'partial' : 'success';
    const warnings = (snapshots.length ? accepted : sourceResults)
        .flatMap(source => source.warnings.map(warning => `${source.label}: ${warning}`));
    const parserResult = { status, snapshots, warnings, diagnostics: {
        supportedThreadHeaders: sum('supportedThreadHeaders'), snapshots: snapshots.length,
        truncatedThreads: sum('truncatedThreads'), unparsedThreadHeaders: sum('unparsedThreadHeaders'),
        headerOnlyVmThreads: sum('headerOnlyVmThreads'), incompleteSnapshots: sum('incompleteSnapshots'),
        skippedRecords: sum('skippedRecords'),
    } };
    return { parserResult, sourceResults };
}

/** Additions run in submission order; Clear/Replace also invalidate unfinished reads. */
export function createSessionInputQueue(onBusy = () => {}) {
    let generation = 0;
    let pending = 0;
    let tail = Promise.resolve();
    return Object.freeze({
        enqueue(operation) {
            const version = generation;
            const isCurrent = () => version === generation;
            pending += 1;
            onBusy(true);
            const task = tail.then(() => isCurrent() ? operation(isCurrent) : undefined);
            tail = task.catch(() => {});
            return task.finally(() => {
                if (!isCurrent()) return;
                pending -= 1;
                onBusy(pending > 0);
            });
        },
        clear() {
            generation += 1;
            pending = 0;
            tail = Promise.resolve();
            onBusy(false);
        },
    });
}

import { threadAiEvidence, threadAiFacts } from '../ai-evidence.js';
import { canCompareThreadCollections } from './snapshot-quality.js';

export const MAX_AI_SNAPSHOTS = 20;
const SUMMARY_LIMIT = 30000, RAW_LIMIT = 35000;
const excerpt = (value, size) => {
    const text = String(value ?? 'Unavailable'), mark = '\n[Excerpt truncated]';
    return text.length <= size ? text : text.slice(0, size - mark.length) + mark;
};

/** The existing analyzer defines process boundaries; this view does not infer new ones. */
export function threadAiSnapshotOptions(dumps, currentIndex) {
    const current = dumps[currentIndex], segment = current?.correlationProcessSegment;
    if (!current?.threads?.length) return null;
    const snapshots = dumps.flatMap((dump, index) => {
        const sameGroup = Number.isInteger(segment) && dump.correlationProcessSegment === segment;
        return dump.threads?.length && (sameGroup || index === currentIndex) ? [{
            index, label: `#${index + 1} · ${excerpt(dump.timestampRaw || 'Time unavailable', 90)} · ${excerpt(dump.sourceLabel || 'Loaded capture', 180)}`,
        }] : [];
    });
    return { currentIndex, snapshots, limit: MAX_AI_SNAPSHOTS,
        note: `Snapshots from the current process group, in capture order. Missing process IDs cannot confirm a shared JVM. Up to ${MAX_AI_SNAPSHOTS} snapshots per request. Changing the selection rebuilds the prompt and replaces edits.` };
}

export function threadSelectionAiEvidence({ dumps, currentIndex, indices = [currentIndex], name }) {
    const options = threadAiSnapshotOptions(dumps, currentIndex);
    if (!options) return null;
    const selected = [...new Set(indices)].sort((a, b) => a - b);
    const allowed = new Set(options.snapshots.map(item => item.index));
    if (!selected.length) throw new Error('Select at least one snapshot.');
    if (selected.some(index => !Number.isInteger(index) || !allowed.has(index))) throw new Error('Choose snapshots from the current process group only.');
    if (selected.length > MAX_AI_SNAPSHOTS) throw new Error(`Choose at most ${MAX_AI_SNAPSHOTS} snapshots for one analysis. No snapshots have been sent.`);
    if (selected.length === 1) return threadAiEvidence({ dump: dumps[selected[0]], snapshotIndex: selected[0], snapshotCount: dumps.length, name });

    const scope = `${selected.length} snapshots of ${dumps.length} · #${selected.map(index => index + 1).join(', #')} · ${excerpt(name, 240)}`;
    const context = {
        scope: 'Only the selected snapshots, in capture order; table filters do not restrict their summaries. Every selected snapshot is represented. Thread and stack excerpts are bounded independently of the complete counts.',
        selectedSnapshots: selected.map(index => index + 1),
        comparisons: selected.slice(1).map((index, position) => ({
            snapshots: [selected[position] + 1, index + 1], adjacent: index === selected[position] + 1,
            collectionsComparable: canCompareThreadCollections(dumps[selected[position]], dumps[index]),
        })),
        limitations: 'Match threads only by the analyzer series keys and identity qualifications, never by name alone. Missing process IDs do not prove a shared JVM; counter resets and ambiguous identities break continuity. Snapshot numbers express capture order, not elapsed time. Repeated waits or stacks do not prove uninterrupted blocking, lack of progress or root cause. CPU intervals refer to the stated adjacent snapshot pair, which may include an unselected snapshot. Missing excerpt entries are not evidence that a thread or issue disappeared. Do not infer disappearance from incomplete or different collections.',
    };
    // Reduce detail evenly across the entire selection. Never silently drop a
    // later snapshot or cut JSON mid-record to fit a provider's context window.
    let summary;
    for (const [threadLimit, stackLimit, findingLimit] of [[12,12,20],[8,4,10],[4,2,5],[2,0,2],[0,0,0]]) {
        summary = JSON.stringify({ ...context, snapshots: selected.map(snapshotIndex => threadAiFacts({
            dump: dumps[snapshotIndex], snapshotIndex, includedSnapshots: selected, threadLimit, stackLimit, findingLimit,
        })) }, null, 2);
        if (summary.length <= SUMMARY_LIMIT) break;
    }
    if (summary.length > SUMMARY_LIMIT) throw new Error('These snapshot summaries exceed the evidence budget. Select fewer snapshots; nothing has been sent.');
    const headings = selected.map(index => `Snapshot #${index + 1} · ${excerpt(dumps[index].sourceLabel || name, 180)} · ${excerpt(dumps[index].timestampRaw || 'Time unavailable', 90)}\n`);
    const perSnapshot = Math.floor((RAW_LIMIT - headings.join('').length - 2 * selected.length) / selected.length);
    const raw = selected.map((index, position) => headings[position] + excerpt(dumps[index].rawText || '', perSnapshot)).join('\n\n');
    return { scope, summary, raw,
        rawLabel: `Selected snapshots’ raw excerpts (at most 35,000 characters total, shared across ${selected.length} snapshots)` };
}

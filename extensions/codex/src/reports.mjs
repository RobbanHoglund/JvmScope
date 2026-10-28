import { randomUUID } from 'node:crypto';

// Per-connection, bounded memory only. Rendering never reparses or writes a capture.
export function createReports({ maxEntries = 12, ttlMs = 600000, now = Date.now } = {}) {
    const entries = new Map();
    const prune = () => { for (const [id, entry] of entries) if (entry.expires <= now()) entries.delete(id); };
    return {
        add(report) {
            prune();
            while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
            const id = randomUUID();
            const snapshots = report._cachedSnapshots || report.snapshots?.items || [];
            delete report._cachedSnapshots;
            if (report.analyzer === 'threads') report.cache = { snapshotCount: snapshots.length,
                complete: snapshots.length === report.snapshotCount, analyzedAt: new Date().toISOString() };
            entries.set(id, { report, snapshots, conclusions: new Map(), expires: now() + ttlMs });
            return id;
        },
        snapshot(id, index) {
            this.get(id);
            const snapshot = entries.get(id).snapshots.find(s => s.index === index);
            if (!snapshot) throw new Error('SNAPSHOTS_NOT_CACHED: Analyze the requested page again with offset/limit.');
            return snapshot;
        },
        conclusion(id, scope, language, input, present = value => value) {
            this.get(id);
            const saved = entries.get(id).conclusions, key = JSON.stringify(scope);
            const candidate = input ? { ...input, language, scope, reportId: id, origin: 'assistant' } : saved.get(key) || null;
            // Build and validate presentation before committing. Failed output must
            // neither replace an assessment nor evict a previously accepted one.
            const output = present(candidate);
            if (input) {
                saved.delete(key);
                while (saved.size >= 24) saved.delete(saved.keys().next().value);
                saved.set(key, candidate);
            }
            return output;
        },
        page(id, { offset, limit, snapshotIndex } = {}) {
            const report = this.get(id);
            if (snapshotIndex != null) { this.snapshot(id, snapshotIndex); offset ??= snapshotIndex; }
            if (offset == null && limit == null) return report;
            offset ??= report.snapshots.offset;
            limit ??= report.snapshots.limit;
            const items = [];
            for (let index = offset; index < Math.min(report.snapshotCount, offset + limit); index++) items.push(this.snapshot(id, index));
            if (snapshotIndex != null && !items.some(s => s.index === snapshotIndex))
                throw new Error('Requested snapshot is outside this report page. Adjust offset/limit to include snapshotIndex.');
            return { ...report, snapshots: { total: report.snapshotCount, offset, limit,
                nextOffset: offset + limit < report.snapshotCount ? offset + limit : null, items } };
        },
        get(id) {
            prune();
            const entry = entries.get(id);
            if (!entry) throw new Error('Report expired or belongs to another session. Run analyze_thread_dumps again.');
            return entry.report;
        },
    };
}

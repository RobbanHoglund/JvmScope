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
            entries.set(id, { report, snapshots, expires: now() + ttlMs });
            return id;
        },
        snapshot(id, index) {
            this.get(id);
            const snapshot = entries.get(id).snapshots.find(s => s.index === index);
            if (!snapshot) throw new Error('SNAPSHOTS_NOT_CACHED: Analyze the requested page again with offset/limit.');
            return snapshot;
        },
        page(id, { offset, limit, snapshotIndex } = {}) {
            const report = this.get(id);
            if (snapshotIndex != null) { this.snapshot(id, snapshotIndex); offset ??= snapshotIndex; }
            if (offset == null && limit == null) return report;
            offset ??= report.snapshots.offset;
            limit ??= report.snapshots.limit;
            const items = [];
            for (let index = offset; index < Math.min(report.snapshotCount, offset + limit); index++) items.push(this.snapshot(id, index));
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

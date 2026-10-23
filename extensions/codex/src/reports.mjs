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
            entries.set(id, { report, expires: now() + ttlMs });
            return id;
        },
        get(id) {
            prune();
            const entry = entries.get(id);
            if (!entry) throw new Error('Report expired or belongs to another session. Run analyze_thread_dumps again.');
            return entry.report;
        },
    };
}

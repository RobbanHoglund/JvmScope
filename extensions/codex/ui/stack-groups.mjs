// Frame equality is a presentation aid, never a lock/dependency inference.
export function groupStacks(threads) {
    const groups = [], known = new Map();
    for (const thread of threads) {
        const frames = thread.lines.map(l => l.text.trim()).filter(s => /^at\s+\S/.test(s));
        const range = thread.context.range;
        const complete = !thread.nextLine && range && thread.lines.length === range.endLine - range.startLine + 1
            && thread.lines.every((l, i) => l.line === range.startLine + i);
        const key = complete && frames.length && thread.state ? JSON.stringify([thread.state, frames]) : null;
        let group = key && known.get(key);
        if (!group) { group = { frames, complete: !!complete, threads: [] }; groups.push(group); if (key) known.set(key, group); }
        group.threads.push(thread);
    }
    return groups;
}

export function selectionTitle(data, locale) {
    const names = data.threads.map(t => t.name);
    const label = names.length === 1 ? names[0]
        : names.every(n => /^HttpClient-\d+-(?:SelectorManager|Worker-\d+)$/.test(n))
            ? (locale === 'sv' ? 'HTTP-klienttrådar' : 'HTTP client threads')
            : `${names.length} ${locale === 'sv' ? 'trådar' : 'threads'}`;
    return `${label} · Snapshot ${data.snapshotNumber}`;
}

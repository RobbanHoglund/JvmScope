// Presentation of recorded frames only. This never adds an analyzer finding.
function framesFrom(lines) {
    return lines.flatMap(({ line, text }) => {
        const match = text.match(/^\s*at\s+(.+?)\s*$/);
        if (!match) return [];
        const frame = match[1], method = frame.split('(')[0].replace(/^.*\//, '');
        return [{ line, text: frame, method, jdk: /^(java\.|javax\.|jdk\.|sun\.|com\.sun\.)/.test(method) }];
    });
}

export function stackHighlights(lines) {
    const frames = framesFrom(lines);
    const outside = frames.filter(f => !f.jdk && !f.text.includes('$$Lambda'));
    return { items: (outside.length ? outside : frames).slice(0, 3).map(({ method, ...frame }) => frame),
        selection: outside.length ? 'outside-jdk-packages' : 'first-recorded-frames', recordedFrames: frames.length };
}

export function stackContext(stackLines, state) {
    const lines = (stackLines || []).map(text => ({ text })), frames = framesFrom(lines);
    const highlights = stackHighlights(lines);
    const park = frames.findIndex(f => /^(jdk\.internal\.misc\.Unsafe|sun\.misc\.Unsafe|java\.util\.concurrent\.locks\.LockSupport)\.park(?:Nanos|Until)?$/.test(f.method));
    const future = frames.findIndex(f => f.method === 'java.util.concurrent.CompletableFuture.get');
    const send = frames.findIndex(f => f.method === 'jdk.internal.net.http.HttpClientImpl.send');
    // Require the actual recorded call chain and Java state, not a thread name.
    const httpWait = ['WAITING', 'TIMED_WAITING'].includes(state) && park >= 0 && future > park && send > future;
    return { frame: highlights.items[0]?.text || null, frameSelection: highlights.selection,
        observation: httpWait ? 'jdk-http-send-wait' : null };
}

export function overviewThread(snapshot, sourceKey) {
    const rows = snapshot?.threadInventory?.items || [];
    if (sourceKey) {
        const thread = rows.find(t => t.sourceKey === sourceKey);
        return thread ? { thread, reason: 'selected' } : null;
    }
    if (snapshot?.analysis?.findings.total || snapshot?.deadlocks?.total || snapshot?.parsingStatus !== 'success') return null;
    const mains = rows.filter(t => t.name === 'main');
    return mains.length === 1 && mains[0].stackContext?.observation === 'jdk-http-send-wait'
        ? { thread: mains[0], reason: 'main-http-wait' } : null;
}

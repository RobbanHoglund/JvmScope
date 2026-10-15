/** Snapshot-local evidence coordinates become physical lines in one imported source. */
export function threadSourceLocation(snapshot, thread, sources) {
    const source = sources.find(source => source.id === snapshot?.sourceId);
    if (!source?.hostSourceId || !Number.isSafeInteger(snapshot?.sourceStartLine)
        || !Number.isSafeInteger(thread?.rawStartLine) || !Number.isSafeInteger(thread?.rawEndLine)
        || thread.rawStartLine < 1 || thread.rawEndLine < thread.rawStartLine) return null;
    return { sourceId: source.hostSourceId,
        startLine: snapshot.sourceStartLine + thread.rawStartLine - 1,
        endLine: snapshot.sourceStartLine + thread.rawEndLine - 1 };
}

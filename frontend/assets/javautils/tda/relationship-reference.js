/** A participant reference must not recursively contain its own relationships. */
export function relationshipThreadReference(thread) {
    if (!thread) return null;
    const { sourceKey, threadName, javaState, jvmId, tid, nid, rawStartLine, rawEndLine } = thread;
    return { sourceKey, threadName, javaState, jvmId, tid, nid, rawStartLine, rawEndLine };
}

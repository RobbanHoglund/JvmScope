/** Absence-based conclusions require comparable, sufficiently parsed collections. */
export function canCompareThreadCollections(previous, current) {
    return [previous, current].every(dump => dump && (!dump.parsingStatus || dump.parsingStatus === 'success')
        // Classic dumps observe only mounted virtual threads. Disappearance
        // from their carriers does not establish that a virtual thread ended.
        && !(dump.threads || dump.parsedThreads || []).some(thread => thread.embeddedVirtualThread))
        && !(previous.collectionScope && current.collectionScope && previous.collectionScope !== current.collectionScope)
        && !(previous.correlationProcessSegment != null && current.correlationProcessSegment != null
            && previous.correlationProcessSegment !== current.correlationProcessSegment)
        && !(previous.processId && current.processId && previous.processId !== current.processId);
}

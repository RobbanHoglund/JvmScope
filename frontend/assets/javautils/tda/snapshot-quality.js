/** Absence-based conclusions require comparable, sufficiently parsed collections. */
export function canCompareThreadCollections(previous, current) {
    return [previous, current].every(dump => dump && (!dump.parsingStatus || dump.parsingStatus === 'success'))
        && !(previous.collectionScope && current.collectionScope && previous.collectionScope !== current.collectionScope)
        && !(previous.correlationProcessSegment != null && current.correlationProcessSegment != null
            && previous.correlationProcessSegment !== current.correlationProcessSegment)
        && !(previous.processId && current.processId && previous.processId !== current.processId);
}

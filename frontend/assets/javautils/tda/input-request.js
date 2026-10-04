/** Coordinates asynchronous input sources so only the newest request may update the analyzer. */
export function createLatestInputRequestGate() {
    let activeRequestId = 0;

    return Object.freeze({
        begin() {
            activeRequestId += 1;
            return activeRequestId;
        },
        isCurrent(requestId) {
            return Number.isInteger(requestId) && requestId === activeRequestId;
        },
        invalidate() {
            activeRequestId += 1;
        },
    });
}

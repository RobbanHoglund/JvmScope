// Snapshot-scoped counts. Repeated captures never establish distinct incidents.
export function summarizeDeadlocks(snapshot) {
    const cycles = Array.isArray(snapshot?.deadlocks) ? snapshot.deadlocks : [];
    const threads = Array.isArray(snapshot?.threads) ? snapshot.threads : [];
    return {
        cycles: cycles.length,
        reportedParticipants: cycles.reduce((n, cycle) => n + (Array.isArray(cycle?.threads) ? cycle.threads.length : 0), 0),
        matchedThreads: threads.filter(thread => thread?.isDeadlocked).length,
        scope: 'selected-snapshot',
    };
}

// Presentation only: never manufacture a measurement from an unavailable counter.
export function cpuCoverage(threads, snapshotIndex, findingCount = 0) {
    const measured = threads.filter(thread => thread.cpuDeltaStatus === 'computed'
        && thread.cpuIntervalQuality === 'reliable'
        && typeof thread.cpuRatePercent === 'number' && Number.isFinite(thread.cpuRatePercent)).length;
    return {
        measured,
        value: measured ? String(findingCount) : 'Unavailable',
        detail: measured
            ? `Reliable rates for ${measured}/${threads.length} threads; other threads are not assessed from reliable rates.`
            : snapshotIndex === 0 ? 'No preceding snapshot for a CPU interval.' : 'No reliable comparable CPU rates in this snapshot.',
    };
}

export function compactSnapshotTime(timestamp) {
    // Keep the original timezone; trim display precision only, never parse an
    // ambiguous local time into the browser's timezone. Full text remains available.
    return String(timestamp || 'Time unavailable').replace(/(\d{4}-\d{2}-\d{2})T(?=\d)/, '$1 ')
        .replace(/(\d{2}:\d{2}:\d{2})\.\d+/, '$1');
}

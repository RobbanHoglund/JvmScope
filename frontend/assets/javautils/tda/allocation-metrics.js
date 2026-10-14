/** Bounds for HotSpot's truncated, adaptive-unit allocated= counters. */
export function allocationCounterBounds(raw, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
    const match = String(raw || '').match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?)(?:B)?$/i);
    if (!match) return null;
    const scale = match[2] ? 1024 ** ('KMGTP'.indexOf(match[2].toUpperCase()) + 1) : 1;
    const decimals = match[1].split('.')[1]?.length || 0;
    const resolution = Math.max(1, scale * 10 ** -decimals);
    // HotSpot prints integer units by truncation. Fractional input may come
    // from another producer: conservatively cover rounding and truncation.
    const minimum = decimals ? Math.max(0, Math.floor(bytes - resolution)) : bytes;
    const maximum = Math.ceil(bytes + resolution) - 1;
    return Number.isSafeInteger(maximum) ? { minimum, maximum, resolution } : null;
}

export function allocationRateFloor(thread) {
    return thread?.allocationRateBounds?.minimum ?? thread?.allocationRateBytesPerSecond ?? null;
}

export function formatAllocationMetric(thread, metric, format) {
    const bounds = metric === 'delta' ? thread?.allocationDeltaBounds : thread?.allocationRateBounds;
    const value = metric === 'delta' ? thread?.allocatedDeltaBytes : thread?.allocationRateBytesPerSecond;
    return bounds ? `${format(bounds.minimum)} – ${format(bounds.maximum)}` : format(value);
}

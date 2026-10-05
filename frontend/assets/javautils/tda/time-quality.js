/** Pure snapshot timestamp quality and adjacent wall-clock analysis. */

const CLASSIC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const TIMESTAMP_COMPONENTS = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:[.,](?<fraction>\d+))?(?<zone>Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):?(?<offsetMinute>\d{2}))?$/;

function missingTimestamp() {
    return {
        raw: null,
        status: 'missing',
        reason: 'No timestamp was found for this snapshot.',
        format: 'missing',
        formatLabel: 'No timestamp',
        timezoneKind: 'unavailable',
        timezoneLabel: 'Timezone unavailable',
        epochMs: null,
    };
}

function invalidTimestamp(raw, format = 'unknown') {
    return {
        raw,
        status: 'invalid',
        reason: 'Timestamp contains an invalid calendar date, time, or UTC offset.',
        format,
        formatLabel: format === 'classic' ? 'Classic timestamp' : format === 'iso-8601' ? 'ISO 8601' : 'Unknown format',
        timezoneKind: 'unavailable',
        timezoneLabel: 'Timezone unavailable',
        epochMs: null,
    };
}

function timezoneMetadata(groups) {
    if (!groups.zone) {
        return {
            timezoneKind: 'unspecified',
            timezoneLabel: 'Timezone not supplied',
            offsetMs: 0,
        };
    }
    if (groups.zone === 'Z') {
        return { timezoneKind: 'utc', timezoneLabel: 'UTC', offsetMs: 0 };
    }

    const offsetHour = Number(groups.offsetHour);
    const offsetMinute = Number(groups.offsetMinute);
    if (offsetHour > 23 || offsetMinute > 59) return null;
    const direction = groups.offsetSign === '+' ? 1 : -1;
    return {
        timezoneKind: 'offset',
        timezoneLabel: `UTC${groups.offsetSign}${String(offsetHour).padStart(2, '0')}:${String(offsetMinute).padStart(2, '0')}`,
        offsetMs: direction * ((offsetHour * 60) + offsetMinute) * 60 * 1000,
    };
}

export function parseSnapshotTimestamp(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return missingTimestamp();

    const format = CLASSIC_TIMESTAMP.test(raw)
        ? 'classic'
        : ISO_TIMESTAMP.test(raw)
            ? 'iso-8601'
            : 'unknown';
    if (format === 'unknown') return invalidTimestamp(raw);

    const match = raw.match(TIMESTAMP_COMPONENTS);
    if (!match?.groups) return invalidTimestamp(raw, format);
    const timezone = timezoneMetadata(match.groups);
    if (!timezone) return invalidTimestamp(raw, format);

    const components = {
        year: Number(match.groups.year),
        month: Number(match.groups.month) - 1,
        day: Number(match.groups.day),
        hour: Number(match.groups.hour),
        minute: Number(match.groups.minute),
        second: Number(match.groups.second),
    };
    const milliseconds = Number((match.groups.fraction || '').padEnd(3, '0').slice(0, 3) || 0);
    const localEpochMs = Date.UTC(
        components.year,
        components.month,
        components.day,
        components.hour,
        components.minute,
        components.second,
        milliseconds,
    );
    const parsed = new Date(localEpochMs);
    const exactCalendarValue = parsed.getUTCFullYear() === components.year
        && parsed.getUTCMonth() === components.month
        && parsed.getUTCDate() === components.day
        && parsed.getUTCHours() === components.hour
        && parsed.getUTCMinutes() === components.minute
        && parsed.getUTCSeconds() === components.second;
    if (!exactCalendarValue) return invalidTimestamp(raw, format);

    return {
        raw,
        status: 'valid',
        reason: timezone.timezoneKind === 'unspecified'
            ? 'Timestamp is valid, but no timezone was supplied.'
            : 'Timestamp is calendar-valid and includes timezone information.',
        format,
        formatLabel: format === 'classic' ? 'Classic timestamp' : 'ISO 8601',
        timezoneKind: timezone.timezoneKind,
        timezoneLabel: timezone.timezoneLabel,
        epochMs: localEpochMs - timezone.offsetMs,
        resolutionMs: 10 ** (3 - Math.min(3, (match.groups.fraction || '').length)),
    };
}

export function snapshotWallClockInterval(previousDump, currentDump) {
    const previous = previousDump?.timestampSource === 'collector' ? parseSnapshotTimestamp(previousDump.jvmTimestampRaw)
        : previousDump?.snapshotTime || parseSnapshotTimestamp(
        previousDump?.timestampRaw ?? previousDump?.timestamp,
    );
    const current = currentDump?.timestampSource === 'collector' ? parseSnapshotTimestamp(currentDump.jvmTimestampRaw)
        : currentDump?.snapshotTime || parseSnapshotTimestamp(
        currentDump?.timestampRaw ?? currentDump?.timestamp,
    );
    if (previous.status !== 'valid' || current.status !== 'valid') {
        return { intervalMs: null, status: 'unavailable' };
    }

    const previousHasZone = previous.timezoneKind === 'utc' || previous.timezoneKind === 'offset';
    const currentHasZone = current.timezoneKind === 'utc' || current.timezoneKind === 'offset';
    if (previousHasZone !== currentHasZone) {
        return { intervalMs: null, status: 'timezone-incompatible' };
    }

    const intervalMs = current.epochMs - previous.epochMs;
    if (intervalMs > 0) return {
        intervalMs, status: 'ordered',
        uncertaintyMs: Math.max(previous.resolutionMs ?? 1000, current.resolutionMs ?? 1000),
    };
    return { intervalMs: null, status: intervalMs === 0 ? 'duplicate' : 'reversed' };
}

export const ELAPSED_REGRESSION_REASON = 'Thread elapsed counter decreased beyond its printed resolution. Thread continuity is uncertain; CPU and allocation comparisons are unavailable.';

/** Missing/rounded counters are different from evidence against thread continuity. */
export function threadElapsedComparison(previousThread, currentThread) {
    const previous = previousThread?.elapsedS;
    const current = currentThread?.elapsedS;
    const resolution = thread => Number.isFinite(thread?.elapsedResolutionMs) && thread.elapsedResolutionMs > 0
        ? thread.elapsedResolutionMs : 10;
    const uncertaintyMs = Math.max(resolution(previousThread), resolution(currentThread));
    if (!Number.isFinite(previous) || previous < 0 || !Number.isFinite(current) || current < 0) {
        return { status: 'unavailable', deltaMs: null, uncertaintyMs };
    }
    const deltaMs = (current - previous) * 1000;
    return { status: deltaMs < -uncertaintyMs - 0.001 ? 'regressed' : deltaMs > 0 ? 'ordered' : 'rounded',
        deltaMs, uncertaintyMs };
}

/** Only call for an exact, adjacent thread continuation in the same JVM. */
export function threadComparisonInterval(previousDump, currentDump, previousThread, currentThread) {
    const wall = snapshotWallClockInterval(previousDump, currentDump);
    const elapsed = threadElapsedComparison(previousThread, currentThread);
    if (elapsed.status === 'regressed') {
        return { intervalMs: null, basis: 'unavailable', quality: 'conflicting', uncertaintyMs: null,
            continuity: 'conflicting', reason: ELAPSED_REGRESSION_REASON };
    }
    const elapsedMs = elapsed.status === 'ordered' ? elapsed.deltaMs : null;
    const elapsedUncertainty = elapsed.uncertaintyMs;
    const wallMs = wall.intervalMs;
    if (wallMs != null && elapsedMs != null
        && Math.abs(wallMs - elapsedMs) > wall.uncertaintyMs + elapsedUncertainty + 0.001) {
        return { intervalMs: null, basis: 'unavailable', quality: 'conflicting', uncertaintyMs: null,
            reason: `Snapshot interval ${wallMs.toFixed(0)} ms and thread elapsed interval ${elapsedMs.toFixed(0)} ms disagree beyond their printed resolution. Rates are unavailable.` };
    }
    const useElapsed = elapsedMs != null && (wallMs == null || elapsedUncertainty < wall.uncertaintyMs);
    const intervalMs = useElapsed ? elapsedMs : wallMs;
    const uncertaintyMs = intervalMs == null ? null : useElapsed ? elapsedUncertainty : wall.uncertaintyMs;
    const basis = intervalMs == null ? 'unavailable' : useElapsed ? 'thread-elapsed' : 'snapshot-time';
    const quality = intervalMs == null ? 'unavailable' : uncertaintyMs / intervalMs > 0.1 ? 'estimated' : 'reliable';
    return { intervalMs, basis, quality, uncertaintyMs,
        reason: intervalMs == null ? 'No comparable positive interval was captured.'
            : `Approximate interval from ${useElapsed ? 'thread elapsed counters' : 'snapshot timestamps'}; printed resolution allows about ±${Number(uncertaintyMs.toFixed(3))} ms${wallMs == null && useElapsed ? `; snapshot clock ${wall.status}` : ''}.${quality === 'estimated' ? ' Too coarse for a CPU/allocation diagnostic.' : ''}` };
}

export function annotateSnapshotTimes(dumps) {
    const normalizedDumps = Array.isArray(dumps) ? dumps : [];

    normalizedDumps.forEach((dump, position) => {
        const metadata = parseSnapshotTimestamp(dump?.timestampRaw ?? dump?.timestamp);
        const previous = position > 0 ? normalizedDumps[position - 1]?.snapshotTime : null;
        let orderingStatus = position === 0 ? 'first' : 'unavailable';
        let wallClockDeltaMs = null;
        let intervalFromPreviousMs = null;
        let intervalReason = position === 0
            ? 'First snapshot; no preceding interval exists.'
            : 'Snapshot-time interval unavailable; per-thread elapsed fallback may be used.';

        if (position > 0 && metadata.status === 'valid' && previous?.status === 'valid') {
            const previousHasZone = previous.timezoneKind === 'utc' || previous.timezoneKind === 'offset';
            const currentHasZone = metadata.timezoneKind === 'utc' || metadata.timezoneKind === 'offset';
            if (previousHasZone !== currentHasZone) {
                orderingStatus = 'timezone-incompatible';
                intervalReason = 'Adjacent timestamps do not have compatible timezone information; per-thread elapsed fallback may be used.';
            } else {
                wallClockDeltaMs = metadata.epochMs - previous.epochMs;
            }
            if (wallClockDeltaMs > 0) {
                orderingStatus = 'ordered';
                intervalFromPreviousMs = wallClockDeltaMs;
                intervalReason = 'Timestamp is later than the adjacent previous snapshot.';
            } else if (wallClockDeltaMs === 0) {
                orderingStatus = 'duplicate';
                intervalReason = 'Timestamp is identical to the adjacent previous snapshot; per-thread elapsed fallback may be used.';
            } else if (wallClockDeltaMs < 0) {
                orderingStatus = 'reversed';
                intervalReason = 'Timestamp is earlier than the adjacent previous snapshot; per-thread elapsed fallback may be used.';
            }
        }

        dump.timestampQuality = metadata.status;
        dump.timestampFormat = metadata.format;
        dump.timestampTimezoneKind = metadata.timezoneKind;
        dump.timestampTimezoneLabel = metadata.timezoneLabel;
        dump.timestampEpochMs = metadata.epochMs;
        dump.timestampQualityReason = metadata.reason;
        dump.snapshotTime = {
            ...metadata,
            orderingStatus,
            wallClockDeltaMs,
            intervalFromPreviousMs,
            intervalReason,
        };
    });

    return normalizedDumps;
}

function formatInterval(intervalMs) {
    if (!Number.isFinite(intervalMs)) return '—';
    if (intervalMs < 1000) return `${intervalMs} ms`;
    const seconds = intervalMs / 1000;
    return `${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))} s`;
}

export function formatSnapshotTime(dump) {
    const time = dump?.snapshotTime || {
        ...parseSnapshotTimestamp(dump?.timestampRaw ?? dump?.timestamp),
        orderingStatus: 'unavailable',
        intervalFromPreviousMs: null,
        intervalReason: 'Snapshot-time interval unavailable; per-thread elapsed fallback may be used.',
    };
    const headline = time.status === 'missing' ? 'Dump time unavailable' : `Dump time: ${time.raw}`;
    const qualityLabel = time.status === 'valid'
        ? `Valid ${time.formatLabel.toLowerCase()}; ${time.timezoneLabel.toLowerCase()}`
        : time.status === 'invalid'
            ? `Invalid timestamp; ${time.reason}`
            : 'No timestamp found';

    let intervalLabel;
    if (time.orderingStatus === 'first') {
        intervalLabel = 'First snapshot; no preceding interval';
    } else if (time.orderingStatus === 'ordered') {
        intervalLabel = `${formatInterval(time.intervalFromPreviousMs)} since previous snapshot; eligible CPU rates use snapshot time`;
    } else if (time.orderingStatus === 'duplicate') {
        intervalLabel = 'Same timestamp as previous snapshot; per-thread elapsed fallback may be used';
    } else if (time.orderingStatus === 'reversed') {
        intervalLabel = 'Timestamp is earlier than previous snapshot; per-thread elapsed fallback may be used';
    } else if (time.orderingStatus === 'timezone-incompatible') {
        intervalLabel = 'Adjacent timestamp timezones are incompatible; per-thread elapsed fallback may be used';
    } else {
        intervalLabel = 'Snapshot-time interval unavailable; per-thread elapsed fallback may be used';
    }

    const severity = time.status === 'invalid' || time.orderingStatus === 'reversed'
        ? 'error'
        : time.status === 'missing'
            || time.timezoneKind === 'unspecified'
            || ['duplicate', 'timezone-incompatible', 'unavailable'].includes(time.orderingStatus)
            ? 'warning'
            : 'success';

    let pillLabel = 'Time gap';
    if (time.status === 'invalid') pillLabel = 'Time invalid';
    else if (time.status === 'missing') pillLabel = 'Time missing';
    else if (time.orderingStatus === 'reversed') pillLabel = 'Time reversed';
    else if (time.orderingStatus === 'duplicate') pillLabel = 'Time duplicate';
    else if (time.orderingStatus === 'timezone-incompatible') pillLabel = 'Time TZ mismatch';
    else if (time.orderingStatus === 'ordered') pillLabel = `Time ${formatInterval(time.intervalFromPreviousMs)}`;
    else if (time.orderingStatus === 'first') pillLabel = 'Time valid';
    if (time.status === 'valid' && time.timezoneKind === 'unspecified') pillLabel += ' · TZ?';

    return {
        headline,
        qualityLabel,
        intervalLabel,
        pillLabel,
        severity,
        tooltip: `${qualityLabel}. ${intervalLabel}.`,
    };
}

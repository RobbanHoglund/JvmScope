import assert from 'node:assert/strict';
import test from 'node:test';

import {
    annotateSnapshotTimes,
    formatSnapshotTime,
    parseSnapshotTimestamp,
} from '../../assets/javautils/tda/time-quality.js';

test('classifies timestamp format, timezone, and exact calendar quality', () => {
    const classic = parseSnapshotTimestamp('2026-08-06 10:15:30');
    const offset = parseSnapshotTimestamp('2026-08-06T10:15:30.250+02:00');
    const utcEquivalent = parseSnapshotTimestamp('2026-08-06T08:15:30.250Z');
    const invalid = parseSnapshotTimestamp('2026-02-30T10:15:30Z');
    const missing = parseSnapshotTimestamp(null);

    assert.equal(classic.status, 'valid');
    assert.equal(classic.format, 'classic');
    assert.equal(classic.timezoneKind, 'unspecified');
    assert.match(classic.reason, /no timezone/i);
    assert.equal(offset.status, 'valid');
    assert.equal(offset.format, 'iso-8601');
    assert.equal(offset.timezoneKind, 'offset');
    assert.equal(offset.timezoneLabel, 'UTC+02:00');
    assert.equal(offset.epochMs, utcEquivalent.epochMs);
    assert.equal(invalid.status, 'invalid');
    assert.equal(invalid.epochMs, null);
    assert.match(invalid.reason, /invalid calendar/i);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.epochMs, null);
});

test('annotates adjacent timestamp ordering without bridging unavailable snapshots', () => {
    const dumps = [
        { index: 10, timestampRaw: '2026-08-06T10:00:00Z', timestampQuality: 'valid' },
        { index: 11, timestampRaw: '2026-08-06T10:00:05Z', timestampQuality: 'valid' },
        { index: 12, timestampRaw: '2026-08-06T10:00:05Z', timestampQuality: 'valid' },
        { index: 13, timestampRaw: '2026-08-06T09:59:59Z', timestampQuality: 'valid' },
        { index: 14, timestampRaw: null, timestampQuality: 'missing' },
        { index: 15, timestampRaw: '2026-08-06T10:00:10Z', timestampQuality: 'valid' },
    ];

    annotateSnapshotTimes(dumps);

    assert.equal(dumps[0].snapshotTime.orderingStatus, 'first');
    assert.equal(dumps[1].snapshotTime.orderingStatus, 'ordered');
    assert.equal(dumps[1].snapshotTime.intervalFromPreviousMs, 5000);
    assert.equal(dumps[2].snapshotTime.orderingStatus, 'duplicate');
    assert.equal(dumps[2].snapshotTime.wallClockDeltaMs, 0);
    assert.equal(dumps[3].snapshotTime.orderingStatus, 'reversed');
    assert.equal(dumps[3].snapshotTime.wallClockDeltaMs, -6000);
    assert.equal(dumps[4].snapshotTime.orderingStatus, 'unavailable');
    assert.equal(dumps[5].snapshotTime.orderingStatus, 'unavailable');
});

test('formats explicit quality and interval-source guidance for presentation', () => {
    const dumps = [
        { timestampRaw: '2026-08-06 10:00:00' },
        { timestampRaw: '2026-08-06 10:00:05' },
        { timestampRaw: '2026-02-30T10:00:10Z' },
    ];
    annotateSnapshotTimes(dumps);

    const first = formatSnapshotTime(dumps[0]);
    const ordered = formatSnapshotTime(dumps[1]);
    const invalid = formatSnapshotTime(dumps[2]);

    assert.match(first.qualityLabel, /timezone not supplied/i);
    assert.match(first.intervalLabel, /first snapshot/i);
    assert.equal(first.severity, 'warning');
    assert.match(ordered.intervalLabel, /5 s since previous/i);
    assert.match(ordered.intervalLabel, /snapshot time/i);
    assert.equal(ordered.pillLabel, 'Time 5 s · TZ?');
    assert.match(invalid.qualityLabel, /invalid timestamp/i);
    assert.match(invalid.intervalLabel, /elapsed fallback/i);
    assert.equal(invalid.severity, 'error');
});

test('rejects adjacent timestamps with incompatible timezone provenance', () => {
    const dumps = [
        { timestampRaw: '2026-08-06 10:00:00' },
        { timestampRaw: '2026-08-06T10:00:05Z' },
    ];

    annotateSnapshotTimes(dumps);
    const presentation = formatSnapshotTime(dumps[1]);

    assert.equal(dumps[1].snapshotTime.orderingStatus, 'timezone-incompatible');
    assert.equal(dumps[1].snapshotTime.intervalFromPreviousMs, null);
    assert.match(presentation.intervalLabel, /timezones are incompatible/i);
    assert.equal(presentation.pillLabel, 'Time TZ mismatch');
});

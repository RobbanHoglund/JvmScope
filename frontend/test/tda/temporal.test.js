import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { parseThreadDump, splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';

const fixture = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

async function correlatedFixture(name) {
    const snapshots = splitThreadDumpSnapshots(await fixture(name));
    const dumps = snapshots.map((snapshot) => ({
        ...snapshot,
        threads: parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index }),
    }));
    return correlateThreadsAcrossSnapshots(dumps);
}

test('computes CPU delta and rate from correlated elapsed counters', async () => {
    const correlation = await correlatedFixture('cross-snapshot-identity.txt');

    const result = annotateCpuRates(correlation.dumps, correlation.series);
    const stableThreads = result.dumps.map((dump) =>
        dump.threads.find((thread) => thread.threadName === 'stable-worker'));
    const replacementThreads = result.dumps.map((dump) =>
        dump.threads.find((thread) => thread.threadName === 'pooled-worker'));

    assert.equal(stableThreads[0].cpuDeltaStatus, 'first-occurrence');
    assert.equal(stableThreads[0].cpuDeltaMs, null);
    assert.equal(stableThreads[1].cpuDeltaMs, 15);
    assert.equal(stableThreads[1].cpuIntervalMs, 5000);
    assert.equal(stableThreads[1].cpuRatePercent, 0.3);
    assert.equal(stableThreads[1].cpuRateBasis, 'thread-elapsed');
    assert.equal(stableThreads[2].cpuDeltaMs, 15);
    assert.equal(stableThreads[2].cpuRatePercent, 0.3);
    assert.ok(replacementThreads.every((thread) => thread.cpuDeltaStatus === 'first-occurrence'));
    assert.equal(result.diagnostics.ratesComputed, 2);
    const stableSeries = result.series.find((series) => series.seriesKey === stableThreads[0].seriesKey);
    assert.equal(stableSeries.cpuDeltaSamples, 2);
    assert.equal(stableSeries.cpuRateSamples, 2);
    assert.equal(stableSeries.totalCpuDeltaMs, 30);
    assert.equal(stableSeries.averageCpuRatePercent, 0.3);
});

test('refuses inconsistent wall-clock and elapsed intervals', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:stable', cpuMs: 100, elapsedS: 10,
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:stable', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 125, elapsedS: 100,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-08-06T10:00:00Z', timestampQuality: 'valid', threads: [previous] },
        { index: 1, timestampRaw: '2026-08-06T10:00:05Z', timestampQuality: 'valid', threads: [current] },
    ];
    const series = [{
        seriesKey: 'series:stable',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    annotateCpuRates(dumps, series);

    assert.equal(current.cpuDeltaMs, 25);
    assert.equal(current.cpuIntervalMs, null);
    assert.equal(current.cpuRatePercent, null);
    assert.equal(current.cpuDeltaStatus, 'interval-conflict');
    assert.match(current.cpuIntervalReason, /disagree/);
});

test('rejects calendar-invalid snapshot timestamps and falls back to elapsed counters', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:stable', cpuMs: 10, elapsedS: 10,
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:stable', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 20, elapsedS: 20,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-02-30T10:00:00Z', timestampQuality: 'valid', threads: [previous] },
        { index: 1, timestampRaw: '2026-02-30T10:00:05Z', timestampQuality: 'valid', threads: [current] },
    ];
    const series = [{
        seriesKey: 'series:stable',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    annotateCpuRates(dumps, series);

    assert.equal(current.cpuIntervalMs, 10000);
    assert.equal(current.cpuRatePercent, 0.1);
    assert.equal(current.cpuRateBasis, 'thread-elapsed');
});

test('rejects reversed snapshot time and falls back to elapsed counters', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:stable', cpuMs: 10, elapsedS: 10,
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:stable', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 20, elapsedS: 15,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-08-06T10:00:10Z', threads: [previous] },
        { index: 1, timestampRaw: '2026-08-06T10:00:05Z', threads: [current] },
    ];
    const series = [{
        seriesKey: 'series:stable',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    annotateCpuRates(dumps, series);

    assert.equal(current.cpuIntervalMs, 5000);
    assert.equal(current.cpuRatePercent, 0.2);
    assert.equal(current.cpuRateBasis, 'thread-elapsed');
});

test('rejects mixed timezone provenance and falls back to elapsed counters', () => {
    const previous = {
        sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:stable', cpuMs: 10, elapsedS: 10,
    };
    const current = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:stable', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 20, elapsedS: 15,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-08-06 10:00:00', threads: [previous] },
        { index: 1, timestampRaw: '2026-08-06T10:00:05Z', threads: [current] },
    ];
    const series = [{
        seriesKey: 'series:stable',
        occurrences: [
            { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
            { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
        ],
    }];

    annotateCpuRates(dumps, series);

    assert.equal(current.cpuIntervalMs, 5000);
    assert.equal(current.cpuRatePercent, 0.2);
    assert.equal(current.cpuRateBasis, 'thread-elapsed');
});

test('does not report a CPU rate for reset, missing, or invalid counters', () => {
    const cases = [
        { previousCpu: 100, currentCpu: 20, previousElapsed: 5, currentElapsed: 10, status: 'counter-reset' },
        { previousCpu: null, currentCpu: 20, previousElapsed: 5, currentElapsed: 10, status: 'counter-missing' },
        { previousCpu: 10, currentCpu: 20, previousElapsed: 5, currentElapsed: 5, status: 'interval-unavailable' },
    ];

    for (const [index, sample] of cases.entries()) {
        const previous = {
            sourceKey: `snapshot:0:tid:0x${index}`,
            seriesKey: `series:${index}`,
            cpuMs: sample.previousCpu,
            elapsedS: sample.previousElapsed,
        };
        const current = {
            sourceKey: `snapshot:1:tid:0x${index}`,
            seriesKey: `series:${index}`,
            previousSourceKey: previous.sourceKey,
            seriesMatchStatus: 'matched',
            cpuMs: sample.currentCpu,
            elapsedS: sample.currentElapsed,
        };
        const dumps = [{ index: 0, threads: [previous] }, { index: 1, threads: [current] }];
        const series = [{
            seriesKey: `series:${index}`,
            occurrences: [
                { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
                { dumpIndex: 1, sourceKey: current.sourceKey, thread: current },
            ],
        }];

        annotateCpuRates(dumps, series);

        assert.equal(current.cpuDeltaStatus, sample.status);
        assert.equal(current.cpuRatePercent, null);
        if (sample.status !== 'interval-unavailable') assert.equal(current.cpuDeltaMs, null);
        else assert.equal(current.cpuDeltaMs, 10);
    }
});

test('does not compute rates for ambiguous identities or snapshot gaps', () => {
    const ambiguous = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:ambiguous', seriesMatchStatus: 'ambiguous',
        cpuMs: 20, elapsedS: 10,
    };
    const previous = {
        sourceKey: 'snapshot:0:tid:0x2', seriesKey: 'series:gap', cpuMs: 10, elapsedS: 5,
    };
    const afterGap = {
        sourceKey: 'snapshot:2:tid:0x2', seriesKey: 'series:gap', previousSourceKey: previous.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 30, elapsedS: 15,
    };
    const dumps = [
        { index: 0, threads: [previous] },
        { index: 1, threads: [ambiguous] },
        { index: 2, threads: [afterGap] },
    ];
    const series = [
        { seriesKey: 'series:ambiguous', occurrences: [{ dumpIndex: 1, sourceKey: ambiguous.sourceKey, thread: ambiguous }] },
        {
            seriesKey: 'series:gap',
            occurrences: [
                { dumpIndex: 0, sourceKey: previous.sourceKey, thread: previous },
                { dumpIndex: 2, sourceKey: afterGap.sourceKey, thread: afterGap },
            ],
        },
    ];

    annotateCpuRates(dumps, series);

    assert.equal(ambiguous.cpuDeltaStatus, 'identity-ambiguous');
    assert.equal(ambiguous.cpuRatePercent, null);
    assert.equal(afterGap.cpuDeltaStatus, 'snapshot-gap');
    assert.equal(afterGap.cpuDeltaMs, null);
    assert.equal(afterGap.cpuRatePercent, null);
});

test('weights a series average CPU rate by the measured intervals', () => {
    const first = { sourceKey: 'snapshot:0:tid:0x1', seriesKey: 'series:weighted', cpuMs: 0 };
    const second = {
        sourceKey: 'snapshot:1:tid:0x1', seriesKey: 'series:weighted', previousSourceKey: first.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 10,
    };
    const third = {
        sourceKey: 'snapshot:2:tid:0x1', seriesKey: 'series:weighted', previousSourceKey: second.sourceKey,
        seriesMatchStatus: 'matched', cpuMs: 20,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-08-06T10:00:00Z', timestampQuality: 'valid', threads: [first] },
        { index: 1, timestampRaw: '2026-08-06T10:00:01Z', timestampQuality: 'valid', threads: [second] },
        { index: 2, timestampRaw: '2026-08-06T10:00:10Z', timestampQuality: 'valid', threads: [third] },
    ];
    const series = [{
        seriesKey: 'series:weighted',
        occurrences: [
            { dumpIndex: 0, sourceKey: first.sourceKey, thread: first },
            { dumpIndex: 1, sourceKey: second.sourceKey, thread: second },
            { dumpIndex: 2, sourceKey: third.sourceKey, thread: third },
        ],
    }];

    const result = annotateCpuRates(dumps, series);

    assert.equal(second.cpuRatePercent, 1);
    assert.equal(third.cpuRatePercent, 0.111111);
    assert.equal(result.series[0].totalCpuIntervalMs, 10000);
    assert.equal(result.series[0].averageCpuRatePercent, 0.2);
});

test('computes allocated-byte deltas and rates independently of CPU counters', () => {
    const first = {
        sourceKey: 'snapshot:0:tid:0xa', seriesKey: 'series:allocation',
        cpuMs: null, allocatedBytes: 10 * 1024 ** 2,
    };
    const second = {
        sourceKey: 'snapshot:1:tid:0xa', seriesKey: 'series:allocation',
        previousSourceKey: first.sourceKey, seriesMatchStatus: 'matched',
        cpuMs: null, allocatedBytes: 60 * 1024 ** 2,
    };
    const dumps = [
        { index: 0, timestampRaw: '2026-08-06T10:00:00Z', threads: [first] },
        { index: 1, timestampRaw: '2026-08-06T10:00:02Z', threads: [second] },
    ];
    const series = [{
        seriesKey: 'series:allocation',
        occurrences: [
            { dumpIndex: 0, sourceKey: first.sourceKey, thread: first },
            { dumpIndex: 1, sourceKey: second.sourceKey, thread: second },
        ],
    }];

    const result = annotateCpuRates(dumps, series);

    assert.equal(second.cpuDeltaStatus, 'counter-missing');
    assert.equal(second.allocatedDeltaBytes, 50 * 1024 ** 2);
    assert.equal(second.allocationIntervalMs, 2000);
    assert.equal(second.allocationRateBytesPerSecond, 25 * 1024 ** 2);
    assert.equal(second.allocationRateBasis, 'snapshot-time');
    assert.equal(result.diagnostics.allocationRatesComputed, 1);
    assert.equal(result.series[0].totalAllocatedDeltaBytes, 50 * 1024 ** 2);
    assert.equal(result.series[0].averageAllocationRateBytesPerSecond, 25 * 1024 ** 2);
});

test('suppresses allocation rates for missing, reset, ambiguous, and non-adjacent counters', () => {
    const cases = [
        { status: 'counter-missing', previous: null, current: 10, adjacent: true, matched: true },
        { status: 'counter-reset', previous: 20, current: 10, adjacent: true, matched: true },
        { status: 'identity-unavailable', previous: 10, current: 20, adjacent: true, matched: false },
        { status: 'snapshot-gap', previous: 10, current: 20, adjacent: false, matched: true },
    ];

    for (const [index, sample] of cases.entries()) {
        const first = {
            sourceKey: `snapshot:0:tid:0x${index}`, seriesKey: `series:allocation:${index}`,
            allocatedBytes: sample.previous,
        };
        const currentDumpIndex = sample.adjacent ? 1 : 2;
        const second = {
            sourceKey: `snapshot:${currentDumpIndex}:tid:0x${index}`,
            seriesKey: first.seriesKey,
            previousSourceKey: first.sourceKey,
            seriesMatchStatus: sample.matched ? 'matched' : 'unresolved',
            allocatedBytes: sample.current,
        };
        const dumps = [
            { index: 0, timestampRaw: '2026-08-06T10:00:00Z', threads: [first] },
            { index: currentDumpIndex, timestampRaw: '2026-08-06T10:00:02Z', threads: [second] },
        ];
        const series = [{
            seriesKey: first.seriesKey,
            occurrences: [
                { dumpIndex: 0, sourceKey: first.sourceKey, thread: first },
                { dumpIndex: currentDumpIndex, sourceKey: second.sourceKey, thread: second },
            ],
        }];

        annotateCpuRates(dumps, series);

        assert.equal(second.allocationDeltaStatus, sample.status);
        assert.equal(second.allocationRateBytesPerSecond, null);
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';

import {
    buildCpuTimelineModel,
    buildSnapshotTickIndexes,
} from '../../assets/javautils/tda/cpu-timeline.js';

function occurrence(dumpIndex, name, ratePercent, overrides = {}) {
    const thread = {
        sourceKey: `snapshot:${dumpIndex}:tid:${name}`,
        threadName: name,
        cpuDeltaStatus: ratePercent == null ? 'interval-unavailable' : 'computed',
        cpuRatePercent: ratePercent,
        cpuDeltaMs: ratePercent == null ? null : ratePercent * 10,
        cpuIntervalMs: 1000,
        cpuRateBasis: 'snapshot-time',
        cpuIntervalQuality: ratePercent == null ? 'unavailable' : 'reliable',
        cpuIntervalUncertaintyMs: ratePercent == null ? null : 1,
        javaState: 'RUNNABLE',
        ...overrides,
    };
    return { dumpIndex, sourceKey: thread.sourceKey, thread };
}

function series(name, rates) {
    return {
        seriesKey: `series:${name}`,
        occurrences: rates.map((rate, index) => occurrence(index, name, rate)),
    };
}

test('distinguishes absent timeline measurements from a search with no matches', () => {
    const input = { dumps: [{ index: 0 }, { index: 1 }], series: [series('zero-cpu', [null, 0])] };
    const zero = buildCpuTimelineModel(input);
    assert.equal(zero.measuredSeriesCount, 1);
    assert.equal(zero.visibleSeriesCount, 1);
    const noMatches = buildCpuTimelineModel({ ...input, query: 'missing' });
    assert.equal(noMatches.measuredSeriesCount, 1);
    assert.equal(noMatches.visibleSeriesCount, 0);
    const unavailable = buildCpuTimelineModel({ ...input, series: [series('unmeasured', [null, null])] });
    assert.equal(unavailable.measuredSeriesCount, 0);
});

test('ranks exact thread series by peak measured CPU rate and preserves snapshot gaps', () => {
    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }, { index: 1 }, { index: 2 }],
        series: [
            series('steady-worker', [null, 20, 22]),
            {
                seriesKey: 'series:burst-worker',
                occurrences: [
                    occurrence(0, 'burst-worker', null),
                    occurrence(1, 'burst-worker', 80, {
                        topFrame: 'com.example.BurstWorker.run(BurstWorker.java:42)',
                        stackLines: [
                            '\tat com.example.BurstWorker.run(BurstWorker.java:42)',
                            '\tat java.base/java.lang.Thread.run(Thread.java:1583)',
                        ],
                    }),
                    occurrence(2, 'burst-worker', null),
                ],
            },
        ],
    });

    assert.deepEqual(model.snapshots.map((snapshot) => snapshot.shortLabel), ['D1', 'D2', 'D3']);
    assert.deepEqual(model.series.map((item) => item.name), ['burst-worker', 'steady-worker']);
    assert.deepEqual(model.series[0].points.map((point) => point.dumpIndex), [1]);
    assert.equal(model.series[0].points[0].threadName, 'burst-worker');
    assert.equal(model.series[0].points[0].topFrame, 'com.example.BurstWorker.run(BurstWorker.java:42)');
    assert.deepEqual(model.series[0].points[0].stackLines, [
        '\tat com.example.BurstWorker.run(BurstWorker.java:42)',
        '\tat java.base/java.lang.Thread.run(Thread.java:1583)',
    ]);
    assert.equal(model.maximumRatePercent, 80);
});

test('filters thread names case-insensitively and applies a bounded series limit', () => {
    const model = buildCpuTimelineModel({
        dumps: [{ timestamp: '2026-08-31 10:00:00' }, { timestamp: '2026-08-31 10:00:01' }],
        series: [series('hz.partition-1', [null, 40]), series('http-worker', [null, 60])],
        query: 'HZ.',
        limit: 1,
    });

    assert.equal(model.availableSeriesCount, 1);
    assert.equal(model.visibleSeriesCount, 1);
    assert.equal(model.series[0].name, 'hz.partition-1');
    assert.equal(model.snapshots[1].label, '2026-08-31 10:00:01');
});

test('highlights one exact series without removing overlapping thread names or changing the scale', () => {
    const worker1 = series('worker-1', [null, 40]);
    const worker10 = series('worker-10', [null, 60]);
    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }, { index: 1 }],
        series: [worker1, worker10],
        query: 'worker-1',
        selectedSeriesKey: worker1.seriesKey,
    });

    assert.deepEqual(model.series.map((item) => item.seriesKey), [worker10.seriesKey, worker1.seriesKey]);
    assert.equal(model.selectedSeriesKey, worker1.seriesKey);
    assert.equal(model.availableSeriesCount, 2);
    assert.equal(model.maximumRatePercent, 60);
});

test('intervals omit the unmeasured first snapshot while retaining missing intervals', () => {
    const model = buildCpuTimelineModel({
        dumps: Array.from({ length: 4 }, (_, index) => ({ index })),
        series: [series('worker', [null, 20, null, 40])],
    });
    assert.deepEqual(model.intervals.map(interval => interval.shortLabel), ['D1→D2', 'D2→D3', 'D3→D4']);
    assert.deepEqual(model.intervals.map(interval => interval.dumpIndex), [1, 2, 3]);
    assert.deepEqual(model.series[0].points.map(point => point.dumpIndex), [1, 3]);
    assert.equal(model.series[0].points[0].ratePercent, 20);
    assert.equal(model.series[0].points[0].intervalMs, 1000);
});

test('two snapshots yield a single interval and hidden selections are cleared', () => {
    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }, { index: 1 }],
        series: [series('worker', [null, 0]), series('other', [null, 10])],
        query: 'worker', selectedSeriesKey: 'series:other',
    });
    assert.deepEqual(model.intervals, [{ dumpIndex: 1, startDumpIndex: 0, shortLabel: 'D1→D2' }]);
    assert.equal(model.selectedSeriesKey, '');
    assert.equal(model.maximumRatePercent, 0);
    assert.equal(model.series[0].points.length, 1);
});

test('rates without a corresponding interval endpoint do not enter the chart', () => {
    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }, { index: 1 }],
        series: [series('worker', [90, 20, 80])],
    });
    assert.deepEqual(model.series[0].points.map(point => point.dumpIndex), [1]);
    assert.equal(model.maximumRatePercent, 20);
    assert.deepEqual(buildCpuTimelineModel().intervals, []);
});

test('enriches stack evidence only for visible series', () => {
    const hidden = series('hidden-worker', [null, 10]);
    Object.defineProperty(hidden.occurrences[1].thread, 'stackLines', {
        get() {
            throw new Error('hidden stack should not be copied');
        },
    });

    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }, { index: 1 }],
        series: [series('visible-worker', [null, 90]), hidden],
        limit: 1,
    });

    assert.deepEqual(model.series.map((item) => item.name), ['visible-worker']);
});

test('builds unique integer snapshot ticks including both endpoints', () => {
    assert.deepEqual(buildSnapshotTickIndexes(2), [0, 1]);
    assert.deepEqual(buildSnapshotTickIndexes(3), [0, 1, 2]);
    assert.deepEqual(buildSnapshotTickIndexes(50), [0, 5, 11, 16, 22, 27, 33, 38, 44, 49]);
});

test('omits series without computed CPU rates', () => {
    const model = buildCpuTimelineModel({
        dumps: [{ index: 0 }],
        series: [{ seriesKey: 'series:idle', occurrences: [occurrence(0, 'idle', null)] }],
    });

    assert.deepEqual(model.series, []);
    assert.equal(model.maximumRatePercent, null);
});

test('only reliable intervals contribute to measured ranking, averages and points', () => {
    const worker = series('mixed-worker', [null, 150, 30, 50, 200, 300]);
    ['unavailable', 'estimated', 'estimated', 'reliable', 'conflicting', undefined].forEach((quality, index) => {
        worker.occurrences[index].thread.cpuIntervalQuality = quality;
    });
    const model = buildCpuTimelineModel({ dumps: Array.from({ length: 6 }, (_, index) => ({ index })),
        series: [worker, series('measured-worker', [null, 60])] });
    assert.deepEqual(model.series.map(s => s.name), ['measured-worker', 'mixed-worker']);
    assert.equal(model.maximumRatePercent, 60);
    const measured = model.series[1];
    assert.equal(measured.maximumRatePercent, 50);
    assert.equal(measured.averageRatePercent, 50);
    assert.deepEqual(measured.points.map(p => p.dumpIndex), [3]);
    assert.equal(measured.points[0].intervalQuality, 'reliable');
    assert.equal(measured.points[0].intervalUncertaintyMs, 1);
});

test('real parsed coarse clocks are excluded while elapsed-counter measurements remain available', () => {
    const dump = (second, cpu, elapsed = '') => `2026-10-04 12:00:0${second}\nFull thread dump OpenJDK 64-Bit Server VM:\n\n"mixed-worker" #11 prio=5 os_prio=0 cpu=${cpu}ms ${elapsed ? `elapsed=${elapsed}s ` : ''}tid=0x11 nid=0x65 runnable [0x1100]\n   java.lang.Thread.State: RUNNABLE\n    at example.Work.run(Work.java:1)\n\nJNI global refs: 1\n`;
    const analysis = analyzeThreadDumpData([dump(0, 100), dump(1, 1600), dump(2, 1900, '2.000'),
        dump(3, 2400, '3.000'), dump(4, 2700, '30.000')].join('\n'));
    assert.deepEqual(analysis.parsedDumps.map(d => d.threads[0].cpuIntervalQuality), ['unavailable', 'estimated', 'estimated', 'reliable', 'conflicting']);
    const model = buildCpuTimelineModel({ dumps: analysis.parsedDumps, series: analysis.threadSeries });
    assert.equal(model.maximumRatePercent, 50);
    assert.deepEqual(model.series[0].points.map(p => p.dumpIndex), [3]);
    const coarse = buildCpuTimelineModel({ dumps: analysis.parsedDumps.slice(0, 2), series: analysis.threadSeries });
    assert.equal(coarse.measuredSeriesCount, 0);
    assert.equal(coarse.maximumRatePercent, null);
});

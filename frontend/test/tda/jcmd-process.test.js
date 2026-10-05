import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { buildCpuTimelineModel } from '../../assets/javautils/tda/cpu-timeline.js';
import { elapsedSnapshot } from './elapsed-regression-fixture.js';

export function jcmdSnapshot(index, pid, collector = false) {
    return `${collector ? `2026-10-04T12:00:0${index}.123Z\n` : ''}${pid == null ? '' : `${pid}:\n`}${elapsedSnapshot(index, 100 + index * 700, `${100 + index}.000`, 1000 + index * 999000)}`;
}

test('strict jcmd PID/date/header prefixes remain in their own raw snapshot with or without collector time', () => {
    for (const collector of [false, true]) {
        const snapshots = splitThreadDumpSnapshots([jcmdSnapshot(0, '1234', collector), jcmdSnapshot(1, '5678', collector)].join('\n'));
        assert.deepEqual(snapshots.map(s => s.processId), ['1234', '5678']);
        assert.match(snapshots[0].rawText, /1234:\n/);
        assert.doesNotMatch(snapshots[0].rawText, /5678:/);
        assert.match(snapshots[1].rawText, /5678:\n/);
        assert.equal(snapshots[1].timestampSource, collector ? 'collector' : 'jvm');
    }
    for (const prefix of ['1234\n', 'message 1234:\n', '0:\n', '1234:\nnot a timestamp\n']) {
        assert.equal(splitThreadDumpSnapshots(prefix + elapsedSnapshot(0, 100, '100.000'))[0].processId, null);
    }
});

test('different PID blocks counters, history, changes and measured graphs through concatenated and separate inputs', () => {
    for (const collector of [false, true]) {
        const texts = [jcmdSnapshot(0, '1234', collector), jcmdSnapshot(1, '5678', collector)];
        for (const input of [texts.join('\n'), texts.map(text => ({ text }))]) {
            const result = analyzeThreadDumpData(input);
            const [first, next] = result.parsedDumps.map(d => d.threads[0]);
            assert.notEqual(first.seriesKey, next.seriesKey);
            assert.equal(next.seriesMatchReason, 'different-process');
            assert.equal(next.previousSourceKey, null);
            assert.equal(next.cpuRatePercent, null);
            assert.equal(next.allocatedDeltaBytes, null);
            assert.equal(next.allocationRateBytesPerSecond, null);
            assert.deepEqual(next.snapshotChange.changes, []);
            assert.equal(result.parsedDumps[1].threadChanges.endedCount, null);
            assert.equal(result.threadSeries.length, 2);
            assert.equal(buildCpuTimelineModel({ dumps: result.parsedDumps, series: result.threadSeries }).measuredSeriesCount, 0);
        }
    }
});

test('same or missing PID allows compatible identifiers, but missing PID cannot bridge conflicting known PIDs', () => {
    for (const pids of [['1234', '1234'], [null, null], ['1234', null], [null, '1234']]) {
        const result = analyzeThreadDumpData(pids.map((pid, i) => jcmdSnapshot(i, pid)).join('\n'));
        assert.equal(result.parsedDumps[1].threads[0].cpuRatePercent, 70);
        assert.equal(result.parsedDumps[1].threads[0].allocationRateBytesPerSecond, 999000);
    }
    const result = analyzeThreadDumpData(['1234', null, '5678'].map((pid, i) => ({text: jcmdSnapshot(i, pid)})));
    assert.deepEqual(result.parsedDumps.map(d => d.processId), ['1234', null, '5678']);
    assert.equal(result.parsedDumps[2].threads[0].seriesMatchReason, 'different-process');
    assert.equal(result.parsedDumps[2].threads[0].cpuRatePercent, null);
});

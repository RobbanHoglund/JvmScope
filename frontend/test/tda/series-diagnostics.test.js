import assert from 'node:assert/strict';
import test from 'node:test';

import {
    annotateSeriesDiagnostics,
    summarizeThreadSeries,
} from '../../assets/javautils/tda/series-diagnostics.js';

function diagnosticThread(sourceKey, overrides = {}) {
    return {
        sourceKey,
        seriesKey: 'series:worker',
        threadName: 'worker',
        seriesMatchStatus: 'new',
        seriesMatchConfidence: 'none',
        previousSourceKey: null,
        scenarioKey: null,
        scenarioLabel: null,
        scenarioConfidence: null,
        scenarioEvidence: null,
        findings: [],
        lockAssessment: {
            observedContentions: [],
            likelyBlockers: [],
        },
        ...overrides,
    };
}

function exactContinuation(previous, dumpIndex, overrides = {}) {
    return diagnosticThread(`snapshot:${dumpIndex}:tid:0x1`, {
        seriesMatchStatus: 'matched',
        seriesMatchConfidence: 'exact',
        previousSourceKey: previous.sourceKey,
        ...overrides,
    });
}

function seriesFrom(threads, dumpIndexes = threads.map((_, index) => index)) {
    return {
        seriesKey: 'series:worker',
        occurrences: threads.map((thread, index) => ({
            dumpIndex: dumpIndexes[index],
            sourceKey: thread.sourceKey,
            thread,
        })),
    };
}

function scenario(key, label, overrides = {}) {
    return {
        scenarioKey: key,
        scenarioLabel: label,
        scenarioConfidence: 'medium',
        scenarioEvidence: { level: 'heuristic', label: 'HEURISTIC' },
        ...overrides,
    };
}

test('reports a diagnostic as growing when it appears at the latest exact endpoint', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1');
    const second = exactContinuation(first, 1, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second]));
    const aggregate = result.diagnostics.find((entry) => entry.key === 'possible-livelock');

    assert.equal(result.status, 'available');
    assert.equal(result.occurrenceCount, 2);
    assert.equal(aggregate.count, 1);
    assert.equal(aggregate.totalOccurrences, 2);
    assert.equal(aggregate.firstObservedDumpIndex, 1);
    assert.equal(aggregate.lastObservedDumpIndex, 1);
    assert.equal(aggregate.currentlyObserved, true);
    assert.equal(aggregate.trend, 'growing');
    assert.equal(aggregate.transitionCount, 1);
    assert.equal(aggregate.currentStreak, 1);
});

test('reports a diagnostic as shrinking when it is absent at the latest exact endpoint', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', scenario('monitor-contention', 'Monitor contention'));
    const second = exactContinuation(first, 1);

    const result = summarizeThreadSeries(seriesFrom([first, second]));
    const aggregate = result.diagnostics.find((entry) => entry.key === 'monitor-contention');

    assert.equal(aggregate.trend, 'shrinking');
    assert.equal(aggregate.currentlyObserved, false);
    assert.equal(aggregate.count, 1);
    assert.equal(aggregate.currentStreak, 0);
    assert.equal(aggregate.longestStreak, 1);
});

test('reports stable persistence and counts each snapshot only once', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        ...scenario('cpu-hot', 'CPU hot', {
            scenarioEvidence: { level: 'measured', label: 'MEASURED' },
        }),
        findings: [{ key: 'cpu-hot', label: 'CPU hot', confidence: 'medium' }],
    });
    const second = exactContinuation(first, 1, scenario('cpu-hot', 'CPU hot', {
        scenarioEvidence: { level: 'measured', label: 'MEASURED' },
        findings: [{ key: 'cpu-hot', label: 'CPU hot', confidence: 'medium' }],
    }));
    const third = exactContinuation(second, 2, scenario('cpu-hot', 'CPU hot', {
        scenarioEvidence: { level: 'measured', label: 'MEASURED' },
    }));

    const result = summarizeThreadSeries(seriesFrom([first, second, third]));
    const aggregate = result.diagnostics.find((entry) => entry.key === 'cpu-hot');

    assert.equal(result.diagnostics.length, 1);
    assert.equal(aggregate.count, 3);
    assert.equal(aggregate.trend, 'stable');
    assert.equal(aggregate.transitionCount, 0);
    assert.equal(aggregate.currentStreak, 3);
    assert.equal(aggregate.longestStreak, 3);
    assert.equal(aggregate.evidence.label, 'MEASURED');
});

test('retains intermittent observations without calling equal endpoints growth', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1');
    const second = exactContinuation(first, 1, scenario('many-waiters', 'Many waiters', {
        findings: [{ key: 'many-waiters', label: 'Many waiters', confidence: 'medium' }],
    }));
    second.scenarioKey = null;
    second.scenarioLabel = null;
    const third = exactContinuation(second, 2);

    const result = summarizeThreadSeries(seriesFrom([first, second, third]));
    const aggregate = result.diagnostics.find((entry) => entry.key === 'many-waiters');

    assert.equal(aggregate.count, 1);
    assert.equal(aggregate.trend, 'stable');
    assert.equal(aggregate.transitionCount, 2);
    assert.equal(aggregate.currentlyObserved, false);
    assert.match(aggregate.reason, /fluctuated/i);
});

test('marks a one-snapshot series as insufficient without discarding observations', () => {
    const only = diagnosticThread('snapshot:0:tid:0x1', scenario('deadlock', 'Java deadlock'));

    const result = summarizeThreadSeries(seriesFrom([only]));

    assert.equal(result.status, 'insufficient-data');
    assert.equal(result.diagnostics[0].count, 1);
    assert.equal(result.diagnostics[0].trend, 'insufficient-data');
    assert.match(result.qualification, /at least two/i);
});

test('suppresses trends when exact series identity is unavailable', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', scenario('cpu-hot', 'CPU hot'));
    const ambiguous = diagnosticThread('snapshot:1:tid:0x2', {
        ...scenario('cpu-hot', 'CPU hot'),
        seriesMatchStatus: 'ambiguous',
    });

    const result = summarizeThreadSeries(seriesFrom([first, ambiguous]));

    assert.equal(result.status, 'identity-unavailable');
    assert.equal(result.diagnostics[0].trend, 'insufficient-data');
    assert.match(result.qualification, /exact identity/i);
});

test('suppresses trends across a snapshot gap', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', scenario('cpu-hot', 'CPU hot'));
    const afterGap = exactContinuation(first, 2, scenario('cpu-hot', 'CPU hot'));

    const result = summarizeThreadSeries(seriesFrom([first, afterGap], [0, 2]));

    assert.equal(result.status, 'snapshot-gap');
    assert.equal(result.diagnostics[0].trend, 'insufficient-data');
});

test('links possible livelock only to an exact prior observed lock wait', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        ...scenario('monitor-contention', 'Monitor contention'),
        lockAssessment: {
            observedContentions: [{ lockId: '0xABC', ownerResolution: 'unique-observed-owner' }],
            likelyBlockers: [],
        },
    });
    const second = exactContinuation(first, 1, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second]));

    assert.equal(result.rootCauseLinks.length, 1);
    assert.equal(result.rootCauseLinks[0].lockId, '0xABC');
    assert.equal(result.rootCauseLinks[0].relation, 'previously-waited-on-lock');
    assert.equal(result.rootCauseLinks[0].firstObservedDumpIndex, 0);
    assert.equal(result.rootCauseLinks[0].livelockDumpIndex, 1);
    assert.equal(result.rootCauseLinks[0].evidence.level, 'heuristic');
    assert.match(result.rootCauseLinks[0].qualification, /does not prove causality/i);
});

test('links a possible-livelock finding when CPU hot remains the primary scenario', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        lockAssessment: {
            observedContentions: [{ lockId: '0xABC', ownerResolution: 'unique-observed-owner' }],
            likelyBlockers: [],
        },
    });
    const second = exactContinuation(first, 1, {
        ...scenario('cpu-hot', 'CPU hot'),
        findings: [{ key: 'possible-livelock', label: 'Possible livelock' }],
    });

    const result = summarizeThreadSeries(seriesFrom([first, second]));

    assert.equal(result.rootCauseLinks.length, 1);
    assert.equal(result.rootCauseLinks[0].lockId, '0xABC');
    assert.equal(result.rootCauseLinks[0].livelockDumpIndex, 1);
});

test('links possible livelock to prior exact holder-with-waiters evidence', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        lockAssessment: {
            observedContentions: [],
            likelyBlockers: [{ lockId: '0xdef', waiterCount: 3 }],
        },
    });
    const second = exactContinuation(first, 1, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second]));

    assert.equal(result.rootCauseLinks.length, 1);
    assert.equal(result.rootCauseLinks[0].lockId, '0xdef');
    assert.equal(result.rootCauseLinks[0].relation, 'previously-held-lock-with-waiters');
    assert.equal(result.rootCauseLinks[0].observationCount, 1);
});

test('does not create a causal link without a prior livelock endpoint or safe continuity', () => {
    const currentOnly = diagnosticThread('snapshot:0:tid:0x1', {
        ...scenario('possible-livelock', 'Possible livelock'),
        lockAssessment: {
            observedContentions: [{ lockId: '0xabc' }],
            likelyBlockers: [],
        },
    });
    const currentResult = summarizeThreadSeries(seriesFrom([currentOnly]));

    const first = diagnosticThread('snapshot:0:tid:0x1', {
        lockAssessment: {
            observedContentions: [{ lockId: '0xabc' }],
            likelyBlockers: [],
        },
    });
    const ambiguous = diagnosticThread('snapshot:1:tid:0x2', {
        ...scenario('possible-livelock', 'Possible livelock'),
        seriesMatchStatus: 'ambiguous',
    });
    const ambiguousResult = summarizeThreadSeries(seriesFrom([first, ambiguous]));

    assert.deepEqual(currentResult.rootCauseLinks, []);
    assert.deepEqual(ambiguousResult.rootCauseLinks, []);
});

test('does not link possible livelock when prior lock assessment is unavailable', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', { lockAssessment: null });
    const second = exactContinuation(first, 1, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second]));

    assert.deepEqual(result.rootCauseLinks, []);
});

test('keeps distinct prior lock associations separate', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        lockAssessment: {
            observedContentions: [],
            likelyBlockers: [
                { lockId: '0xaaa', waiterCount: 2 },
                { lockId: '0xbbb', waiterCount: 3 },
            ],
        },
    });
    const second = exactContinuation(first, 1, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second]));

    assert.deepEqual(result.rootCauseLinks.map((link) => link.lockId), ['0xaaa', '0xbbb']);
    assert.deepEqual(result.rootCauseLinks.map((link) => link.maximumObservedWaiters), [2, 3]);
});

test('deduplicates normalized lock links and records their observed range', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1', {
        lockAssessment: {
            observedContentions: [{ lockId: '0xABC' }],
            likelyBlockers: [],
        },
    });
    const second = exactContinuation(first, 1, {
        lockAssessment: {
            observedContentions: [{ lockId: '0xabc' }],
            likelyBlockers: [],
        },
    });
    const third = exactContinuation(second, 2, scenario('possible-livelock', 'Possible livelock'));

    const result = summarizeThreadSeries(seriesFrom([first, second, third]));

    assert.equal(result.rootCauseLinks.length, 1);
    assert.equal(result.rootCauseLinks[0].lockId, '0xABC');
    assert.equal(result.rootCauseLinks[0].observationCount, 2);
    assert.equal(result.rootCauseLinks[0].firstObservedDumpIndex, 0);
    assert.equal(result.rootCauseLinks[0].lastObservedDumpIndex, 1);
});

test('annotates every occurrence and reports aggregate diagnostics', () => {
    const first = diagnosticThread('snapshot:0:tid:0x1');
    const second = exactContinuation(first, 1, scenario('cpu-hot', 'CPU hot'));
    const series = seriesFrom([first, second]);
    const dumps = [
        { index: 0, threads: [first] },
        { index: 1, threads: [second] },
    ];

    const result = annotateSeriesDiagnostics(dumps, [series]);

    assert.equal(result.diagnostics.seriesAnalyzed, 1);
    assert.equal(result.diagnostics.availableSeries, 1);
    assert.equal(result.diagnostics.rootCauseLinks, 0);
    assert.equal(series.crossSnapshotDiagnostics, first.crossSnapshotDiagnostics);
    assert.equal(first.crossSnapshotDiagnostics, second.crossSnapshotDiagnostics);
    assert.equal(second.crossSnapshotDiagnostics.diagnostics[0].trend, 'growing');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ALLOCATION_RATE_THRESHOLDS,
    createRunnableCpuThresholds,
    evaluateAllocationRate,
    evaluateMeasuredCpu,
    evaluateRunnableCpu,
    getRunnableCpuThresholdProfile,
    hasMeasuredLivelockCpuEvidence,
    isPossibleLivelockCandidate,
    RUNNABLE_CPU_THRESHOLDS,
    runnableCpuThresholdProfileFromSearch,
    resolveRunnableCpuThresholdProfileId,
    updateRunnableCpuThresholdProfileSearch,
} from '../../assets/javautils/tda/classification.js';
import { extractNormalizedFrames } from '../../assets/javautils/tda/parser.js';

function measuredThread(overrides = {}) {
    return {
        javaState: 'RUNNABLE',
        cpuMs: 100000,
        elapsedS: 1000,
        cpuDeltaMs: 300,
        cpuIntervalMs: 5000,
        cpuRatePercent: 6,
        cpuRateBasis: 'snapshot-time',
        cpuDeltaStatus: 'computed',
        ...overrides,
    };
}

test('classifies application CPU heat only from a measured adjacent interval', () => {
    const evidence = evaluateRunnableCpu(measuredThread());

    assert.equal(evidence.available, true);
    assert.equal(evidence.hotFinding, true);
    assert.equal(evidence.hotScenario, true);
    assert.equal(evidence.scenarioConfidence, 'medium');
    assert.match(evidence.reason, /Measured 6\.0% CPU over 5\.00s/);
    assert.match(evidence.reason, /snapshot timestamps/);
});

test('does not infer current CPU heat from large lifetime counters', () => {
    const evidence = evaluateRunnableCpu(measuredThread({
        cpuDeltaMs: null,
        cpuIntervalMs: null,
        cpuRatePercent: null,
        cpuRateBasis: 'unavailable',
        cpuDeltaStatus: 'first-occurrence',
    }));

    assert.equal(evidence.available, false);
    assert.equal(evidence.status, 'first-occurrence');
    assert.equal(evidence.hotFinding, false);
    assert.equal(evidence.hotScenario, false);
});

test('preserves measured interval CPU when the thread parks at the final endpoint', () => {
    const parked = measuredThread({
        javaState: 'TIMED_WAITING',
        cpuDeltaMs: 568.79,
        cpuIntervalMs: 2000,
        cpuRatePercent: 28.4395,
    });

    const measured = evaluateMeasuredCpu(parked);
    const endpointAttributed = evaluateRunnableCpu(parked);

    assert.equal(measured.available, true);
    assert.equal(measured.hotFinding, true);
    assert.equal(measured.ratePercent, 28.4395);
    assert.equal(endpointAttributed.available, false);
    assert.equal(endpointAttributed.status, 'not-runnable');
});

test('retains exceptionally high CPU measured over a slightly short interval', () => {
    const evidence = evaluateMeasuredCpu(measuredThread({
        cpuDeltaMs: 752.79,
        cpuIntervalMs: 790,
        cpuRatePercent: 95.289873,
        cpuRateBasis: 'thread-elapsed',
    }));

    assert.equal(evidence.available, true);
    assert.equal(evidence.hotFinding, true);
    assert.equal(evidence.hotScenario, true);
    assert.equal(evidence.status, 'measured-high-rate-short-interval');
    assert.match(evidence.reason, /retained despite the short interval/i);
});

test('pins measured CPU availability at the short-interval boundaries', () => {
    const cases = [
        { kind: 'application', intervalMs: 250, ratePercent: 20, available: true, status: 'measured-high-rate-short-interval' },
        { kind: 'application', intervalMs: 250, ratePercent: 19.9, available: false, status: 'sample-too-short' },
        { kind: 'application', intervalMs: 249, ratePercent: 20, available: false, status: 'sample-too-short' },
        { kind: 'application', intervalMs: 999, ratePercent: 20, available: true, status: 'measured-high-rate-short-interval' },
        { kind: 'application', intervalMs: 500, ratePercent: 3, available: false, status: 'sample-too-short' },
        { kind: 'application', intervalMs: 1000, ratePercent: 3, available: true, status: 'measured-rate' },
        { kind: 'infrastructure', intervalMs: 250, ratePercent: 15, available: true, status: 'measured-high-rate-short-interval' },
        { kind: 'infrastructure', intervalMs: 250, ratePercent: 14.9, available: false, status: 'sample-too-short' },
    ];

    for (const entry of cases) {
        const evidence = evaluateMeasuredCpu(measuredThread({
            cpuIntervalMs: entry.intervalMs,
            cpuRatePercent: entry.ratePercent,
            cpuRateBasis: 'thread-elapsed',
        }), { kind: entry.kind });
        const message = `${entry.kind} ${entry.intervalMs} ms at ${entry.ratePercent}%`;

        assert.equal(evidence.available, entry.available, message);
        assert.equal(evidence.status, entry.status, message);
    }
});

test('classifies allocation heat only from a measured adjacent allocated-byte rate', () => {
    const evidence = evaluateAllocationRate({
        allocatedBytes: 512 * 1024 ** 2,
        allocatedDeltaBytes: 50 * 1024 ** 2,
        allocationIntervalMs: 2000,
        allocationRateBytesPerSecond: 25 * 1024 ** 2,
        allocationRateBasis: 'snapshot-time',
        allocationDeltaStatus: 'computed',
    });

    assert.equal(evidence.available, true);
    assert.equal(evidence.hotFinding, true);
    assert.equal(evidence.hotScenario, true);
    assert.equal(evidence.confidence, 'medium');
    assert.match(evidence.reason, /25\.00 MiB\/s heap allocation over 2\.00s/);
    assert.match(evidence.reason, /does not measure retained\/live heap/);
});

test('does not infer allocation activity or a leak from one large cumulative counter', () => {
    const unavailable = evaluateAllocationRate({
        allocatedBytes: 20 * 1024 ** 3,
        allocationDeltaStatus: 'first-occurrence',
    });
    const short = evaluateAllocationRate({
        allocatedDeltaBytes: 100 * 1024 ** 2,
        allocationIntervalMs: 500,
        allocationRateBytesPerSecond: 200 * 1024 ** 2,
        allocationDeltaStatus: 'computed',
    });

    assert.equal(unavailable.available, false);
    assert.equal(unavailable.status, 'first-occurrence');
    assert.equal(short.available, false);
    assert.equal(short.status, 'sample-too-short');
    assert.equal(ALLOCATION_RATE_THRESHOLDS.scenarioBytesPerSecond, 10 * 1024 ** 2);
});

test('uses stricter scenario threshold for measured selector and event-loop CPU', () => {
    const belowScenario = evaluateRunnableCpu(measuredThread({ cpuRatePercent: 6 }), {
        kind: 'infrastructure',
    });
    const hotScenario = evaluateRunnableCpu(measuredThread({ cpuRatePercent: 11 }), {
        kind: 'infrastructure',
    });

    assert.equal(belowScenario.hotFinding, true);
    assert.equal(belowScenario.hotScenario, false);
    assert.equal(hotScenario.hotFinding, true);
    assert.equal(hotScenario.hotScenario, true);
    assert.equal(hotScenario.scenarioConfidence, 'high');
    assert.equal(hotScenario.findingConfidence, 'medium');
});

test('rejects short samples and stacks with an obvious blocking primitive', () => {
    const shortSample = evaluateRunnableCpu(measuredThread({
        cpuDeltaMs: 30,
        cpuIntervalMs: 500,
        cpuRatePercent: 6,
    }));
    const blocking = evaluateRunnableCpu(measuredThread(), { hasBlockingPrimitive: true });

    assert.equal(shortSample.available, false);
    assert.equal(shortSample.status, 'sample-too-short');
    assert.equal(blocking.available, false);
    assert.equal(blocking.status, 'blocking-primitive');
});

test('requires measured current CPU activity for a possible livelock signal', () => {
    assert.equal(hasMeasuredLivelockCpuEvidence(measuredThread({ cpuRatePercent: 1.5 })), true);
    assert.equal(hasMeasuredLivelockCpuEvidence(measuredThread({ cpuRatePercent: 0.5 })), false);
    assert.equal(hasMeasuredLivelockCpuEvidence(measuredThread({
        cpuRatePercent: null,
        cpuDeltaStatus: 'first-occurrence',
    })), false);
});

test('requires runnable measured CPU and an explicit livelock frame signal', () => {
    const active = measuredThread({ cpuRatePercent: 42, cpuIntervalMs: 2000 });

    assert.equal(isPossibleLivelockCandidate(active, {
        stackText: 'java.util.concurrent.locks.ReentrantLock.tryLock(ReentrantLock.java:1)',
    }), true);
    assert.equal(isPossibleLivelockCandidate(active, {
        stackText: 'org.springframework.retry.support.RetryTemplate.execute(RetryTemplate.java:1)',
    }), false);
    assert.equal(isPossibleLivelockCandidate({
        ...active,
        javaState: 'WAITING',
        isCarrierThread: true,
    }, {
        stackText: 'java.util.concurrent.locks.ReentrantLock.tryLock(ReentrantLock.java:1)',
    }), false);
    assert.equal(isPossibleLivelockCandidate({ ...active, cpuRatePercent: 0.2 }, {
        stackText: 'java.util.concurrent.locks.ReentrantLock.tryLock(ReentrantLock.java:1)',
    }), false);
    assert.equal(isPossibleLivelockCandidate({
        ...active,
        cpuRatePercent: null,
        cpuDeltaStatus: 'first-occurrence',
    }, {
        stackText: 'java.util.concurrent.locks.ReentrantLock.tryLock(ReentrantLock.java:1)',
    }), false);
});

test('does not use a livelock-like thread name as stack evidence', () => {
    const thread = measuredThread({
        threadName: 'yield-worker',
        rawBlock: [
            '"yield-worker" #12 prio=5 tid=0x1 nid=0x2 runnable',
            '   java.lang.Thread.State: RUNNABLE',
            '\tat com.example.Worker.run(Worker.java:42)',
        ],
    });
    const frameText = extractNormalizedFrames(thread).join('\n');

    assert.equal(isPossibleLivelockCandidate(thread, { stackText: frameText }), false);
    assert.equal(isPossibleLivelockCandidate(thread, {
        stackText: 'com.example.YieldWorker.run(YieldWorker.java:42)',
    }), false);
    assert.equal(isPossibleLivelockCandidate(thread, {
        stackText: 'com.example.TryLockMetrics.record(TryLockMetrics.java:42)',
    }), false);
});

test('provides deterministic CPU profiles and falls back safely for unknown profile ids', () => {
    const balanced = getRunnableCpuThresholdProfile('balanced');
    const sensitive = getRunnableCpuThresholdProfile('sensitive');
    const highThroughput = getRunnableCpuThresholdProfile('high-throughput');

    assert.equal(resolveRunnableCpuThresholdProfileId('sensitive'), 'sensitive');
    assert.equal(resolveRunnableCpuThresholdProfileId('unknown'), 'balanced');
    assert.deepEqual(balanced.thresholds, RUNNABLE_CPU_THRESHOLDS);
    assert.equal(balanced.thresholds.applicationScenarioPercent, 5);
    assert.ok(sensitive.thresholds.applicationScenarioPercent < balanced.thresholds.applicationScenarioPercent);
    assert.ok(highThroughput.thresholds.applicationScenarioPercent > balanced.thresholds.applicationScenarioPercent);
    assert.equal(Object.isFrozen(balanced.thresholds), true);
});

test('validates custom CPU thresholds and their severity ordering', () => {
    const custom = createRunnableCpuThresholds({
        applicationFindingPercent: 4,
        applicationScenarioPercent: 8,
        applicationScenarioHighPercent: 12,
        applicationFindingHighPercent: 16,
    });

    assert.equal(custom.applicationFindingPercent, 4);
    assert.equal(custom.infrastructureScenarioPercent, 10);
    assert.equal(Object.isFrozen(custom), true);
    assert.throws(
        () => createRunnableCpuThresholds({ applicationFindingPercent: -1 }),
        /non-negative finite number/i,
    );
    assert.throws(
        () => createRunnableCpuThresholds({
            applicationFindingPercent: 10,
            applicationScenarioPercent: 5,
        }),
        /application.*ordering/i,
    );
});

test('uses the selected CPU profile without changing measured rate semantics', () => {
    const balanced = getRunnableCpuThresholdProfile('balanced');
    const highThroughput = getRunnableCpuThresholdProfile('high-throughput');
    const thread = measuredThread({ cpuRatePercent: 6 });

    const balancedEvidence = evaluateRunnableCpu(thread, { thresholds: balanced.thresholds });
    const highThroughputEvidence = evaluateRunnableCpu(thread, { thresholds: highThroughput.thresholds });

    assert.equal(balancedEvidence.ratePercent, 6);
    assert.equal(highThroughputEvidence.ratePercent, 6);
    assert.equal(balancedEvidence.hotScenario, true);
    assert.equal(highThroughputEvidence.hotScenario, false);
    assert.equal(highThroughputEvidence.scenarioThresholdPercent, 10);
    assert.match(highThroughputEvidence.reason, /scenario threshold 10\.0%/i);
});

test('uses the selected profile for measured livelock CPU evidence', () => {
    const sensitive = getRunnableCpuThresholdProfile('sensitive');
    const highThroughput = getRunnableCpuThresholdProfile('high-throughput');
    const thread = measuredThread({ cpuRatePercent: 1 });

    assert.equal(hasMeasuredLivelockCpuEvidence(thread, { thresholds: sensitive.thresholds }), true);
    assert.equal(hasMeasuredLivelockCpuEvidence(thread, { thresholds: highThroughput.thresholds }), false);
});

test('round-trips CPU profiles through a shareable URL query without losing other parameters', () => {
    assert.equal(runnableCpuThresholdProfileFromSearch('?cpuProfile=sensitive&view=table'), 'sensitive');
    assert.equal(runnableCpuThresholdProfileFromSearch('?cpuProfile=unknown'), 'balanced');
    assert.equal(
        updateRunnableCpuThresholdProfileSearch('?view=table', 'high-throughput'),
        '?view=table&cpuProfile=high-throughput',
    );
    assert.equal(
        updateRunnableCpuThresholdProfileSearch('?view=table&cpuProfile=sensitive', 'balanced'),
        '?view=table',
    );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    parseDeadlocks,
    parseThreadDump,
    splitThreadDumpSnapshots,
} from '../../assets/javautils/tda/parser.js';
import { analyzeClassInitialization } from '../../assets/javautils/tda/class-initialization.js';
import { evaluateAllocationRate, evaluateRunnableCpu } from '../../assets/javautils/tda/classification.js';
import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';

const singleSamplePath = join(
    import.meta.dirname,
    '../../../testdata/thread-dumps/real-java-all-1-snapshot.txt',
);
const samplePath = join(
    import.meta.dirname,
    '../../../testdata/thread-dumps/real-java-all-3-snapshots.txt',
);

test('parses the JVM-generated single-snapshot sample', async () => {
    const text = await readFile(singleSamplePath, 'utf8');
    const snapshots = splitThreadDumpSnapshots(text);

    assert.equal(snapshots.length, 1);
    assert.ok(parseThreadDump(snapshots[0].rawText, { snapshotIndex: 0 }).length >= 60);
    assert.ok(parseDeadlocks(snapshots[0].rawText).length >= 2);
});

test('parses the JVM-generated all-scenarios sample across three snapshots', async () => {
    const text = await readFile(samplePath, 'utf8');
    const snapshots = splitThreadDumpSnapshots(text);

    assert.equal(snapshots.length, 3);
    assert.ok(snapshots.every((snapshot) => snapshot.timestampQuality === 'valid'));

    const dumps = snapshots.map((snapshot) => parseThreadDump(snapshot.rawText, {
        snapshotIndex: snapshot.index,
    }));
    const scenarioThreads = dumps[0].filter((thread) => thread.threadName.startsWith('scenario-'));

    assert.ok(scenarioThreads.length >= 30);
    assert.ok(scenarioThreads.some((thread) => thread.javaState === 'BLOCKED'));
    assert.ok(scenarioThreads.some((thread) => thread.javaState === 'WAITING'));
    assert.ok(scenarioThreads.some((thread) => thread.javaState === 'TIMED_WAITING'));
    assert.ok(scenarioThreads.some((thread) => thread.javaState === 'RUNNABLE'));
    assert.ok(parseDeadlocks(snapshots[0].rawText).length >= 2);

    const cpuSamples = dumps.map((threads) => threads.find(
        (thread) => thread.threadName === 'scenario-cpu-hot-1',
    ));
    assert.ok(cpuSamples.every((thread) => thread.cpuMs != null && thread.elapsedS != null));
    assert.ok(cpuSamples[2].cpuMs > cpuSamples[0].cpuMs);
});

test('the real sample exercises measured CPU, allocation, livelock, and class initialization paths', async () => {
    const text = await readFile(samplePath, 'utf8');
    const snapshots = splitThreadDumpSnapshots(text).map((snapshot) => ({
        ...snapshot,
        threads: parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index }),
    }));
    const correlation = correlateThreadsAcrossSnapshots(snapshots);
    const temporal = annotateCpuRates(correlation.dumps, correlation.series);

    const secondCpu = temporal.dumps[1].threads.find((thread) => thread.threadName === 'scenario-cpu-hot-1');
    const secondChurn = temporal.dumps[1].threads.find((thread) => thread.threadName === 'scenario-allocation-churn-1');
    const secondCombined = temporal.dumps[1].threads.find((thread) => thread.threadName === 'scenario-cpu-and-allocation-hot');
    const livelock = temporal.dumps[1].threads.find((thread) => thread.threadName === 'scenario-livelock-2-agent-1');

    assert.equal(evaluateRunnableCpu(secondCpu).hotScenario, true);
    assert.equal(evaluateAllocationRate(secondChurn).hotScenario, true);
    assert.equal(evaluateRunnableCpu(secondCombined).hotFinding, true);
    assert.equal(evaluateAllocationRate(secondCombined).hotFinding, true);
    assert.match(livelock.rawBlock.join('\n'), /compareAndSet|startLivelock|onSpinWait/i);
    assert.ok(livelock.cpuRatePercent >= 1);

    for (const dump of temporal.dumps) {
        const classInitialization = analyzeClassInitialization(dump.threads);
        const chain = classInitialization.chains.find((item) =>
            item.className.includes('ThreadScenarioRunner$ClassInitializationTarget'));
        assert.ok(chain);
        assert.equal(chain.waiterCount, 10);
        assert.equal(chain.initializer.threadName, 'scenario-class-init-initializer');
        assert.equal(chain.stallCandidate, true);
    }
});

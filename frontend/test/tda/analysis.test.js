import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { createAnalysisClient } from '../../assets/javautils/tda/analysis-client.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { buildThreadDetailsViewModel } from '../../assets/javautils/tda/thread-modal.js';

const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
function workerFactory() {
    const thread = new Worker(new URL('fixtures/analysis-worker-adapter.mjs', import.meta.url));
    const worker = { postMessage: data => thread.postMessage(data), terminate: () => thread.terminate() };
    thread.on('message', data => worker.onmessage?.({ data }));
    thread.on('error', error => worker.onerror?.({ message: error.message }));
    return worker;
}

test('the worker preserves real snapshot counts, graph data and shared thread references', async t => {
    const client = createAnalysisClient(workerFactory);
    t.after(() => client.cancel());
    const text = readFileSync(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8');
    const result = await client.analyze(text);
    assert.equal(result.parserResult.status, 'success');
    assert.equal(result.parsedDumps.length, 3);
    assert.equal(result.parsedDumps[0].threads.length, 67);
    assert.equal(result.runnableStackClusters.length, 3);
    const dump = result.parsedDumps[0];
    assert.ok(buildThreadDependencyGraph(dump.threads, dump.deadlocks).dependencyEdges.length > 0);
    for (const chain of dump.contentionChains) {
        assert.ok(chain.owners.every(owner => dump.threads.includes(owner)));
        assert.ok(chain.waiters.every(waiter => dump.threads.includes(waiter)));
    }
    for (const cluster of result.runnableStackClusters) {
        assert.ok(Array.isArray(cluster.seenDumpIndexes));
        assert.ok(cluster.dumpCounts instanceof Map);
        assert.ok(cluster.members.every(member => result.parsedDumps[member.dumpIndex].threads.includes(member)));
    }
});

test('every controlled runtime format still runs through the extracted analysis pipeline', () => {
    for (const name of readdirSync(new URL('fixtures/runtime/', import.meta.url))) {
        if (!name.startsWith('jdk')) continue;
        const result = analyzeThreadDumpData(fixture(`runtime/${name}`));
        assert.equal(result.parserResult.status, 'success', name);
        assert.ok(result.parsedDumps[0].threads.length >= 2, name);
        assert.doesNotThrow(() => structuredClone(result), name);
    }
});

test('partial input keeps observations but suppresses cluster trends and thread departures', () => {
    const result = analyzeThreadDumpData(fixture('partial-thread-snapshot.txt'));
    assert.equal(result.parserResult.status, 'partial');
    assert.equal(result.parsedDumps[1].threadChanges.endedCount, null);
    assert.equal(result.runnableStackClusters[0].trend, 'Unavailable');
    assert.equal(result.runnableStackClusters[0].timeline[1].count, null);
    assert.equal(result.runnableStackClusters[0].timeline[1].observedCount, 1);
});

test('the worker cannot project a stable history across a process change hidden by classic snapshots', async t => {
    const client = createAnalysisClient(workerFactory);
    t.after(() => client.cancel());
    const plain = fixture('runtime/jdk25-dump-to-file.txt');
    const classic = fixture('runtime/jdk25-thread-print.txt');
    const input = [plain.replace(/^\d+/, '100'), classic, classic, plain.replace(/^\d+/, '200')].join('\n');
    const result = await client.analyze(input);
    assert.equal(result.parserResult.status, 'success');
    const first = result.parsedDumps[0].threads.find(thread => thread.jvmId === 23);
    const last = result.parsedDumps.at(-1).threads.find(thread => thread.jvmId === 23);
    assert.notEqual(last.seriesKey, first.seriesKey);
    assert.equal(last.seriesMatchReason, 'different-process');
    const history = buildThreadDetailsViewModel(last).history.summary;
    assert.equal(history.status, 'insufficient-data');
    assert.equal(history.occurrenceCount, 1);
    assert.ok(history.diagnostics.every(diagnostic => diagnostic.trend === 'insufficient-data'));
    assert.ok(result.parsedDumps.at(-1).smartAnalysis.findings.every(finding =>
        !finding.facts.some(fact => fact.label === 'Cross-snapshot evidence')));
    assert.equal(last.cpuRatePercent, null);
    assert.equal(last.lockAssessment.transitions.status, 'first-occurrence');
    assert.equal(result.parsedDumps.at(-1).threadChanges.endedCount, null);
});

test('empty and unsupported inputs cannot retain a previous analysis', () => {
    for (const [text, status] of [['', 'empty'], ['unrelated log entries', 'unsupported']]) {
        const result = analyzeThreadDumpData(text);
        assert.equal(result.parserResult.status, status);
        assert.deepEqual(result.parsedDumps, []);
        assert.deepEqual(result.threadSeries, []);
        assert.deepEqual(result.runnableStackClusters, []);
    }
});

test('the real worker accepts separate session sources with global keys and shared graph references', async t => {
    const client = createAnalysisClient(workerFactory);
    t.after(() => client.cancel());
    const result = await client.analyze([
        { text: fixture('runtime/jdk27-thread-print.txt'), name: 'classic.txt', kind: 'file' },
        { text: fixture('runtime/jdk27-mounted-virtual.json'), name: 'mounted.json', kind: 'file' },
    ]);
    assert.equal(result.parsedDumps.length, 2);
    assert.ok(result.sourceResults.every(source => source.accepted));
    assert.equal(result.parsedDumps[1].sourceLabel, 'mounted.json');
    for (const dump of result.parsedDumps) {
        assert.ok(dump.threads.every(thread => thread.sourceKey.startsWith(`snapshot:${dump.index}:`)));
        for (const chain of dump.contentionChains) {
            assert.ok(chain.owners.every(owner => dump.threads.includes(owner)));
            assert.ok(chain.waiters.every(waiter => dump.threads.includes(waiter)));
        }
    }
    assert.doesNotThrow(() => buildThreadDependencyGraph(result.parsedDumps[1].threads, result.parsedDumps[1].deadlocks));
});

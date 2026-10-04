import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSessionInputQueue, parseThreadDumpSession } from '../../assets/javautils/tda/session.js';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { buildCpuTimelineModel } from '../../assets/javautils/tda/cpu-timeline.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';

const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const sample = readFileSync(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8');
const source = (text, name = 'dump.txt') => ({ text, name, kind: 'file' });

test('separate physical sources produce the same histories, deltas and timeline as one multi-snapshot file', () => {
    const single = analyzeThreadDumpData(sample);
    const separate = analyzeThreadDumpData(splitThreadDumpSnapshots(sample).map((dump, index) => source(dump.rawText, `dump-${index}.txt`)));
    assert.equal(separate.parsedDumps.length, 3);
    assert.deepEqual(separate.parsedDumps.map(dump => dump.threads.map(thread => ({
        sourceKey: thread.sourceKey, seriesKey: thread.seriesKey, cpuDeltaMs: thread.cpuDeltaMs,
        cpuRatePercent: thread.cpuRatePercent, seriesMatchStatus: thread.seriesMatchStatus,
    }))), single.parsedDumps.map(dump => dump.threads.map(thread => ({
        sourceKey: thread.sourceKey, seriesKey: thread.seriesKey, cpuDeltaMs: thread.cpuDeltaMs,
        cpuRatePercent: thread.cpuRatePercent, seriesMatchStatus: thread.seriesMatchStatus,
    }))));
    assert.deepEqual(buildCpuTimelineModel({ dumps: separate.parsedDumps, series: separate.threadSeries }),
        buildCpuTimelineModel({ dumps: single.parsedDumps, series: single.threadSeries }));
    assert.deepEqual(separate.parsedDumps.map(dump => dump.sourceLabel), ['dump-0.txt', 'dump-1.txt', 'dump-2.txt']);
});

test('headerless texts and JSON sources retain independent snapshot and source boundaries', () => {
    const headerless = '"worker" #1 prio=5 tid=0x01 nid=1 runnable\n java.lang.Thread.State: RUNNABLE\n at example.Worker.run(Worker.java:1)';
    const result = analyzeThreadDumpData([source(headerless, 'one.txt'), source(headerless, 'two.txt'), source(fixture('runtime/jdk27-mounted-virtual.json'), 'mounted.json')]);
    assert.equal(result.parsedDumps.length, 3);
    assert.deepEqual(result.parsedDumps.map(dump => dump.index), [0, 1, 2]);
    assert.equal(result.parsedDumps[0].threads.length, 1);
    assert.equal(result.parsedDumps[1].threads.length, 1);
    assert.notEqual(result.parsedDumps[0].threads[0].sourceKey, result.parsedDumps[1].threads[0].sourceKey);
    const json = result.parsedDumps[2];
    const virtual = json.threads.find(thread => thread.carrierSourceKey);
    assert.ok(virtual);
    assert.ok(virtual.carrierSourceKey.startsWith('snapshot:2:'));
    assert.ok(json.threads.some(thread => thread.sourceKey === virtual.carrierSourceKey && thread.isCarrierThread));
    const graph = buildThreadDependencyGraph(json.threads, json.deadlocks);
    assert.ok(graph.resourceEdges.some(edge => edge.source === `thread:${virtual.sourceKey}` && edge.target === `thread:${virtual.carrierSourceKey}`));
});

test('empty or malformed sources cannot block valid batch items or corrupt global indexes', () => {
    const result = parseThreadDumpSession([null, source('unrelated text', 'bad.txt'), source('{"threadDump":', 'bad.json'), source(sample)]);
    assert.deepEqual(result.sourceResults.map(item => item.accepted), [false, false, false, true]);
    assert.equal(result.parserResult.status, 'success');
    assert.deepEqual(result.parserResult.snapshots.map(dump => dump.index), [0, 1, 2]);
    assert.deepEqual(result.parserResult.snapshots.map(dump => dump.sourceSnapshotIndex), [0, 1, 2]);
    assert.equal(result.parserResult.diagnostics.snapshots, 3);
    const partial = parseThreadDumpSession([source(sample), source(fixture('partial-thread-snapshot.txt'))]);
    assert.equal(partial.parserResult.status, 'partial');
    assert.ok(partial.parserResult.diagnostics.incompleteSnapshots > 0);
    assert.equal(parseThreadDumpSession([]).parserResult.status, 'empty');
});

test('independent JSON files with changed process identities cannot share a thread history', () => {
    const raw = fixture('runtime/jdk27-dump-to-file.json');
    const a = JSON.parse(raw);
    const b = JSON.parse(raw);
    b.threadDump.processId = String(Number(a.threadDump.processId) + 1);
    const result = analyzeThreadDumpData([source(JSON.stringify(a)), source(JSON.stringify(b))]);
    const first = result.parsedDumps[0].threads[0];
    const last = result.parsedDumps[1].threads[0];
    assert.notEqual(first.seriesKey, last.seriesKey);
    assert.equal(last.seriesMatchReason, 'different-process');
    assert.equal(last.cpuRatePercent, null);
    assert.equal(result.parsedDumps[1].threadChanges.endedCount, null);
});

test('duplicate, equal, reversed and missing timestamps retain input order without invented rates', () => {
    const block = '"worker" #1 prio=5 cpu=10.00ms tid=0x01 nid=1 runnable\n java.lang.Thread.State: RUNNABLE\n at example.Worker.run(Worker.java:1)';
    const dump = time => source(`${time ? `${time}\n` : ''}Full thread dump OpenJDK 64-Bit Server VM (27 mixed mode):\n\n${block}`);
    const result = analyzeThreadDumpData([dump('2099-01-01 12:00:00'), dump('2099-01-01 12:00:00'), dump('2099-01-01 11:00:00'), dump(null)]);
    assert.equal(result.parsedDumps.length, 4);
    assert.deepEqual(result.parsedDumps.map(item => item.timestamp), ['2099-01-01 12:00:00', '2099-01-01 12:00:00', '2099-01-01 11:00:00', null]);
    assert.ok(result.parsedDumps.every(item => item.threads[0].cpuRatePercent === null));
});

test('queued additions retain submission order and a failed addition does not block the next', async () => {
    const busy = [];
    const queue = createSessionInputQueue(value => busy.push(value));
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const observed = [];
    const a = queue.enqueue(async () => { await wait; observed.push('a'); });
    const b = queue.enqueue(() => { observed.push('b'); throw new Error('bad source'); });
    const rejected = assert.rejects(b, /bad source/);
    const c = queue.enqueue(() => observed.push('c'));
    await Promise.resolve();
    assert.deepEqual(observed, []);
    release();
    await Promise.all([a, rejected, c]);
    assert.deepEqual(observed, ['a', 'b', 'c']);
    assert.equal(busy.at(-1), false);
    assert.ok(busy.slice(0, -1).every(Boolean));
});

test('Clear/Replace invalidate unfinished reads and queued work; new work can run immediately', async () => {
    const queue = createSessionInputQueue();
    let release;
    const wait = new Promise(resolve => { release = resolve; });
    const observed = [];
    const a = queue.enqueue(async current => { await wait; if (current()) observed.push('stale'); });
    const b = queue.enqueue(() => observed.push('queued-stale'));
    await Promise.resolve();
    queue.clear();
    await queue.enqueue(() => observed.push('new'));
    release();
    await Promise.all([a, b]);
    assert.deepEqual(observed, ['new']);
});

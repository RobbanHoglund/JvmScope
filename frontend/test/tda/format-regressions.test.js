import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeThreadDump, parseThreadDump } from '../../assets/javautils/tda/parser.js';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { formatBytes, formatCpu, formatElapsed, formatRate } from '../../assets/javautils/tda/dependency-graph-view.js';
import { correlateThreadsAcrossSnapshots } from '../../assets/javautils/tda/identity.js';
import { annotateThreadChanges } from '../../assets/javautils/tda/changes.js';
import { annotateCpuRates } from '../../assets/javautils/tda/temporal.js';
import { annotateLockPrecedence } from '../../assets/javautils/tda/lock-precedence.js';
import { buildRawDumpModel } from '../../assets/javautils/tda/raw-dump-model.js';
import { canCompareThreadCollections } from '../../assets/javautils/tda/snapshot-quality.js';
import { parseModernLockLine } from '../../assets/javautils/tda/dump-to-file.js';

const fixture = name => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
function pipeline(raw) {
    const analysis = analyzeThreadDump(raw);
    const dumps = analysis.snapshots.map(snapshot => ({ ...snapshot, threads: snapshot.parsedThreads }));
    const correlation = correlateThreadsAcrossSnapshots(dumps);
    annotateCpuRates(correlation.dumps, correlation.series);
    annotateLockPrecedence(correlation.dumps, correlation.series);
    const changes = annotateThreadChanges(correlation.dumps, correlation.series);
    return { analysis, ...changes };
}

test('duplicate raw observations do not become duplicate owners, but distinct owners stay ambiguous', () => {
    const threads = parseThreadDump(fixture('runtime/jdk25-thread-print.txt'));
    const owner = threads.find(thread => thread.threadName === 'sample-owner');
    owner.heldLocks.push({ ...owner.heldLocks[0] });
    assert.equal(buildThreadDependencyGraph(threads).dependencyEdges[0].ambiguousOwner, false);
    threads.push({ ...owner, sourceKey: 'another-owner', threadName: 'another-owner' });
    assert.ok(buildThreadDependencyGraph(threads).dependencyEdges.every(edge => edge.ambiguousOwner));
});

test('Java 8 missing metrics remain unavailable through the graph and presentation', () => {
    const { dumps } = pipeline(fixture('hotspot-jdk8-classic.txt'));
    const node = buildThreadDependencyGraph(dumps[0].threads).threadNodes[0];
    assert.equal(node.cpuMs, null);
    assert.equal(node.cpuRatePercent, null);
    assert.equal(node.elapsedS, null);
    assert.equal(node.allocatedBytes, null);
    for (const format of [formatCpu, formatRate, formatElapsed, formatBytes]) {
        for (const missing of [null, undefined, '', NaN, Infinity]) assert.equal(format(missing), '—');
        assert.notEqual(format(0), '—', 'measured zero is available');
    }
});

test('returning threads after a partial snapshot are unresolved, not newly created', () => {
    const raw = fixture('partial-thread-snapshot.txt');
    const first = raw.slice(0, raw.indexOf('2026-09-08 10:00:05'));
    const result = pipeline(raw + '\n' + first.replace('10:00:00', '10:00:10'));
    const recovered = result.dumps.at(-1).threads.find(thread => thread.threadName === 'still-alive');
    assert.equal(recovered.snapshotChange.status, 'unresolved');
    assert.equal(result.dumps.at(-1).threadChanges.newCount, null);
});

test('modern plain snapshots retain timestamps and match by JVM ID without inventing CPU', () => {
    const raw = fixture('runtime/jdk25-dump-to-file.txt');
    const result = pipeline(raw + '\n' + raw);
    assert.equal(result.dumps.length, 2);
    assert.equal(result.dumps[1].threads[0].seriesMatchStatus, 'matched');
    assert.equal(result.dumps[1].threads[0].cpuRatePercent, null);
    assert.equal(result.dumps[1].threadChanges.endedCount, 0);
});

test('changing capture scope or process does not imply thread arrivals/departures', () => {
    const classic = fixture('runtime/jdk25-thread-print.txt');
    const modern = fixture('runtime/jdk25-dump-to-file.txt');
    const mixed = pipeline(classic + '\n' + modern);
    assert.equal(mixed.dumps.length, 2);
    assert.equal(mixed.dumps[1].threadChanges.endedCount, null);
    const otherProcess = pipeline(modern + '\n' + modern.replace(/^\d+/, '999999'));
    assert.ok(otherProcess.dumps[1].threads.every(thread => thread.seriesMatchStatus === 'new'));
    assert.equal(otherProcess.dumps[1].threadChanges.endedCount, null);
});

test('JSON survives property reordering, compact input, escaped names, duplicate names and large IDs', () => {
    const data = JSON.parse(fixture('runtime/jdk25-dump-to-file.json'));
    const records = data.threadDump.threadContainers[0].threads;
    records[0].tid = '9007199254740993';
    records[1].tid = '9007199254740994';
    records[0].name = 'quote" newline\n braces{}';
    records[1].name = records[0].name;
    data.threadDump.threadContainers[0].threads = records.map(record => Object.fromEntries(Object.entries(record).reverse()));
    const raw = JSON.stringify(data);
    const threads = parseThreadDump(raw);
    assert.equal(threads.length, 4);
    assert.equal(threads[0].threadName, records[0].name);
    assert.equal(threads[1].threadName, records[1].name);
    assert.notEqual(threads[0].sourceKey, threads[1].sourceKey);
    assert.equal(threads[0].jvmId, '9007199254740993');
    assert.ok(threads.every(thread => thread.rawStartLine === 1 && thread.rawEndLine === 1));
    assert.equal(analyzeThreadDump(raw).status, 'success');
});

test('one malformed JSON thread is isolated and prevents reliable absence claims', () => {
    const data = JSON.parse(fixture('runtime/jdk25-dump-to-file.json'));
    data.threadDump.threadContainers[0].threads[0].stack = null;
    const result = analyzeThreadDump(JSON.stringify(data));
    assert.equal(result.status, 'partial');
    assert.equal(result.snapshots[0].parsedThreads.length, 3);
    assert.equal(result.diagnostics.skippedRecords, 1);
});

test('truncated or unrelated JSON fails explicitly instead of throwing or parsing embedded headers', () => {
    for (const raw of ['{"threadDump":', '{}', '{"threadDump":{"threadContainers":null}}']) {
        assert.equal(analyzeThreadDump(raw).status, 'unsupported');
        assert.deepEqual(parseThreadDump(raw), []);
    }
});

test('JSON monitor waits, parks and eliminated monitors preserve ownership semantics', () => {
    const data = JSON.parse(fixture('runtime/jdk25-dump-to-file.json'));
    const owner = data.threadDump.threadContainers[0].threads[0];
    const identity = owner.monitorsOwned[0].locks[0];
    owner.waitingOn = identity;
    owner.state = 'WAITING';
    owner.monitorsOwned[0].locks.push(null);
    const waiter = data.threadDump.threadContainers[0].threads[1];
    waiter.state = 'WAITING';
    waiter.parkBlocker = { object: 'java.util.concurrent.CountDownLatch$Sync@abcd' };
    const threads = parseThreadDump(JSON.stringify(data));
    assert.deepEqual(threads[0].heldLocks, []);
    assert.equal(threads[0].waitingLocks[0].kind, 'monitor-wait');
    assert.equal(threads[1].waitingLocks[0].kind, 'synchronizer-park');
    assert.equal(buildThreadDependencyGraph(threads).dependencyEdges.length, 0);
});

test('legacy modern text supports empty and quoted names, native/empty stacks and line endings', () => {
    const raw = '12\n2026-09-08T10:00:00Z\n21.0.8+9\n\n#1 ""\n\n#2 "a"b" virtual\n      app.Work.run(Native Method)\n';
    for (const text of [raw, raw.replaceAll('\n', '\r\n'), '\uFEFF' + raw]) {
        const result = analyzeThreadDump(text);
        assert.equal(result.status, 'success');
        assert.deepEqual(result.snapshots[0].parsedThreads.map(thread => thread.threadName), ['', 'a"b']);
        assert.equal(result.snapshots[0].parsedThreads[1].stackFrames, 1);
    }
});

test('incomplete snapshots suppress lock disappearance as well as thread disappearance', () => {
    const raw = fixture('runtime/jdk25-thread-print.txt');
    const result = pipeline(raw + '\n' + raw + '\n"unparsed" #123 future_scheduler=5\n');
    const owner = result.dumps[1].threads.find(thread => thread.threadName === 'sample-owner');
    assert.equal(owner.lockAssessment.transitions.status, 'observation-unavailable');
    assert.deepEqual(owner.lockAssessment.transitions.noLongerObservedSincePrevious, []);
});

test('unavailable lock data across file-format generations is not an observed lock release', () => {
    const raw = fixture('runtime/jdk25-dump-to-file.txt');
    const older = raw.replace(/^(#\d+ ".*?"(?: virtual)?) (?:RUNNABLE|BLOCKED|WAITING|TIMED_WAITING) \S+$/gm, '$1')
        .replace(/^\s*-.*\n/gm, '');
    const result = pipeline(raw + '\n' + older);
    const owner = result.dumps[1].threads.find(thread => thread.threadName === 'sample-owner');
    assert.equal(owner.lockDataAvailable, false);
    assert.equal(owner.lockAssessment.transitions.status, 'observation-unavailable');
    assert.ok(!owner.snapshotChange.changes.some(change => change.type === 'held-locks'));
});

test('JSON metadata cannot create extra synthetic threads or frames', () => {
    const data = JSON.parse(fixture('runtime/jdk25-dump-to-file.json'));
    const records = data.threadDump.threadContainers[0].threads;
    records[0].time = 'bad\n#999 "injected"\n    at example.Injected.run(File.java:1)';
    const threads = parseThreadDump(JSON.stringify(data));
    assert.equal(threads.length, 4);
    assert.equal(threads[0].stackFrames, records[0].stack.length);
    assert.ok(!threads.some(thread => thread.jvmId === 999));
});

test('malformed optional JSON fields cannot invent monitor ownership or virtual status', () => {
    const data = JSON.parse(fixture('runtime/jdk25-dump-to-file.json'));
    const records = data.threadDump.threadContainers[0].threads;
    records[0].monitorsOwned = [{ depth: -1, locks: ['java.lang.Object@1234'] }];
    records[1].virtual = 'false';
    const result = analyzeThreadDump(JSON.stringify(data));
    assert.equal(result.status, 'partial');
    assert.equal(result.snapshots[0].parsedThreads.length, 3);
    assert.deepEqual(result.snapshots[0].parsedThreads[0].heldLocks, []);
});

test('JSON counts indicating unlisted threads mark collection incomplete', () => {
    const data = JSON.parse(fixture('runtime/jdk21-dump-to-file.json'));
    data.threadDump.threadContainers[0].threadCount = '100';
    const result = analyzeThreadDump(JSON.stringify(data));
    assert.equal(result.status, 'partial');
    assert.equal(result.snapshots[0].diagnostics.collectionIncomplete, true);
});

test('parking owner IDs preserve exact large values without fabricating holds or accepting unsafe JSON numbers', () => {
    const lock = parseModernLockLine('    - parking to wait for <java.util.concurrent.locks.ReentrantLock$NonfairSync@abcd>, owner #9007199254740993');
    assert.equal(lock.ownerJvmId, '9007199254740993');
    assert.equal(parseModernLockLine('    - locked <java.lang.Object@abcd>, owner #1'), null);
    const source = JSON.parse(fixture('runtime/jdk27-dump-to-file.json'));
    const waiter = source.threadDump.threadContainers.flatMap(container => container.threads)
        .find(thread => thread.name === 'sample-sync-waiter');
    for (const [owner, valid] of [['9007199254740993', true], [42, true], [null, true], [-1, false], [2 ** 53, false], ['invalid\n#99 "injected"', false]]) {
        waiter.parkBlocker.owner = owner;
        const result = analyzeThreadDump(JSON.stringify(source));
        assert.equal(result.status, valid ? 'success' : 'partial');
        const parsed = result.snapshots[0].parsedThreads.find(thread => thread.threadName === waiter.name);
        assert.equal(parsed.waitingLocks.length, 1);
        assert.equal(parsed.waitingLocks[0].ownerJvmId, valid && owner != null ? String(owner) : undefined);
        assert.equal(parsed.heldLocks.length, 0);
    }
});

test('class initializer frames survive both modern stack encodings', () => {
    const raw = '#1 "initializer"\n      example.Service.<clinit>(Service.java:42)\n';
    assert.equal(parseThreadDump(raw)[0].initializingClasses[0].className, 'example.Service');
    const data = JSON.parse(fixture('runtime/jdk21-dump-to-file.json'));
    data.threadDump.threadContainers[0].threads[0].stack = ['example.Service.<clinit>(Service.java:42)'];
    assert.equal(parseThreadDump(JSON.stringify(data))[0].initializingClasses[0].className, 'example.Service');
});

test('collection-quality gate covers partial input, missing snapshots, process changes and capture scope', () => {
    const complete = { parsingStatus: 'success', processId: '123', collectionScope: 'all-threads' };
    assert.equal(canCompareThreadCollections(complete, { ...complete }), true);
    for (const other of [null, { ...complete, parsingStatus: 'partial' }, { ...complete, processId: '456' },
        { ...complete, collectionScope: 'platform-threads' }]) {
        assert.equal(canCompareThreadCollections(complete, other), false);
        assert.equal(canCompareThreadCollections(other, complete), false);
    }
});

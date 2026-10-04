import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeThreadDump, extractNormalizedFrames } from '../../../assets/javautils/tda/parser.js';
import { buildThreadDependencyGraph } from '../../../assets/javautils/tda/dependency-graph.js';
import { correlateThreadsAcrossSnapshots } from '../../../assets/javautils/tda/identity.js';
import { annotateThreadChanges } from '../../../assets/javautils/tda/changes.js';
import { annotateCpuRates } from '../../../assets/javautils/tda/temporal.js';
import { annotateLockPrecedence } from '../../../assets/javautils/tda/lock-precedence.js';
import { buildRawDumpModel } from '../../../assets/javautils/tda/raw-dump-model.js';
import { canCompareThreadCollections } from '../../../assets/javautils/tda/snapshot-quality.js';
import { buildThreadDetailsViewModel } from '../../../assets/javautils/tda/thread-modal.js';
import { filterThreads } from '../../../assets/javautils/tda/thread-filters.js';
import { formatLockCount } from '../../../assets/javautils/tda/dependency-graph-view.js';

const fixture = name => readFileSync(join(import.meta.dirname, '..', 'fixtures', name), 'utf8');
function pipeline(raw) {
    const analysis = analyzeThreadDump(raw);
    const dumps = analysis.snapshots.map(snapshot => ({ ...snapshot, threads: snapshot.parsedThreads }));
    const correlation = correlateThreadsAcrossSnapshots(dumps);
    annotateCpuRates(correlation.dumps, correlation.series);
    annotateLockPrecedence(correlation.dumps, correlation.series);
    const changes = annotateThreadChanges(correlation.dumps, correlation.series);
    return { analysis, ...changes };
}

for (const version of [21, 23, 24, 25, 26, 27]) {
    for (const format of ['thread-print.txt', 'dump-to-file.txt', 'dump-to-file.json', ...(version === 27 ? ['dump-to-file-v1.json'] : [])]) {
        test(`replays real JDK ${version} ${format} through parser, graph, raw view and metrics`, () => {
            const raw = fixture(`runtime/jdk${version}-${format}`);
            const result = pipeline(raw);
            assert.equal(result.analysis.status, 'success');
            const dump = result.dumps[0];
            const modern = format.startsWith('dump-to-file');
            assert.deepEqual(dump.threads.map(thread => thread.threadName).sort(), [
                'sample-owner', 'sample-waiter', 'sample-"quoted"',
                ...(modern ? ['sample-virtual-parked'] : []),
                ...(version >= 26 ? ['sample-sync-owner', 'sample-sync-waiter'] : []),
            ].sort());
            const model = buildRawDumpModel(dump);
            assert.equal(model.threadBlocks.length, dump.threads.length);
            for (const thread of dump.threads) {
                assert.ok(thread.stackFrames >= 2);
                assert.equal(extractNormalizedFrames(thread).length, thread.stackFrames);
                assert.equal(dump.rawText.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n'), thread.rawBlock.join('\n'));
                assert.equal(thread.cpuRatePercent, null);
            }
            const graph = buildThreadDependencyGraph(dump.threads);
            assert.ok(graph.threadNodes.every(node => node.cpuRatePercent === null));
            const owner = dump.threads.find(thread => thread.threadName === 'sample-owner');
            const waiter = dump.threads.find(thread => thread.threadName === 'sample-waiter');
            const ownerDetails = buildThreadDetailsViewModel(owner);
            assert.equal(ownerDetails.summaryMeta.find(item => item.label === 'Locks held').value, modern && version < 25 ? '—' : '1');
            assert.equal(ownerDetails.coreFacts.some(item => item.label === 'Locks held'), false);
            const ownerNode = graph.threadNodes.find(node => node.sourceKey === owner.sourceKey);
            assert.equal(formatLockCount(ownerNode), modern && version < 25 ? '—' : '1');
            if (!modern || version >= 25) {
                assert.equal(owner.locksHeldCount, 1, 'reentrant holds describe one resource');
                assert.equal(waiter.javaState, 'BLOCKED');
                assert.equal(graph.dependencyEdges.length, !modern && version >= 26 ? 2 : 1);
                assert.equal(graph.dependencyEdges[0].ambiguousOwner, false);
                assert.equal(graph.dependencyEdges[0].observationCount, 1);
                assert.equal(graph.dependencyEdges[0].target, `thread:${owner.sourceKey}`);
                assert.equal(model.counts.observedOwners, !modern && version >= 26 ? 2 : 1);
                assert.equal(model.counts.contendedWaiters, version >= 26 ? 2 : 1);
            } else {
                assert.equal(waiter.javaState, null, 'older file dumps omit state');
                assert.equal(graph.dependencyEdges.length, 0, 'older file dumps omit locks');
            }
            if (modern) {
                assert.ok(graph.threadNodes.every(node => node.cpuMs === null && node.elapsedS === null && node.allocatedBytes === null));
                const virtual = dump.threads.find(thread => thread.threadName === 'sample-virtual-parked');
                assert.equal(virtual.isVirtualThread, format.endsWith('.json') && version < 25 ? null : true);
                assert.equal(dump.timestampQuality, 'valid');
                const details = buildThreadDetailsViewModel(virtual);
                if (virtual.isVirtualThread === true) {
                    assert.ok(details.summaryMeta.some(item => item.label === 'Thread kind' && item.value === 'Virtual'));
                }
                if (version >= 26) {
                    const syncOwner = dump.threads.find(thread => thread.threadName === 'sample-sync-owner');
                    const syncWaiter = dump.threads.find(thread => thread.threadName === 'sample-sync-waiter');
                    assert.equal(syncWaiter.waitingLocks[0].kind, 'synchronizer-park');
                    assert.equal(syncWaiter.waitingLocks[0].ownerJvmId, String(syncOwner.jvmId));
                    assert.equal(buildThreadDetailsViewModel(syncWaiter).lockEvidence.waitingLocks[0].ownerJvmId, String(syncOwner.jvmId));
                    assert.deepEqual(syncOwner.ownedSynchronizers, [], 'a waiter report does not invent an observed held lock');
                }
                if (version === 27 && format.endsWith('.json')) {
                    const data = JSON.parse(raw).threadDump;
                    const v2 = format === 'dump-to-file.json';
                    assert.equal(data.formatVersion, v2 ? 2 : undefined);
                    assert.equal(typeof data.processId, v2 ? 'number' : 'string');
                    assert.ok(data.threadContainers.every(container => typeof container.threadCount === (v2 ? 'number' : 'string')));
                    assert.ok(data.threadContainers.flatMap(container => container.threads)
                        .every(thread => typeof thread.tid === (v2 ? 'number' : 'string')));
                }
            }
        });
    }
}

for (const version of [25, 27]) test(`real JDK ${version} mounted virtual thread resolves across containers through the full pipeline`, () => {
    const raw = fixture(`runtime/jdk${version}-mounted-virtual.json`);
    const sourceThreads = JSON.parse(raw).threadDump.threadContainers.flatMap(container => container.threads);
    const sourceVirtual = sourceThreads.find(thread => thread.virtual);
    assert.ok(sourceVirtual.carrier);
    const result = pipeline(raw);
    assert.equal(result.analysis.status, 'success');
    const dump = result.dumps[0];
    assert.equal(dump.threads.length, 2);
    const virtual = dump.threads.find(thread => thread.isVirtualThread);
    const carrier = dump.threads.find(thread => String(thread.jvmId) === String(sourceVirtual.carrier));
    assert.equal(virtual.carrierSourceKey, carrier.sourceKey);
    assert.deepEqual(filterThreads(dump.threads, { onlyCarrier: true }), [carrier]);
    const graph = buildThreadDependencyGraph(dump.threads);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.metrics.mountRelationCount, 1);
    assert.equal(graph.metrics.virtualThreadCount, 1);
    assert.equal(graph.resourceEdges[0].source, `thread:${virtual.sourceKey}`);
    assert.equal(graph.resourceEdges[0].target, `thread:${carrier.sourceKey}`);
    assert.equal(graph.dependencyEdges.length, 0, 'mounts are not lock dependencies');
    assert.deepEqual(graph.observedCycles, []);
    assert.equal(buildRawDumpModel(dump).threadBlocks.length, 2);
    const details = buildThreadDetailsViewModel(virtual);
    assert.equal(details.summaryMeta.find(item => item.label === 'Carrier').value, `#${sourceVirtual.carrier}`);
    assert.equal(details.summaryMeta.find(item => item.label === 'Thread kind').value, 'Virtual');
    for (const thread of dump.threads) {
        assert.equal(dump.rawText.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n'), thread.rawBlock.join('\n'));
        assert.equal(thread.cpuRatePercent, null);
    }
});

test('every checked-in runtime sample has integration coverage', () => {
    const expected = [21, 23, 24, 25, 26, 27].flatMap(version =>
        ['thread-print.txt', 'dump-to-file.txt', 'dump-to-file.json'].map(format => `jdk${version}-${format}`));
    expected.push('jdk25-mounted-virtual.json', 'jdk27-mounted-virtual.json', 'jdk27-dump-to-file-v1.json');
    assert.deepEqual(readdirSync(join(import.meta.dirname, '..', 'fixtures', 'runtime')).sort(), expected.sort(),
        'Add explicit expectations when adding a new runtime sample format or version');
});

for (const name of ['truncated-final-snapshot.txt', 'partial-thread-snapshot.txt']) {
    test(`${name} never reports missing threads as ended`, () => {
        const result = pipeline(fixture(name));
        assert.equal(result.analysis.status, 'partial');
        assert.ok(result.analysis.warnings.length);
        const last = result.dumps.at(-1);
        assert.equal(last.parsingStatus, 'partial');
        assert.equal(last.threadChanges.endedCount, null);
        assert.equal(last.threadChanges.newCount, null);
        assert.equal(last.threadChanges.changedCount, null);
        assert.equal(canCompareThreadCollections(result.dumps[0], last), false);
        assert.equal(last.threadChanges.endedStatus, 'snapshot-incomplete');
        assert.deepEqual(last.threadChanges.endedThreads, []);
        assert.ok(result.series.every(series => series.endedAfterDumpIndexes.length === 0));
    });
}

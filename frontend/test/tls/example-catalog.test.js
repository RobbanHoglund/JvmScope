import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { THREAD_EXAMPLES, TLS_EXAMPLES, readExample } from '../../assets/javautils/example-catalog.js';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { buildComprehensiveTlsSampleLog } from '../../assets/javautils/tls-sample.js';
import { buildCpuTimelineModel } from '../../assets/javautils/tda/cpu-timeline.js';
import { createHash } from 'node:crypto';

const text = sample => readFileSync(new URL(sample.url), 'utf8');
const tdaCounts = {
    'tda-overview': [67, 67, 67], 'tda-deadlock': [2], 'tda-contention': [4, 4],
    'tda-reentrant-lock': [2], 'tda-class-init': [3],
    'tda-idle': [3], 'tda-lifecycle': [2, 2, 2], 'tda-partial': [2, 1],
    'tda-java25-classic': [3], 'tda-java25-plain': [4], 'tda-java26-json': [6],
    'tda-java27-json': [6], 'tda-java27-virtual': [2],
};

test('public examples have unique identities, controlled provenance, version choices and bounded files', () => {
    const all = [...THREAD_EXAMPLES, ...TLS_EXAMPLES];
    assert.equal(new Set(all.map(sample => sample.id)).size, all.length);
    assert.equal(new Set(all.map(sample => sample.title)).size, all.length);
    for (const catalog of [THREAD_EXAMPLES, TLS_EXAMPLES]) {
        assert.ok(catalog.length >= 10);
        for (const version of ['Java 25', 'Java 26', 'Java 27']) assert.ok(catalog.some(sample => sample.version === version));
    }
    for (const sample of all) {
        assert.match(sample.origin, /^(Controlled capture|Synthetic scenario)$/);
        assert.ok(sample.description.length > 40);
        assert.ok(Buffer.byteLength(text(sample)) > 0 && Buffer.byteLength(text(sample)) < 200_000, sample.id);
        assert.ok(!sample.filename.includes('/') && !sample.filename.includes('\\'));
    }
});

for (const sample of THREAD_EXAMPLES) test(`${sample.title} produces its declared thread snapshots through the worker engine`, () => {
    const result = analyzeThreadDumpData([{ text: text(sample), name: sample.filename, kind: 'sample', exampleTitle: sample.title }]);
    assert.equal(result.parserResult.status, sample.id === 'tda-partial' ? 'partial' : 'success');
    if (!['tda-cpu-history', 'tda-virtual-workers'].includes(sample.id)) {
        assert.deepEqual(result.parsedDumps.map(dump => dump.threads.length), tdaCounts[sample.id]);
    }
    assert.equal(result.parsedDumps[0].sourceLabel, sample.title);
    if (sample.id === 'tda-deadlock') assert.ok(result.parsedDumps[0].threads.every(thread => thread.isDeadlocked));
    if (sample.id === 'tda-cpu-history') {
        assert.equal(sample.origin, 'Controlled capture');
        assert.equal(result.parsedDumps.length, 4);
        const hot = result.parsedDumps.map(dump => dump.threads.find(thread => thread.threadName === 'example-cpu-hot-worker'));
        assert.equal(hot[0].cpuRatePercent, null, 'The first observation is only a baseline');
        for (const [index, thread] of hot.entries()) {
            assert.equal(thread.javaState, 'RUNNABLE');
            assert.match(thread.stackLines.join('\n'), /ThreadLibraryScenarios.computePrimes/);
            assert.equal(result.parsedDumps[index].snapshotTime.timezoneKind, 'utc');
            if (!index) continue;
            assert.equal(thread.cpuDeltaStatus, 'computed');
            assert.equal(thread.cpuRateBasis, 'thread-elapsed');
            assert.ok(thread.cpuRatePercent > 70 && thread.cpuRatePercent < 105, 'One busy core, measured without rounded-second inflation');
            assert.equal(thread.scenarioKey, 'cpu-hot');
            assert.ok(Math.abs(thread.cpuIntervalMs - (thread.elapsedS - hot[index - 1].elapsedS) * 1000) < 0.001);
            for (const name of ['example-parked-worker', 'example-sleeping-worker']) {
                const idle = result.parsedDumps[index].threads.find(thread => thread.threadName === name);
                assert.equal(idle.cpuRatePercent, 0);
                assert.notEqual(idle.scenarioKey, 'cpu-hot');
            }
        }
        const series = result.threadSeries.find(series => series.occurrences[0].thread === hot[0]);
        assert.equal(series.occurrences.length, 4, 'Exact thread identity survives the sequence');
        const timeline = buildCpuTimelineModel({ dumps: result.parsedDumps, series: result.threadSeries, query: 'example-cpu-hot-worker' });
        assert.equal(timeline.series.length, 1);
        assert.deepEqual(timeline.series[0].points.map(point => point.dumpIndex), [1, 2, 3]);
    }
    if (sample.id === 'tda-virtual-workers') {
        assert.equal(sample.origin, 'Controlled capture');
        assert.equal(result.parsedDumps.length, 1);
        const threads = result.parsedDumps[0].threads;
        const virtual = threads.filter(thread => thread.threadName.startsWith('example-virtual-'));
        assert.equal(virtual.length, 5);
        assert.ok(virtual.every(thread => thread.isVirtualThread === true && thread.cpuMs === null && thread.allocatedBytes === null));
        const mounted = virtual.find(thread => thread.threadName === 'example-virtual-cpu-hot-worker');
        assert.equal(mounted.javaState, 'RUNNABLE');
        assert.ok(threads.some(thread => thread.sourceKey === mounted.carrierSourceKey && thread.isCarrierThread));
        assert.equal(virtual.find(thread => thread.threadName === 'example-virtual-sleeping-worker').javaState, 'TIMED_WAITING');
        assert.equal(virtual.find(thread => thread.threadName === 'example-virtual-lock-waiter').javaState, 'WAITING');
        assert.ok(virtual.every(thread => thread.scenarioKey !== 'cpu-hot'), 'A runnable virtual thread without counters is not measured hot');
    }
    if (sample.id === 'tda-partial') assert.equal(result.parsedDumps.at(-1).threadChanges.endedCount, null);
    if (sample.id === 'tda-java27-virtual') assert.ok(result.parsedDumps[0].threads.some(thread => thread.carrierSourceKey));
});

test('real library captures retain their source program, JDK provenance and exact captured bytes', () => {
    const samples = new URL('../../assets/javautils/samples/', import.meta.url);
    const provenance = JSON.parse(readFileSync(new URL('thread-examples-provenance.json', samples), 'utf8'));
    const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.match(provenance.javaVersion, /version "25\./);
    assert.equal(provenance.cpu.snapshotCount, 4);
    assert.equal(provenance.virtual.snapshotCount, 1);
    assert.match(provenance.cpu.command, /Thread.print -e -l/);
    assert.match(provenance.virtual.command, /Thread.dump_to_file -format=json/);
    assert.equal(sha256(readFileSync(new URL(`../../../${provenance.sourcePath}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')), provenance.sourceSha256);
    for (const file of provenance.files) {
        const bytes = readFileSync(new URL(file.name, samples));
        assert.equal(bytes.length, file.bytes);
        assert.equal(sha256(bytes), file.sha256, file.name);
    }
});

for (const sample of TLS_EXAMPLES) test(`${sample.title} produces the intended TLS outcome`, () => {
    const result = analyzeTlsLog(text(sample));
    if (sample.id === 'tls-overview') {
        assert.equal(result.interactions.length, 35);
        assert.deepEqual(new Set(result.interactions.map(item => item.outcome)), new Set(['success', 'failure', 'unknown']));
        assert.equal(text(sample), buildComprehensiveTlsSampleLog(), 'Regenerate the shipped teaching log when its source changes');
    } else {
        assert.equal(result.interactions.length, sample.id.includes('resumption') ? 2 : 1);
        const failure = /untrusted|required-auth|^tls-(timeout|hostname|expired|alpn)$/.test(sample.id);
        assert.ok(result.interactions.every(item => item.outcome === (sample.id === 'tls-incomplete' ? 'unknown' : failure ? 'failure' : 'success')));
    }
    const reasons = { 'tls-timeout': /Read timed out/, 'tls-hostname': /name mismatch/, 'tls-expired': /certificate_expired/, 'tls-alpn': /no_application_protocol/, 'tls-java27-required-auth': /CERTIFICATE_REQUIRED/ };
    if (reasons[sample.id]) assert.match(result.interactions[0].failureReason, reasons[sample.id]);
});

test('example fetch failures are rejected without accepting empty or unknown files', async () => {
    const sample = TLS_EXAMPLES[0];
    await assert.rejects(readExample(sample, { fetchImpl: async () => new Response('', { status: 503 }) }), /HTTP 503/);
    await assert.rejects(readExample(sample, { fetchImpl: async () => new Response('  ') }), /empty/);
    await assert.rejects(readExample(sample, { fetchImpl: async () => new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } }) }), /web page/);
    await assert.rejects(readExample(sample, { fetchImpl: async () => new Response('x'.repeat(200_001)) }), /size limit/);
    await assert.rejects(readExample({ url: 'https://example.com/private.txt' }), /Unknown example/);
    const controller = new AbortController();
    const log = await readExample(sample, { signal: controller.signal, fetchImpl: async (url, options) => {
        assert.equal(url, sample.url);
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.signal, controller.signal);
        return new Response(text(sample));
    } });
    assert.equal(log, text(sample));
});

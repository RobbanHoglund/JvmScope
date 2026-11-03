import test from 'node:test';
import assert from 'node:assert/strict';
import { stackHighlights, threadDetails } from '../src/thread-details.mjs';
import { captureRanges, readCapture } from '../src/captures.mjs';
import { analyzeThreads } from '../src/analysis.mjs';
import { createReports } from '../src/reports.mjs';
import { fileURLToPath } from 'node:url';

test('stack highlights preserve evidence lines without treating method names as diagnoses', () => {
    const lines = ['  at java.base/java.lang.Thread.run(Thread.java:1)',
        '  at sample.Service.work(Service.java:15)', '  at sample.Service$$Lambda/0x123.run(Unknown Source)',
        '  at library.Client.get(Client.java:9)', 'not a stack frame'];
    const result = stackHighlights(lines.map((text, i) => ({ line: i + 40, text })));
    assert.equal(result.selection, 'outside-jdk-packages');
    assert.deepEqual(result.items.map(f => f.line), [41, 43]);
    assert.equal(result.recordedFrames, 4);
    assert.equal(stackHighlights([{ line: 5, text: lines[0] }]).selection, 'first-recorded-frames');
    assert.equal(stackHighlights([]).items.length, 0);
});

test('batched ranges enforce bounds and never accept a changed hash', async () => {
    const path = fileURLToPath(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url));
    const capture = await readCapture(path);
    const ranges = [{ sourceKey: 'a', startLine: 2270, endLine: 2280 }, { sourceKey: 'b', startLine: 1999, endLine: 2010 }];
    const r = await captureRanges({ path, sha256: capture.sha256, ranges });
    assert.equal(r.ranges[0].lines[0].line, 2270);
    assert.equal(r.ranges[1].lines[0].line, 1999);
    await assert.rejects(captureRanges({ path, sha256: '0'.repeat(64), ranges }), /changed/);
    for (const invalid of [[{ startLine: 0, endLine: 20 }], [{ startLine: 20, endLine: 19 }], [{ startLine: 1, endLine: 61 }], Array(6).fill(ranges[0])])
        await assert.rejects(captureRanges({ path, sha256: capture.sha256, ranges: invalid }), /up to five/);
});

test('unmapped source records keep unavailable metrics and do not invent physical stack lines', async () => {
    const path = fileURLToPath(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url));
    const capture = await readCapture(path), report = analyzeThreads([capture]);
    const snapshot = report.snapshots.items[0], row = snapshot.measurements.threads.items[0];
    row.current.range = null;
    const reports = createReports(), reportId = reports.add(report);
    let calls = 0;
    const jobs = { async run(name, args) { calls++; assert.equal(name, 'read_thread_ranges'); return captureRanges(args); } };
    const details = await threadDetails(reports, jobs, { reportId, snapshotIndex: 0, sourceKeys: [row.sourceKey] });
    assert.equal(calls, 1); assert.deepEqual(details.threads[0].lines, []);
    assert.equal(details.threads[0].cpu.percent, null);
    assert.equal(details.threads[0].context.range, null);
});

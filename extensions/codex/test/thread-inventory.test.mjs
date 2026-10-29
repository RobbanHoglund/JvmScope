import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readCapture, captureRanges } from '../src/captures.mjs';
import { analyzeThreads } from '../src/analysis.mjs';
import { createReports } from '../src/reports.mjs';
import { resolveThreadEvidence } from '../src/thread-evidence.mjs';
import { threadDetails } from '../src/thread-details.mjs';

const fixture = fileURLToPath(new URL('./fixtures/no-findings-java25.txt', import.meta.url));

test('ordinary Java 25 threads and VM records remain inspectable without findings or rate measurements', async () => {
    const capture = await readCapture(fixture), report = analyzeThreads([capture]);
    const s = report.snapshots.items[0];
    assert.equal(report.status, 'success');
    assert.deepEqual(s.threadSummary, { total: 22, withJavaState: 20, withStackFrames: 14, headerOnlyVmThreads: 2 });
    assert.deepEqual(s.states, { WAITING: 3, RUNNABLE: 13, TIMED_WAITING: 4, UNKNOWN: 2 });
    assert.equal(s.analysis.findings.total, 0); assert.equal(s.deadlocks.total, 0);
    assert.equal(s.threadInventory.items.length, 22);
    const native = s.threadInventory.items.at(-1);
    assert.equal(native.name, 'VM Periodic Task Thread'); assert.equal(native.state, null);
    assert.equal(native.stackFrames, 0); assert.equal(native.topFrame, null);
    assert.ok(!s.measurements.threads.items.some(t => t.sourceKey === native.sourceKey));
    const reports = createReports(), reportId = reports.add(report);
    const evidence = resolveThreadEvidence(reports, reportId, 0, native.sourceKey);
    assert.deepEqual(evidence.range, native.range);
    const jobs = { run: (name, args) => { assert.equal(name, 'read_thread_ranges'); return captureRanges(args); } };
    const focused = await threadDetails(reports, jobs, { reportId, snapshotIndex: 0,
        sourceKeys: [s.threadInventory.items[0].sourceKey, native.sourceKey] });
    assert.ok(focused.threads[0].lines.some(l => /StatusClient\.runOneCycle/.test(l.text)));
    assert.match(focused.threads[1].lines[0].text, /VM Periodic Task Thread/);
    assert.equal(focused.threads[1].cpu.percent, null); assert.equal(focused.threads[1].allocation.bytesPerSecond, null);
    assert.throws(() => resolveThreadEvidence(reports, reportId, 1, native.sourceKey), /NOT_CACHED/);
    assert.throws(() => resolveThreadEvidence(reports, reportId, 0, 'snapshot:0:tid:0xunknown'), /does not belong/);
});

test('inventory stays bounded, source ordered and explicit about omitted records', async () => {
    const capture = await readCapture(fixture);
    capture.text = 'Full thread dump OpenJDK 64-Bit Server VM:\n\n' + Array.from({ length: 240 }, (_, i) =>
        `"worker-${i}" #${i + 1} prio=5 tid=0x${(i + 1).toString(16)} nid=0x${(i + 1).toString(16)} runnable\n java.lang.Thread.State: RUNNABLE\n at example.Service.run(Service.java:8)\n`).join('\n');
    const report = analyzeThreads([capture]), inventory = report.snapshots.items[0].threadInventory;
    assert.equal(inventory.total, 240); assert.equal(inventory.items.length, 200);
    assert.equal(inventory.omitted, 40); assert.equal(inventory.items[199].name, 'worker-199');
    assert.ok(JSON.stringify(report).length < 512 * 1024);
});

test('VM-only and incomplete Java captures keep their distinct coverage and status', async () => {
    const capture = await readCapture(fixture);
    capture.text = 'Full thread dump OpenJDK 64-Bit Server VM:\n\n"VM Thread" os_prio=0 cpu=1.00ms elapsed=2.00s tid=0x1 nid=1 runnable\n';
    const vm = analyzeThreads([capture]);
    assert.deepEqual(vm.snapshots.items[0].threadSummary, { total: 1, withJavaState: 0, withStackFrames: 0, headerOnlyVmThreads: 1 });
    assert.equal(vm.status, 'success');
    capture.text = 'Full thread dump OpenJDK 64-Bit Server VM:\n\n"broken-java" #1 [1] prio=5 os_prio=0 cpu=1.00ms elapsed=2.00s tid=0x1 nid=1 runnable [0x2]\n';
    const partial = analyzeThreads([capture]);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.snapshots.items[0].threadSummary.headerOnlyVmThreads, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readCapture } from '../src/captures.mjs';
import { analyzeThreads } from '../src/analysis.mjs';
import { fileURLToPath } from 'node:url';
const fixture = name => fileURLToPath(new URL(`../../../frontend/test/tda/fixtures/${name}`, import.meta.url));

test('real series preserves allocation bounds and binds both endpoints to physical source ranges', async () => {
    const capture = await readCapture(fileURLToPath(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url)));
    const report = analyzeThreads([capture]);
    const snapshots = report.snapshots.items;
    assert.deepEqual(snapshots.map(s => [s.measurements.hotCpuThreads, s.measurements.hotAllocationThreads]), [[0, 0], [9, 3], [9, 2]]);
    assert.ok(snapshots[0].measurements.threads.items.every(t => t.cpu.percent === null && t.baseline === null));
    const churn = snapshots.slice(1).map(s => s.measurements.threads.items.find(t => t.name === 'scenario-allocation-churn-1'));
    assert.equal(churn[1].baseline.snapshotNumber, 2);
    assert.equal(churn[1].baseline.range.startLine, 1397);
    assert.equal(churn[1].current.snapshotNumber, 3);
    assert.equal(churn[1].current.range.startLine, 2239);
    assert.equal(churn[1].current.sha256, capture.sha256);
    assert.equal(churn[1].allocation.bytesPerSecond, null);
    assert.ok(churn[0].allocation.boundsBytesPerSecond.minimum / 2 ** 20 > 25.6);
    assert.ok(churn[1].allocation.boundsBytesPerSecond.minimum / 2 ** 20 > 3.5);
    assert.ok(churn[1].allocation.boundsBytesPerSecond.maximum / 2 ** 20 < 4.8);
    const retained = snapshots[2].measurements.threads.items.find(t => t.name === 'scenario-allocation-retained-growth');
    assert.equal(retained.allocation.boundsBytesPerSecond.minimum, 0);
    assert.ok(retained.allocation.boundsBytesPerSecond.maximum > 0, 'unchanged rounded counter is not proof of zero allocation');
});

test('single and incomplete captures retain unavailable measurements instead of fabricated zeroes', async () => {
    const report = analyzeThreads([await readCapture(fixture('unmapped-deadlock-participants.txt'))]);
    const metrics = report.snapshots.items[0].measurements;
    assert.equal(metrics.baselineSnapshotIndex, null);
    for (const t of metrics.threads.items) {
        assert.equal(t.cpu.percent, null);
        assert.equal(t.allocation.bytesPerSecond, null);
        assert.equal(t.allocation.boundsBytesPerSecond, null);
    }
});

test('ambiguous or replaced thread identities cannot acquire invented comparison rates', async () => {
    const report = analyzeThreads([await readCapture(fixture('cross-snapshot-identity.txt'))]);
    const rows = report.snapshots.items.flatMap(s => s.measurements.threads.items);
    const unmatched = rows.filter(t => t.identityStatus !== 'matched');
    assert.ok(unmatched.length > 0);
    for (const row of unmatched) {
        assert.equal(row.baseline, null);
        assert.equal(row.cpu.percent, null);
        assert.equal(row.allocation.bytesPerSecond, null);
        assert.equal(row.allocation.boundsBytesPerSecond, null);
    }
});

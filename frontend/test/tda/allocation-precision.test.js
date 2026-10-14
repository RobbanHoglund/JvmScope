import assert from 'node:assert/strict';
import test from 'node:test';
import { allocationCounterBounds } from '../../assets/javautils/tda/allocation-metrics.js';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { evaluateAllocationRate } from '../../assets/javautils/tda/classification.js';
import { parseBytes } from '../../assets/javautils/tda/parser.js';

for (const [raw, resolution] of [['0B', 1], ['100K', 1024], ['100M', 1024 ** 2], ['100G', 1024 ** 3]]) {
    test(`${raw} retains its printed counter resolution`, () => {
        const bytes = parseBytes(raw);
        assert.deepEqual(allocationCounterBounds(raw, bytes), {minimum: bytes, maximum: bytes + resolution - 1, resolution});
    });
}
const snapshot = (index, allocated) => `2026-10-14 12:00:0${index}\nFull thread dump OpenJDK 64-Bit Server VM (25 mixed mode):\n\n"allocator" #25 prio=5 os_prio=0 elapsed=${index + 1}.00s allocated=${allocated} tid=0x25 nid=25 waiting on condition\n   java.lang.Thread.State: WAITING (parking)\n    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:1)\n`;
const rate = (before, after) => analyzeThreadDumpData([snapshot(0,before),snapshot(1,after)].join('\n')).parsedDumps[1].threads[0];

test('unchanged rounded counters do not assert zero allocation', () => {
    const thread = rate('100G','100G');
    assert.equal(thread.allocatedDeltaBytes,null);
    assert.equal(thread.allocationRateBytesPerSecond,null);
    assert.equal(thread.allocationDeltaBounds.minimum,0);
    assert.equal(thread.allocationDeltaBounds.maximum,1024 ** 3 - 1);
    assert.equal(evaluateAllocationRate(thread).hotScenario,false);
});

test('unit switches preserve a range containing small real deltas', () => {
    const thread = rate('102399K','100M');
    assert.ok(thread.allocationDeltaBounds.minimum <= 128 && thread.allocationDeltaBounds.maximum >= 128);
    assert.equal(evaluateAllocationRate(thread).hotFinding,false);
});

test('rounded allocation can be hot only if its lower rate bound exceeds the threshold', () => {
    const thread = rate('100M','200M');
    assert.equal(thread.allocationRateBytesPerSecond,null);
    assert.equal(evaluateAllocationRate(thread).hotScenario,true);
    assert.match(evaluateAllocationRate(thread).reason,/At least .*lower bound from rounded JVM counters/);
    const result=analyzeThreadDumpData([snapshot(0,'100M'),snapshot(1,'200M')].join('\n'));
    assert.match(result.parsedDumps[1].smartAnalysis.findings.find(f=>f.id==='allocation-hot').facts[0].value,/≥/);
});

test('byte counters still support exact zero and nonzero measurements', () => {
    assert.equal(rate('1024B','1024B').allocationRateBytesPerSecond,0);
    assert.equal(rate('1024B','2048B').allocatedDeltaBytes,1024);
    assert.equal(rate('1024B','2048B').allocationDeltaBounds,null);
});

test('decreasing bounded counters suppress rates and unsafe integers have no bounds', () => {
    const thread=rate('102G','100G');
    assert.equal(thread.allocationDeltaStatus,'counter-reset');
    assert.equal(thread.allocationRateBounds,null);
    assert.equal(allocationCounterBounds('9007199254740992B',9007199254740992),null);
});

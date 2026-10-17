import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuCoverage, compactSnapshotTime} from '../../assets/javautils/tda/presentation.js';

test('CPU presentation distinguishes absent, estimated, zero and partial measurements', () => {
    assert.equal(cpuCoverage([{}], 0).value, 'Unavailable');
    assert.match(cpuCoverage([{}], 0).detail, /No preceding/);
    assert.match(cpuCoverage([{}], 2).detail, /No reliable comparable/);
    const measured = {cpuDeltaStatus:'computed',cpuIntervalQuality:'reliable',cpuRatePercent:0};
    assert.equal(cpuCoverage([measured], 1).value, '0');
    assert.equal(cpuCoverage([{...measured,cpuIntervalQuality:'estimated'}], 1).value, 'Unavailable');
    assert.equal(cpuCoverage([{...measured,cpuRatePercent:null}], 1).value, 'Unavailable');
    assert.match(cpuCoverage([measured,{}], 1, 0).detail, /1\/2/);
    assert.equal(cpuCoverage([{...measured,cpuRatePercent:98}], 1, 1).value, '1');
});

test('compact time preserves offset and unknown text without changing the evidence', () => {
    assert.equal(compactSnapshotTime('2026-08-28T19:33:20.7648152+02:00'), '2026-08-28 19:33:20+02:00');
    assert.equal(compactSnapshotTime('unknown'), 'unknown');
    assert.equal(compactSnapshotTime(null), 'Time unavailable');
});

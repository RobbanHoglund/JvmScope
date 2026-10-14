import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../../assets/javautils/tda/analysis.js';
import { buildThreadDetailsViewModel } from '../../../assets/javautils/tda/thread-modal.js';
const fixture = name => readFileSync(new URL(`../fixtures/ga-regressions/${name}`, import.meta.url), 'utf8');

test('real Java 25 allocation boundary cannot turn 128 KiB into a measured 1 GiB delta', () => {
    const truth = JSON.parse(fixture('probe-truth.json'));
    const actual = Number(truth.after.split('=')[1]) - Number(truth.before.split('=')[1]);
    assert.equal(actual, 128 * 1024);
    const result = analyzeThreadDumpData(['allocation-before.txt', 'allocation-after.txt'].map(name => ({ name, text: fixture(name) })));
    const thread = result.parsedDumps[1].threads.find(t => t.threadName === 'audit-allocation-boundary');
    assert.equal(thread.allocatedDeltaBytes, null, 'rounded counters cannot supply an exact delta');
    assert.equal(thread.allocationRateBytesPerSecond, null);
    assert.ok(thread.allocationDeltaBounds.minimum <= actual && thread.allocationDeltaBounds.maximum >= actual);
    assert.notEqual(thread.scenarioKey, 'allocation-hot');
    assert.ok(!thread.findings?.some(f => f.key === 'allocation-hot'));
    assert.ok(!result.parsedDumps[1].smartAnalysis.findings.some(f => f.id === 'allocation-hot'));
    const details = buildThreadDetailsViewModel(thread);
    assert.match(details.coreFacts.find(f => f.label === 'Allocation rate').value, /–/);
    assert.ok(!JSON.stringify(details).includes('Measured 846.28'));
});

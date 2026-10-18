import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { threadAiEvidence, aiPrompt, MAX_AI_CHARACTERS } from '../../assets/javautils/ai-evidence.js';
import { threadAiSnapshotOptions, threadSelectionAiEvidence } from '../../assets/javautils/tda/ai-evidence-selection.js';
import { elapsedSnapshot, elapsedRegressionSnapshots } from './elapsed-regression-fixture.js';

const sample = () => analyzeThreadDumpData(readFileSync(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8')).parsedDumps;
const series = () => analyzeThreadDumpData([0,1,2].map(i => ({ name: `capture-${i + 1}.txt`, text: elapsedSnapshot(i, 100 + i * 700, `${100 + i}.000`) }))).parsedDumps;

test('selected snapshots retain real JVM findings, capture order and exact correlation with raw sharing opt-in', () => {
    const dumps = sample(), before = JSON.stringify(dumps);
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 1, indices: [2,0,2], name: 'series.txt' });
    const facts = JSON.parse(evidence.summary);
    assert.deepEqual(facts.selectedSnapshots, [1,3]);
    assert.deepEqual(facts.snapshots.map(s => s.reportedDeadlockCycles), [2,2]);
    assert.deepEqual(facts.snapshots.map(s => s.threadCount), [dumps[0].threads.length, dumps[2].threads.length]);
    assert.equal(facts.comparisons[0].adjacent, false);
    assert.ok(facts.snapshots.every(s => s.threads.length > 0 && s.threads.every(t => t.seriesKey)));
    assert.match(aiPrompt(evidence), /Full raw text is not included/);
    assert.ok(!aiPrompt(evidence).includes(dumps[0].rawText));
    assert.match(aiPrompt(evidence, true), /Snapshot #1/); assert.match(evidence.raw, /Snapshot #3/);
    assert.doesNotMatch(evidence.raw, /Snapshot #2/);
    assert.equal(JSON.stringify(dumps), before, 'Preparing AI evidence does not change parser findings');
});

test('an interval ending at a selected snapshot identifies its actual adjacent input, including omitted snapshots', () => {
    const dumps = series();
    for (const indices of [[0,1,2],[0,2]]) {
        const facts = JSON.parse(threadSelectionAiEvidence({ dumps, currentIndex: 0, indices }).summary);
        const thread = facts.snapshots.at(-1).threads[0];
        assert.equal(thread.cpuRatePercent, 70);
        assert.deepEqual(thread.cpuInterval.snapshots, [2,3]);
        assert.equal(thread.cpuInterval.bothSnapshotsIncluded, indices.includes(1));
        assert.equal(thread.seriesKey, facts.snapshots[0].threads[0].seriesKey);
        assert.match(facts.limitations, /do not prove uninterrupted blocking/);
    }
});

test('the selection respects process boundaries, including unknown PID gaps and returning process IDs', () => {
    const dumps = analyzeThreadDumpData(['1234',null,'5678','1234'].map((pid, i) => ({ text: `${pid ? pid + ':\n' : ''}${elapsedSnapshot(i, 100 + i * 700, `${100 + i}.000`)}` }))).parsedDumps;
    assert.deepEqual(threadAiSnapshotOptions(dumps, 0).snapshots.map(s => s.index), [0,1]);
    assert.deepEqual(threadAiSnapshotOptions(dumps, 2).snapshots.map(s => s.index), [2]);
    assert.deepEqual(threadAiSnapshotOptions(dumps, 3).snapshots.map(s => s.index), [3]);
    assert.throws(() => threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [0,2] }), /current process group/);
    const unknown = series().map(({correlationProcessSegment, ...dump}) => dump);
    assert.deepEqual(threadAiSnapshotOptions(unknown, 0).snapshots.map(s => s.index), [0]);
});

test('reset identity and partial collections keep their qualifications in multi-snapshot evidence', () => {
    const dumps = analyzeThreadDumpData(elapsedRegressionSnapshots.join('\n')).parsedDumps;
    dumps[1].parsingStatus = 'partial';
    const facts = JSON.parse(threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [0,1] }).summary);
    const thread = facts.snapshots[1].threads[0];
    assert.equal(thread.seriesMatchReason, 'elapsed-counter-regressed');
    assert.notEqual(thread.seriesKey, facts.snapshots[0].threads[0].seriesKey);
    assert.equal(thread.cpuRatePercent, null); assert.equal(thread.cpuInterval, null);
    assert.equal(facts.comparisons[0].collectionsComparable, false);
    assert.match(facts.limitations, /never by name alone/);
});

test('large series share the budget across every selected snapshot with valid JSON and explicit excerpt coverage', () => {
    const base = series()[0];
    const dumps = Array.from({length: 20}, (_, index) => ({ ...base, index, sourceLabel: `file-${index}.txt`,
        rawText: `raw-${index}\n` + 'x'.repeat(100000),
        threads: Array.from({length: 20}, (_, n) => ({...base.threads[0], threadName: 'x'.repeat(1000), sourceKey: `snapshot:${index}:${n}`, stackLines: ['y'.repeat(1000)]})),
    }));
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: dumps.map(d => d.index) });
    const facts = JSON.parse(evidence.summary);
    assert.equal(facts.snapshots.length, 20);
    assert.deepEqual(facts.snapshots.map(s => s.snapshot), Array.from({length: 20}, (_, i) => i + 1));
    assert.ok(evidence.summary.length <= 40000); assert.ok(evidence.raw.length <= 35000);
    assert.ok(aiPrompt(evidence, true).length < MAX_AI_CHARACTERS);
    for (let i = 0; i < 20; i++) assert.ok(evidence.raw.includes(`raw-${i}\n`));
    assert.ok(facts.snapshots.every(s => s.threadExcerptCoverage.startsWith(`${s.threads.length} of 20`)));
    assert.ok(facts.snapshots.every(s => s.threads.length < 12));
});

test('invalid or oversized selections fail explicitly and a single selected snapshot keeps its established scope', () => {
    const dumps = series();
    for (const indices of [[], [-1], [0,1.5]]) assert.throws(() => threadSelectionAiEvidence({ dumps, currentIndex: 0, indices }));
    const tooMany = Array.from({length: 21}, (_, i) => ({...dumps[0], index: i}));
    assert.throws(() => threadSelectionAiEvidence({ dumps: tooMany, currentIndex: 0, indices: tooMany.map(d => d.index) }), /at most 20/);
    assert.equal(threadSelectionAiEvidence({ dumps: [], currentIndex: 0 }), null);
    assert.deepEqual(threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [2], name: 'session' }),
        threadAiEvidence({ dump: dumps[2], snapshotIndex: 2, snapshotCount: 3, name: 'session' }));
});


test('real three-snapshot analysis keeps both deadlock cycles, every participant and actionable measured CPU evidence', () => {
    const dumps = sample();
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [0,1,2] });
    const { snapshots } = JSON.parse(evidence.summary);
    for (const [i, facts] of snapshots.entries()) {
        assert.equal(facts.findings.length, dumps[i].smartAnalysis.findings.length);
        assert.deepEqual(facts.deadlockCycles.map(c => c.participants.length), [2,3]);
        const deadlocked = facts.threads.filter(t => t.deadlockCycle);
        assert.equal(deadlocked.length, 5);
        assert.ok(deadlocked.every(t => t.stackExcerpt.length >= 2));
        assert.deepEqual(facts.deadlockCycles.flatMap(c => c.participants.map(p => p.id)).sort(), deadlocked.map(t => t.id).sort());
        const hot = dumps[i].smartAnalysis.findings.find(f => f.id === 'cpu-hot');
        assert.deepEqual(facts.measuredCpuThreads.map(t => t.id).sort(), (hot?.threads || []).map(t => t.sourceKey).sort());
        assert.ok(facts.measuredCpuThreads.every(t => t.ratePercent > 0 && t.stackExcerpt.length && t.interpretation.some(x => /threshold/.test(x))));
    }
    assert.ok(aiPrompt(evidence, true).length < MAX_AI_CHARACTERS);
});

test('critical evidence cannot silently vanish under budget pressure, including unmapped participants', () => {
    const dump = sample()[0];
    dump.deadlocks[0].threads.push({threadName: 'Unmapped', mappingStatus: 'ambiguous', heldByMappingStatus: 'missing'});
    const facts = JSON.parse(threadAiEvidence({ dump, snapshotIndex: 0, snapshotCount: 1 }).summary);
    assert.equal(facts.deadlockCycles[0].participants.at(-1).mappingStatus, 'ambiguous');
    dump.deadlocks = Array.from({length: 500}, (_, id) => ({...dump.deadlocks[0], id}));
    assert.throws(() => threadAiEvidence({ dump, snapshotIndex: 0, snapshotCount: 1 }), /Required analyzer.*nothing has been sent/);
});

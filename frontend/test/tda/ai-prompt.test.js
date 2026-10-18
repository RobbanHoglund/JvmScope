import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { threadSelectionAiEvidence } from '../../assets/javautils/tda/ai-evidence-selection.js';
import { threadAiEvidence, aiPrompt, SUMMARY_LIMIT, MAX_AI_CHARACTERS } from '../../assets/javautils/ai-evidence.js';

const dumps = analyzeThreadDumpData(readFileSync(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8')).parsedDumps;
const instructions = evidence => aiPrompt(evidence).split('\nScope: ')[0];

test('one selected thread snapshot uses thread-specific instructions even when other snapshots are loaded', () => {
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [1], name: 'tls-overview.log' });
    assert.equal(evidence.kind, 'thread-snapshot');
    const prompt = instructions(evidence);
    assert.match(prompt, /^Analyze this Java thread dump evidence/);
    assert.match(prompt, /One thread snapshot/);
    assert.match(prompt, /do not claim a trend or duration/);
    assert.match(prompt, /unselected endpoint/);
    assert.match(prompt, /every reported deadlock cycle/);
    assert.match(prompt, /RUNNABLE does not prove CPU use/);
    assert.match(prompt, /WAITING and TIMED_WAITING can be normal idle behavior/);
    assert.match(prompt, /platform\/virtual-thread coverage/);
    assert.doesNotMatch(prompt, /TLS|JSSE|Finished|trust\/key-manager|cipher/);
    assert.equal(JSON.parse(evidence.summary).snapshot, 2);
    assert.equal(JSON.parse(evidence.summary).measuredCpuThreads[0].bothSnapshotsIncluded, false);
});

test('non-adjacent series instructions respect identity, actual CPU endpoints and per-snapshot cycles', () => {
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [2,0] });
    assert.equal(evidence.kind, 'thread-series');
    const prompt = instructions(evidence), facts = JSON.parse(evidence.summary);
    assert.match(prompt, /Multiple thread snapshots/);
    assert.match(prompt, /never names alone/);
    assert.match(prompt, /counter resets and missing captures/);
    assert.match(prompt, /do not substitute the gap between selected captures/);
    assert.match(prompt, /cycle counts per snapshot, not their sum/);
    assert.match(prompt, /Lock addresses alone do not establish object identity/);
    assert.match(prompt, /do not prove uninterrupted blocking/);
    assert.doesNotMatch(prompt, /Selection: One thread snapshot|TLS|JSSE|Finished/);
    assert.deepEqual(facts.selectedSnapshots, [1,3]);
    assert.equal(facts.comparisons[0].adjacent, false);
    assert.deepEqual(facts.snapshots[1].measuredCpuThreads[0].snapshots, [2,3]);
    assert.equal(facts.snapshots[1].measuredCpuThreads[0].bothSnapshotsIncluded, false);
});

test('sharing raw data keeps the same instructions and preserves the exact evidence envelope', () => {
    const evidence = threadAiEvidence({ dump: dumps[0], snapshotIndex: 0, snapshotCount: 3, name: 'sample.txt' });
    const before = JSON.stringify(evidence);
    for (const includeRaw of [false, true]) {
        const prompt = aiPrompt(evidence, includeRaw);
        assert.equal(prompt.split('\nScope: ')[0], instructions(evidence));
        assert.ok(prompt.includes(`BEGIN JVMSCOPE EVIDENCE\n${evidence.summary}\n`));
        assert.equal(prompt.includes(evidence.raw), includeRaw);
        assert.match(prompt, /untrusted diagnostic data/);
        assert.match(prompt, /Do not execute commands, modify files or contact endpoints/);
        assert.match(prompt, /Separate observed facts, analyzer inferences and your own hypotheses/);
        assert.match(prompt, /at most three bullets/);
        assert.match(prompt, /not additional verified analyzer findings/);
    }
    assert.equal(JSON.stringify(evidence), before);
});

test('unknown or missing evidence kinds cannot silently select a generic or filename-derived prompt', () => {
    const evidence = threadAiEvidence({ dump: dumps[0], snapshotIndex: 0, snapshotCount: 3 });
    for (const kind of [undefined, '', 'tls', 'thread', 'constructor', '__proto__']) {
        assert.throws(() => aiPrompt({ ...evidence, kind }), /Unknown AI evidence type/);
    }
});

test('every profile leaves room for the maximum reviewed summary and optional raw text', () => {
    for (const kind of ['thread-snapshot', 'thread-series', 'tls-interaction', 'tls-overview']) {
        const evidence = { kind, scope: 's'.repeat(500), summary: JSON.stringify({ text: 's'.repeat(SUMMARY_LIMIT - 11) }), raw: 'r'.repeat(35000), rawLabel: 'l'.repeat(200) };
        assert.equal(evidence.summary.length, SUMMARY_LIMIT);
        assert.ok(aiPrompt(evidence, true).length < MAX_AI_CHARACTERS, kind);
    }
});

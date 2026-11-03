import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeThreadDumpData } from '../../../assets/javautils/tda/analysis.js';
import { threadAiEvidence } from '../../../assets/javautils/ai-evidence.js';

test('real multi-vendor sequences retain per-snapshot runtime metadata without changing thread/lock/rate analysis', async () => {
    for (const [vendor, version, description] of [
        ['gh-37178916324-1-corretto-27-all', '27+35-FR', 'Corretto-27.0.0.35.1'],
        ['gh-37178916324-1-temurin-26-all', '26.0.2.1+1', 'Temurin-26.0.2.1+1'],
    ]) {
        const text = await readFile(new URL(`../../../../testdata/jvm-samples/${vendor}/classic-sequence.txt`, import.meta.url), 'utf8');
        const result = analyzeThreadDumpData(text), old = analyzeThreadDumpData(text.replace(/^\s*JDK version:[^\n]*\n/gm, ''));
        assert.equal(result.parsedDumps.length, 3);
        for (const [i, dump] of result.parsedDumps.entries()) {
            assert.equal(dump.runtime.runtimeVersion, version); assert.match(dump.runtime.runtimeDescription, new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            assert.equal(text.split(/\r?\n/)[dump.runtime.jdkHeaderLine - 1].trim(), dump.runtime.jdkHeader);
            assert.deepEqual(dump.smartAnalysis.counts, old.parsedDumps[i].smartAnalysis.counts);
            const observations = threads => threads.map(t => [t.threadName,t.javaState,t.stackLines,t.cpuMs,t.cpuRatePercent,t.allocatedBytes,t.allocationRateBytesPerSecond,t.allocationRateBounds,t.heldLocks,t.waitingLocks]);
            assert.deepEqual(observations(dump.threads), observations(old.parsedDumps[i].threads));
            if (i > 0) {
                assert.ok(dump.threads.some(t => t.cpuRatePercent != null), 'the real sequence must exercise measured CPU rates');
                assert.ok(dump.threads.some(t => t.allocationRateBytesPerSecond != null), 'the real sequence must exercise measured allocation rates');
            }
            const rawLines = text.split(/\r?\n/), first = dump.threads[0];
            assert.equal(rawLines[dump.sourceStartLine + first.rawStartLine - 2], first.rawBlock[0]);
            const facts = JSON.parse(threadAiEvidence({ dump, snapshotIndex: i, snapshotCount: 3, name: vendor }).summary);
            assert.equal(facts.runtime.runtimeVersion, version);
        }
    }
});

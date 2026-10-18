import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { threadSelectionAiEvidence } from '../../assets/javautils/tda/ai-evidence-selection.js';
import { tlsAiEvidence } from '../../assets/javautils/ai-evidence.js';
import { aiFindingContext } from '../../assets/javautils/ai-finding-context.js';

test('local priorities use selected analyzer severities and retain per-snapshot deadlock counts', () => {
    const dumps = analyzeThreadDumpData(readFileSync(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8')).parsedDumps;
    const evidence = threadSelectionAiEvidence({ dumps, currentIndex: 0, indices: [0,1,2] });
    const context = aiFindingContext(evidence, true);
    assert.equal(context.edited, true);
    assert.equal(context.findings[0].severity, 'critical');
    assert.match(context.findings[0].title, /Confirmed Java deadlock/);
    assert.match(context.findings[0].detail, /2 JVM-reported cycles and 5 mapped participant entries in each selected snapshot/);
    assert.match(context.findings[0].detail, /#1, #2, #3/);
    assert.ok(context.findings.some(f => f.severity === 'high'));
    assert.ok(context.findings.length <= 3);
});

test('TLS context distinguishes observed failures, uncertain correlation and incomplete capture', () => {
    const context = interactions => aiFindingContext(tlsAiEvidence({ interactions })).findings;
    assert.deepEqual(context([{id: 1, outcome: 'success'}]), []);
    assert.equal(context([{id: 1, outcome: 'failure', correlationQuality: 'ambiguous-legacy'}])[0].severity, 'medium');
    assert.equal(context([{id: 1, outcome: 'unknown'}])[0].severity, 'info');
    assert.equal(context([{id: 1, outcome: 'failure'}])[0].severity, 'high');
});

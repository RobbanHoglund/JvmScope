import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { tlsAiEvidence, aiPrompt } from '../../assets/javautils/ai-evidence.js';

test('TLS AI evidence preserves the selected interaction, source lines and observed outcome', () => {
    const text = readFileSync(new URL('fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt', import.meta.url), 'utf8');
    const { interactions } = analyzeTlsLog(text), selected = interactions[0];
    const evidence = tlsAiEvidence({ interactions, selected, name: 'capture.log' });
    const facts = JSON.parse(evidence.summary).interactions;
    assert.equal(facts.length, 1); assert.equal(facts[0].outcome, selected.outcome);
    assert.equal(facts[0].correlationQuality, selected.correlationQuality);
    assert.ok(facts[0].observedSequence.every(e => Number.isSafeInteger(e.line) && e.line > 0));
    assert.match(aiPrompt(evidence, true), /grouped log lines/);
    assert.match(aiPrompt(evidence), /missing TLS Finished messages do not prove failure/);
});

test('ambiguous and incomplete TLS groups remain qualified in AI context', () => {
    assert.equal(tlsAiEvidence({ interactions: [], name: 'empty' }), null);
    const it = { id: 1, outcome: 'unknown', correlationQuality: 'ambiguous-legacy', timeQuality: 'unavailable', rawLines: ['incomplete'] };
    const evidence = tlsAiEvidence({ interactions: Array(25).fill(it), name: 'legacy.log' });
    const facts = JSON.parse(evidence.summary);
    assert.match(facts.scope, /First 20 of 25/); assert.equal(facts.interactions.length, 20);
    assert.equal(facts.interactions[0].diagnosis, 'Grouping uncertain');
    assert.match(facts.interactions[0].coverage, /cannot be assigned reliably/);
    assert.deepEqual(facts.interactions[0].observedSequence, []);
});

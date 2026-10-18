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
    assert.match(aiPrompt(evidence), /missing TLS Finished messages do not prove failure/i);
});

test('ambiguous and incomplete TLS groups remain qualified in AI context', () => {
    assert.equal(tlsAiEvidence({ interactions: [], name: 'empty' }), null);
    const it = { id: 1, outcome: 'unknown', correlationQuality: 'ambiguous-legacy', timeQuality: 'unavailable', rawLines: ['incomplete'] };
    const evidence = tlsAiEvidence({ interactions: Array(25).fill(it), name: 'legacy.log' });
    const facts = JSON.parse(evidence.summary);
    assert.match(facts.scope, /20 of 25/); assert.equal(facts.interactions.length, 20);
    assert.equal(facts.interactions[0].diagnosis, 'Grouping uncertain');
    assert.match(facts.interactions[0].coverage, /cannot be assigned reliably/);
    assert.deepEqual(facts.interactions[0].observedSequence, []);
});


test('TLS overview includes late failures and shares raw excerpts without cutting JSON', () => {
    const interactions = Array.from({length: 25}, (_, n) => ({ id: n + 1, outcome: 'success', rawLines: [`raw-${n}`, 'x'.repeat(10000)] }));
    interactions[24].outcome = 'failure'; interactions[24].failureReason = 'Received fatal alert: handshake_failure';
    const evidence = tlsAiEvidence({ interactions, name: 'many.log' });
    const facts = JSON.parse(evidence.summary);
    assert.deepEqual(facts.captureOutcomeCounts, {success: 24, failure: 1});
    assert.equal(facts.interactions.at(-1).id, 25);
    assert.match(evidence.raw, /raw-24/);
    assert.ok(evidence.raw.length <= 35000);
    for (const it of interactions) { it.failureReason = 'x'.repeat(10000); it.peerHost = 'y'.repeat(10000); }
    const large = tlsAiEvidence({ interactions });
    assert.equal(JSON.parse(large.summary).interactions.length, 20);
    assert.ok(large.summary.length <= 40000);
});

test('late classified TLS failure events survive sequence budgeting', () => {
    const text = readFileSync(new URL('fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt', import.meta.url), 'utf8');
    const { interactions } = analyzeTlsLog(text), selected = interactions[0];
    const first = selected.observedRecords.find(r => /ClientHello/.test(r.message));
    selected.observedRecords = [...Array(40).fill(first), ...selected.observedRecords];
    const facts = JSON.parse(tlsAiEvidence({ interactions, selected }).summary).interactions[0];
    assert.ok(facts.observedSequence.some(e => e.kind === 'failure'));
    assert.match(facts.sequenceCoverage, /all classified failure events retained/);
});

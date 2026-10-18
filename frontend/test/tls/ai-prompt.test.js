import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { tlsAiEvidence, aiPrompt } from '../../assets/javautils/ai-evidence.js';
const parse = name => analyzeTlsLog(readFileSync(new URL(`fixtures/runtime/${name}.txt`, import.meta.url), 'utf8')).interactions;
const instructions = evidence => aiPrompt(evidence).split('\nScope: ')[0];

for (const fixture of ['jdk8u252-tlsv1.2-mutual-client', 'jdk11-tlsv1.3-success-client', 'jdk25-tlsv1.3-required-client-auth-client', 'jdk25-tlsv1.3-untrusted-server']) {
    test(`TLS instructions preserve real runtime evidence and avoid thread-analysis rules: ${fixture}`, () => {
        const interactions = parse(fixture), selected = interactions[0];
        const evidence = tlsAiEvidence({ interactions, selected, name: 'thread-series-CPU-deadlock.txt' });
        assert.equal(evidence.kind, 'tls-interaction');
        const prompt = instructions(evidence), facts = JSON.parse(evidence.summary).interactions[0];
        assert.match(prompt, /^Analyze this Java TLS\/JSSE log evidence/);
        assert.match(prompt, /One TLS interaction/);
        assert.match(prompt, /Do not infer an overall failure rate/);
        assert.match(prompt, /produced\/consumed direction/);
        assert.match(prompt, /Preserve correlation warnings/);
        assert.match(prompt, /Missing TLS Finished messages do not prove failure/);
        assert.match(prompt, /post-handshake errors/);
        assert.match(prompt, /certificate dates against reliable capture time/);
        assert.match(prompt, /offered settings from negotiated protocol and cipher/);
        assert.match(prompt, /certificate-chain trust, validity, hostname\/SNI, mutual TLS/);
        assert.match(prompt, /do not recommend disabling certificate or hostname verification/);
        assert.doesNotMatch(prompt, /RUNNABLE|TIMED_WAITING|CPU|deadlock|thread snapshot|thread-series|monitor-lock/);
        assert.equal(facts.outcome, selected.outcome);
        assert.equal(facts.protocol, selected.tlsVersion);
        assert.equal(facts.correlationQuality, selected.correlationQuality);
        assert.ok(aiPrompt(evidence, true).includes(evidence.raw));
        assert.ok(!aiPrompt(evidence).includes(evidence.raw));
    });
}

test('TLS overview instructions distinguish biased excerpts from capture-wide counts', () => {
    const success = parse('jdk11-tlsv1.3-success-client')[0];
    const failure = parse('jdk25-tlsv1.3-required-client-auth-client')[0];
    const interactions = [...Array.from({ length: 24 }, (_, i) => ({ ...success, id: i + 1 })), { ...failure, id: 25 }];
    const evidence = tlsAiEvidence({ interactions, name: 'capture.log' });
    assert.equal(evidence.kind, 'tls-overview');
    const prompt = instructions(evidence), facts = JSON.parse(evidence.summary);
    assert.match(prompt, /TLS capture overview/);
    assert.match(prompt, /capture-wide outcome counts separately from the bounded interaction excerpt/);
    assert.match(prompt, /do not treat it as a representative sample/);
    assert.match(prompt, /Shared error text does not prove a shared root cause/);
    assert.doesNotMatch(prompt, /Selection: One TLS interaction|RUNNABLE|deadlock|CPU/);
    assert.deepEqual(facts.captureOutcomeCounts, { success: 24, failure: 1 });
    assert.equal(facts.interactions.length, 20);
    assert.equal(facts.interactions.at(-1).id, 25);
});

test('an uncertain TLS group keeps its qualification without manufacturing a failure', () => {
    const interaction = { id: 1, outcome: 'unknown', correlationQuality: 'ambiguous-legacy', rawLines: ['partial trace'] };
    const evidence = tlsAiEvidence({ interactions: [interaction], selected: interaction });
    assert.match(instructions(evidence), /Do not combine uncertain groups into a complete exchange/);
    const facts = JSON.parse(evidence.summary).interactions[0];
    assert.equal(facts.outcome, 'unknown');
    assert.equal(facts.diagnosis, 'Grouping uncertain');
    assert.deepEqual(facts.observedSequence, []);
});

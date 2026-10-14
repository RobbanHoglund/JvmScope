import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { matchTlsFailureReason } from '../../assets/javautils/tls-core.js';
import { explainIssueText } from '../../assets/javautils/tls-explanations.js';
import { prepareTlsAnalysis } from '../../assets/javautils/tls-analysis-model.js';
import { tlsObservedSequence } from '../../assets/javautils/tls-sequence-model.js';

const line = message => `javax.net.ssl|DEBUG|A|main|2026-10-14 12:00:00.000 UTC|X.java:1|${message}`;
const hello = line('Produced ClientHello handshake message');
const finished = [line('Consuming server Finished handshake message'), line('Produced client Finished handshake message')];
const timeout = line('java.net.SocketTimeoutException: Read timed out');
const parse = (...parts) => analyzeTlsLog(parts.flat().join('\n')).interactions;
const alert = (description, level = 'warning') => [line('Received alert message ('),
    '"Alert": {', `"level": "${level}",`, `"description": "${description}"`, '}', ')'];

test('real Java 17 read timeouts recover on the same socket and retain their evidence', () => {
    const text = readFileSync(new URL('./fixtures/review/jdk17-recovered-read-timeout.txt', import.meta.url), 'utf8');
    assert.match(text, /RESULT=TLSv1.2,TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384/);
    const [it] = analyzeTlsLog(text).interactions;
    assert.equal(it.sawHandshakeFinished, true);
    assert.equal(it.outcome, 'success');
    assert.equal(it.failureReason, null);
    assert.equal(it.failureEvidence.filter(e => e.key === 'socket_timeout').length, 6);
    assert.equal(tlsObservedSequence(it).filter(e => e.kind === 'failure').length, 0);
    assert.ok(it.rawLines.some(l => l.includes('Read timed out')));
});

test('a timeout alone is not a terminal outcome or a safe connection boundary', () => {
    for (const input of [[timeout], [hello, timeout]]) {
        const [it] = parse(input);
        assert.equal(it.outcome, 'unknown');
        assert.equal(it.failureReason, null);
        assert.match(it.outcomeDetail, /timeout.*no final TLS outcome/);
    }
    const interactions = parse(hello, timeout, hello, finished);
    assert.deepEqual(interactions.map(it => it.outcome), ['unknown', 'unknown']);
    assert.ok(interactions.every(it => it.correlationQuality === 'ambiguous-thread'));
});

test('a terminal fatal alert still outranks a recoverable timeout and Finished', () => {
    for (const completion of [[], finished]) {
        const [it] = parse(hello, timeout, completion, line('Received fatal alert: certificate_required'));
        assert.equal(it.outcome, 'failure');
        assert.equal(it.failureReason, 'Received fatal alert: certificate_required');
    }
});

test('timeout normalization retains connect, read and unspecified observations', () => {
    for (const message of ['Connect timed out', 'Read timed out', 'operation deadline exceeded', '']) {
        const original = `SocketTimeoutException${message ? ': ' + message : ''}`;
        assert.equal(matchTlsFailureReason('java.net.' + original).text, original);
        const [it] = parse(hello, line('java.net.' + original));
        assert.equal(it.failureEvidence[0].text, original);
        assert.equal(it.outcome, 'unknown');
    }
});

for (const description of ['handshake_failure', 'bad_certificate_status_response', 'unknown_alert']) {
    test(`TLS 1.3 error semantics override warning level for ${description}`, () => {
        for (const version of ['TLSv1.3', 'TLSv1.2', null]) {
            const [it] = parse(hello, version ? line(`Negotiated protocol version: ${version}`) : [], finished, alert(description));
            assert.equal(it.outcome, version === 'TLSv1.3' ? 'failure' : 'success');
            const event = tlsObservedSequence(it).at(-1);
            assert.equal(event.kind, version === 'TLSv1.3' ? 'failure' : 'alert');
            if (version === 'TLSv1.3') {
                assert.match(it.failureReason, /reported level: warning/);
                assert.match(event.title, /reported level: warning/);
            }
        }
    });
}

test('TLS 1.3 closure and cancellation warnings remain nonfatal while explicit fatal levels stay fatal', () => {
    for (const description of ['close_notify', 'user_canceled']) {
        const [it] = parse(hello, line('Negotiated protocol version: TLSv1.3'), finished, alert(description));
        assert.equal(it.outcome, 'success');
        assert.equal(tlsObservedSequence(it).at(-1).kind, 'alert');
    }
    assert.equal(parse(hello, line('Negotiated protocol version: TLSv1.2'), finished, alert('bad_certificate', 'fatal'))[0].outcome, 'failure');
});

test('OCSP alerts retain an exact category and endpoint without matching certificate prefixes', () => {
    for (const prefix of ['Received fatal alert: ', 'Sent fatal alert: ', 'Received TLS 1.3 error alert: ']) {
        const reason = prefix + 'bad_certificate_status_response';
        const result = explainIssueText(reason);
        assert.equal(result.key, 'bad_certificate_status_response');
        assert.match(result.explanation, /invalid or unacceptable OCSP response/);
        assert.match(result.explanation, prefix.startsWith('Sent') ? /The local JVM rejected/ : /The remote peer rejected/);
        assert.equal(prepareTlsAnalysis([{ outcome: 'failure', failureReason: reason }])[0].failure, result.key);
    }
    for (const name of ['bad_certificate_hash_value', 'bad_certificate_custom', 'custom_bad_certificate']) {
        assert.equal(explainIssueText('Received fatal alert: ' + name).key, 'Received fatal alert:');
    }
    assert.equal(explainIssueText('Received fatal alert: bad_certificate').key, 'bad_certificate');
    assert.equal(explainIssueText('No cipher suite in common').key, 'cipher suites in common');
});

test('server certificate candidate misses remain neutral hints on a successful session', () => {
    const text = readFileSync(new URL('./fixtures/runtime/jdk21-tlsv1.3-success-server.txt', import.meta.url), 'utf8');
    const [it] = analyzeTlsLog(text).interactions;
    assert.equal(it.direction, 'inbound');
    assert.equal(it.outcome, 'success');
    assert.equal(it.sawCertRequest, false);
    assert.equal(it.sawCertificateSelectionHint, true);
    assert.ok(!it.sawClientCertSelectionFailure);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    matchTlsFailureReason,
    summarizeTlsTransportFailure,
} from '../../assets/javautils/tls-core.js';
import {
    explainIssueText,
    ISSUE_EXPLANATIONS,
} from '../../assets/javautils/tls-explanations.js';
import { buildComprehensiveTlsSampleLog } from '../../assets/javautils/tls-sample.js';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';

test('local fatal alerts are not explained as remote peer rejections', () => {
    const required = explainIssueText('Fatal (CERTIFICATE_REQUIRED): Empty client certificate chain');
    assert.equal(required.key, 'certificate_required');
    assert.equal(required.locallyRaised, true);
    assert.match(required.explanation, /The local JVM required a client certificate/);
    assert.doesNotMatch(required.explanation, /The peer required/);
    const unknown = explainIssueText('Sent fatal alert: certificate_unknown');
    assert.equal(unknown.key, 'certificate_unknown');
    assert.equal(unknown.locallyRaised, true);
    assert.match(unknown.explanation, /The local JVM rejected/);
    assert.equal(explainIssueText('Received fatal alert: certificate_unknown').key, 'certificate_unknown');
});

for (const [reason, key] of [
    ['Fatal (HANDSHAKE_FAILURE): no cipher suites in common', 'cipher suites in common'],
    ['Fatal (CERTIFICATE_UNKNOWN): PKIX path building failed: unable to find valid certification path to requested target', 'PKIX path building failed'],
    ['Fatal (HANDSHAKE_FAILURE): Certificates do not conform to algorithm constraints', 'algorithm constraints'],
    ['Sent fatal alert: certificate_expired', 'certificate_expired'],
    ['Sent fatal alert: unknown_ca', 'unknown_ca'],
]) {
    test(`local alert retains its specific explanation: ${key}`, () => {
        const result = explainIssueText(reason);
        assert.equal(result.key, key);
        assert.equal(result.locallyRaised, true);
        assert.ok(result.explanation.length > 0);
        assert.doesNotMatch(result.explanation, /\{[Aa]lertEndpoint\}/);
    });
}

test('alert descriptions identify the rejecting side by the sender, not the observer', () => {
    // Expected meanings are independent of the production catalogue and its templates.
    const meanings = [
        ['certificate_unknown', '$endpoint rejected a certificate during the TLS handshake.'],
        ['handshake_failure', "$endpoint aborted the handshake with the generic TLS alert 'handshake_failure'."],
        ['unknown_ca', '$endpoint received a certificate chain or partial chain, but did not accept it because the issuing CA was not trusted.'],
        ['bad_certificate', '$endpoint reported a certificate-related handshake failure.'],
        ['unsupported_certificate', '$endpoint rejected the certificate because its type was not acceptable.'],
        ['certificate_expired', 'The certificate has expired or is not currently valid.'],
        ['certificate_revoked', '$endpoint determined that the certificate had been revoked by its issuer.'],
        ['certificate_required', '$endpoint required a client certificate, but none was provided for the handshake.'],
        ['protocol_version', '$endpoint recognized the proposed or negotiated TLS version, but did not support or accept it.'],
        ['unrecognized_name', 'The server did not recognize the server name indicated by the client, typically via SNI.'],
        ['access_denied', '$endpoint understood the certificate or authentication material but refused the handshake for authorization reasons.'],
        ['illegal_parameter', 'A handshake field was syntactically valid but inconsistent, incorrect, or unacceptable to $endpointLower.'],
        ['insufficient_security', 'Negotiation failed because the server requires stronger parameters than the client supports.'],
        ['decrypt_error', 'A handshake-layer cryptographic operation failed.'],
        ['unsupported_extension', '$endpoint rejected a TLS extension it did not support or did not allow in that context.'],
        ['no_application_protocol', 'ALPN negotiation failed because the client and server had no application protocol in common.'],
    ];
    for (const [alert, meaning] of meanings) {
        for (const [reason, locallyRaised] of [
            [`Sent fatal alert: ${alert}`, true],
            [`Fatal (${alert.toUpperCase()}): rejected`, true],
            [`Received fatal alert: ${alert}`, false],
            [`Fatal (${alert.toUpperCase()}): Received fatal alert: ${alert}`, false],
        ]) {
            const result = explainIssueText(reason);
            assert.equal(result.key, alert, reason);
            assert.equal(result.locallyRaised, locallyRaised, reason);
            const expected = meaning
                .replace('$endpointLower', locallyRaised ? 'the local JVM' : 'the remote peer')
                .replace('$endpoint', locallyRaised ? 'The local JVM' : 'The remote peer');
            assert.equal(result.explanation.split('\n')[1], expected, reason);
            assert.doesNotMatch(result.explanation, /alert sender|\{[Aa]lertEndpoint\}/i, reason);
        }
    }
    const local = explainIssueText('Sent fatal alert: unknown_ca');
    assert.match(local.explanation, /The local JVM received/);
    assert.match(local.explanation, /the local JVM's truststore/);
    const remote = explainIssueText('Received fatal alert: unknown_ca');
    assert.match(remote.explanation, /The remote peer received/);
    assert.match(remote.explanation, /the remote peer's truststore/);
});

test('certificate and handshake alert bodies preserve the endpoint beyond their first sentence', () => {
    for (const [prefix, endpoint, opposite] of [
        ['Sent fatal alert: ', 'the local JVM', /remote peer|the peer|other side/i],
        ['Received fatal alert: ', 'the remote peer', /local JVM|other side/i],
    ]) {
        const certificate = explainIssueText(`${prefix}certificate_unknown`).explanation;
        assert.ok(certificate.includes(`certificate_unknown means ${endpoint} found the certificate unacceptable`));
        assert.ok(certificate.includes(`${endpoint[0].toUpperCase() + endpoint.slice(1)} did not trust the presented certificate chain`));
        assert.ok(certificate.includes(`not acceptable to ${endpoint} for the intended purpose`));
        assert.ok(certificate.includes(`Does ${endpoint} trust the issuing CA/root?`));
        assert.ok(certificate.includes(`the alert from ${endpoint} may just be the final outcome`));
        assert.match(certificate, /rejecting endpoint is not necessarily the endpoint at fault/);
        assert.doesNotMatch(certificate, opposite);
        const handshake = explainIssueText(`${prefix}handshake_failure`).explanation;
        assert.ok(handshake.includes(`means ${endpoint} could not negotiate acceptable security parameters`));
        assert.doesNotMatch(handshake, opposite);
    }
    for (const alert of ['certificate_unknown', 'handshake_failure']) {
        assert.doesNotMatch(explainIssueText(alert).explanation, /local JVM|remote peer|other side/i);
    }
});

test('bad_certificate does not assert that a missing certificate was corrupt', () => {
    for (const reason of ['Sent fatal alert: bad_certificate', 'Received fatal alert: bad_certificate']) {
        const { explanation } = explainIssueText(reason);
        assert.match(explanation, /does not establish that a certificate was corrupt or even presented/);
        assert.match(explanation, /empty client certificate chain \(null cert chain\)/);
        assert.match(explanation, /Was a client certificate required/);
        assert.doesNotMatch(explanation, /considered the certificate invalid at a certificate-integrity level/);
    }
});

test('transport guidance remains cautious with incomplete and completed handshakes', () => {
    for (const observation of ['Broken pipe', 'Unexpected EOF', 'Peer closed connection', 'Connection reset']) {
        for (const context of ['', ' during TLS handshake', ' after Finished']) {
            const result = explainIssueText(observation + context);
            assert.ok(result, observation + context);
            assert.match(result.explanation, /observation alone|message alone/);
            assert.doesNotMatch(result.explanation, /before.*negotiation completed|handshake was still in progress|closed.*without sending a TLS fatal alert/);
        }
    }
    const timeout = explainIssueText('SocketTimeoutException: Read timed out');
    assert.match(timeout.explanation, /different handshake stages or during application reads/);
    assert.match(timeout.explanation, /does not prove/);
});

test('local diagnostic reasons outrank enclosing alert names of any length', () => {
    for (const prefix of ['Fatal (UNSUPPORTED_CERTIFICATE): ', 'Sent fatal alert: unsupported_certificate: ']) {
        const result = explainIssueText(`${prefix}PKIX path validation failed: Algorithm constraints check failed on signature algorithm: SHA1withRSA`);
        assert.equal(result.key, 'algorithm constraints');
        assert.equal(result.locallyRaised, true);
        assert.match(result.explanation, /local JVM security policy rejected/);
    }
    for (const reason of ['Fatal (UNSUPPORTED_CERTIFICATE): ', 'Fatal (UNSUPPORTED_CERTIFICATE): rejected', 'Sent fatal alert: unsupported_certificate']) {
        assert.equal(explainIssueText(reason).key, 'unsupported_certificate');
    }
    const received = explainIssueText('Fatal (UNSUPPORTED_CERTIFICATE): Received fatal alert: unsupported_certificate');
    assert.equal(received.key, 'unsupported_certificate');
    assert.equal(received.locallyRaised, false);
    assert.match(received.explanation, /The remote peer rejected/);
});

test('bare alert names do not invent an endpoint and resolving one origin does not affect the next', () => {
    for (const reason of ['Sent fatal alert: unknown_ca', 'Received fatal alert: unknown_ca', 'unknown_ca']) {
        const result = explainIssueText(reason);
        assert.equal(result.key, 'unknown_ca');
        assert.doesNotMatch(result.explanation, /\{[Aa]lertEndpoint\}/);
    }
    const bare = explainIssueText('unknown_ca');
    assert.match(bare.explanation, /The endpoint that sent the alert received/);
    assert.doesNotMatch(bare.explanation, /local JVM|remote peer/);
    assert.match(explainIssueText('  SENT fatal alert: UNKNOWN_CA  ').explanation, /The local JVM received/);
    assert.match(explainIssueText('Fatal (UNKNOWN_CA): Received fatal alert: unknown_ca').explanation, /The remote peer received/);
});

test('unspecified local errors keep their fallback and received errors retain remote origin', () => {
    const local = explainIssueText('  Fatal (INTERNAL_ERROR): Unexpected error  ');
    assert.equal(local.key, 'local-fatal');
    assert.equal(local.locallyRaised, true);
    assert.match(local.explanation, /local JSSE endpoint/);
    const received = explainIssueText('Received fatal alert: unknown_ca');
    assert.equal(received.key, 'unknown_ca');
    assert.equal(received.locallyRaised, false);
    assert.equal(explainIssueText('Unexpected error'), null);
});

test('local hostname diagnostics normalize without changing parser rule priorities', () => {
    for (const inner of [
        'No subject alternative DNS name matching api.example.com found',
        'javax.net.ssl.SSLHandshakeException: (certificate_unknown) No subject alternative DNS name matching api.example.com found',
        'No subject alternative DNS name matching certificate_unknown.example.com found',
        'No name matching api.example.com found',
        'Hostname api.example.com not verified',
    ]) {
        const reason = `Fatal (CERTIFICATE_UNKNOWN): ${inner}`;
        assert.equal(matchTlsFailureReason(reason).text, reason);
        const [interaction] = analyzeTlsLog(`javax.net.ssl|ERROR|01|main|2026-09-09 12:00:00.000 UTC|TransportContext.java:1|${reason}`).interactions;
        assert.equal(interaction.outcome, 'failure');
        assert.equal(interaction.failureReason, reason);
        const result = explainIssueText(interaction.failureReason);
        assert.equal(result.key, 'Certificate name mismatch', reason);
        assert.equal(result.locallyRaised, true);
    }
    for (const alert of ['certificate_unknown', 'handshake_failure']) {
        const result = explainIssueText(`Fatal (${alert.toUpperCase()}): Received fatal alert: ${alert}`);
        assert.equal(result.key, alert);
        assert.equal(result.locallyRaised, false);
    }
});

test('every authored explanation is reachable by its own key', () => {
    for (const key of ISSUE_EXPLANATIONS.keys()) {
        const result = explainIssueText(key);
        assert.ok(result, `expected an explanation for ${key}`);
        assert.equal(result.key, key, `${key} was shadowed by ${result.key}`);
        assert.doesNotMatch(result.explanation, /\{[Aa]lertEndpoint\}/, key);
    }
});

test('hostname guidance separates name matching from trust and respects DNS SAN precedence', () => {
    const { explanation } = explainIssueText('Fatal (CERTIFICATE_UNKNOWN): No subject alternative DNS name matching api.example.com found');
    assert.match(explanation, /does not establish certificate trust or validity/);
    assert.match(explanation, /no DNS SAN is present.*fall back to the subject CN/);
    assert.match(explanation, /DNS SAN entries are present.*does not fall back to the subject CN/);
    assert.doesNotMatch(explanation, /server is valid|modern Java rejects|only for legacy certificates/);
});

test('cipher and algorithm guidance distinguishes certificate authentication from key exchange and policy', () => {
    const cipher = explainIssueText('Fatal (HANDSHAKE_FAILURE): no cipher suites in common').explanation;
    assert.match(cipher, /RSA certificate when only ECDHE_ECDSA suites are enabled/);
    assert.match(cipher, /ECDHE_RSA uses an RSA certificate with ECDHE key exchange/);
    assert.doesNotMatch(cipher, /RSA-only.*cannot satisfy an ECDHE-only/);
    const policy = explainIssueText('Fatal (HANDSHAKE_FAILURE): Certificates do not conform to algorithm constraints').explanation;
    assert.match(policy, /minimum allowed by the active JDK security policy/);
    assert.doesNotMatch(policy, /RSA key is smaller than 2048|trust anchor.*disabled by/);
});

function sampleFailureReasons() {
    const reasons = new Set();
    const transportContext = { sawClientHello: true, sawServerHello: false };

    for (const line of buildComprehensiveTlsSampleLog().split('\n')) {
        const evidence = matchTlsFailureReason(line);
        if (!evidence) continue;
        reasons.add(
            summarizeTlsTransportFailure(evidence.text, transportContext) || evidence.text,
        );
    }

    return reasons;
}

test('every failure reason produced by the comprehensive sample has an explanation', () => {
    const reasons = sampleFailureReasons();

    assert.ok(reasons.size > 0);
    for (const reason of reasons) {
        assert.ok(explainIssueText(reason), `missing explanation for ${reason}`);
    }
});

test('every authored explanation is exercised by the comprehensive sample', () => {
    const reached = new Set();

    for (const reason of sampleFailureReasons()) {
        const result = explainIssueText(reason);
        if (result) reached.add(result.key);
    }

    const unreached = [...ISSUE_EXPLANATIONS.keys()].filter((key) => !reached.has(key));
    assert.deepEqual(
        unreached,
        [],
        `no sample scenario produces a failure reason resolving to: ${unreached.join(', ')}`,
    );
});

test('known failures resolve to the explanation authored for them', () => {
    const resolutions = [
        [
            'SSLHandshakeException: PKIX path building failed: unable to find valid certification path to requested target',
            'PKIX path building failed',
        ],
        [
            'Received fatal alert: certificate_unknown',
            'certificate_unknown',
        ],
        [
            'Received fatal alert: handshake_failure',
            'handshake_failure',
        ],
        ['Received fatal alert: unknown_ca', 'unknown_ca'],
        ['Received fatal alert: bad_certificate', 'bad_certificate'],
        ['Received fatal alert: unsupported_certificate', 'unsupported_certificate'],
        ['Received fatal alert: certificate_expired', 'certificate_expired'],
        ['Received fatal alert: certificate_revoked', 'certificate_revoked'],
        ['Received fatal alert: certificate_required', 'certificate_required'],
        ['Received fatal alert: protocol_version', 'protocol_version'],
        ['Received fatal alert: unrecognized_name', 'unrecognized_name'],
        ['Received fatal alert: access_denied', 'access_denied'],
        ['Received fatal alert: illegal_parameter', 'illegal_parameter'],
        ['Received fatal alert: insufficient_security', 'insufficient_security'],
        ['Received fatal alert: decrypt_error', 'decrypt_error'],
        ['Received fatal alert: unsupported_extension', 'unsupported_extension'],
        ['Received fatal alert: no_application_protocol', 'no_application_protocol'],
        ['No cipher suites in common', 'cipher suites in common'],
        ['no cipher suites in common', 'cipher suites in common'],
        [
            'SSLHandshakeException: Certificates do not conform to algorithm constraints',
            'algorithm constraints',
        ],
        [
            'Peer closed connection during TLS handshake (before ServerHello)',
            'Peer closed connection during TLS handshake',
        ],
        [
            'Certificate name mismatch: no certificate name matching api.example.com found',
            'Certificate name mismatch',
        ],
    ];

    for (const [failureReason, expectedKey] of resolutions) {
        assert.equal(explainIssueText(failureReason)?.key, expectedKey, failureReason);
    }
});

test('generic fatal alerts resolve to the fallback explanation without shadowing specific alerts', () => {
    const genericAlerts = [
        'internal_error',
        'bad_record_mac',
        'unexpected_message',
        'decode_error',
        'record_overflow',
        'inappropriate_fallback',
        'missing_extension',
        'unknown_psk_identity',
    ];

    for (const alert of genericAlerts) {
        const failure = matchTlsFailureReason(`Received fatal alert: ${alert}`);
        assert.ok(failure, `expected ${alert} to be classified`);
        assert.equal(explainIssueText(failure.text)?.key, 'Received fatal alert:', alert);
    }

    assert.equal(
        explainIssueText('Received fatal alert: certificate_required')?.key,
        'certificate_required',
    );
});

test('empty issue text has no explanation', () => {
    assert.equal(explainIssueText(''), null);
    assert.equal(explainIssueText(null), null);
});

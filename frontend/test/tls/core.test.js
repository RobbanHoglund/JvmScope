import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyTlsFailureEvidence,
    deriveTlsDirection,
    matchTlsFailureReason,
    resolveTlsPeerHost,
    summarizeTlsTransportFailure,
} from '../../assets/javautils/tls-core.js';

test('classifies every JSSE fatal alert as a failure reason', () => {
    const alerts = [
        'protocol_version',
        'unrecognized_name',
        'unknown_ca',
        'no_application_protocol',
        'certificate_expired',
        'access_denied',
        'certificate_required',
        'bad_certificate',
        'certificate_revoked',
        'decrypt_error',
        'illegal_parameter',
        'insufficient_security',
    ];

    for (const alert of alerts) {
        const result = matchTlsFailureReason(
            `Fatal (${alert.toUpperCase()}): Received fatal alert: ${alert}`,
        );
        assert.ok(result, `expected ${alert} to be classified`);
        assert.equal(result.text, `Received fatal alert: ${alert}`);
    }
});

test('keeps the strongest specific fatal-alert rules ahead of the generic rule', () => {
    assert.deepEqual(
        matchTlsFailureReason('Fatal (CERTIFICATE_UNKNOWN): Received fatal alert: certificate_unknown'),
        {
            key: 'fatal_certificate_unknown',
            priority: 100,
            text: 'Received fatal alert: certificate_unknown',
        },
    );
    assert.deepEqual(
        matchTlsFailureReason('Received fatal alert: handshake_failure'),
        {
            key: 'fatal_handshake_failure',
            priority: 95,
            text: 'Received fatal alert: handshake_failure',
        },
    );
});

test('classifies DNS host-name verification failures and keeps the rejected name', () => {
    const shapes = [
        [
            'javax.net.ssl.SSLHandshakeException: java.security.cert.CertificateException: '
                + 'No subject alternative DNS name matching api.example.com found.',
            'api.example.com',
        ],
        [
            'java.security.cert.CertificateException: No subject alternative DNS name matching '
                + 'api.example.com found.',
            'api.example.com',
        ],
        ['java.security.cert.CertificateException: No name matching legacy.example.com found', 'legacy.example.com'],
        ['javax.net.ssl.SSLPeerUnverifiedException: Hostname wildcard.a.b.example.com not verified', 'wildcard.a.b.example.com'],
    ];

    for (const [line, host] of shapes) {
        assert.deepEqual(matchTlsFailureReason(line), {
            key: 'hostname_verification',
            priority: 92,
            text: `Certificate name mismatch: no certificate name matching ${host} found`,
        }, line);
    }
});

test('outranks the generic SSLHandshakeException rule but not a received fatal alert', () => {
    assert.equal(
        matchTlsFailureReason(
            'javax.net.ssl.SSLHandshakeException: No subject alternative DNS name matching api.example.com found.',
        ).key,
        'hostname_verification',
    );
    assert.equal(
        matchTlsFailureReason(
            'Fatal (CERTIFICATE_UNKNOWN): Received fatal alert: certificate_unknown; '
                + 'No subject alternative DNS name matching api.example.com found.',
        ).key,
        'fatal_certificate_unknown',
    );
});

test('leaves the IP-address host-name variant on its existing rule', () => {
    assert.equal(
        matchTlsFailureReason(
            'SSLHandshakeException: (certificate_unknown) No subject alternative names matching '
                + 'IP address 10.0.0.12 found',
        ).key,
        'ssl_handshake_exception',
    );
});

test('captures a no-common-cipher clue without outranking the final fatal alert', () => {
    assert.deepEqual(matchTlsFailureReason('No cipher suites in common'), {
        key: 'no_common_cipher_suite',
        priority: 75,
        text: 'No cipher suites in common',
    });
    assert.equal(
        matchTlsFailureReason('Received fatal alert: handshake_failure').priority,
        95,
    );
});

test('derives connection direction only from handshake roles, not generic message flow', () => {
    assert.equal(deriveTlsDirection({ initiatedByLocal: true }), 'outbound');
    assert.equal(deriveTlsDirection({ initiatedByPeer: true }), 'inbound');
    assert.equal(deriveTlsDirection({ initiatedByLocal: true, initiatedByPeer: true }), 'both');
    // Old weak-signal properties must remain insufficient even if supplied by a caller.
    assert.equal(deriveTlsDirection({ sawConsuming: true }), 'unknown');
    assert.equal(deriveTlsDirection({ sawProduced: true, hasTargetHost: true }), 'unknown');
    assert.equal(deriveTlsDirection(), 'unknown');
});

test('does not mistake inbound SNI or certificate CN for the remote peer', () => {
    assert.equal(resolveTlsPeerHost({
        sni: 'local-vhost.example.com',
        certificateSubjectCn: 'server-cert.example.com',
        direction: 'inbound',
    }), null);
    assert.equal(resolveTlsPeerHost({
        peerHost: '192.0.2.44',
        sni: 'local-vhost.example.com',
        direction: 'inbound',
    }), '192.0.2.44');
});

test('uses outbound SNI but never substitutes a certificate identity for the peer endpoint', () => {
    assert.equal(resolveTlsPeerHost({ sni: 'api.example.com', direction: 'outbound' }), 'api.example.com');
    assert.equal(resolveTlsPeerHost({
        certificateSubjectCn: 'cert.example.com',
        direction: 'outbound',
    }), null);
    assert.equal(resolveTlsPeerHost({ direction: 'outbound' }), null);
});

test('failure matching safely ignores empty and unrelated input', () => {
    assert.equal(matchTlsFailureReason(null), null);
    assert.equal(matchTlsFailureReason('Handshake completed'), null);
});

test('keeps transport errors after a completed handshake out of the handshake failure summary', () => {
    assert.deepEqual(
        classifyTlsFailureEvidence('java.net.SocketException: Connection reset'),
        {
            key: 'connection_reset',
            priority: 50,
            text: 'java.net.SocketException: Connection reset',
            phase: 'handshake',
            promotesHandshakeFailure: true,
        },
    );
    assert.deepEqual(
        classifyTlsFailureEvidence('java.net.SocketException: Connection reset', {
            sawHandshakeFinished: true,
        }),
        {
            key: 'connection_reset',
            priority: 50,
            text: 'java.net.SocketException: Connection reset',
            phase: 'post-handshake',
            promotesHandshakeFailure: false,
        },
    );
});

test('preserves the specific transport failure in the final handshake summary', () => {
    const beforeServerHello = { sawClientHello: true, sawServerHello: false };

    assert.equal(
        summarizeTlsTransportFailure('java.net.SocketException: Connection reset', beforeServerHello),
        'Connection reset (handshake phase unknown; ServerHello not captured)',
    );
    assert.equal(
        summarizeTlsTransportFailure('java.io.EOFException: SSL peer shut down incorrectly', beforeServerHello),
        'Unexpected EOF (handshake phase unknown; ServerHello not captured)',
    );
    assert.equal(
        summarizeTlsTransportFailure('java.net.SocketException: Broken pipe', beforeServerHello),
        'Broken pipe (socket write failed; handshake phase unknown; ServerHello not captured)',
    );
    assert.equal(summarizeTlsTransportFailure('Received fatal alert: bad_certificate'), null);
});

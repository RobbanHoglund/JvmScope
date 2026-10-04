import assert from 'node:assert/strict';
import test from 'node:test';

import { buildComprehensiveTlsSampleLog } from '../../assets/javautils/tls-sample.js';

const sample = buildComprehensiveTlsSampleLog();

test('comprehensive sample contains thirty-five independently started interactions', () => {
    const starts = sample.match(/(?:Produced|Consuming) ClientHello/g) || [];
    assert.equal(starts.length, 35);
});

test('comprehensive sample covers success, mTLS, closure, concurrency and incomplete capture', () => {
    const expectedEvidence = [
        'TLSv1.1',
        'TLSv1.2',
        'TLSv1.3',
        'Consuming ClientHello',
        'CertificateRequest',
        'certificate authorities',
        'Produced client Certificate',
        'application_layer_protocol_negotiation',
        'Handshake completed',
        'Received close_notify',
        'interleaved-client',
        'interleaved-server',
        'incomplete-capture',
        'Resuming session: pre_shared_key',
        'outbound-ip-no-sni',
        'hostname-mismatch',
    ];

    for (const evidence of expectedEvidence) {
        assert.match(sample, new RegExp(evidence), `missing sample evidence: ${evidence}`);
    }
});

test('comprehensive sample covers representative TLS and transport failures', () => {
    const expectedFailures = [
        'certificate_unknown',
        'unknown_ca',
        'certificate_required',
        'handshake_failure',
        'unrecognized_name',
        'protocol_version',
        'no_application_protocol',
        'certificate_expired',
        'access_denied',
        'Connection reset',
        'SocketTimeoutException: Read timed out',
        'bad_certificate',
        'certificate_revoked',
        'decrypt_error',
        'illegal_parameter',
        'insufficient_security',
        'No cipher suites in common',
        'EOFException',
        'Broken pipe',
        'unsupported_certificate',
        'unsupported_extension',
        'Connection closed by peer',
        'No subject alternative DNS name matching api.example.com found',
        'internal_error',
    ];

    for (const failure of expectedFailures) {
        assert.ok(sample.includes(failure), `missing sample failure: ${failure}`);
    }
});

test('every structured sample line has a complete JSSE prefix', () => {
    const structuredLines = sample.split('\n').filter((line) => line.startsWith('javax.net.ssl|'));
    assert.ok(structuredLines.length > 0);

    for (const line of structuredLines) {
        assert.equal(line.split('|').length, 7, line);
        assert.match(line, /^javax\.net\.ssl\|(?:ALL|DEBUG|ERROR|WARNING)\|[^|]+\|[^|]+\|[^|]+\|null:-1\|.+$/);
    }
});

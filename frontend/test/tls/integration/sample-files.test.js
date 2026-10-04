import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeTlsLog } from '../../../assets/javautils/tls-parser.js';
import { clientCertDisplay, certificateAuthoritiesDisplay } from '../../../assets/javautils/tls-view-model.js';
import { buildComprehensiveTlsSampleLog } from '../../../assets/javautils/tls-sample.js';
import { explainIssueText } from '../../../assets/javautils/tls-explanations.js';

const root = join(import.meta.dirname, '..', 'fixtures');
const fixture = name => readFileSync(join(root, name), 'utf8');

for (const version of [25, 26, 27]) test(`a real Java ${version} capture ending at the received alert still reports the post-Finished rejection`, () => {
    const lines = fixture(`runtime/jdk${version}-tlsv1.3-required-client-auth-client.txt`).replaceAll('\r\n', '\n').split('\n');
    const start = lines.findIndex(line => line.includes('Received alert message'));
    const end = lines.findIndex((line, index) => index > start && /^\)\s*$/.test(line));
    assert.ok(start >= 0 && end > start);
    const [it] = analyzeTlsLog(lines.slice(0, end + 1).join('\n')).interactions;
    assert.equal(it.sawHandshakeFinished, true);
    assert.equal(it.outcome, 'failure');
    assert.equal(it.failureReason, 'Received fatal alert: certificate_required');
    assert.equal(explainIssueText(it.failureReason).locallyRaised, false);
});

for (const [name, expectedKey, locallyRaised] of [
    ['jdk8u252-tlsv1.2-required-client-auth-server.txt', 'bad_certificate', true],
    ...[25, 26, 27].flatMap(version => [
        [`jdk${version}-tlsv1.3-required-client-auth-server.txt`, 'certificate_required', true],
        [`jdk${version}-tlsv1.3-required-client-auth-client.txt`, 'certificate_required', false],
        [`jdk${version}-tlsv1.3-untrusted-client.txt`, 'local-fatal', true],
    ]),
]) {
    test(`explains the alert origin from captured ${name}`, () => {
        const raw = fixture(`runtime/${name}`);
        const [interaction] = analyzeTlsLog(raw).interactions;
        assert.equal(interaction.outcome, 'failure');
        const explanation = explainIssueText(interaction.failureReason);
        assert.equal(explanation.key, expectedKey);
        assert.equal(explanation.locallyRaised, locallyRaised);
        if (expectedKey === 'bad_certificate') {
            assert.match(raw, /SSLHandshakeException: null cert chain/);
            assert.match(explanation.explanation, /The local JVM reported a certificate-related handshake failure/);
            assert.match(explanation.explanation, /empty client certificate chain \(null cert chain\)/);
            assert.doesNotMatch(explanation.explanation, /considered the certificate invalid at a certificate-integrity level/);
        }
        if (expectedKey === 'certificate_required') {
            assert.match(explanation.explanation, locallyRaised
                ? /The local JVM required a client certificate/
                : /The remote peer required a client certificate/);
        }
    });
}

test('a local algorithm-policy diagnostic beats its longer enclosing alert name', () => {
    const [interaction] = analyzeTlsLog(fixture('local-algorithm-constraints.txt')).interactions;
    assert.equal(interaction.outcome, 'failure');
    assert.match(interaction.failureReason, /^Fatal \(UNSUPPORTED_CERTIFICATE\):/);
    const explanation = explainIssueText(interaction.failureReason);
    assert.equal(explanation.key, 'algorithm constraints');
    assert.equal(explanation.locallyRaised, true);
    assert.match(explanation.explanation, /local JVM security policy rejected/);
    assert.match(explanation.explanation, /jdk\.certpath\.disabledAlgorithms/);
});

const captures = [
    ...['jdk8u504', 'jdk11', 'jdk17', 'jdk21', 'jdk23', 'jdk24'].map(jdk => [jdk, 'TLSv1.3', 'success']),
    ['jdk8u252', 'TLSv1', 'success'], ['jdk8u252', 'TLSv1.1', 'success'],
    ['jdk8u252', 'TLSv1.2', 'success'], ['jdk8u252', 'TLSv1.2', 'mutual'], ['jdk8u252', 'TLSv1.2', 'required-client-auth'],
    ...['jdk25', 'jdk26', 'jdk27'].flatMap(jdk => [
        [jdk, 'TLSv1.2', 'success'], [jdk, 'TLSv1.2', 'resumption'],
        [jdk, 'TLSv1.3', 'success'], [jdk, 'TLSv1.3', 'success-expand'],
        [jdk, 'TLSv1.3', 'mutual'], [jdk, 'TLSv1.3', 'optional-client-auth'],
        [jdk, 'TLSv1.3', 'required-client-auth'], [jdk, 'TLSv1.3', 'untrusted'],
    ]),
];
const expectedFiles = [];
for (const [jdk, protocol, scenario] of captures) {
    for (const side of ['client', 'server']) {
        const name = `${jdk}-${protocol.toLowerCase()}-${scenario}-${side}.txt`;
        expectedFiles.push(name);
        test(`replays real ${name} through the UI parser and detail projections`, () => {
            const raw = fixture(`runtime/${name}`);
            const result = analyzeTlsLog(raw);
            assert.equal(result.status, 'success');
            assert.equal(result.interactions.length, scenario === 'resumption' ? 2 : 1);
            for (const it of result.interactions) {
                assert.equal(it.outcome, ['required-client-auth', 'untrusted'].includes(scenario) ? 'failure' : 'success');
                assert.equal(it.tlsVersion, protocol);
                assert.equal(it.direction, side === 'client' ? 'outbound' : 'inbound');
                const cipher = protocol === 'TLSv1.3' ? 'TLS_AES_256_GCM_SHA384'
                    : protocol !== 'TLSv1.2' ? 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA'
                    : jdk === 'jdk8u252' ? 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384' : 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384';
                assert.equal(it.cipherSuite, cipher);
                assert.equal(it.sni, 'localhost');
                assert.equal(it.peerHost, side === 'client' ? 'localhost' : null);
                assert.equal(it.lineCount, it.rawLines.length);
                assert.ok(raw.includes(it.rawLines.join('\n')), 'raw view preserves the original record text');
                if (jdk === 'jdk8u252') {
                    assert.equal(it.durationMs, -1, 'legacy logs have no timestamps');
                    assert.equal(it.tidDisplay, '—');
                } else {
                    assert.ok(it.durationMs >= 0);
                    assert.ok(it.tids.size > 0);
                }
                if (scenario === 'mutual') {
                    assert.equal(it.clientCertSubject, 'CN=localhost, O=TLS regression sample');
                    assert.deepEqual(it.certificateAuthorities, ['CN=localhost, O=TLS regression sample']);
                    assert.equal(clientCertDisplay(it), 'localhost');
                    assert.equal(certificateAuthoritiesDisplay(it), 'localhost');
                }
                if (scenario === 'optional-client-auth') {
                    assert.equal(it.failureReason, null);
                    assert.equal(clientCertDisplay(it), 'Empty list');
                }
                if (scenario === 'required-client-auth') assert.ok(it.failureReason);
            }
        });
    }
}

test('all runtime samples have explicit expectations and cannot silently escape the build gate', () => {
    assert.deepEqual(readdirSync(join(root, 'runtime')).sort(), expectedFiles.sort());
});

for (const scenario of ['success', 'success-expand']) for (const side of ['client', 'server']) {
    test(`Java 27 hybrid ${scenario} ${side} ServerHello remains TLS 1.3 with complete key-share evidence`, () => {
        const [it] = analyzeTlsLog(fixture(`runtime/jdk27-tlsv1.3-${scenario}-${side}.txt`)).interactions;
        const hello = it.observedRecords.find(record => /(?:Produced|Consuming) ServerHello handshake message/.test(record.message));
        assert.ok(hello);
        const evidence = it.rawLines.slice(hello.rawStart, hello.rawEnd).join('\n');
        assert.match(evidence, /"server_share":\s*\{\s*"named group": X25519MLKEM768/);
        assert.equal(it.outcome, 'success');
        assert.equal(it.tlsVersion, 'TLSv1.3', 'compatibility TLSv1.2 field must not override negotiated supported_versions');
        assert.equal(it.cipherSuite, 'TLS_AES_256_GCM_SHA384');
    });
}

test('truncation after the real server Finished remains unknown', () => {
    const result = analyzeTlsLog(fixture('truncated-server-finished.txt'));
    assert.equal(result.interactions.length, 1);
    assert.equal(result.interactions[0].outcome, 'unknown');
    assert.equal(result.interactions[0].tlsVersion, 'TLSv1.3');
});

test('ambiguous legacy streams do not invent a successful connection', () => {
    const result = analyzeTlsLog(fixture('interleaved-legacy.txt'));
    assert.equal(result.status, 'partial');
    assert.ok(result.warnings.length);
    assert.ok(result.interactions.every(it => it.outcome === 'unknown' && it.direction === 'unknown'));
});

test('the UI demonstration is parsed, rather than only checking its source text', () => {
    const result = analyzeTlsLog(buildComprehensiveTlsSampleLog());
    assert.equal(result.interactions.length, 35);
    const byThread = name => result.interactions.find(it => it.threads.has(name));
    assert.equal(byThread('outbound-tls12').outcome, 'success');
    assert.equal(byThread('outbound-tls12').cipherSuite, 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256');
    assert.equal(byThread('mtls-success').clientCertSubjectCn, 'payments-client');
    assert.equal(byThread('incomplete-capture').outcome, 'unknown');
});

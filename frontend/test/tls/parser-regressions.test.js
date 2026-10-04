import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { parseTsUtcMillis } from '../../assets/javautils/tls-log-records.js';
import { clientCertDisplay, certificateAuthoritiesDisplay, clientCertificateDetailsText, certificateAuthoritiesDetailsText } from '../../assets/javautils/tls-view-model.js';

const line = (message, { tid = 'A', thread = 'worker', time = '12:00:00.000', zone = 'UTC' } = {}) =>
    `javax.net.ssl|DEBUG|${tid}|${thread}|2026-09-08 ${time} ${zone}|Handshake.java:1|${message}`;
const client = options => line('Produced ClientHello handshake message (', options) + '\n"client version": "TLSv1.2",\n"cipher suites": [TLS_AES_128_GCM_SHA256]\n)';
const server = options => line('Consuming ServerHello handshake message (', options) + '\n"server version": "TLSv1.2",\n"cipher suite": "TLS_AES_256_GCM_SHA384",\n"selected version": [TLSv1.3]\n)';
const finished = options => [line('Consuming server Finished handshake message', options), line('Produced client Finished handshake message', options)].join('\n');
const parse = (...parts) => analyzeTlsLog(parts.join('\n')).interactions;

test('structured fatal alerts establish failure and origin without a following exception, including after completion', () => {
    for (const [verb, origin] of [['Received', 'Received'], ['Consuming', 'Received'], ['Produced', 'Sent'], ['Sent', 'Sent']]) {
        for (const completed of [false, true]) {
            const alert = line(`${verb} alert message (`) + '\n"Alert": {\n"level": "fatal",\n"description": "certificate_required"\n}\n)';
            const [it] = parse(client(), ...(completed ? [finished()] : []), alert);
            assert.equal(it.outcome, 'failure');
            assert.equal(it.failureReason, `${origin} fatal alert: certificate_required`);
            assert.equal(it.sawHandshakeFinished, completed);
            assert.ok(it.rawLines.join('\n').endsWith(alert));
        }
    }
});

test('alert payloads cannot borrow fatal fields from unrelated records or text after a JSSE message boundary', () => {
    const payload = '\n"Alert": {\n"level": "fatal",\n"description": "certificate_unknown"\n}';
    for (const record of [line('Produced Certificate handshake message (') + payload + '\n)',
        line('Received alert message (') + '\n"Alert": {\n"level": "warning",\n"description": "close_notify"\n}\n)' + payload]) {
        const [it] = parse(client(), finished(), record);
        assert.equal(it.outcome, 'success');
        assert.equal(it.failureReason, null);
    }
    const [partial] = parse(line('Received alert message (') + '\n"Alert": {\n"level": "fatal",');
    assert.equal(partial.outcome, 'failure');
    assert.equal(partial.failureReason, 'Received fatal alert: unspecified');
});

test('a structured sent alert does not replace a more specific local failure diagnostic in either order', () => {
    for (const reason of ['Fatal (CERTIFICATE_UNKNOWN): PKIX path building failed', 'PKIX path building failed', 'No cipher suites in common']) {
        const alert = line('Produced alert message (') + '\n"Alert": {\n"level": "fatal",\n"description": "handshake_failure"\n}\n)';
        for (const records of [[line(reason), alert], [alert, line(reason)]]) {
            const [it] = parse(client(), ...records);
            assert.equal(it.outcome, 'failure');
            assert.equal(it.failureReason, reason);
            assert.ok(it.failureEvidence.some(evidence => evidence.key === 'sent_fatal_alert'));
        }
    }
});

test('expanded structured alert payloads preserve failure without relying on compact headers', () => {
    const text = '{\n"logger": "javax.net.ssl",\n"thread id": "A",\n"thread name": "worker",\n"time": "2026-10-02 10:00:00.000 UTC",\n"message": "Received alert message"\n"Alert": {\n"description": "protocol_version",\n"level": "fatal"\n}\n}';
    const [it] = parse(text);
    assert.equal(it.outcome, 'failure');
    assert.equal(it.failureReason, 'Received fatal alert: protocol_version');
    assert.equal(it.rawLines.join('\n'), text);
});

test('negotiated parameters come from ServerHello, never ClientHello offers or ignored suites', () => {
    const [offer] = parse(client(), line('Ignore unsupported cipher suite: TLS_RSA_WITH_AES_128_CBC_SHA'));
    assert.equal(offer.tlsVersion, null);
    assert.equal(offer.cipherSuite, null);
    assert.equal(offer.outcome, 'unknown');
    const [selected] = parse(client(), server(), finished());
    assert.equal(selected.tlsVersion, 'TLSv1.3');
    assert.equal(selected.cipherSuite, 'TLS_AES_256_GCM_SHA384');
});

test('a truncated TLS 1.3 compatibility ServerHello does not claim TLS 1.2', () => {
    const [it] = parse(client(), line('Consuming ServerHello handshake message ('), '"server version": "TLSv1.2",');
    assert.equal(it.tlsVersion, null);
    assert.equal(it.outcome, 'unknown');
});

test('one Finished or two duplicate Finished messages do not prove completion', () => {
    for (const messages of [[line('Consuming server Finished handshake message')], [line('Produced client Finished handshake message'), line('Produced client Finished handshake message')]]) {
        assert.equal(parse(client(), ...messages)[0].outcome, 'unknown');
    }
    assert.equal(parse(client(), finished())[0].outcome, 'success');
});

test('fatal client-auth rejection after local Finished remains a failure', () => {
    const [it] = parse(client(), server(), finished(), line('Fatal (CERTIFICATE_REQUIRED): Received fatal alert: certificate_required'));
    assert.equal(it.outcome, 'failure');
    assert.match(it.failureReason, /certificate_required/);
});

test('optional authentication and unsuccessful key candidates are warnings, not failures', () => {
    const [it] = parse(client(), line('No X.509 cert selected for EC'), line('No available authentication scheme'), finished());
    assert.equal(it.outcome, 'success');
    assert.equal(it.failureReason, null);
    assert.ok(it.warnCount >= 2);
});

test('partial captures retain local fatal alerts without a ClientHello', () => {
    const [it] = parse(line('Fatal (DECODE_ERROR): malformed handshake'));
    assert.equal(it.outcome, 'failure');
    assert.equal(it.direction, 'unknown');
});

test('slow handshakes stay together across arbitrary time gaps', () => {
    const result = parse(client(), server({ time: '12:00:30.000' }), finished({ time: '12:01:00.000' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].outcome, 'success');
    assert.equal(result[0].durationMs, 60000);
});

test('HelloRetryRequest retains the second ClientHello within the same interaction', () => {
    const result = parse(client(), line('Consuming HelloRetryRequest handshake message'), client(), server(), finished());
    assert.equal(result.length, 1);
    assert.equal(result[0].outcome, 'success');
});

test('successive handshakes on the same thread remain separate', () => {
    const result = parse(client(), server(), finished(), client(), line('Received fatal alert: unknown_ca'));
    assert.deepEqual(result.map(it => it.outcome), ['success', 'failure']);
});

test('thread names with pipes, empty names and renames do not corrupt thread ID grouping', () => {
    const result = parse(client({ thread: 'first|name' }), server({ thread: '' }), finished({ thread: 'renamed' }));
    assert.equal(result.length, 1);
    assert.equal(result[0].outcome, 'success');
    assert.equal(result[0].tids.size, 1);
    assert.equal(result[0].threadCount, 1, 'renaming one thread does not create three threads');
});

test('interleaved equal thread names with distinct IDs do not share state', () => {
    const result = parse(client(), client({ tid: 'B' }), server(), line('Received fatal alert: unknown_ca', { tid: 'B' }), finished());
    assert.equal(result.length, 2);
    assert.equal(result.find(it => it.tids.has('A')).outcome, 'success');
    assert.equal(result.find(it => it.tids.has('B')).outcome, 'failure');
});

test('unrelated app logs after a JSSE record cannot poison another connection', () => {
    const [it] = parse(client(), '2026-09-08 INFO unrelated SSLHandshakeException: another connection failed', server(), finished());
    assert.equal(it.outcome, 'success');
});

test('post-handshake transport failure remains evidence without retroactively failing the handshake', () => {
    const [it] = parse(client(), server(), finished(), line('java.net.SocketException: Connection reset'));
    assert.equal(it.outcome, 'success');
    assert.equal(it.failureEvidence.at(-1).phase, 'post-handshake');
});

test('empty certificate lists differ from missing details and never mean no match', () => {
    const [empty] = parse(client(), line('Consuming CertificateRequest message ('), '"certificate authorities": []', ')', line('Produced client Certificate message ('), '"certificate_list": [  ', ']', ')', finished());
    assert.equal(empty.outcome, 'success');
    assert.equal(clientCertDisplay(empty), 'Empty list');
    assert.equal(clientCertificateDetailsText(empty), 'Empty list');
    assert.equal(certificateAuthoritiesDisplay(empty), 'Empty list');
    const [missing] = parse(client(), line('Consuming CertificateRequest message'), line('Produced client Certificate message'));
    assert.equal(clientCertDisplay(missing), 'Not captured');
    assert.equal(certificateAuthoritiesDisplay(missing), 'Not captured');
});

test('an unfinished CA list is unknown rather than explicitly empty', () => {
    const [it] = parse(client(), line('Consuming CertificateRequest message ('), '"certificate authorities": [');
    assert.equal(certificateAuthoritiesDisplay(it), 'Not captured');
    assert.equal(certificateAuthoritiesDetailsText(it), 'Not captured');
});

test('quoted and escaped certificate names preserve the complete distinguished name', () => {
    const subject = 'CN=client\\, one, O="Example, Inc"';
    const authority = 'CN="Issuer ] one", O="Example, Inc"';
    const [it] = parse(client(), line('Consuming CertificateRequest message ('), '"certificate authorities": [', authority + ']', ')', line('Produced client Certificate message ('), '"subject": "' + subject + '"', ')', finished());
    assert.equal(it.clientCertSubject, subject);
    assert.equal(clientCertDisplay(it), 'client, one');
    assert.deepEqual(it.certificateAuthorities, [authority]);
    assert.equal(certificateAuthoritiesDisplay(it), 'Issuer ] one');
});

test('certificate capture ends at the message boundary and cannot steal an unrelated subject', () => {
    const [it] = parse(client(), line('Produced client Certificate message ('), ')', line('Trust store certificate ('), '"subject": "CN=unrelated"', ')');
    assert.equal(it.clientCertSubject, null);
    assert.equal(it.peerHost, null);
});

test('certificate subjects are data, not TLS failure events', () => {
    const [it] = parse(client(), line('Consuming server Certificate handshake message ('), '"subject": "CN=SSLHandshakeException: certificate_unknown"', ')', finished());
    assert.equal(it.outcome, 'success');
    assert.equal(it.failureReason, null);
});

test('names cannot masquerade as retry, negotiation, or SNI events', () => {
    const result = parse(client(), line('Consuming server Certificate handshake message ('), '"subject": "CN=HelloRetryRequest Negotiated protocol version: TLSv1.3 type=host_name (0), value=wrong.example"', ')', client());
    assert.equal(result.length, 2);
    assert.equal(result[0].tlsVersion, null);
    assert.equal(result[0].sni, null);
});

test('kk midnight, known offsets and invalid or ambiguous timestamps are handled explicitly', () => {
    assert.equal(parseTsUtcMillis('2026-09-08 24:15:30.123 UTC'), Date.parse('2026-09-08T00:15:30.123Z'));
    assert.equal(parseTsUtcMillis('2026-09-08 12:00:00.000 EDT'), Date.parse('2026-09-08T16:00:00Z'));
    assert.equal(parseTsUtcMillis('2026-09-08 12:00:00.000 GMT+05:30'), Date.parse('2026-09-08T06:30:00Z'));
    for (const value of ['2026-02-30 12:00:00.000 UTC', '2026-09-08 25:00:00.000 UTC', '2026-09-08 12:00:00.000 CST', '2026-09-08 12:00:00.000 IST']) assert.equal(parseTsUtcMillis(value), -1);
    const [it] = parse(client({ zone: 'IST' }), finished({ zone: 'IST' }));
    assert.equal(it.outcome, 'success');
    assert.equal(it.durationMs, -1);
});

test('unrecognized formats get explicit feedback instead of an apparently valid empty table', () => {
    for (const raw of ['', 'an ordinary application log', '{"logger":"different"}']) assert.equal(analyzeTlsLog(raw).status, 'unsupported');
});

test('legacy bodies without a thread record do not invent a thread identity', () => {
    const result = analyzeTlsLog('*** ClientHello, TLSv1.2\nCipher Suites: [TLS_RSA_WITH_AES_128_CBC_SHA]');
    assert.equal(result.interactions[0].threadCount, null);
    assert.equal(result.interactions[0].direction, 'unknown');
});

test('BOM and CR-only input uses the same parser path', () => {
    assert.equal(analyzeTlsLog('\uFEFF' + [client(), server(), finished()].join('\n').replaceAll('\n', '\r')).interactions[0].outcome, 'success');
});

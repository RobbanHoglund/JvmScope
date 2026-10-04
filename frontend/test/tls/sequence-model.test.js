import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { tlsObservedSequence, tlsDiagnosis, tlsCaptureCoverage, reconcileTlsSelection } from '../../assets/javautils/tls-sequence-model.js';

const line = (message, tid = 'A', time = '12:00:00.000') => `javax.net.ssl|DEBUG|${tid}|worker|2026-09-08 ${time} UTC|Handshake.java:1|${message}`;
const hello = () => line('Produced ClientHello handshake message');
const parse = (...parts) => analyzeTlsLog(parts.join('\n')).interactions;

test('structured alert events match the parser outcome, origin and exact evidence even in truncated captures', () => {
    for (const verb of ['Received', 'Produced']) {
        const [it] = parse(hello(), line(`${verb} alert message (`), '"Alert": {', '"level": "fatal",', '"description": "certificate_unknown"');
        const event = tlsObservedSequence(it).at(-1);
        assert.equal(it.outcome, 'failure');
        assert.equal(event.kind, 'failure');
        assert.equal(event.action, verb);
        assert.equal(event.title, 'Fatal alert: certificate_unknown');
        assert.match(it.rawLines[event.rawIndex], /alert message/);
        assert.equal(event.sourceLine, 2);
    }
});

test('sequences retain retries, duplicate messages and file order when clocks move backwards', () => {
    const [it] = parse(hello(), line('Consuming HelloRetryRequest handshake message'), hello(),
        line('Consuming server Finished handshake message', 'A', '11:59:59.000'), line('Consuming server Finished handshake message'));
    const events = tlsObservedSequence(it);
    assert.deepEqual(events.map(event => event.title), ['ClientHello', 'HelloRetryRequest', 'ClientHello', 'server Finished', 'server Finished']);
    assert.deepEqual(events.map(event => event.sourceLine), [1, 2, 3, 4, 5]);
    assert.equal(it.outcome, 'unknown');
    assert.match(tlsCaptureCoverage(it), /cannot be assigned reliably/);
    assert.equal(events[3].epochMillis < events[2].epochMillis, true);
});

test('interleaved thread records and body diagnostics retain physical source positions', () => {
    const text = ['application preamble', hello(), line('Produced ClientHello handshake message', 'B'),
        line('Fatal (CERTIFICATE_UNKNOWN): validation failed'), 'javax.net.ssl.SSLHandshakeException: PKIX path building failed',
        line('Received fatal alert: protocol_version', 'B')].join('\n');
    const it = analyzeTlsLog(text).interactions.find(item => item.tids.has('A'));
    const events = tlsObservedSequence(it);
    assert.equal(events[0].sourceLine, 2);
    assert.equal(events.at(-1).sourceLine, 5);
    assert.equal(it.rawLines[events.at(-1).rawIndex], text.split('\n')[4]);
});

test('expanded logger events link to their message field, not a different header field', () => {
    const text = '{\n"logger": "javax.net.ssl",\n"thread id": "A",\n"thread name": "worker",\n"time": "2026-09-08 12:00:00.000 UTC",\n"message": "Produced ClientHello handshake message"\n}';
    const [it] = parse(text);
    const [event] = tlsObservedSequence(it);
    assert.equal(event.sourceLine, 6);
    assert.match(it.rawLines[event.rawIndex], /"message":/);
});

test('post-handshake transport diagnostics stay separate from handshake failure', () => {
    const [it] = parse(hello(), line('Consuming server Finished handshake message'), line('Produced client Finished handshake message'),
        line('java.net.SocketException: Connection reset'));
    const event = tlsObservedSequence(it).at(-1);
    assert.equal(it.outcome, 'success');
    assert.equal(event.kind, 'transport');
    assert.equal(event.postHandshake, true);
    assert.equal(tlsDiagnosis(it), 'Finished exchange observed');
});

test('a received fatal alert after local completion remains a failed interaction', () => {
    const [it] = parse(hello(), line('Consuming server Finished handshake message'), line('Produced client Finished handshake message'),
        line('Received fatal alert: certificate_required'));
    assert.equal(it.outcome, 'failure');
    assert.equal(tlsObservedSequence(it).at(-1).kind, 'failure');
    assert.equal(tlsObservedSequence(it).at(-1).action, 'Received');
    assert.equal(tlsObservedSequence(it).at(-1).postHandshake, true);
});

test('certificate-selection hints stay visible without asserting a failed handshake', () => {
    const [it] = parse(hello(), line('No X.509 cert selected for EC'), line('No available authentication scheme'),
        line('Consuming server Finished handshake message'), line('Produced client Finished handshake message'));
    assert.equal(it.outcome, 'success');
    const hints = tlsObservedSequence(it).filter(event => event.kind === 'hint');
    assert.equal(hints.length, 2);
    assert.deepEqual(hints.map(event => event.sourceLine), [2, 3]);
});

test('ambiguous legacy captures never project an attributable single-connection sequence', () => {
    const [it] = parse('first, WRITE: TLSv1.2 Handshake, length = 10\n*** ClientHello, TLSv1.2\nsecond, READ: TLSv1.2 Handshake, length = 10\n*** ServerHello, TLSv1.2\n*** Finished');
    assert.equal(it.correlationQuality, 'ambiguous-legacy');
    assert.deepEqual(tlsObservedSequence(it), []);
    assert.equal(tlsDiagnosis(it), 'Grouping uncertain');
    assert.match(tlsCaptureCoverage(it), /cannot be assigned reliably/);
});

test('missing and invalid clocks are explicit; partial captures do not invent stages', () => {
    const [it] = parse(line('Produced ClientHello handshake message').replace(' UTC|', ' CST|'));
    assert.equal(tlsObservedSequence(it)[0].epochMillis, null);
    assert.equal(tlsDiagnosis(it), 'No final outcome captured');
    assert.match(tlsCaptureCoverage(it), /ServerHello: not captured/);
    assert.deepEqual(tlsObservedSequence({ rawLines: [] }), []);
});

test('selection uses object identity, survives sorting, and cannot reuse an ID from another capture', () => {
    const first = { id: 1 }, second = { id: 2 }, replacement = { id: 1 };
    assert.equal(reconcileTlsSelection(first, [second, first]), first);
    assert.equal(reconcileTlsSelection(first, [second]), null);
    assert.equal(reconcileTlsSelection(first, [replacement]), null);
    assert.equal(reconcileTlsSelection(null, [second], true), second);
    assert.equal(reconcileTlsSelection(null, [], true), null);
});

test('all Java runtime fixtures preserve complete raw records and exact source spans', () => {
    const directory = new URL('./fixtures/runtime/', import.meta.url);
    const files = readdirSync(directory).filter(name => name.endsWith('.txt'));
    assert.equal(files.length, 70);
    for (const file of files) {
        const lines = readFileSync(new URL(file, directory), 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
            .map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
        lines[0] = lines[0].replace(/^\uFEFF/, '');
        for (const it of analyzeTlsLog(lines.join('\n')).interactions) {
            for (const record of it.observedRecords) {
                assert.deepEqual(it.rawLines.slice(record.rawStart, record.rawEnd),
                    lines.slice(record.sourceStart - 1, record.sourceStart - 1 + record.rawEnd - record.rawStart), file);
            }
            for (const event of tlsObservedSequence(it)) {
                assert.equal(it.rawLines[event.rawIndex], lines[event.sourceLine - 1], file);
                assert.ok(event.rawIndex >= 0 && event.rawIndex < it.rawLines.length, file);
            }
        }
    }
});

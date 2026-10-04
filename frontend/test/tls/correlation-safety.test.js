import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { tlsObservedSequence, tlsDiagnosis, tlsCaptureCoverage } from '../../assets/javautils/tls-sequence-model.js';
import { createTlsFilters, prepareTlsAnalysis, selectTlsEntries } from '../../assets/javautils/tls-analysis-model.js';
import { explainIssueText } from '../../assets/javautils/tls-explanations.js';

const line = (msg, tid = 'A', expanded = false) => expanded
    ? `{\n"logger": "javax.net.ssl",\n"thread id": "${tid}",\n"thread name": "worker",\n"time": "2026-10-04 12:00:00.000 UTC",\n"message": "${msg}"\n}`
    : `javax.net.ssl|DEBUG|${tid}|worker|2026-10-04 12:00:00.000 UTC|Handshake.java:1|${msg}`;
const messages = ['Produced ClientHello handshake message', 'Consuming ServerHello handshake message',
    'Produced client Finished handshake message', 'Consuming server Finished handshake message'];
const parse = parts => analyzeTlsLog(parts.join('\n'));

test('two incomplete connections interleaved on one thread cannot borrow each other’s Finished', () => {
    for (const expanded of [false, true]) {
        const [client, server, produced, consumed] = messages.map(m => line(m, 'A', expanded));
        const raw = [client, client, server, server, produced, consumed];
        const result = parse(raw);
        assert.equal(result.status, 'partial');
        assert.match(result.warnings.join(' '), /connection identity is ambiguous/);
        assert.deepEqual(result.interactions.map(i => i.outcome), ['unknown', 'unknown']);
        const it = result.interactions[1];
        assert.equal(it.correlationQuality, 'ambiguous-thread');
        assert.equal(it.sawHandshakeFinished, false);
        assert.equal(it.tlsVersion, null);
        assert.equal(it.clientCertSubject, null);
        assert.equal(it.direction, 'unknown');
        assert.ok(it.warnCount > 0);
        assert.equal(tlsDiagnosis(it), 'Grouping uncertain');
        assert.match(tlsCaptureCoverage(it), /cannot be assigned reliably/);
        assert.equal(tlsObservedSequence(it).length, 5);
        assert.ok(tlsObservedSequence(it).every(event => !event.postHandshake));
        assert.ok(it.rawLines.join('\n').includes(server));
        assert.equal(it.observedRecords.length, 5);
        const visible = selectTlsEntries(prepareTlsAnalysis(result.interactions), { ...createTlsFilters(), outcome: 'success' });
        assert.equal(visible.length, 0);
    }
});

test('complete sequential connections, separate threads and HelloRetryRequest remain attributable', () => {
    const full = messages.map(m => line(m));
    assert.deepEqual(parse([...full, ...full]).interactions.map(i => i.outcome), ['success', 'success']);
    const parallel = messages.flatMap(m => [line(m,'A'), line(m,'B')]);
    assert.deepEqual(parse(parallel).interactions.map(i => i.outcome), ['success', 'success']);
    const retry = parse([full[0], line('Consuming HelloRetryRequest handshake message'), ...full]);
    assert.equal(retry.interactions.length, 1);
    assert.equal(retry.interactions[0].outcome, 'success');
});

test('contradicting Finished roles, duplicates and extra ServerHello cannot establish success', () => {
    const full = messages.map(m => line(m));
    for (const records of [[full[0],full[1],line('Produced server Finished handshake message'),full[3]],
        [...full,full[2]], [...full,full[1]]]) {
        const result = parse(records);
        assert.equal(result.interactions[0].outcome, 'unknown');
        assert.equal(result.interactions[0].correlationQuality, 'ambiguous-thread');
    }
});

test('removing a ServerHello block never proves that reset happened before it', () => {
    const [client, server] = messages.map(m => line(m));
    for (const observation of ['java.net.SocketException: Connection reset', 'java.net.SocketException: Broken pipe',
        'java.io.EOFException: SSL peer shut down incorrectly', 'Connection closed by peer']) {
        for (const hello of [[], [server]]) {
            const it = parse([client,...hello,line(observation)]).interactions[0];
            assert.equal(it.outcome,'failure');
            assert.match(it.failureReason,/phase unknown/);
            assert.doesNotMatch(it.failureReason,/before ServerHello/);
            if (!hello.length) assert.match(it.failureReason,/ServerHello not captured/);
            assert.ok(explainIssueText(it.failureReason), 'General guidance remains reachable');
            assert.equal(tlsDiagnosis(it),it.failureReason);
        }
    }
});

test('post-completion reset stays transport evidence, and explicit fatal client-auth rejection stays failure', () => {
    const full = messages.map(m => line(m));
    assert.equal(parse([...full,line('java.net.SocketException: Connection reset')]).interactions[0].outcome,'success');
    assert.equal(parse([...full,line('Received fatal alert: certificate_required')]).interactions[0].outcome,'failure');
});

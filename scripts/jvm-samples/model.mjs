import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, renameSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { analyzeThreadDumpData } from '../../frontend/assets/javautils/tda/analysis.js';
import { buildThreadDependencyGraph } from '../../frontend/assets/javautils/tda/dependency-graph.js';
import { analyzeTlsLog } from '../../frontend/assets/javautils/tls-parser.js';

export const ROOT = resolve(import.meta.dirname, '../..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = path => JSON.parse(readFileSync(path, 'utf8'));
export const manifest = json(join(ROOT, 'tools/jvm-samples/matrix.json'));
export function saveJson(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export function safeFile(root, path) {
    assert.equal(typeof path, 'string');
    assert.match(path, /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/);
    assert.ok(!path.split('/').some(part => ['..', '.', ''].includes(part)), 'Unsafe relative path');
    assert.ok(!path.split('/').some(part => /\.$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)), 'Unsafe Windows filename');
    const target = resolve(root, path), rel = relative(resolve(root), target);
    assert.ok(rel && !rel.startsWith('..') && !rel.includes(':') && !rel.startsWith(sep));
    for (let current = target; current !== resolve(root); current = resolve(current, '..')) {
        if (existsSync(current)) assert.ok(!lstatSync(current).isSymbolicLink(), 'Symlinks are not accepted in evidence');
    }
    if (existsSync(root)) assert.ok(!lstatSync(root).isSymbolicLink());
    return target;
}
export function selection(input, allowed, label) {
    if (input === 'all') return [...allowed];
    const values = [...new Set(String(input).split(',').map(v => v.trim()))];
    assert.ok(values.length && values.every(v => allowed.map(String).includes(v)), `Unknown ${label}: ${input}`);
    return values.map(v => allowed.find(a => String(a) === v));
}
function tlsDiagnosticFamily(interaction, oracle) {
    const reason = String(interaction.failureReason || '');
    const alertMatch = reason.match(/Fatal\s+\(([A-Z_]+)\)|(?:Received|Sent) fatal alert:\s*([a-z_]+)/i);
    const alert = (alertMatch?.[1] || alertMatch?.[2] || '').toLowerCase();
    if (alert && !['certificate_unknown', 'unknown_ca', 'certificate_required', 'bad_certificate',
        'handshake_failure', 'unexpected_message'].includes(alert)) return 'other';
    if (/PKIX path building failed|unable to find valid certification path|\b(?:certificate_unknown|unknown_ca)\b/i.test(reason)) return 'trust';
    if (/empty (?:client |server )?certificate chain|\b(?:certificate_required|bad_certificate)\b/i.test(reason)) return 'client-auth';
    if (/broken pipe|connection reset|unexpected EOF|peer closed connection/i.test(reason)
        || /^Fatal \(HANDSHAKE_FAILURE\): Couldn't kickstart handshaking/i.test(reason)
        // Some SunJSSE releases wrap an OS socket abort in a local alert. The
        // independent endpoint exception must confirm that this was transport.
        || (/SocketException$/.test(oracle.exception)
            && /^(?:Fatal \(UNEXPECTED_MESSAGE\):|Sent fatal alert: unexpected_message)/i.test(reason))) return 'remote-abort';
    if (/^Received fatal alert: handshake_failure$/i.test(reason)) return 'remote-rejection';
    return 'other';
}
function validateTlsFailureRole(interaction, expected, oracle, runtime) {
    const expectedDirection = expected.side === 'client' ? 'outbound' : 'inbound';
    assert.equal(interaction.direction, expectedDirection, 'TLS endpoint side contradicts the observed ClientHello direction');
    const rejectingLocally = expected.scenario === 'untrusted' ? expected.side === 'client' : expected.side === 'server';
    const expectedOrigin = rejectingLocally ? 'local' : 'remote';
    const evidence = [...new Set([interaction.failureReason,
        ...interaction.failureEvidence.filter(item => item.promotesHandshakeFailure).map(item => item.text)].filter(Boolean))];
    let matchingOrigin = false;
    for (const text of evidence) {
        const family = tlsDiagnosticFamily({ failureReason: text }, oracle);
        // A receiver can record a local OS/socket abort while the rejecting peer
        // reports the certificate cause. Keep the independent transport oracle.
        if (family === 'remote-abort') continue;
        const received = /\bReceived fatal alert:/i.test(text);
        const sent = /\bSent fatal alert:/i.test(text);
        const fatal = /\bFatal\s*\(([A-Z_]+)\)/i.test(text);
        const alert = text.match(/Fatal\s*\(([A-Z_]+)\)|(?:Received|Sent) fatal alert:\s*([a-z_]+)/i);
        if (alert) assert.ok(['certificate_unknown', 'unknown_ca', 'certificate_required', 'bad_certificate', 'handshake_failure']
            .includes((alert[1] || alert[2]).toLowerCase()), 'Contradictory TLS failure alert');
        const localCause = /PKIX path building failed|unable to find valid certification path|empty (?:client |server )?certificate chain|null cert chain/i.test(text);
        const origin = received ? 'remote' : sent || fatal || localCause ? 'local' : null;
        if (origin) {
            assert.equal(origin, expectedOrigin, `Wrong TLS failure origin for ${expected.scenario}/${expected.side}: ${text}`);
            matchingOrigin = true;
        }
        if (/empty server certificate chain/i.test(text)) {
            // Older OpenJDK T12CertificateConsumer server overloads use this
            // misleading wording for an absent *client* chain. Limit the
            // accommodation to runtime-attested SunJSSE 8–22 / TLS 1.2 evidence.
            const major = Number((runtime?.['java.runtime.version'] || '').replace(/^1\./, '').match(/^\d+/)?.[0]);
            const legacyClientAuthWording = expected.scenario === 'required-client-auth' && expected.side === 'server'
                && expected.protocol === 'TLSv1.2' && interaction.tlsVersion === 'TLSv1.2' && major >= 8 && major <= 22
                && /^SunJSSE(?:\s|$)/.test(runtime?.provider || '')
                && oracle.message === 'Empty server certificate chain'
                && interaction.observedRecords.some(record => /^Produced CertificateRequest\b/.test(record.message))
                && interaction.observedRecords.some(record => /^Consuming client Certificate\b/.test(record.message)
                    && /"Certificates"\s*:\s*<empty list>/.test(interaction.rawLines.slice(record.rawStart, record.rawEnd).join('\n')))
                && evidence.some(message => /^Fatal \(BAD_CERTIFICATE\): Empty server certificate chain\b/i.test(message));
            assert.ok(legacyClientAuthWording, 'Wrong TLS certificate role: server certificate absence is not client-authentication evidence');
        }
    }
    assert.ok(matchingOrigin || tlsDiagnosticFamily(interaction, oracle) === 'remote-abort', 'Missing TLS failure origin evidence');
}
export function validateCase(item, directory, runtime) {
    assert.ok(['tda', 'tls'].includes(item.analyzer));
    assert.ok(item.expected && typeof item.expected === 'object', 'Missing independent workload oracle');
    const raw = readFileSync(safeFile(directory, item.file));
    assert.equal(sha256(raw), item.sha256, `Changed capture: ${item.file}`);
    assert.equal(raw.length, item.bytes, `Changed byte count: ${item.file}`);
    const text = raw.toString('utf8'), e = item.expected;
    if (item.analyzer === 'tls') {
        assert.ok(['success', 'untrusted', 'mutual', 'optional-client-auth', 'required-client-auth', 'resumption'].includes(e.scenario));
        assert.ok(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'].includes(e.protocol));
        assert.ok(['client', 'server'].includes(e.side), 'Missing or invalid endpoint side');
        const expectedCount = e.scenario === 'resumption' ? 2 : 1;
        assert.equal(e.results.length, expectedCount, 'Workload did not complete all requested connections');
        const failure = ['untrusted', 'required-client-auth'].includes(e.scenario);
        assert.ok(e.results.every(r => r.outcome === (failure ? 'failure' : 'success')), 'Wrong workload outcome');
        if (failure) assert.ok(e.results.every(r => /(?:SSL(?:Handshake)?Exception|SocketException)/.test(r.exception)), 'Unexpected failure kind');
        if (e.scenario === 'untrusted' && e.side === 'client') assert.ok(e.results.every(r => /cert|PKIX|trust/i.test(r.message)), 'Expected a trust-validation failure');
        const parsed = analyzeTlsLog(text);
        assert.equal(parsed.status, 'success');
        assert.equal(parsed.interactions.length, expectedCount, 'Handshake correlation changed');
        for (const [index, it] of parsed.interactions.entries()) {
            assert.equal(it.outcome, failure ? 'failure' : 'success');
            if (failure) {
                const family = tlsDiagnosticFamily(it, e.results[index]);
                const allowed = e.scenario === 'untrusted'
                    ? (e.side === 'client' ? ['trust'] : ['trust', 'remote-abort', 'remote-rejection'])
                    : (e.side === 'server' ? ['client-auth'] : ['client-auth', 'remote-abort', 'remote-rejection']);
                assert.ok(allowed.includes(family), `Wrong TLS diagnostic family for ${e.scenario}/${e.side}: ${it.failureReason || 'missing'}`);
                validateTlsFailureRole(it, e, e.results[index], runtime);
            } else {
                assert.equal(it.tlsVersion, e.protocol);
                assert.equal(it.cipherSuite, e.results[index].cipher);
            }
            if (['mutual', 'optional-client-auth', 'required-client-auth'].includes(e.scenario)) {
                assert.ok(it.sawCertRequest, 'Missing captured CertificateRequest');
                assert.ok(it.sawProducedClientCertificate, 'Missing captured client Certificate message');
                if (e.scenario === 'mutual') assert.ok(it.clientCertSubject && !it.clientCertificateEmpty, 'Missing presented client certificate');
                else {
                    assert.ok(!it.clientCertSubject, 'Expected an absent client certificate');
                    if (e.protocol === 'TLSv1.3') assert.ok(it.clientCertificateEmpty, 'Missing explicit empty client certificate list');
                }
            }
            assert.ok(it.rawLines.length && text.replaceAll('\r\n', '\n').includes(it.rawLines.join('\n')), 'Raw evidence mapping changed');
        }
        return { interactions: parsed.interactions.length, outcome: failure ? 'failure' : 'success' };
    }
    assert.ok(['classic-sequence', 'file-plain', 'file-json', 'virtual-json', 'json-v1'].includes(e.scenario));
    const analysis = analyzeThreadDumpData(text);
    assert.equal(analysis.parserResult.status, 'success');
    assert.equal(analysis.parsedDumps.length, e.snapshots);
    assert.ok(Array.isArray(e.threads) && e.threads.length, 'Empty workload oracle');
    for (const dump of analysis.parsedDumps) {
        for (const observed of e.threads) {
            const matches = dump.threads.filter(t => t.threadName === observed.name);
            assert.equal(matches.length, 1, `Missing/ambiguous workload thread: ${observed.name}`);
            const t = matches[0];
            if (e.scenario === 'classic-sequence' || t.javaState) assert.equal(t.javaState, observed.state);
            if (e.scenario === 'virtual-json' && observed.virtualRequired) assert.equal(t.isVirtualThread, true);
            assert.ok(t.stackFrames > 0, `Empty stack: ${observed.name}`);
            if (e.scenario !== 'classic-sequence') {
                assert.equal(t.cpuMs ?? null, null, 'File dumps must not invent CPU counters');
                assert.equal(t.cpuRatePercent, null, 'File dumps must not invent CPU rates');
            }
        }
        if (e.scenario === 'classic-sequence') {
            assert.equal(e.deadlocked.length, 2, 'Workload JVM did not independently confirm the deadlock');
            for (const name of e.deadlocked) assert.equal(dump.threads.find(t => t.threadName === name)?.isDeadlocked, true);
            const graph = buildThreadDependencyGraph(dump.threads, dump.deadlocks);
            assert.ok(graph.metrics.confirmedDeadlockCycleCount >= 1);
            // Exercise the same dependency graph consumed by the UI, with MXBean ownership as oracle.
            for (const name of ['matrix-monitor-waiter', 'matrix-lock-waiter']) {
                const observed = e.threads.find(t => t.name === name);
                assert.ok(observed.lockOwner, 'Workload did not establish ownership');
                const waiter = graph.threadNodes.find(t => t.threadName === name);
                const owner = graph.threadNodes.find(t => t.threadName === observed.lockOwner);
                assert.ok(graph.dependencyEdges.some(edge => edge.source === waiter.id && edge.target === owner.id), `Missing owner relation: ${name}`);
            }
        }
    }
    if (e.scenario === 'classic-sequence') {
        const hot = analysis.parsedDumps.map(d => d.threads.find(t => t.threadName === 'matrix-cpu-hot'));
        assert.ok(hot.slice(1).every(t => t.seriesMatchStatus === 'matched'), 'Snapshot correlation failed');
        assert.equal(hot[0].cpuDeltaMs, null);
        if (hot.every(t => t.cpuMs != null)) assert.ok(hot.slice(1).every(t => t.cpuDeltaMs > 0 && t.cpuRatePercent > 0), 'CPU workload not measured across snapshots');
        else assert.ok(hot.every(t => t.cpuRatePercent === null), 'Missing counters must remain unavailable');
    }
    return { snapshots: analysis.parsedDumps.length, workloadThreads: e.threads.length };
}
export function checkReport(report, directory) {
    assert.equal(report.schemaVersion, 1);
    assert.match(report.id, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/);
    assert.ok(manifest.versions.includes(report.major));
    assert.ok(manifest.distributions.includes(report.distribution));
    assert.ok(['complete', 'partial', 'capture-error', 'unavailable', 'discovery-error', 'incomplete'].includes(report.status));
    assert.ok(Number.isFinite(Date.parse(report.capturedAt)));
    assert.ok(Array.isArray(report.cases));
    const ids = new Set();
    for (const item of report.cases) {
        assert.ok(!ids.has(item.id), 'Duplicate case ID'); ids.add(item.id);
        assert.ok(['verified', 'validation-error', 'capture-error', 'unsupported-format', 'unavailable'].includes(item.status));
        if (item.status === 'verified') {
            assert.ok(report.runtime?.['java.runtime.version'] && report.runtime?.['java.vm.name']);
            const actualMajor = Number(report.runtime['java.runtime.version'].replace(/^1\./, '').match(/^\d+/)?.[0]);
            assert.equal(actualMajor, report.major, 'Evidence runtime does not match the declared Java major');
            if (report.package) {
                assert.equal(report.package.major_version, report.major, 'Evidence package does not match the declared Java major');
                assert.equal(report.package.release_status, 'ga', 'Only GA packages belong in this evidence matrix');
                assert.ok(!/-ea\b/.test(report.runtime['java.runtime.version']), 'GA package reported an EA runtime');
            }
            if (item.analyzer === 'tls') assert.match(report.runtime.provider, /^SunJSSE(?:\s|$)/, 'TLS evidence must identify the supported provider');
            else assert.ok(!/openj9|j9 vm/i.test(report.runtime['java.vm.name']), 'Javacore is outside the TDA parser scope');
            validateCase(item, directory, report.runtime);
        }
    }
    if (report.status === 'complete') assert.ok(report.cases.length && report.cases.every(c => ['verified', 'unavailable', 'unsupported-format'].includes(c.status)));
    return report;
}
export function readLedger(root = ROOT) {
    const directory = join(root, 'testdata/jvm-samples');
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => {
        const report = json(safeFile(directory, name));
        assert.equal(name, report.id + '.json', 'Ledger filename must match the immutable report ID');
        return { report, directory };
    });
}
const escape = value => String(value ?? '—').replaceAll('|', '\\|').replace(/[\u0000-\u001f\u007f]/g, ' ');
export function renderMatrix(records) {
    const lines = ['<!-- JVM-SAMPLES:START -->', '### Automated capture evidence', '',
        'Generated from imported, revalidated captures. Counts cover exact builds and scenarios,',
        'not all patch releases, operating systems or vendors. Earlier fixtures are listed below.', '',
        '| Java | TDA verified cases | TLS verified cases | TDA distributions | TLS distributions |',
        '| --- | ---: | ---: | --- | --- |'];
    for (const major of manifest.versions) {
        const reports = records.filter(({ report }) => report.major === major).map(({ report }) => report);
        const verified = reports.flatMap(r => r.cases.filter(c => c.status === 'verified'));
        const count = a => verified.filter(c => c.analyzer === a).length || 'Unverified';
        const distributions = analyzer => {
            const vendors = [...new Set(reports.filter(r => r.cases.some(c => c.status === 'verified' && c.analyzer === analyzer)).map(r => r.distribution))].sort();
            return vendors.length > 4 ? `[${vendors.length} distributions](docs/JVM-SAMPLE-RESULTS.md)` : vendors.join(', ') || 'Unverified';
        };
        lines.push(`| ${major} | ${count('tda')} | ${count('tls')} | ${distributions('tda')} | ${distributions('tls')} |`);
    }
    lines.push('', '[Exact builds, providers, formats and unsuccessful attempts](docs/JVM-SAMPLE-RESULTS.md).',
        '[Run or import the manual capture workflow](docs/JVM-SAMPLES.md).', '<!-- JVM-SAMPLES:END -->');
    return lines.join('\n');
}
export function renderResults(records) {
    const lines = ['# JVM sample evidence', '', 'Generated by `node scripts/jvm-samples.mjs render`. Do not edit the rows manually.',
        'Only verified cases are stored as permanent fixtures. Failed/raw captures remain in workflow artifacts.',
        'A failed later attempt does not remove older verified evidence. The README counts all retained cases.',
        'One row per capture attempt. The linked JSON retains every case, oracle, status, command and hash;',
        'fixture folders contain the verified raw files. Complete collection does not imply support for every format.', '',
        '| Capture / provenance | Java | Distribution | Actual runtime / VM | Platform | Provider | TDA cases | TLS cases | Status / detail |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
    for (const { report: r } of records) {
        const counts = analyzer => {
            const cases = r.cases.filter(c => c.analyzer === analyzer);
            return ['verified', 'unsupported-format', 'unavailable', 'capture-error', 'validation-error']
                .map(status => [status, cases.filter(c => c.status === status).length])
                .filter(([, count]) => count).map(([status, count]) => `${count} ${status}`).join('; ') || '—';
        };
        const runtime = `${r.runtime?.['java.runtime.version'] || r.package?.java_version || 'Unavailable'} / ${r.runtime?.['java.vm.name'] || '—'}`;
        const platform = `${r.runtime?.['os.name'] || '—'} ${r.runtime?.['os.arch'] || ''}`;
        const problem = r.error || r.cases.find(c => ['capture-error', 'validation-error'].includes(c.status))?.error;
        const preview = problem ? escape(problem).slice(0, 220) : '';
        const evidence = r.cases.some(c => c.status === 'verified') ? `[fixtures](../testdata/jvm-samples/${r.id}/)` : '';
        const detail = [r.status, preview, evidence].filter(Boolean).join(' · ');
        lines.push(`| [${escape(r.id)}](../testdata/jvm-samples/${r.id}.json) | ${r.major} | ${escape(r.distribution)} | ${escape(runtime)} | ${escape(platform)} | ${escape(r.runtime?.provider)} | ${counts('tda')} | ${counts('tls')} | ${detail} |`);
    }
    if (!records.length) lines.push('', 'No captures from the new workflow have been imported yet. Existing runtime fixtures remain in their original test suites.');
    return lines.join('\n') + '\n';
}
export function render(root = ROOT, check = false) {
    const records = readLedger(root);
    for (const { report, directory } of records) checkReport(report, directory);
    const readmePath = join(root, 'README.md'), readme = readFileSync(readmePath, 'utf8').replaceAll('\r\n', '\n');
    const markers = /<!-- JVM-SAMPLES:START -->[\s\S]*?<!-- JVM-SAMPLES:END -->/g;
    assert.equal([...readme.matchAll(markers)].length, 1, 'README requires exactly one generated matrix block');
    const files = [[readmePath, readme.replace(markers, renderMatrix(records))], [join(root, 'docs/JVM-SAMPLE-RESULTS.md'), renderResults(records)]];
    for (const [path, content] of files) {
        if (check) assert.equal(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'), content, `${relative(root, path)} is stale; run the render command`);
        else writeFileSync(path, content);
    }
    return records;
}
export function importBundle(bundle, root = ROOT) {
    const aggregate = json(safeFile(bundle, 'summary.json'));
    assert.equal(aggregate.schemaVersion, 1);
    assert.ok(Array.isArray(aggregate.reports) && aggregate.reports.length, 'No reports to import');
    const destination = join(root, 'testdata/jvm-samples'), staged = new Map();
    safeFile(root, 'testdata/jvm-samples');
    for (const { report, directory } of readLedger(root)) checkReport(report, directory);
    assert.equal([...readFileSync(join(root, 'README.md'), 'utf8').matchAll(/<!-- JVM-SAMPLES:START -->[\s\S]*?<!-- JVM-SAMPLES:END -->/g)].length, 1, 'README requires exactly one generated matrix block');
    const stage = (path, bytes) => {
        const target = safeFile(destination, path);
        if (existsSync(target)) assert.equal(sha256(readFileSync(target)), sha256(bytes), `Conflicting immutable evidence: ${path}`);
        if (staged.has(path)) assert.equal(sha256(staged.get(path)), sha256(bytes), `Duplicate conflicting evidence: ${path}`);
        staged.set(path, bytes);
    };
    // Validate the entire bundle before any repository write. Partial run statuses are retained.
    for (const entry of aggregate.reports) {
        const reportPath = safeFile(bundle, entry);
        const directory = resolve(reportPath, '..');
        const report = checkReport(json(reportPath), directory);
        const imported = structuredClone(report);
        for (const c of imported.cases) {
            if (c.status !== 'verified') { delete c.file; continue; }
            const bytes = readFileSync(safeFile(directory, c.file));
            c.file = `${report.id}/${c.file}`; stage(c.file, bytes);
        }
        stage(`${report.id}.json`, Buffer.from(JSON.stringify(imported, null, 2) + '\n'));
    }
    mkdirSync(destination, { recursive: true });
    for (const [path, bytes] of staged) {
        const target = safeFile(destination, path);
        if (existsSync(target)) continue;
        mkdirSync(resolve(target, '..'), { recursive: true });
        const temporary = `${target}.pending`;
        if (existsSync(temporary)) assert.equal(sha256(readFileSync(temporary)), sha256(bytes), `Conflicting interrupted write: ${path}`);
        else writeFileSync(temporary, bytes, { flag: 'wx' });
        renameSync(temporary, target);
    }
    // Interrupted imports are retryable: existing bytes must match and documentation is regenerated.
    render(root);
    return aggregate.reports.length;
}

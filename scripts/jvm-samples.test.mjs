import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ROOT, sha256, saveJson, safeFile, selection, validateCase, checkReport, importBundle, render, renderMatrix, renderResults } from './jvm-samples/model.mjs';
import { choosePackage, boundMatrix, discover, aggregate, download } from './jvm-samples/discovery.mjs';
import { analyzeThreadDump } from '../frontend/assets/javautils/tda/parser.js';
import { readReadyPort } from './jvm-samples/port-file.mjs';
import { sampleEnvironment } from './sample-environment.mjs';

function temporary(t) {
    const directory = mkdtempSync(join(tmpdir(), 'jvmscope-pipeline-test-'));
    t.after(() => {
        assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
        rmSync(directory, { recursive: true, force: true });
    });
    return directory;
}
function scaffold(t) {
    const root = temporary(t); mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'README.md'), '# Test\n<!-- JVM-SAMPLES:START -->\n<!-- JVM-SAMPLES:END -->\n');
    render(root); return root;
}
function bundle(t, cases = []) {
    const path = temporary(t);
    const report = { schemaVersion: 1, id: 'test-temurin-25-all', major: 25, distribution: 'temurin', status: 'partial',
        capturedAt: '2026-10-04T10:00:00Z', cases };
    saveJson(join(path, 'temurin-25/report.json'), report);
    saveJson(join(path, 'summary.json'), { schemaVersion: 1, reports: ['temurin-25/report.json'] });
    return { path, report };
}
test('selection rejects typos, ranges and empty selectors instead of silently skipping JVMs', () => {
    assert.deepEqual(selection('7,8,7', [7, 8], 'versions'), [7, 8]);
    assert.deepEqual(selection('all', [7, 8], 'versions'), [7, 8]);
    for (const value of ['', 'all,7', '7-27', '28', '7,']) assert.throws(() => selection(value, [7, 8], 'versions'));
});
test('package resolution excludes EA, musl, JavaFX, JRE and wrong vendor/version/platform', () => {
    const valid = { id: 'a', java_version: '25.0.2+9', major_version: 25, distribution: 'temurin', release_status: 'ga',
        operating_system: 'linux', architecture: 'x64', lib_c_type: 'glibc', archive_type: 'tar.gz', package_type: 'jdk', directly_downloadable: true, javafx_bundled: false };
    const variants = [{ release_status: 'ea' }, { lib_c_type: 'musl' }, { package_type: 'jre' }, { operating_system: 'windows' },
        { major_version: 26 }, { distribution: 'zulu' }, { javafx_bundled: true }, { directly_downloadable: false },
        { architecture: 'aarch64' }, { architecture: 'x86' }].map(change => ({ ...valid, ...change, java_version: '999' }));
    const latest = { ...valid, id: 'b', java_version: '25.0.10+1' };
    assert.deepEqual(choosePackage([valid, latest, ...variants], 25, 'temurin'), latest);
    assert.equal(choosePackage(variants, 25, 'temurin'), undefined);
    for (const architecture of ['amd64', 'x86_64']) assert.deepEqual(choosePackage([{ ...valid, architecture }], 25, 'temurin'), { ...valid, architecture });
});
test('a catalog timeout/schema/checksum error is distinct from a missing package', async () => {
    const plan = await discover({ versions: '7', vendors: 'temurin,zulu', material: 'all', runId: 'test', sourceCommit: 'abc', fetcher: async url => ({
        ok: true, json: async () => url.includes('distribution=temurin') ? { result: [] } : { result: [{ invalid: 'record' }] },
    }) });
    assert.equal(plan.entries[0].status, 'unavailable');
    assert.equal(plan.entries[1].status, 'discovery-error');
    const broken = await discover({ versions: '7', vendors: 'zulu', runId: 'test', sourceCommit: 'abc', fetcher: async () => ({ ok: true, json: async () => ({}) }) });
    assert.equal(broken.entries[0].status, 'discovery-error');
    assert.equal(broken.matrix.length, 0);
});
test('matrix overflow is an error, never truncated compatibility claims', () => {
    assert.equal(boundMatrix(Array.from({ length: 256 }, (_, i) => ({ key: String(i) }))).length, 256);
    assert.throws(() => boundMatrix(Array.from({ length: 257 }, () => ({ key: 'a' }))), /256/);
});
test('aggregate records missing runtime jobs and rejects artifacts from a different revision', t => {
    const directory = temporary(t), entries = [{ key: 'temurin-25', major: 25, distribution: 'temurin', status: 'available' },
        { key: 'zulu-7', major: 7, distribution: 'zulu', status: 'unavailable', error: 'Unavailable' }];
    const plan = { runId: 'test', material: 'all', sourceCommit: 'abc', discoveredAt: '2026-10-04T10:00:00Z', entries };
    aggregate(plan, directory);
    const reportPath = join(directory, 'temurin-25/report.json');
    const report = JSON.parse(readFileSync(reportPath));
    assert.equal(report.status, 'incomplete');
    report.sourceCommit = 'another-commit'; saveJson(reportPath, report);
    assert.throws(() => aggregate(plan, directory), /source revision/);
});
test('evidence paths reject absolute paths, traversal, empty segments and symlinks', t => {
    const root = temporary(t);
    for (const path of ['/x', '../x', 'a/../x', 'a//x', 'C:/x', 'a/./x', 'a\\x', 'a/NUL.txt', 'a/CON', 'trailing.']) assert.throws(() => safeFile(root, path));
    assert.equal(safeFile(root, 'a/file.txt'), join(root, 'a/file.txt'));
    if (process.platform !== 'win32') {
        symlinkSync(temporary(t), join(root, 'linked'), 'dir');
        assert.throws(() => safeFile(root, 'linked/file.txt'), /Symlinks/);
    }
});
test('corrupt or semantically wrong captures abort the entire import before repository writes', t => {
    const root = scaffold(t), raw = Buffer.from('not a TLS log');
    const c = { analyzer: 'tls', id: 'bad', file: 'bad.txt', status: 'verified', bytes: raw.length, sha256: sha256(raw),
        expected: { protocol: 'TLSv1.2', scenario: 'success', side: 'client', results: [{ outcome: 'success', cipher: 'fake' }] } };
    const b = bundle(t, [c]); b.report.runtime = { 'java.runtime.version': '25+36', 'java.vm.name': 'OpenJDK 64-Bit Server VM', provider: 'SunJSSE 25.0' };
    saveJson(join(b.path, 'temurin-25/report.json'), b.report);
    writeFileSync(join(b.path, 'temurin-25/bad.txt'), raw);
    assert.throws(() => importBundle(b.path, root), /success/);
    assert.equal(existsSync(join(root, 'testdata/jvm-samples')), false);
    assert.throws(() => validateCase({ ...c, sha256: '0'.repeat(64) }, join(b.path, 'temurin-25')), /Changed capture/);
});

test('valid hashes cannot turn protocol errors or generic alerts into trust-validation evidence', t => {
    const directory = temporary(t);
    const expected = { protocol: 'TLSv1.2', scenario: 'untrusted', side: 'client', results: [
        { outcome: 'failure', exception: 'javax.net.ssl.SSLHandshakeException', message: 'PKIX path building failed' },
    ] };
    const record = m => `javax.net.ssl|DEBUG|A|worker|2026-10-04 12:00:00.000 UTC|Test.java:1|${m}`;
    const validate = (reason, side = 'client') => {
        const raw = Buffer.from([record('Produced ClientHello handshake message'), record(reason)].join('\n'));
        writeFileSync(join(directory, 'test.log'), raw);
        return validateCase({ analyzer: 'tls', file: 'test.log', bytes: raw.length, sha256: sha256(raw), expected: { ...expected, side } }, directory);
    };
    for (const reason of ['Received fatal alert: protocol_version', 'Received fatal alert: handshake_failure',
        'Received fatal alert: bad_certificate', 'Fatal (PROTOCOL_VERSION): PKIX path building failed',
        'Received fatal alert: protocol_version\n' + record('java.net.SocketException: Connection reset')]) assert.throws(() => validate(reason), /diagnostic family/);
    assert.equal(validate('Fatal (CERTIFICATE_UNKNOWN): PKIX path building failed').outcome, 'failure');
    assert.equal(validate('Received fatal alert: certificate_unknown', 'server').outcome, 'failure');
    assert.equal(validate('java.net.SocketException: Connection reset', 'server').outcome, 'failure');
    assert.throws(() => validate('Received fatal alert: protocol_version', 'server'), /diagnostic family/);
    assert.throws(() => validate('java.net.SocketException: Connection reset'), /diagnostic family/);
});

test('client authentication scenarios require captured requests and the expected certificate presence', t => {
    const directory = join(ROOT, 'testdata/jvm-samples');
    const report = JSON.parse(readFileSync(join(directory, 'gh-37178210582-1-temurin-17-all.json'), 'utf8'));
    const find = scenario => report.cases.find(c => c.status === 'verified' && c.analyzer === 'tls' && c.expected.scenario === scenario && c.expected.side === 'client');
    const mutual = find('mutual'), success = find('success');
    validateCase(mutual, directory);
    assert.throws(() => validateCase({ ...success, expected: { ...success.expected, scenario: 'mutual' } }, directory), /CertificateRequest/);
    assert.throws(() => validateCase({ ...mutual, expected: { ...mutual.expected, scenario: 'optional-client-auth' } }, directory), /absent client certificate/);
    assert.throws(() => validateCase({ ...mutual, expected: { ...mutual.expected, side: 'other' } }, directory), /endpoint side/);
    const empty = report.cases.find(c => c.status === 'verified' && c.expected?.scenario === 'optional-client-auth'
        && c.expected.side === 'client' && c.expected.protocol === 'TLSv1.3');
    validateCase(empty, directory);
    const raw = Buffer.from(readFileSync(safeFile(directory, empty.file), 'utf8').replace(/"certificate_list"\s*:\s*\[\s*\]/g, ''));
    const altered = temporary(t);
    writeFileSync(join(altered, 'missing-body.log'), raw);
    assert.throws(() => validateCase({ ...empty, file: 'missing-body.log', sha256: sha256(raw), bytes: raw.length }, altered), /explicit empty client certificate list/);
});
test('imports are idempotent, conflicting IDs fail, partial reports retain old evidence and docs drift fails CI', t => {
    const root = scaffold(t), b = bundle(t, [{ id: 'failed', analyzer: 'tda', status: 'capture-error', error: 'timeout' }]);
    importBundle(b.path, root); const readme = readFileSync(join(root, 'README.md'), 'utf8');
    importBundle(b.path, root); assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), readme);
    assert.match(readFileSync(join(root, 'docs/JVM-SAMPLE-RESULTS.md'), 'utf8'), /capture-error/);
    b.report.cases[0].error = 'changed'; saveJson(join(b.path, 'temurin-25/report.json'), b.report);
    assert.throws(() => importBundle(b.path, root), /Conflicting immutable evidence/);
    writeFileSync(join(root, 'README.md'), readme.replace('| 25 | Unverified', '| 25 | 100'));
    assert.throws(() => render(root, true), /stale/);
});
test('an empty complete report and duplicate cases cannot become evidence', t => {
    const b = bundle(t);
    assert.throws(() => checkReport({ ...b.report, status: 'complete' }, b.path));
    assert.throws(() => checkReport({ ...b.report, cases: [{ id: 'same', status: 'capture-error' }, { id: 'same', status: 'capture-error' }] }, b.path), /Duplicate/);
    assert.match(renderMatrix([{ report: b.report }]), /\| 25 \| Unverified \| Unverified \| Unverified \|/);
});
test('Java 7/8 JNI global references footer closes VM thread blocks without hiding truncated Java threads', () => {
    const vm = '"VM Periodic Task Thread" os_prio=2 tid=0x123 nid=0x456 waiting on condition\n\n';
    for (const footer of ['JNI global refs: 4', 'JNI global references: 4']) {
        const result = analyzeThreadDump('2026-10-04 10:00:00\nFull thread dump OpenJDK 64-Bit Server VM (25.504-b01 mixed mode):\n\n' + vm + footer);
        assert.equal(result.status, 'success');
        assert.equal(result.diagnostics.headerOnlyVmThreads, 1);
        assert.ok(result.snapshots[0].parsedThreads[0].rawBlock.every(line => !line.includes('JNI global')));
        assert.equal(analyzeThreadDump('"unfinished" #1 prio=5 os_prio=0 tid=0x123 nid=0x456 runnable [0x789]\n' + footer).status, 'partial');
    }
});
test('Java 7 native VM priorities do not make complete dumps partial; ordinary missing stacks still do', () => {
    for (const name of ['VM Thread', 'VM Periodic Task Thread', 'GC task thread#0 (ParallelGC)']) {
        const header = `"${name}" prio=10 tid=0x123 nid=0x456 runnable\n\nJNI global references: 4\n`;
        const parsed = analyzeThreadDump(header);
        assert.equal(parsed.status, 'success'); assert.equal(parsed.snapshots[0].parsedThreads[0].javaState, null);
    }
    for (const header of ['"ordinary-worker" prio=10 tid=0x123 nid=0x456 runnable', '"VM Thread" #1 prio=10 tid=0x123 nid=0x456 runnable [0x789]']) {
        assert.equal(analyzeThreadDump(header + '\n\nJNI global references: 4\n').status, 'partial');
    }
});
test('archive checksum mismatches and HTTP redirects cannot produce installation provenance', async t => {
    const bytes = Buffer.from('archive bytes');
    const makeEntry = checksum => ({ status: 'available', package: { id: 'package', direct_download_uri: 'https://publisher.example/jdk', checksum_type: 'sha256', checksum } });
    const wrongRoot = temporary(t);
    await assert.rejects(download(makeEntry('0'.repeat(64)), wrongRoot, async () => new Response(bytes)), /checksum mismatch/);
    assert.equal(existsSync(join(wrongRoot, 'download.json')), false);
    const good = await download(makeEntry(sha256(bytes)), temporary(t), async () => new Response(bytes));
    assert.equal(good.provenance.archiveSha256, sha256(bytes));
    assert.equal(good.provenance.verification, 'HTTPS plus catalog checksum');
    await assert.rejects(download(makeEntry(sha256(bytes)), temporary(t), async () => new Response(null, { status: 302, headers: { location: 'http://publisher.example/jdk' } })), /HTTPS/);
});
test('an interrupted matching pending write can be retried without losing older imported results', t => {
    const root = scaffold(t), b = bundle(t, [{ id: 'failed', analyzer: 'tda', status: 'capture-error', error: 'timeout' }]);
    const dir = join(root, 'testdata/jvm-samples'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, b.report.id + '.json.pending'), JSON.stringify(b.report, null, 2) + '\n');
    importBundle(b.path, root);
    assert.equal(existsSync(join(dir, b.report.id + '.json')), true);
    assert.equal(existsSync(join(dir, b.report.id + '.json.pending')), false);
    render(root, true);
});
test('TLS readiness rejects an empty or partly written port line, including a plausible decimal prefix', t => {
    const path = join(temporary(t), 'port.txt');
    assert.equal(readReadyPort(path), null);
    for (const value of ['', '2', '2387', '23873', '0\n', '65536\n', 'abc\n', '23873\n9999\n']) {
        writeFileSync(path, value); assert.equal(readReadyPort(path), null);
    }
    for (const value of ['23873\n', '23873\r\n']) { writeFileSync(path, value); assert.equal(readReadyPort(path), 23873); }
});
test('sample child environments retain OS prerequisites and exclude CI secrets and injected JVM options', () => {
    const safe = sampleEnvironment({ Path: '/bin', HOME: '/runner', SystemRoot: 'C:/Windows', TMP: '/temp',
        ACTIONS_RUNTIME_TOKEN: 'secret', GITHUB_TOKEN: 'secret', GH_TOKEN: 'secret', JAVA_TOOL_OPTIONS: '-javaagent:private.jar',
        JDK_JAVA_OPTIONS: '-Dprivate=value', CLASSPATH: '/private', HTTPS_PROXY: 'https://user:secret@proxy', SECRET: 'private' });
    assert.deepEqual(safe, { Path: '/bin', HOME: '/runner', SystemRoot: 'C:/Windows', TMP: '/temp' });
});
test('verified evidence cannot be relabelled as another Java major, EA package, VM or provider', () => {
    const directory = join(ROOT, 'testdata/jvm-samples');
    const original = JSON.parse(readFileSync(join(directory, 'local-zulu8-pilot2-zulu-8-all.json'), 'utf8'));
    const report = analyzer => ({ ...structuredClone(original), cases: original.cases.filter(c => c.status === 'verified' && c.analyzer === analyzer).slice(0, 1) });
    const tda = report('tda'), tls = report('tls');
    assert.ok(tda.cases.length && tls.cases.length);
    checkReport(tda, directory); checkReport(tls, directory);
    assert.throws(() => checkReport({ ...tda, major: 17 }, directory), /Java major/);
    assert.throws(() => checkReport({ ...tda, package: { major_version: 8, release_status: 'ea' } }, directory), /GA packages/);
    assert.throws(() => checkReport({ ...tda, package: { major_version: 17, release_status: 'ga' } }, directory), /Java major/);
    assert.throws(() => checkReport({ ...tda, runtime: { ...tda.runtime, 'java.vm.name': 'Eclipse OpenJ9 VM' } }, directory), /parser scope/);
    assert.throws(() => checkReport({ ...tls, runtime: { ...tls.runtime, provider: 'IBMJSSE2' } }, directory), /supported provider/);
});
test('README keeps VM/provider coverage separate for the two analyzers', () => {
    const records = [{ report: { id: 'semeru-8', major: 8, distribution: 'semeru', status: 'complete', cases: [
        { analyzer: 'tda', status: 'unsupported-format' }, { analyzer: 'tls', status: 'verified' },
    ] } }];
    const matrix = renderMatrix(records);
    assert.match(matrix, /\| 8 \| Unverified \| 1 \| Unverified \| semeru \|/);
    const summary = renderResults(records);
    assert.match(summary, /1 unsupported-format \| 1 verified/);
    assert.match(summary, /\[fixtures\]\(\.\.\/testdata\/jvm-samples\/semeru-8\/\)/);
});
test('runtime error control bytes remain in provenance but cannot turn generated Markdown into a binary file', () => {
    const report = { id: 'failed-zulu-10', major: 10, distribution: 'zulu', cases: [], status: 'capture-error', error: 'bad\u0000path\u001b\nline' };
    const markdown = renderResults([{ report }]);
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(markdown));
    assert.match(markdown, /bad path  line/);
    assert.equal(report.error, 'bad\u0000path\u001b\nline');
});

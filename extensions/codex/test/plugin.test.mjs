import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { analyzeThreadDumpData } from '../../../frontend/assets/javautils/tda/analysis.js';
import { analyzeTlsLog } from '../../../frontend/assets/javautils/tls-parser.js';
import { parseGcLog, analyzeGc } from '../../../frontend/assets/javautils/gc/parser.js';
import { readCapture, MAX_CAPTURE_BYTES } from '../src/captures.mjs';
import { createJobs } from '../src/jobs.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
let temporary, plugin, client, transport;
let stderr = '';
const sample = name => path.join(plugin, 'samples', name);
const fixture = name => path.join(repo, 'frontend/test/tda/fixtures', name);
async function call(name, args = {}) {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
    return response.structuredContent;
}
async function fails(name, args, pattern) {
    try {
        const response = await client.callTool({ name, arguments: args });
        assert.equal(response.isError, true);
        assert.match(response.content[0].text, pattern);
    } catch (error) {
        if (error.code === 'ERR_ASSERTION') throw error;
        assert.match(error.message, pattern);
    }
}
before(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'jvmscope plugin '));
    const installed = path.join(temporary, 'relocated installation');
    plugin = path.join(installed, 'plugins/jvmscope');
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    execFileSync('python3', ['-m', 'zipfile', '-e', path.join(repo, `build/jvmscope-codex-${version}.zip`), installed]);
    // Deliberately launch outside the repo, from paths containing spaces, with no node_modules.
    transport = new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: temporary, stderr: 'pipe' });
    transport.stderr?.on('data', chunk => { stderr += chunk; });
    client = new Client({ name: 'jvmscope-package-test', version: '1.0.0' });
    await client.connect(transport);
});
after(async () => {
    await client?.close();
    await rm(temporary, { recursive: true, force: true });
    assert.equal(stderr, '', 'Protocol or worker errors must not be hidden');
});

test('relocated bundle exposes eight read-only tools with validated schemas', async () => {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 8);
    for (const tool of tools) {
        assert.equal(tool.annotations.readOnlyHint, true);
        assert.equal(tool.annotations.destructiveHint, false);
        assert.equal(tool.inputSchema.additionalProperties, false);
    }
});

test('ZIP includes discoverable marketplace, manifests, skill, icon and dependency notices', async () => {
    const root = path.resolve(plugin, '../..');
    const marketplace = JSON.parse(await readFile(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'));
    assert.equal(path.resolve(root, marketplace.plugins[0].source.path), plugin);
    const manifest = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(await readFile(path.join(plugin, 'mcp.json'), 'utf8'));
    assert.equal(mcp.mcpServers.jvmscope.type, 'stdio');
    const server = mcp.mcpServers.jvmscope.args[0].replace('${PLUGIN_ROOT}', plugin);
    assert.equal(path.normalize(server), path.join(plugin, 'server/server.mjs'));
    assert.equal(manifest.extensions['com.openai'].requires_local_executor, true);
    assert.ok((await readFile(path.join(plugin, manifest.extensions['com.openai'].interface.logo))).length > 100);
    assert.match(await readFile(path.join(plugin, 'skills/analyze-jvm/SKILL.md'), 'utf8'), /name: analyze-jvm/);
    assert.match(await readFile(path.join(plugin, 'THIRD-PARTY-NOTICES.md'), 'utf8'), /@modelcontextprotocol\/server/);
    assert.ok((await readFile(path.join(plugin, 'LICENSE'))).length > 100);
});

test('single-plugin ZIP has a root manifest and runs independently of the marketplace', async () => {
    const installed = path.join(temporary, 'single plugin import');
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    execFileSync('python3', ['-m', 'zipfile', '-e', path.join(repo, `build/jvmscope-codex-plugin-${version}.zip`), installed]);
    const manifest = JSON.parse(await readFile(path.join(installed, 'plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'jvmscope');
    const mcp = JSON.parse(await readFile(path.join(installed, 'mcp.json'), 'utf8'));
    const server = mcp.mcpServers.jvmscope.args[0].replace('${PLUGIN_ROOT}', installed);
    assert.equal(path.normalize(server), path.join(installed, 'server/server.mjs'));
    await assert.rejects(readFile(path.join(installed, '.agents/plugins/marketplace.json')), { code: 'ENOENT' });
    assert.deepEqual(await readFile(server), await readFile(path.join(plugin, 'server/server.mjs')));
    const standalone = new Client({ name: 'jvmscope-single-plugin-test', version: '1.0.0' });
    try {
        await standalone.connect(new StdioClientTransport({ command: process.execPath, args: [server], cwd: installed }));
        assert.equal((await standalone.listTools()).tools.length, 8);
        const result = await standalone.callTool({ name: 'list_samples', arguments: { analyzer: 'threads' } });
        assert.ok(!result.isError);
        const capture = result.structuredContent.samples[0].path;
        assert.ok(capture.startsWith(installed + path.sep));
        const analysis = await standalone.callTool({ name: 'analyze_thread_dumps', arguments: { paths: [capture] } });
        assert.ok(!analysis.isError, JSON.stringify(analysis));
    } finally {
        await standalone.close();
    }
});

test('all bundled samples are present and analyzed through the real MCP transport', async () => {
    const { samples } = await call('list_samples');
    assert.equal(samples.length, 11);
    for (const s of samples) {
        assert.ok(path.isAbsolute(s.path));
        const tool = { threads: 'analyze_thread_dumps', tls: 'analyze_tls_log', gc: 'analyze_gc_log' }[s.analyzer];
        const result = await call(tool, s.analyzer === 'threads' ? { paths: [s.path] } : { path: s.path });
        assert.ok(['success', 'partial'].includes(result.status), s.file);
        assert.match(result.sources[0].sha256, /^[a-f0-9]{64}$/);
    }
});

test('confirmed deadlock retains severity, participant evidence and physical line references', async () => {
    const result = await call('analyze_thread_dumps', { paths: [sample('confirmed-deadlock.txt')] });
    assert.equal(result.findingCounts.critical, 1);
    const snapshot = result.snapshots.items[0];
    const finding = snapshot.analysis.findings.items.find(f => f.id === 'confirmed-deadlock');
    assert.equal(finding.severity, 'critical');
    assert.equal(finding.evidence.level, 'fact');
    assert.equal(finding.threads.total, 2);
    const thread = finding.threads.items[0];
    const evidence = await call('read_capture_lines', { path: result.sources[0].path, sha256: result.sources[0].sha256, startLine: thread.startLine, endLine: thread.endLine });
    assert.ok(evidence.lines[0].text.includes(`"${thread.name}"`));
    assert.ok(evidence.lines.some(l => l.text.includes('waiting to lock')));
    const cycle = snapshot.deadlocks.items[0];
    const [alpha, beta] = cycle.participants.items;
    assert.equal(alpha.ownerId, beta.id);
    assert.equal(beta.ownerId, alpha.id);
    assert.equal(alpha.waitingLockId, '0x00000000aaaabbbb');
    assert.equal(alpha.evidence.startLine, 4);
});

test('MCP Apps report resolves its bundled UI and preserves cached evidence without rereading', async () => {
    const filename = path.join(temporary, 'render-cache.txt');
    await cp(sample('confirmed-deadlock.txt'), filename);
    const report = await call('analyze_thread_dumps', { paths: [filename] });
    const descriptor = (await client.listTools()).tools.find(t => t.name === 'render_thread_report');
    const uri = descriptor._meta.ui.resourceUri;
    assert.ok((await client.listResources()).resources.some(r => r.uri === uri));
    const resource = (await client.readResource({ uri })).contents[0];
    assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.text, /ui\/initialize/);
    assert.match(resource.text, /ui\/notifications\/tool-result/);
    assert.deepEqual(resource._meta.ui.csp.connectDomains, []);
    await writeFile(filename, 'changed after analysis');
    const rendered = await client.callTool({ name: 'render_thread_report', arguments: { reportId: report.reportId } });
    assert.ok(!rendered.isError);
    assert.deepEqual(rendered._meta.jvmscopeReport, report);
    await fails('read_capture_lines', { path: filename, sha256: report.sources[0].sha256, startLine: 4, endLine: 9 }, /changed/);
    await fails('render_thread_report', { reportId: '00000000-0000-4000-8000-000000000000' }, /expired|another session/);
});

test('multiple reported deadlocks remain separate and unresolved owners are never invented', async () => {
    const report = await call('analyze_thread_dumps', { paths: [path.join(repo, 'extensions/codex/test/fixtures/multiple-deadlocks.txt')] });
    assert.equal(report.snapshots.items[0].deadlocks.total, 2);
    assert.deepEqual(report.snapshots.items[0].deadlocks.items.map(c => c.participants.items.map(t => t.name)), [['alpha', 'beta'], ['gamma', 'delta']]);
    const unmapped = await call('analyze_thread_dumps', { paths: [fixture('unmapped-deadlock-participants.txt')] });
    for (const p of unmapped.snapshots.items[0].deadlocks.items.flatMap(c => c.participants.items)) {
        assert.equal(p.ownerId, null);
        assert.equal(p.evidence, null);
    }
});

test('series comparison uses the unchanged engine and snapshot pagination', async () => {
    const paths = [fixture('ga-regressions/allocation-before.txt'), fixture('ga-regressions/allocation-after.txt')];
    const direct = analyzeThreadDumpData(await Promise.all(paths.map(async (p, i) => ({ id: `source:${i}`, name: path.basename(p), text: await readFile(p, 'utf8') }))));
    const first = await call('analyze_thread_dumps', { paths, limit: 1 });
    assert.equal(first.snapshotCount, direct.parsedDumps.length);
    assert.equal(first.snapshots.nextOffset, 1);
    const second = await call('analyze_thread_dumps', { paths, offset: 1, limit: 1 });
    assert.deepEqual(second.snapshots.items[0].analysis.counts, direct.parsedDumps[1].smartAnalysis.counts);
    assert.deepEqual(second.snapshots.items[0].analysis.coverage, direct.parsedDumps[1].smartAnalysis.coverage);
    assert.equal(second.snapshots.nextOffset, null);
});

test('mixed invalid and valid sources are visibly partial, while JSON is accepted separately', async () => {
    const result = await call('analyze_thread_dumps', { paths: [fixture('unknown-format.txt'), fixture('ga-regressions/carrier-json.json')] });
    assert.equal(result.status, 'partial');
    assert.equal(result.sourceResults[0].accepted, false);
    assert.equal(result.sourceResults[1].accepted, true);
});

test('unmapped deadlock participants retain mapping warnings', async () => {
    const result = await call('analyze_thread_dumps', { paths: [fixture('unmapped-deadlock-participants.txt')] });
    const f = result.snapshots.items[0].analysis.findings.items[0];
    assert.equal(f.severity, 'critical');
    assert.match(f.summary, /missing or ambiguous/);
    assert.equal(f.threads.total, 0);
});

test('TLS outcome and selected TLS version match the engine, with exact fatal-alert evidence', async () => {
    const filename = sample('java25-client-auth.txt');
    const direct = analyzeTlsLog(await readFile(filename, 'utf8'));
    const result = await call('analyze_tls_log', { path: filename });
    const i = result.interactions.items[0];
    assert.equal(i.outcome, 'failure');
    assert.equal(i.tlsVersion, 'TLSv1.3');
    assert.equal(i.failureReason, direct.interactions[0].failureReason);
    assert.equal(i.correlationQuality, direct.interactions[0].correlationQuality);
    const range = i.evidence.items.find(e => /fatal/i.test(e.message));
    assert.ok(range);
    const evidence = await call('read_capture_lines', { path: filename, sha256: result.sources[0].sha256, startLine: range.startLine, endLine: range.endLine });
    assert.ok(evidence.lines.some(l => /fatal/i.test(l.text)));
});

test('GC statistics and findings match the existing engine for every bundled collector', async () => {
    const { samples } = await call('list_samples', { analyzer: 'gc' });
    for (const s of samples) {
        const direct = analyzeGc(parseGcLog(await readFile(s.path, 'utf8')), { pauseBudgetMs: 1 });
        const result = await call('analyze_gc_log', { path: s.path, pauseBudgetMs: 1, limit: 1 });
        assert.deepEqual(result.stats, direct.stats, s.file);
        assert.equal(result.findings.total, direct.findings.length);
        if (direct.findings.length) assert.equal(result.findings.items[0].rule, direct.findings[0].rule);
    }
});

test('GC restarts are separate sessions, and concurrent cycles are excluded from pause totals', async () => {
    const filename = path.join(temporary, 'restarts.log');
    await writeFile(filename, '[0.001s][info][gc] Using G1\n[10s][info][gc] GC(0) Pause Young (Normal) 20M->4M(32M) 100ms\n[11s][info][gc] GC(1) Concurrent Mark Cycle 900ms\n[0.001s][info][gc] Using Serial\n[1s][info][gc] GC(0) Pause Young (Normal) 20M->4M(32M) 2ms');
    const first = await call('analyze_gc_log', { path: filename });
    const second = await call('analyze_gc_log', { path: filename, session: 1 });
    assert.equal(first.sessions.length, 2);
    assert.equal(first.stats.totalPauseMs, 100);
    assert.equal(second.stats.totalPauseMs, 2);
    await fails('analyze_gc_log', { path: filename, session: 7 }, /Unknown JVM session/);
});

test('Java, GC and TLS knowledge is available without network access', async () => {
    for (const query of ['virtual threads', 'gc', 'certificate_required']) {
        const found = await call('search_knowledge', { query });
        assert.ok(found.total > 0, query);
        const article = await call('get_knowledge_article', { id: found.items[0].id });
        assert.equal(article.id, found.items[0].id);
        assert.match(article.currency, /not a live lookup/);
    }
    await fails('get_knowledge_article', { id: '../secrets' }, /Unknown article/);
});

test('knowledge search follows nextOffset without repeating articles', async () => {
    const first = await call('search_knowledge', { query: 'gc', limit: 1 });
    assert.ok(first.total > 1);
    assert.equal(first.nextOffset, 1);
    const second = await call('search_knowledge', { query: 'gc', offset: first.nextOffset, limit: 1 });
    assert.equal(second.total, first.total);
    assert.equal(second.items.length, 1);
    assert.notEqual(second.items[0].id, first.items[0].id);
    const end = await call('search_knowledge', { query: 'gc', offset: first.total, limit: 1 });
    assert.deepEqual(end.items, []);
    assert.equal(end.nextOffset, null);
    await fails('search_knowledge', { query: 'gc', offset: -1 }, /Invalid|small|greater|nonnegative/i);
});

test('wrong format and malformed arguments fail explicitly without poisoning the next request', async () => {
    await fails('analyze_gc_log', { path: sample('confirmed-deadlock.txt') }, /GC/);
    await fails('analyze_tls_log', { path: sample('java27-g1.log') }, /recognizable/);
    await fails('analyze_thread_dumps', { paths: [sample('java27-g1.log')] }, /No supported/);
    await fails('analyze_gc_log', { path: sample('java27-g1.log'), pauseBudgetMs: 0 }, /Invalid|greater|small|positive/i);
    await fails('analyze_tls_log', { path: 'https://example.com/private' }, /absolute local/);
    await fails('analyze_tls_log', { path: 'relative.txt' }, /absolute local/);
    await fails('analyze_thread_dumps', { paths: [] }, /Invalid|small|least/i);
    await fails('analyze_thread_dumps', { paths: [sample('confirmed-deadlock.txt'), sample('confirmed-deadlock.txt')] }, /twice/);
    assert.equal((await call('list_samples', { analyzer: 'tls' })).samples.length, 1);
});

test('evidence rejects changed source hashes and oversized ranges', async () => {
    const filename = path.join(temporary, 'changing.log');
    await cp(sample('java27-g1.log'), filename);
    const analysis = await call('analyze_gc_log', { path: filename });
    const args = { path: filename, sha256: analysis.sources[0].sha256, startLine: 1, endLine: 201 };
    await fails('read_capture_lines', args, /at most 200/);
    await writeFile(filename, 'changed');
    await fails('read_capture_lines', { ...args, endLine: 1 }, /changed since analysis/);
});

test('capture reader rejects empty, invalid UTF-8, binary, gzip, directories and oversized files', async () => {
    for (const [name, data, pattern] of [
        ['empty', '', /empty/], ['binary', Buffer.from([0, 1]), /binary/],
        ['gzip', Buffer.from([31, 139, 4]), /gzip/], ['encoding', Buffer.from([255]), /UTF-8/],
    ]) {
        const filename = path.join(temporary, name); await writeFile(filename, data);
        await assert.rejects(readCapture(filename), pattern);
    }
    await assert.rejects(readCapture(temporary), /regular|directory|EISDIR|EPERM/i);
    const huge = path.join(temporary, 'too-large.log');
    await writeFile(huge, 'x'); await truncate(huge, MAX_CAPTURE_BYTES + 1);
    await assert.rejects(readCapture(huge), /64 MiB/);
});

test('worker cancellation and deadline terminate work and permit a later request', async () => {
    const hanging = path.join(temporary, 'hanging.mjs');
    await writeFile(hanging, 'setInterval(() => {}, 1000);');
    const jobs = createJobs({ workerUrl: hanging, timeoutMs: 100 });
    try {
        const controller = new AbortController();
        const pending = jobs.run('fixture', {}, controller.signal);
        controller.abort();
        await assert.rejects(pending, /cancelled/);
        await assert.rejects(jobs.run('fixture', {}), /exceeded/);
    } finally { await jobs.close(); }
    assert.ok((await call('search_knowledge', { query: 'gc' })).total > 0);
});

test('worker concurrency is bounded and recovers after cancellation', async () => {
    const hanging = path.join(temporary, 'busy.mjs');
    await writeFile(hanging, 'setInterval(() => {}, 1000);');
    const jobs = createJobs({ workerUrl: hanging });
    const controller = new AbortController();
    try {
        const first = assert.rejects(jobs.run('fixture', {}, controller.signal), /cancelled/);
        const second = assert.rejects(jobs.run('fixture', {}, controller.signal), /cancelled/);
        await assert.rejects(jobs.run('fixture', {}), /already running/);
        controller.abort();
        await Promise.all([first, second]);
    } finally { await jobs.close(); }
});

test('modern MCP negotiation discovers and calls the same packaged server', async () => {
    const modern = new Client({ name: 'modern-test', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    const wire = new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: temporary, stderr: 'pipe' });
    try {
        await modern.connect(wire);
        assert.equal((await modern.listTools()).tools.length, 8);
        const response = await modern.callTool({ name: 'search_knowledge', arguments: { query: 'gc' } });
        assert.ok(!response.isError);
        const analysis = await modern.callTool({ name: 'analyze_thread_dumps', arguments: { paths: [sample('confirmed-deadlock.txt')] } });
        const rendered = await modern.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.structuredContent.reportId } });
        assert.ok(!rendered.isError);
        assert.equal(rendered._meta.jvmscopeReport.findingCounts.critical, 1);
    } finally { await modern.close(); }
});

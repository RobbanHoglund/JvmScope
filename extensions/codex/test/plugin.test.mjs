import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, truncate, realpath } from 'node:fs/promises';
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

test('relocated bundle exposes twelve read-only tools with validated schemas', async () => {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 12);
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

test('no-findings reports retain Java and VM counts and verify source outside the rate leaders', async () => {
    const capture = path.join(temporary, 'ordinary-java25.txt');
    await cp(path.join(repo, 'extensions/codex/test/fixtures/no-findings-java25.txt'), capture);
    const analysis = await call('analyze_thread_dumps', { paths: [capture] });
    const rendered = await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId } });
    assert.ok(!rendered.isError);
    assert.equal(rendered.structuredContent.selectedThreadSummary.total, 22);
    assert.equal(rendered.structuredContent.selectedThreadSummary.withJavaState, 20);
    assert.equal(rendered.structuredContent.selectedThreadSummary.headerOnlyVmThreads, 2);
    const observation = rendered.structuredContent.selectedThreadObservation;
    assert.equal(observation.reason, 'main-http-wait');
    assert.equal(observation.thread.state, 'WAITING');
    assert.equal(observation.thread.stackContext.observation, 'jdk-http-send-wait');
    assert.match(observation.thread.stackContext.frame, /StatusClient\.java:152/);
    const snapshot = rendered._meta.jvmscopeReport.snapshots.items[0];
    assert.equal(snapshot.threadInventory.items.length, 22);
    const sourceKey = snapshot.threadInventory.items.at(-1).sourceKey;
    const focused = await client.callTool({ name: 'inspect_thread_details', arguments: { reportId: analysis.reportId, snapshotIndex: 0, sourceKeys: [sourceKey] } });
    assert.ok(!focused.isError);
    assert.match(focused.structuredContent.threads[0].lines[0].text, /VM Periodic Task Thread/);
    assert.equal(focused.structuredContent.threads[0].cpu.percent, null);
    await writeFile(capture, 'changed');
    await fails('inspect_thread_details', { reportId: analysis.reportId, snapshotIndex: 0, sourceKeys: [sourceKey] }, /changed since analysis/);
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
        assert.equal((await standalone.listTools()).tools.length, 12);
        const result = await standalone.callTool({ name: 'list_samples', arguments: { analyzer: 'threads' } });
        assert.ok(!result.isError);
        const returnedSample = result.structuredContent.samples[0];
        const capture = returnedSample.path;
        // Canonicalize both files: macOS has /var symlinks and Windows may change path casing.
        assert.equal(await realpath(capture), await realpath(path.join(installed, 'samples', returnedSample.file)));
        const analysis = await standalone.callTool({ name: 'analyze_thread_dumps', arguments: { paths: [capture] } });
        assert.ok(!analysis.isError, JSON.stringify(analysis));
    } finally {
        await standalone.close();
    }
});

test('one-call demo returns the same analysis, verified source, provenance and reusable report', async () => {
    const demo = await client.callTool({ name: 'show_thread_example', arguments: { language: 'sv' } });
    assert.ok(!demo.isError, JSON.stringify(demo));
    assert.equal(demo._meta.jvmscopeLanguage, 'sv');
    const data = demo.structuredContent, report = demo._meta.jvmscopeReport;
    assert.equal(data.example.synthetic, true);
    assert.match(data.example.provenance, /Synthetic regression/);
    assert.equal(data.exampleEvidence.source.sha256, report.sources[0].sha256);
    assert.equal(data.exampleEvidence.lines[3].text.startsWith('"alpha"'), true);
    assert.ok(data.exampleEvidence.lines.some(l => l.text.includes('Found one Java-level deadlock')));
    const direct = await call('analyze_thread_dumps', { paths: [sample('confirmed-deadlock.txt')] });
    assert.deepEqual(data.selectedSnapshot, direct.snapshots.items[0]);
    assert.deepEqual(report.snapshots, direct.snapshots);
    const cached = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId } });
    assert.deepEqual(cached._meta.jvmscopeReport, report);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.find(t => t.name === 'show_thread_example')._meta.ui.resourceUri,
        tools.find(t => t.name === 'render_thread_report')._meta.ui.resourceUri);
    await fails('show_thread_example', { path: fixture('unknown-format.txt') }, /unrecognized|invalid|additional/i);
    // Evidence errors remain explicit: a demo must not succeed with unverified sources.
    await fails('read_capture_lines', { path: report.sources[0].path, sha256: '0'.repeat(64), startLine: 1, endLine: 10 }, /changed/);
});

test('cached comparison and focused source share snapshot identity without reparsing files', async () => {
    const filename = path.join(temporary, 'cached-series.txt');
    await cp(path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt'), filename);
    const analysis = await call('analyze_thread_dumps', { paths: [filename], limit: 1 });
    assert.equal(analysis._cachedSnapshots, undefined);
    assert.equal(analysis.cache.complete, true);
    const view = await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId, view: 'comparison', offset: 0, limit: 4 } });
    assert.ok(!view.isError);
    assert.equal(view.structuredContent.comparison.page.items.length, 3);
    const thread = view.structuredContent.comparison.page.items[2].measurements.threads.items.find(t => t.name === 'scenario-cpu-and-allocation-hot');
    const evidence = await call('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 2, sourceKey: thread.sourceKey });
    assert.equal(evidence.context.snapshotNumber, 3);
    assert.equal(evidence.lines[0].line, 2270);
    assert.match(evidence.citationLabel, /Snapshot 3.*scenario-cpu-and-allocation-hot/);
    const focus = await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId, snapshotIndex: 2, sourceKey: thread.sourceKey } });
    assert.equal(focus._meta.jvmscopeFocus.snapshotIndex, 2);
    await fails('render_thread_report', { reportId: analysis.reportId, sourceKey: thread.sourceKey }, /Supply snapshotIndex/);
    await fails('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 0, sourceKey: thread.sourceKey }, /identity.*snapshot/);
    await fails('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 2, sourceKey: thread.sourceKey, startLine: 117 }, /does not belong/);
    await writeFile(filename, 'changed since analysis');
    const cached = await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId, view: 'comparison', offset: 0, limit: 4 } });
    assert.ok(!cached.isError);
    assert.deepEqual(cached.structuredContent.comparison, view.structuredContent.comparison);
    await fails('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 2, sourceKey: thread.sourceKey }, /changed since analysis/);
});

test('cached pages keep the public response bound even when more snapshots are retained', async () => {
    const filename = path.join(temporary, 'large-cached-series.txt');
    const input = await readFile(path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt'), 'utf8');
    await writeFile(filename, Array(6).fill(input).join('\n'));
    const analysis = await call('analyze_thread_dumps', { paths: [filename], limit: 1 });
    assert.equal(analysis.cache.complete, true);
    await fails('render_thread_report', { reportId: analysis.reportId, offset: 0, limit: 50 }, /response limit/);
    const small = await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId, offset: 10, limit: 1 } });
    assert.ok(!small.isError);
    assert.equal(small._meta.jvmscopeReport.snapshots.items[0].index, 10);
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
    assert.deepEqual(alpha.heldLocks.items.map(l => l.lockId), ['0x00000000ccccdddd']);
    assert.deepEqual(beta.heldLocks.items.map(l => l.lockId), ['0x00000000aaaabbbb']);
});

test('held-lock cards preserve explicit synchronizers and exclude released Object.wait monitors', async () => {
    const filename = path.join(temporary, 'explicit-lock-evidence.txt');
    const original = await readFile(sample('confirmed-deadlock.txt'), 'utf8');
    const changed = original.replace(' - locked <0x00000000ccccdddd> (a example.LockB)',
        ' - locked <0x00000000ccccdddd> (a example.LockB)\n - waiting on <0x00000000ccccdddd> (a example.LockB)\n Locked ownable synchronizers:\n - <0x12345678> (a java.util.concurrent.locks.ReentrantLock$NonfairSync)');
    assert.notEqual(changed, original);
    await writeFile(filename, changed);
    const report = await call('analyze_thread_dumps', { paths: [filename] });
    assert.ok(Number.isFinite(report.timing.workerRoundTripMs));
    assert.ok(report.timing.workerRoundTripMs + 2 >= report.timing.readMs + report.timing.analysisMs);
    const alpha = report.snapshots.items[0].deadlocks.items[0].participants.items.find(p => p.name === 'alpha');
    assert.deepEqual(alpha.heldLocks.items, [{ lockId: '0x12345678', lockType: 'a java.util.concurrent.locks.ReentrantLock$NonfairSync', kind: 'ownable-synchronizer' }]);
    // The footer's owner relation must not reintroduce the released lexical monitor.
    assert.ok(!alpha.heldLocks.items.some(l => l.lockId === '0x00000000ccccdddd'));
});

test('real HotSpot standard captures expose exact evidence in every snapshot', async () => {
    const filename = path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt');
    const report = await call('analyze_thread_dumps', { paths: [filename] });
    assert.equal(report.snapshotCount, 3);
    assert.equal(report.findingCounts.critical, 3);
    assert.deepEqual(report.deadlockObservations, { snapshotsWithCycles: 3, snapshotCount: 3, scope: 'snapshots-not-distinct-incidents' });
    assert.equal(report.findingCountScope, 'finding-category-occurrences-across-snapshots');
    const paged = await call('analyze_thread_dumps', { paths: [filename], offset: 1, limit: 1 });
    assert.deepEqual(paged.deadlockObservations, report.deadlockObservations);
    for (const snapshot of report.snapshots.items) {
        assert.equal(snapshot.deadlocks.total, 2);
        const participants = snapshot.deadlocks.items.flatMap(c => c.participants.items);
        assert.equal(participants.length, 5);
        for (const p of participants) {
            assert.ok(p.evidence.startLine >= snapshot.sourceStartLine);
            const excerpt = await call('read_capture_lines', { path: filename, sha256: report.sources[0].sha256, ...p.evidence });
            assert.ok(excerpt.lines[0].text.includes(`"${p.name}"`));
            assert.ok(excerpt.lines.some(l => l.text.includes('waiting to lock')));
        }
        const finding = snapshot.analysis.findings.items.find(f => f.id === 'confirmed-deadlock');
        assert.deepEqual(finding.threads.items.map(t => t.startLine).sort(), participants.map(t => t.evidence.startLine).sort());
    }
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
    assert.equal(rendered._meta.jvmscopeLanguage, 'en');
    assert.ok(Number.isFinite(rendered._meta.jvmscopeTimings.reportPreparationMs));
    assert.equal(rendered._meta.jvmscopeTimings.captureReads, 0);
    assert.equal(rendered._meta.jvmscopeTimings.parserRuns, 0);
    assert.match(rendered._meta.jvmscopeTimings.scope, /excludes transport, AI and host rendering/);
    assert.match(rendered.content[0].text, /diagnostic conclusion and next check/);
    assert.doesNotMatch(rendered.content[0].text, /if no widget is visible|couldn.t verify/i);
    const swedish = await client.callTool({ name: 'render_thread_report', arguments: { reportId: report.reportId, language: 'sv' } });
    assert.equal(swedish._meta.jvmscopeLanguage, 'sv');
    assert.deepEqual(swedish._meta.jvmscopeReport, report);
    assert.deepEqual(swedish.structuredContent.deadlockObservations, { snapshotsWithCycles: 1, snapshotCount: 1, scope: 'snapshots-not-distinct-incidents' });
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
        assert.equal(p.heldLocks.total, 0);
    }
});

test('AI conclusion is carried into the widget without changing findings or leaking across scope', async () => {
    const data = await call('analyze_thread_dumps', { paths: [sample('repeated-contention.txt')] });
    const conclusion = { summary: 'Snapshot 1: observed contention needs source review.', nextCheck: 'Compare the owner and waiter stacks.' };
    const args = { reportId: data.reportId, snapshotIndex: 0, language: 'en', conclusion };
    const r = await client.callTool({ name: 'render_thread_report', arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    assert.deepEqual(r.structuredContent.conclusion, r._meta.jvmscopeConclusion);
    assert.equal(r._meta.jvmscopeConclusion.summary, conclusion.summary);
    assert.deepEqual(r._meta.jvmscopeConclusion.scope, { view: 'snapshot', snapshots: [0] });
    assert.deepEqual(r._meta.jvmscopeReport.snapshots.items[0].analysis, data.snapshots.items[0].analysis);
    assert.match(r.content[0].text, /do not repeat them below/);
    const next = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, snapshotIndex: 1 } });
    assert.equal(next._meta.jvmscopeConclusion, null);
    const back = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, snapshotIndex: 0, language: 'sv' } });
    assert.deepEqual(back._meta.jvmscopeConclusion, r._meta.jvmscopeConclusion);
    assert.equal(back._meta.jvmscopeLanguage, 'sv');
    await fails('render_thread_report', { ...args, conclusion: { ...conclusion, summary: 'x'.repeat(901) } }, /Too big|<=900|at most/i);
    await fails('render_thread_report', { ...args, conclusion: { ...conclusion, summary: '  ' } }, /Too small|>=1|at least/i);
    await fails('render_thread_report', { ...args, conclusion: { ...conclusion, nextCheck: 'x'.repeat(401) } }, /Too big|<=400|at most/i);
    await fails('render_thread_report', { ...args, conclusion: { ...conclusion, reportId: data.reportId } }, /Unrecognized/i);
    const comparison = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, view: 'comparison', conclusion } });
    assert.deepEqual(comparison._meta.jvmscopeConclusion.scope, { view: 'comparison', snapshots: [0, 1] });
    const partial = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, view: 'comparison', offset: 1, limit: 1 } });
    assert.equal(partial._meta.jvmscopeConclusion, null);
    const row = data.snapshots.items[0].threadInventory.items[0];
    const focus = await client.callTool({ name: 'render_thread_details', arguments: { reportId: data.reportId, snapshotIndex: 0, sourceKeys: [row.sourceKey], conclusion } });
    assert.ok(!focus.isError, JSON.stringify(focus));
    assert.deepEqual(focus._meta.jvmscopeConclusion.scope, { view: 'threads', snapshots: [0], sourceKeys: [row.sourceKey] });
});

test('thread-specific overview assessments cannot replace another thread or the snapshot assessment', async () => {
    const data = await call('analyze_thread_dumps', { paths: [sample('confirmed-deadlock.txt')] });
    const [one, two] = data.snapshots.items[0].threadInventory.items;
    const render = args => client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, snapshotIndex: 0, ...args } });
    const general = { summary: 'Snapshot-wide assessment.', nextCheck: 'Review both participants.' };
    const focused = { summary: 'Assessment of the first thread only.', nextCheck: 'Review its acquisition path.' };
    await render({ conclusion: general });
    const first = await render({ sourceKey: one.sourceKey, conclusion: focused });
    assert.deepEqual(first._meta.jvmscopeConclusion.scope, { view: 'snapshot', snapshots: [0], sourceKeys: [one.sourceKey] });
    assert.equal((await render({ sourceKey: two.sourceKey }))._meta.jvmscopeConclusion, null);
    assert.equal((await render({}))._meta.jvmscopeConclusion.summary, general.summary);
    assert.equal((await render({ sourceKey: one.sourceKey }))._meta.jvmscopeConclusion.summary, focused.summary);
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
        assert.equal((await modern.listTools()).tools.length, 12);
        const response = await modern.callTool({ name: 'search_knowledge', arguments: { query: 'gc' } });
        assert.ok(!response.isError);
        const analysis = await modern.callTool({ name: 'analyze_thread_dumps', arguments: { paths: [sample('confirmed-deadlock.txt')] } });
        const rendered = await modern.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.structuredContent.reportId } });
        assert.ok(!rendered.isError);
        assert.equal(rendered._meta.jvmscopeReport.findingCounts.critical, 1);
    } finally { await modern.close(); }
});

test('focused multi-thread inspection returns exact measurements and verified stacks in one bounded call', async () => {
    const filename = path.join(temporary, 'focused-series.txt');
    await cp(path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt'), filename);
    const analysis = await call('analyze_thread_dumps', { paths: [filename] });
    const rows = analysis.snapshots.items[2].measurements.threads.items;
    const names = ['scenario-cpu-and-allocation-hot', 'scenario-livelock-2-agent-1', 'scenario-livelock-2-agent-2'];
    const selected = names.map(name => rows.find(t => t.name === name));
    const args = { reportId: analysis.reportId, snapshotIndex: 2, sourceKeys: selected.map(t => t.sourceKey), language: 'sv' };
    const response = await client.callTool({ name: 'inspect_thread_details', arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    const data = response.structuredContent;
    assert.deepEqual(data.threads.map(t => t.name), names);
    assert.equal(data.snapshotNumber, 3);
    assert.equal(data.timing.captureReads, 1); assert.equal(data.timing.parserRuns, 0);
    assert.equal(data.source.sha256, analysis.sources[0].sha256);
    assert.equal(data.snapshotDeadlockCycles, 2);
    assert.equal(response._meta.jvmscopeReport, undefined, 'follow-ups must not resend the entire report');
    for (const [i, thread] of data.threads.entries()) {
        assert.deepEqual(thread.cpu, selected[i].cpu);
        assert.deepEqual(thread.allocation, selected[i].allocation);
        assert.equal(thread.context.snapshotIndex, 2);
        assert.ok(thread.lines[0].text.includes(thread.name));
        assert.equal(thread.lines[0].line, selected[i].current.range.startLine);
    }
    assert.match(data.threads[0].highlights.items[0].text, /ThreadScenarioRunner.java:634/);
    assert.match(data.threads[1].highlights.items[0].text, /ThreadScenarioRunner.java:532/);
    assert.ok(JSON.stringify(data).length < 20000);
    await fails('inspect_thread_details', { ...args, snapshotIndex: 0 }, /identity.*snapshot/);
    await fails('inspect_thread_details', { ...args, sourceKeys: [args.sourceKeys[0], args.sourceKeys[0]] }, /distinct/);
    await fails('inspect_thread_details', { ...args, sourceKeys: [] }, /Too small|at least|>=1/);
    await fails('inspect_thread_details', { ...args, sourceKeys: Array(6).fill(args.sourceKeys[0]) }, /Too big|at most|<=5/);
    await writeFile(filename, 'changed after analysis');
    await fails('inspect_thread_details', args, /changed since analysis/);
});

test('focused stacks disclose truncation and page only inside the selected thread', async () => {
    const filename = path.join(temporary, 'long-thread.txt');
    const header = 'Full thread dump OpenJDK 64-Bit Server VM:\n\n"long-worker" #1 prio=5 tid=0x1 nid=0x1 runnable\n java.lang.Thread.State: RUNNABLE\n';
    await writeFile(filename, header + Array.from({ length: 80 }, (_, i) => ` at sample.Service.step${i}(Service.java:${i + 1})`).join('\n') + '\n');
    const analysis = await call('analyze_thread_dumps', { paths: [filename] });
    const row = analysis.snapshots.items[0].measurements.threads.items[0];
    const response = await client.callTool({ name: 'inspect_thread_details', arguments: { reportId: analysis.reportId, snapshotIndex: 0, sourceKeys: [row.sourceKey] } });
    assert.ok(!response.isError);
    const thread = response.structuredContent.threads[0];
    assert.equal(thread.lines.length, 60);
    assert.equal(thread.nextLine, thread.lines.at(-1).line + 1);
    const next = await call('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 0, sourceKey: row.sourceKey, startLine: thread.nextLine });
    assert.equal(next.lines[0].line, thread.nextLine);
    assert.equal(next.nextLine, null);
    assert.match(next.lines.at(-1).text, /Service.java:80/);
    assert.equal(thread.cpu.percent, null);
    assert.equal(thread.allocation.bytesPerSecond, null);
});

test('selected-thread explanation cannot present an empty assessment and checks fresh evidence', async () => {
    const filename = path.join(temporary, 'follow-up-main.txt');
    await cp(path.join(repo, 'extensions/codex/test/fixtures/no-findings-java25.txt'), filename);
    const analysis = await call('analyze_thread_dumps', { paths: [filename] });
    const key = analysis.snapshots.items[0].threadInventory.items.find(t => t.name === 'main').sourceKey;
    const args = { reportId: analysis.reportId, snapshotIndex: 0, sourceKeys: [key], language: 'sv' };
    const conclusion = { summary: 'main väntar i HttpClientImpl.send. En snapshot visar inte om anropet har fastnat.', nextCheck: 'Jämför en senare dump och anropets timeoutlogg.' };
    await client.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId, language: 'sv', conclusion } });
    // Having an overview assessment must not make a new focused assessment optional.
    await fails('render_thread_details', args, /conclusion/);
    const tools = (await client.listTools()).tools;
    const inspect = tools.find(t => t.name === 'inspect_thread_details');
    assert.ok(inspect);
    assert.equal(inspect._meta?.ui?.resourceUri, undefined);
    assert.equal(inspect._meta?.['openai/outputTemplate'], undefined);
    assert.ok(tools.find(t => t.name === 'render_thread_details').inputSchema.required.includes('conclusion'));
    const evidence = await call('inspect_thread_details', args);
    assert.equal(evidence.presentation, 'evidence-only');
    assert.equal(evidence.conclusion, null);
    assert.match(evidence.nextAction, /render_thread_details/);
    assert.match(evidence.threads[0].lines.map(l => l.text).join('\n'), /HttpClientImpl.send/);
    assert.equal(evidence.timing.parserRuns, 0);
    const shown = await client.callTool({ name: 'render_thread_details', arguments: { ...args, conclusion } });
    assert.ok(!shown.isError, JSON.stringify(shown));
    assert.equal(shown.structuredContent.presentation, 'report-with-assessment');
    assert.equal(shown._meta.jvmscopeConclusion.summary, conclusion.summary);
    assert.deepEqual(shown._meta.jvmscopeConclusion.scope, { view: 'threads', snapshots: [0], sourceKeys: [key] });
    assert.deepEqual(shown.structuredContent.threads, evidence.threads);
    assert.equal(shown.structuredContent.timing.captureReads, 1);
    assert.equal(shown.structuredContent.timing.parserRuns, 0);
    assert.equal((await call('inspect_thread_details', args)).conclusion.summary, conclusion.summary);
    await fails('render_thread_details', { ...args, conclusion: { ...conclusion, summary: ' ' } }, /Too small|at least|>=1/);
    await writeFile(filename, 'changed between evidence and presentation');
    await fails('render_thread_details', { ...args, conclusion }, /changed since analysis/);
    await fails('inspect_thread_details', args, /changed since analysis/);
});

test('explicit snapshot focus cannot silently fall back to a different page or cache its conclusion there', async () => {
    const data = await call('analyze_thread_dumps', { paths: [path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt')] });
    const conclusion = { summary: 'Assessment for snapshot 3 only.', nextCheck: 'Inspect snapshot 3.' };
    const sourceKey = data.snapshots.items[2].threadInventory.items[0].sourceKey;
    const args = { reportId: data.reportId, snapshotIndex: 2, sourceKey, offset: 0, limit: 1, conclusion };
    await fails('render_thread_report', args, /snapshot.*page/i);
    await fails('render_thread_report', { ...args, sourceKey: undefined }, /snapshot.*page/i);
    await fails('render_thread_report', { ...args, view: 'comparison' }, /snapshot.*page/i);
    const first = await client.callTool({ name: 'render_thread_report', arguments: { reportId: data.reportId, snapshotIndex: 0 } });
    assert.equal(first.structuredContent.selectedSnapshotIndex, 0);
    assert.equal(first._meta.jvmscopeConclusion, null, 'Rejected assessment must not pollute another snapshot');
    const selected = await client.callTool({ name: 'render_thread_report', arguments: { ...args, offset: 1, limit: 2 } });
    assert.ok(!selected.isError, JSON.stringify(selected));
    assert.equal(selected.structuredContent.selectedSnapshotIndex, 2);
    assert.equal(selected._meta.jvmscopeFocus.snapshotIndex, 2);
    assert.equal(selected._meta.jvmscopeFocus.sourceKey, sourceKey);
    assert.deepEqual(selected._meta.jvmscopeConclusion.scope, { view: 'snapshot', snapshots: [2], sourceKeys: [sourceKey] });
});

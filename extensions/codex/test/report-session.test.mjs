import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
let directory, plugin;
before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'jvmscope session '));
    plugin = path.join(directory, 'relocated plugin');
    await cp(path.join(repo, 'build/codex-marketplace/plugins/jvmscope'), plugin, { recursive: true });
});
after(async () => rm(directory, { recursive: true, force: true }));
async function connect() {
    const client = new Client({ name: 'restarted-report-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [path.join(plugin, 'server/server.mjs')], cwd: directory }));
    return client;
}
async function call(client, name, arguments_) {
    const result = await client.callTool({ name, arguments: arguments_ });
    assert.ok(!result.isError, JSON.stringify(result)); return result;
}
async function analyzeAndStop(paths, options = {}) {
    const first = await connect();
    try { return (await call(first, 'analyze_thread_dumps', { paths, ...options })).structuredContent; }
    finally { await first.close(); }
}

test('a report remains inspectable after its original MCP process has exited', async () => {
    const capture = path.join(plugin, 'samples/confirmed-deadlock.txt');
    const analysis = await analyzeAndStop([capture]);
    assert.ok(analysis.reportContext, 'Analysis must carry the bounded source reference needed by a new connection');
    const second = await connect();
    try {
        const snapshot = analysis.snapshots.items[0], sourceKey = snapshot.threadInventory.items[0].sourceKey;
        const args = { reportId: analysis.reportId, reportContext: analysis.reportContext, snapshotIndex: 0 };
        const focused = await call(second, 'inspect_thread_details', { ...args, sourceKeys: [sourceKey] });
        assert.equal(focused.structuredContent.reportId, analysis.reportId);
        assert.ok(focused.structuredContent.threads[0].lines.length);
        assert.equal(focused.structuredContent.source.sha256, analysis.sources[0].sha256);
        assert.deepEqual(focused._meta.jvmscopeReportContext, analysis.reportContext);
        const evidence = await call(second, 'read_thread_evidence', { ...args, sourceKey });
        assert.deepEqual(evidence.structuredContent.lines, focused.structuredContent.threads[0].lines);
        assert.equal(evidence.structuredContent.context.sourceKey, sourceKey);
    } finally { await second.close(); }
});

test('recovery preserves ordered sources, global snapshot indexes and measured allocation bounds', async () => {
    const capture = path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt');
    const analysis = await analyzeAndStop([capture], { offset: 2, limit: 1 });
    const second = await connect();
    try {
        const result = await call(second, 'render_thread_report', { reportId: analysis.reportId,
            reportContext: analysis.reportContext, snapshotIndex: 2, offset: 2, limit: 1 });
        const restored = result._meta.jvmscopeReport;
        assert.deepEqual(restored.sources, analysis.sources);
        assert.deepEqual(restored.snapshots, analysis.snapshots);
        assert.equal(restored.cache.recovered, true);
        assert.equal(result._meta.jvmscopeConclusion, null, 'A new process must not invent or import an assessment');
        const comparison = await call(second, 'render_thread_report', { reportId: analysis.reportId,
            reportContext: analysis.reportContext, view: 'comparison', offset: 0, limit: 4 });
        assert.equal(comparison._meta.jvmscopeReport.snapshots.items.length, 3);
    } finally { await second.close(); }
});

test('a changed or missing source cannot silently revive an old report or poison a later retry', async () => {
    const capture = path.join(directory, 'changing.txt'), original = await readFile(path.join(plugin, 'samples/confirmed-deadlock.txt'), 'utf8');
    await writeFile(capture, original);
    const analysis = await analyzeAndStop([capture]);
    const second = await connect();
    const args = { reportId: analysis.reportId, reportContext: analysis.reportContext, snapshotIndex: 0 };
    try {
        await writeFile(capture, original + '\n');
        const changed = await second.callTool({ name: 'render_thread_report', arguments: args });
        assert.equal(changed.isError, true); assert.match(changed.content[0].text, /changed since analysis/);
        await rm(capture);
        const missing = await second.callTool({ name: 'render_thread_report', arguments: args });
        assert.equal(missing.isError, true);
        await writeFile(capture, original);
        const restored = await call(second, 'render_thread_report', args);
        assert.equal(restored._meta.jvmscopeReport.sources[0].sha256, analysis.sources[0].sha256);
    } finally { await second.close(); }
});

test('a source reference must match its report id and original snapshot count', async () => {
    const analysis = await analyzeAndStop([path.join(plugin, 'samples/confirmed-deadlock.txt')]);
    const second = await connect();
    try {
        for (const changes of [{ reportId: '11111111-1111-4111-8111-111111111111' }, { snapshotCount: 99 }]) {
            const result = await second.callTool({ name: 'render_thread_report', arguments: { reportId: analysis.reportId,
                reportContext: { ...analysis.reportContext, ...changes } } });
            assert.equal(result.isError, true); assert.match(result.content[0].text, /context|reference|snapshot count/i);
        }
        const restored = await call(second, 'render_thread_report', { reportId: analysis.reportId, reportContext: analysis.reportContext });
        assert.equal(restored._meta.jvmscopeReport.snapshotCount, 1);
    } finally { await second.close(); }
});

test('recovery retains rejected sources and source order instead of renumbering the remaining files', async () => {
    const paths = [path.join(repo, 'frontend/test/tda/fixtures/unknown-format.txt'), path.join(plugin, 'samples/confirmed-deadlock.txt'),
        path.join(repo, 'extensions/codex/test/fixtures/no-findings-java25.txt')];
    const analysis = await analyzeAndStop(paths, { offset: 1, limit: 1 });
    const second = await connect();
    try {
        const restored = (await call(second, 'render_thread_report', { reportId: analysis.reportId,
            reportContext: analysis.reportContext, snapshotIndex: 1, offset: 1, limit: 1 }))._meta.jvmscopeReport;
        assert.equal(restored.status, 'partial');
        assert.deepEqual(restored.sources, analysis.sources);
        assert.deepEqual(restored.sourceResults, analysis.sourceResults);
        assert.deepEqual(restored.snapshots, analysis.snapshots);
    } finally { await second.close(); }
});

test('the bundled example retains its explicit synthetic provenance across connections', async () => {
    const first = await connect(); let example;
    try { example = await call(first, 'show_thread_example', { language: 'sv' }); }
    finally { await first.close(); }
    const second = await connect();
    try {
        const result = await call(second, 'render_thread_report', { reportId: example.structuredContent.reportId,
            reportContext: example.structuredContent.reportContext, language: 'sv' });
        assert.deepEqual(result._meta.jvmscopeReport.example, example._meta.jvmscopeReport.example);
        assert.equal(result.structuredContent.example.synthetic, true);
    } finally { await second.close(); }
});

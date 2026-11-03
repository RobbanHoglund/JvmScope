import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
let client;
const capture = fileURLToPath(new URL('./fixtures/no-findings-java25.txt', import.meta.url));
before(async () => {
    client = new Client({ name: 'assessment-handoff-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../../../build/codex-marketplace/plugins/jvmscope/server/server.mjs', import.meta.url))] }));
});
after(async () => client?.close());
async function call(name, arguments_) {
    const result = await client.callTool({ name, arguments: arguments_ });
    assert.ok(!result.isError, JSON.stringify(result)); return result;
}
const overview = { summary: 'Snapshot-wide assessment.', nextCheck: 'Compare another capture.' };
const focused = { summary: 'Assessment of the selected main thread.', nextCheck: 'Check its request timing.' };

test('focused reports carry the exact parent snapshot assessment separately from manual evidence and the new thread assessment', async () => {
    const analysis = (await call('analyze_thread_dumps', { paths: [capture] })).structuredContent;
    const reportId = analysis.reportId, sourceKeys = [analysis.snapshots.items[0].threadInventory.items[0].sourceKey];
    await call('render_thread_report', { reportId, snapshotIndex: 0, conclusion: overview });
    const manual = await call('inspect_thread_details', { reportId, snapshotIndex: 0, sourceKeys });
    assert.equal(manual._meta.jvmscopeConclusion, null, 'A manual click has no thread assessment');
    assert.equal(manual._meta.jvmscopeSnapshotConclusion.summary, overview.summary);
    assert.deepEqual(manual._meta.jvmscopeSnapshotConclusion.scope, { view: 'snapshot', snapshots: [0] });
    const shown = await call('render_thread_details', { reportId, snapshotIndex: 0, sourceKeys, conclusion: focused });
    assert.equal(shown._meta.jvmscopeConclusion.summary, focused.summary);
    assert.deepEqual(shown._meta.jvmscopeConclusion.scope, { view: 'threads', snapshots: [0], sourceKeys });
    assert.equal(shown._meta.jvmscopeSnapshotConclusion.summary, overview.summary);
    assert.equal(shown._meta.jvmscopeSnapshotConclusion.reportId, reportId);
    assert.equal(shown.structuredContent.timing.parserRuns, 0);
});

test('a thread-specific overview or another report cannot become the global parent assessment', async () => {
    const a = (await call('analyze_thread_dumps', { paths: [capture] })).structuredContent;
    await call('render_thread_report', { reportId: a.reportId, conclusion: overview });
    const b = (await call('analyze_thread_dumps', { paths: [capture] })).structuredContent;
    const key = b.snapshots.items[0].threadInventory.items[0].sourceKey;
    await call('render_thread_report', { reportId: b.reportId, snapshotIndex: 0, sourceKey: key, conclusion: overview });
    const result = await call('render_thread_details', { reportId: b.reportId, snapshotIndex: 0, sourceKeys: [key], conclusion: focused });
    assert.equal(result._meta.jvmscopeSnapshotConclusion, null);
    assert.equal(result._meta.jvmscopeConclusion.reportId, b.reportId);
});

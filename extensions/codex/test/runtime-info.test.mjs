import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
let client;
before(async () => {
    client = new Client({ name: 'runtime-info-regression', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../../../build/codex-marketplace/plugins/jvmscope/server/server.mjs', import.meta.url))] }));
});
after(async () => client?.close());
async function call(name, arguments_) {
    const result = await client.callTool({ name, arguments: arguments_ });
    assert.ok(!result.isError, JSON.stringify(result)); return result;
}

test('packaged analysis, snapshot and selected-thread tools expose the exact captured JDK runtime', async () => {
    const paths = [26, 27].map(major => fileURLToPath(new URL(`../../../frontend/test/tda/fixtures/runtime/jdk${major}-thread-print.txt`, import.meta.url)));
    const analysis = (await call('analyze_thread_dumps', { paths })).structuredContent;
    assert.deepEqual(analysis.snapshots.items.map(s => s.runtime.runtimeVersion), ['26.0.2.1+1-7','27+35-2325']);
    const report = await call('render_thread_report', { reportId: analysis.reportId, snapshotIndex: 1 });
    assert.equal(report.structuredContent.selectedRuntime.runtimeVersion, '27+35-2325');
    assert.equal(report._meta.jvmscopeReport.snapshots.items[0].index, 1);
    assert.equal(report._meta.jvmscopeReport.snapshots.items[0].runtime.javaVersion, '27.0+35');
    const sourceKey = analysis.snapshots.items[1].threadInventory.items[0].sourceKey;
    const focused = await call('inspect_thread_details', { reportId: analysis.reportId, snapshotIndex: 1, sourceKeys: [sourceKey] });
    assert.equal(focused.structuredContent.runtime.runtimeVersion, '27+35-2325');
    const line = focused.structuredContent.threads[0].lines[0];
    assert.equal(line.line, 5); assert.match(line.text, /^"sample-owner"/);
    const comparison = await call('render_thread_report', { reportId: analysis.reportId, view: 'comparison' });
    assert.equal(comparison.structuredContent.selectedRuntime, null);
    assert.deepEqual(comparison.structuredContent.comparison.page.items.map(s => s.runtime.runtimeVersion), ['26.0.2.1+1-7','27+35-2325']);
});

test('legacy dumps retain a distinct VM version without fabricating an absent runtime build', async () => {
    const path = fileURLToPath(new URL('../../../frontend/test/tda/fixtures/hotspot-jdk8-classic.txt', import.meta.url));
    const analysis = (await call('analyze_thread_dumps', { paths: [path] })).structuredContent;
    const runtime = analysis.snapshots.items[0].runtime;
    assert.equal(runtime.javaVersion, null); assert.equal(runtime.runtimeVersion, null);
    assert.match(runtime.vmName, /HotSpot|OpenJDK/);
});

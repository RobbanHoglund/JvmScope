// Packaged protocol trace, without model reasoning or the Codex desktop app.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
const plugin = fileURLToPath(new URL('../../../build/codex-marketplace/plugins/jvmscope/', import.meta.url));
const capture = fileURLToPath(new URL('./fixtures/no-findings-java25.txt', import.meta.url));
const client = new Client({ name: 'overview-benchmark', version: '1.0.0' });
const runs = [];
async function call(name, args) {
    const started = performance.now();
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(JSON.stringify(response));
    return { response, roundTripMs: Math.round(performance.now() - started) };
}
try {
    const start = performance.now();
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [plugin + 'server/server.mjs'] }));
    const connectionMs = Math.round(performance.now() - start);
    for (let i = 0; i < 7; i++) {
        const started = performance.now();
        const analysis = await call('analyze_thread_dumps', { paths: [capture] });
        const reportId = analysis.response.structuredContent.reportId;
        const row = analysis.response.structuredContent.snapshots.items[0].threadInventory.items[0];
        const evidence = await call('read_thread_evidence', { reportId, snapshotIndex: 0, sourceKey: row.sourceKey });
        const rendered = await call('render_thread_report', { reportId, snapshotIndex: 0, sourceKey: row.sourceKey, language: 'sv' });
        runs.push({ totalToolMs: Math.round(performance.now() - started), analysisRoundTripMs: analysis.roundTripMs,
            evidenceRoundTripMs: evidence.roundTripMs, reportRoundTripMs: rendered.roundTripMs,
            analysis: analysis.response.structuredContent.timing, report: rendered.response._meta.jvmscopeTimings });
    }
    console.log(JSON.stringify({ scope: 'Three stdio tool calls per overview; excludes model reasoning, UI construction and desktop display.',
        node: process.version, connectionMs, medianToolMs: runs.map(r => r.totalToolMs).sort((a, b) => a - b)[3], runs }, null, 2));
} finally { await client.close(); }

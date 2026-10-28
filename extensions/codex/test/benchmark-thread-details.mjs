// Repeatable tool-transport trace; excludes model reasoning and desktop rendering.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'jvmscope focused benchmark '));
const plugin = path.join(directory, 'plugin'), capture = path.join(directory, 'series.txt');
const client = new Client({ name: 'focused-benchmark', version: '1.0.0' });
const traces = [];
async function call(name, args) {
    const started = performance.now(), r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(JSON.stringify(r));
    traces.push({ name, ms: Math.round(performance.now() - started), modelCharacters: JSON.stringify({ content: r.content, structuredContent: r.structuredContent }).length });
    return r;
}
async function trial(action) { const start = performance.now(), offset = traces.length; await action(); return { ms: Math.round(performance.now() - start), calls: traces.slice(offset) }; }
const summary = runs => ({ medianMs: runs.map(r => r.ms).sort((a,b) => a-b)[3], callsPerFollowUp: runs[0].calls.length,
    modelCharacters: runs[0].calls.reduce((n,c) => n+c.modelCharacters, 0), runs });
try {
    await cp(path.join(repo, 'build/codex-marketplace/plugins/jvmscope'), plugin, { recursive: true });
    await cp(path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt'), capture);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: directory }));
    const analysis = (await call('analyze_thread_dumps', { paths: [capture] })).structuredContent;
    const rows = analysis.snapshots.items[2].measurements.threads.items;
    const sourceKeys = ['scenario-cpu-and-allocation-hot', 'scenario-livelock-2-agent-1', 'scenario-livelock-2-agent-2'].map(name => rows.find(t => t.name === name).sourceKey);
    const args = { reportId: analysis.reportId, snapshotIndex: 2, sourceKeys, language: 'sv' };
    const separate = [], focused = [];
    for (let i = 0; i < 7; i++) {
        separate.push(await trial(async () => {
            for (const sourceKey of sourceKeys) await call('read_thread_evidence', { reportId: analysis.reportId, snapshotIndex: 2, sourceKey });
            await call('render_thread_report', { reportId: analysis.reportId, snapshotIndex: 2, language: 'sv' });
        }));
        focused.push(await trial(async () => {
            await call('inspect_thread_details', args);
            await call('render_thread_details', { ...args, conclusion: {
                summary: 'De valda trådarna har jämförbara mätvärden i snapshot 3. Namn och stackramar bevisar inte livelock.',
                nextCheck: 'Granska de verifierade kodpositionerna och jämför nästa intervall.' } });
        }));
    }
    console.log(JSON.stringify({ scope: 'Packaged stdio tools with a fixed test assessment; excludes AI reasoning. The focused flow inspects evidence and then presents it.', node: process.version,
        separate: summary(separate), focused: summary(focused) }, null, 2));
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }

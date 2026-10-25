// Measures packaged stdio work only, not model reasoning or the desktop UI.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'jvmscope comparison '));
const plugin = path.join(directory, 'relocated plugin'), capture = path.join(directory, 'series.txt');
const client = new Client({ name: 'comparison-benchmark', version: '1.0.0' });
async function call(name, args) { const r = await client.callTool({ name, arguments: args }); if (r.isError) throw new Error(JSON.stringify(r)); return r; }
async function timed(fn) { const start = performance.now(); await fn(); return Math.round(performance.now() - start); }
try {
    await cp(path.join(repo, 'build/codex-marketplace/plugins/jvmscope'), plugin, { recursive: true });
    await cp(path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt'), capture);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: directory }));
    const analysis = (await call('analyze_thread_dumps', { paths: [capture], limit: 1 })).structuredContent;
    const options = { reportId: analysis.reportId, view: 'comparison', language: 'sv', offset: 0, limit: 4 };
    const reanalyzed = [], cached = [];
    for (let i = 0; i < 7; i++) {
        reanalyzed.push(await timed(async () => {
            const r = (await call('analyze_thread_dumps', { paths: [capture], limit: 4 })).structuredContent;
            await call('render_thread_report', { ...options, reportId: r.reportId });
        }));
        cached.push(await timed(() => call('render_thread_report', options)));
    }
    const response = await call('render_thread_report', options);
    if (process.env.JVMSCOPE_BENCHMARK_RESULT) await writeFile(process.env.JVMSCOPE_BENCHMARK_RESULT, JSON.stringify(response, null, 2));
    const summarize = (values, calls) => ({ calls, medianMs: [...values].sort((a,b) => a-b)[3], samplesMs: values });
    console.log(JSON.stringify({ scope: 'Packaged stdio MCP; excludes model/desktop time', node: process.version,
        reanalyzed: summarize(reanalyzed, 2), cached: summarize(cached, 1),
        modelComparisonCharacters: JSON.stringify(response.structuredContent.comparison).length,
        fullComparisonCharacters: JSON.stringify(response._meta.jvmscopeReport.snapshots.items.map(s => s.measurements)).length }, null, 2));
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }

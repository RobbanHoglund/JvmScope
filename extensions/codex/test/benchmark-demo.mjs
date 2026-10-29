// Reproducible transport benchmark. Excludes model reasoning and Codex UI rendering.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../../../build/codex-marketplace/plugins/jvmscope/', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'jvmscope benchmark '));
const plugin = path.join(temporary, 'relocated plugin');
const client = new Client({ name: 'jvmscope-demo-benchmark', version: '1.0.0' });
async function call(name, args = {}) {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(JSON.stringify(r));
    return r;
}
async function measure(run) { const start = performance.now(); await run(); return Math.round(performance.now() - start); }
try {
    await cp(source, plugin, { recursive: true });
    const connectionMs = await measure(() => client.connect(new StdioClientTransport({ command: process.execPath,
        args: [path.join(plugin, 'server/server.mjs')], cwd: temporary })));
    const coldDemoMs = await measure(() => call('show_thread_example', { language: 'sv' }));
    const baseline = [], oneCall = [];
    for (let i = 0; i < 7; i++) {
        baseline.push(await measure(async () => {
            const list = await call('list_samples', { analyzer: 'threads' });
            const sample = list.structuredContent.samples.find(s => s.file === 'confirmed-deadlock.txt');
            const analysis = (await call('analyze_thread_dumps', { paths: [sample.path] })).structuredContent;
            await call('read_capture_lines', { path: sample.path, sha256: analysis.sources[0].sha256, startLine: 1, endLine: 200 });
            await call('render_thread_report', { reportId: analysis.reportId, language: 'sv' });
        }));
        oneCall.push(await measure(() => call('show_thread_example', { language: 'sv' })));
    }
    const summarize = (values, calls) => ({ calls, medianMs: [...values].sort((a, b) => a - b)[3], samplesMs: values });
    console.log(JSON.stringify({ scope: 'Relocated packaged stdio MCP, no model or UI time', node: process.version,
        connectionMs, coldDemoMs, baseline: summarize(baseline, 4), oneCall: summarize(oneCall, 1) }, null, 2));
} finally { await client.close(); await rm(temporary, { recursive: true, force: true }); }

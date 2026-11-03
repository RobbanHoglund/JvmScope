// A real packaged MCP connection for independent, multi-turn skill trials.
// File transport also works when executor calls have separate network namespaces.
// Records raw calls/results, not expected answers. Never included in the plugin.
import { mkdir, writeFile, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Supply an absolute trial-output directory.');
await mkdir(output, { recursive: true });
const plugin = fileURLToPath(new URL('../../../build/codex-marketplace/plugins/jvmscope/', import.meta.url));
const client = new Client({ name: 'jvmscope-skill-trial', version: '1' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: output }));
const tools = await client.listTools();
let sequence = 0;
let running = true;
console.log(`MCP test session ready: ${output}`);
async function close() { running = false; await client.close(); }
process.on('SIGTERM', () => { void close(); });
process.on('SIGINT', () => { void close(); });
while (running) {
    for (const file of (await readdir(output)).filter(f => /^request-[a-f0-9-]+\.json$/.test(f))) {
        let result;
        try {
            const raw = await readFile(path.join(output, file), 'utf8');
            if (raw.length > 20000) throw new Error('Oversized request');
            const input = JSON.parse(raw);
            if (input.method === 'tools/list') result = tools;
            else {
                if (!tools.tools.some(t => t.name === input.name)) throw new Error('Unknown MCP tool');
                const number = ++sequence; result = await client.callTool(input);
                await writeFile(path.join(output, `call-${String(number).padStart(2, '0')}.json`), JSON.stringify({ input, result }, null, 2));
            }
        } catch (error) { result = { error: error.message }; }
        const dest = path.join(output, file.replace('request-', 'response-'));
        await writeFile(dest + '.tmp', JSON.stringify(result)); await rename(dest + '.tmp', dest);
        await unlink(path.join(output, file));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
}

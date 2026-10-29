import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) throw new Error('Supply the absolute session directory.');
let input = ''; for await (const chunk of process.stdin) input += chunk;
JSON.parse(input);
const id = randomUUID(), request = path.join(directory, `request-${id}.json`), response = path.join(directory, `response-${id}.json`);
await writeFile(request + '.tmp', input); await rename(request + '.tmp', request);
const deadline = Date.now() + 90000;
while (true) {
    try { const result = await readFile(response, 'utf8'); await unlink(response); console.log(result); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (Date.now() > deadline) throw new Error('MCP trial session did not respond.');
    await new Promise(resolve => setTimeout(resolve, 100));
}

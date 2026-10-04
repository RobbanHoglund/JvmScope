import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startSlimServer } from './server-process.mjs';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const packageDirectory = join(root, 'slim', 'build', 'package');
async function size(directory) {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        total += entry.isDirectory() ? await size(path) : (await stat(path)).size;
    }
    return total;
}
async function memory(pid) {
    if (process.platform !== 'win32') return null;
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$p = Get-Process -Id ${pid}; [pscustomobject]@{workingSetBytes=$p.WorkingSet64;privateBytes=$p.PrivateMemorySize64;peakWorkingSetBytes=$p.PeakWorkingSet64} | ConvertTo-Json -Compress`], { windowsHide: true });
    return JSON.parse(stdout);
}
const starts = [];
for (let i = 0; i < 3; i++) {
    const server = await startSlimServer();
    try { starts.push(Math.round(server.startupMs)); } finally { await server.stop(); }
}
const server = await startSlimServer({ useEnvironment: true });
let report;
try {
    const idle = await memory(server.child.pid);
    const index = await readFile(join(root, 'slim', 'build', 'generated', 'resources', 'web', 'assets.index'), 'utf8');
    const assets = index.trim().split('\n').map(line => {
        const [path, length, digest] = line.split('\t');
        return { path, length: Number(length), digest };
    });
    let requests = 0, receivedBytes = 0;
    const start = performance.now();
    const outcomes = await Promise.allSettled(Array.from({ length: 32 }, async (_, worker) => {
        for (let i = 0; i < 40; i++) {
            const asset = assets[(i + worker) % assets.length];
            const response = await fetch(server.url + asset.path, { signal: AbortSignal.timeout(10000) });
            assert.equal(response.status, 200);
            const bytes = Buffer.from(await response.arrayBuffer());
            assert.equal(bytes.byteLength, asset.length);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.digest);
            receivedBytes += bytes.byteLength;
            requests++;
        }
    }));
    for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
            console.error('Server output:', server.output);
            console.error('Completed requests:', requests);
            throw outcome.reason;
        }
    }
    const elapsedMs = Math.round(performance.now() - start);
    const loaded = await memory(server.child.pid);
    const runtime = join(packageDirectory, 'runtime', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const modules = (await execute(runtime, ['--list-modules'], { windowsHide: true })).stdout.trim().split(/\r?\n/);
    assert.deepEqual(modules.map(module => module.split('@')[0]).sort(), ['java.base', 'jdk.httpserver']);
    report = { measuredAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
        startupToHttpHealthMs: starts, appJarBytes: (await stat(join(packageDirectory, 'app.jar'))).size,
        runtimeBytes: await size(join(packageDirectory, 'runtime')), packageBytes: await size(packageDirectory), modules,
        configuration: 'HOST/PORT environment, no --host/--port CLI overrides', idle, loaded, workload: { concurrency: 32, requests, receivedBytes, elapsedMs },
        limitation: 'Windows process counters, not Linux cgroup limits. Run the separate container GA gate to verify Linux resource limits.' };
} finally { await server.stop(); }
await mkdir(join(root, '.run', 'slim-measurements'), { recursive: true });
await writeFile(join(root, '.run', 'slim-measurements', 'latest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

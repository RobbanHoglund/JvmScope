// Explicit integration smoke test; never part of npm test (it starts builds).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { SLIM_PORT, SLIM_URL } from '../../scripts/local-dev-config.mjs';
import { assertPortsAvailable } from '../../scripts/local-dev.mjs';

const launcher = fileURLToPath(new URL('../../scripts/local-dev.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const legacyDirectory = join(root, '.run', 'jvmscope');
const legacyState = join(legacyDirectory, 'state.json');
function run(action, compatibilityAlias = false, env = process.env) {
    const child = spawn(process.execPath, [launcher, action, ...(compatibilityAlias ? ['--slim'] : [])], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    return new Promise((accept, reject) => { child.once('error', reject); child.once('close', code => accept({ code, text })); });
}
async function status(compatibilityAlias = false) {
    const result = await run('status', compatibilityAlias);
    assert.equal(result.code, 0, result.text);
    return JSON.parse(result.text);
}
async function waitUntil(check) {
    for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100); }
    throw new Error('Lifecycle state did not settle.');
}
assert.equal(await status(), null, 'Stop JvmScope before running the smoke test.');
await assertPortsAvailable([SLIM_PORT]);
await assert.rejects(readFile(legacyState), { code: 'ENOENT' }, 'Stop the former launcher before the smoke test.');
try {
    await mkdir(legacyDirectory, { recursive: true });
    const token = randomUUID();
    await writeFile(legacyState, JSON.stringify({ root: 'not-this-checkout', token, pid: process.pid }));
    try {
        const rejected = await run('stop');
        assert.notEqual(rejected.code, 0);
        assert.match(rejected.text, /Invalid run state.*No process was stopped/);
        assert.equal(JSON.parse(await readFile(legacyState)).pid, process.pid);
    } finally { await unlink(legacyState); }
    console.log('PASS: invalid legacy state is rejected without guessing or killing an owner');

    const occupied = net.createServer();
    await new Promise((accept, reject) => { occupied.once('error', reject); occupied.listen(SLIM_PORT, '127.0.0.1', accept); });
    // Exercise the previous supervisor protocol without rebuilding Spring.
    const actualRoot = realpathSync(root);
    const project = createHash('sha256').update(actualRoot).digest('hex').slice(0, 12);
    const socketName = `ju-${project}-${token.replaceAll('-', '').slice(0, 12)}.sock`;
    const preferred = join(tmpdir(), socketName);
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\jvmscope-${project}-${token}`
        : Buffer.byteLength(preferred) < 100 ? preferred : join('/tmp', socketName);
    let legacyStops = 0;
    const legacy = net.createServer(socket => {
        let input = '';
        socket.on('data', async chunk => {
            input += chunk;
            if (!input.includes('\n')) return;
            const request = JSON.parse(input);
            assert.equal(request.token, token);
            if (request.action === 'stop') {
                legacyStops++;
                await unlink(legacyState);
            }
            socket.end(JSON.stringify({ status: request.action === 'stop' ? 'stopping' : 'running' }));
        });
    });
    await new Promise((accept, reject) => { legacy.once('error', reject); legacy.listen(endpoint, accept); });
    await writeFile(legacyState, JSON.stringify({ root: actualRoot, token, pid: process.pid }));
    try {
        const rejected = await run('start');
        assert.notEqual(rejected.code, 0);
        assert.match(rejected.text, /Port 23873 is unavailable/);
        assert.equal(occupied.listening, true);
        assert.equal(await status(), null);
        assert.equal(legacyStops, 1);
        await assert.rejects(readFile(legacyState), { code: 'ENOENT' });
    } finally {
        await new Promise(accept => legacy.close(accept));
        await new Promise(accept => occupied.close(accept));
        await unlink(legacyState).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    console.log('PASS: upgrade gracefully stops the authenticated former supervisor; occupied port preserves its owner');

    const pending = run('start');
    await waitUntil(async () => (await status())?.children.some(child => child.name === 'build'));
    assert.equal((await run('stop')).code, 0);
    assert.notEqual((await pending).code, 0);
    assert.equal(await status(), null);
    await assertPortsAvailable([SLIM_PORT]);
    console.log('PASS: cancellation stops the owned build and removes state');

    const failed = await run('start', true, { ...process.env, JAVA_HOME: join(tmpdir(), `missing-java-${randomUUID()}`) });
    assert.notEqual(failed.code, 0);
    assert.doesNotMatch(failed.text, /Startup was cancelled/);
    await waitUntil(async () => await status() === null);
    await assertPortsAvailable([SLIM_PORT]);
    console.log('PASS: preparation failure is contained and releases the fixed port');

    // Git Bash can force ANSI styling even when logs are redirected.
    const colored = { ...process.env, FORCE_COLOR: '1' };
    delete colored.NO_COLOR;
    for (const result of await Promise.all([run('start', false, colored), run('start', true, colored)])) assert.equal(result.code, 0, result.text);
    const running = await status();
    assert.equal(running.status, 'running');
    assert.deepEqual(running.children.map(child => child.name), ['slim']);
    assert.equal((await run('start')).code, 0);
    assert.equal((await status()).pid, running.pid);
    assert.equal((await fetch(`${SLIM_URL}/health`)).status, 200);
    for (const path of ['/jvmscope/tda.html', '/jvmscope/tls.html']) assert.equal((await fetch(SLIM_URL + path)).status, 200);
    assert.deepEqual(await status(true), running, 'The compatibility alias must address the same supervisor');
    console.log('PASS: canonical/alias concurrent starts share one linked Java server with both analyzers');

    // Kill only the child just created and verified through its own supervisor.
    process.kill(running.children[0].pid);
    await waitUntil(async () => await status() === null);
    await assertPortsAvailable([SLIM_PORT]);
    assert.equal(await status(true), null);
    console.log('PASS: unexpected server exit cleans up the shared launcher');

    assert.equal((await run('start')).code, 0);
    assert.equal((await run('stop', true)).code, 0);
    assert.equal((await run('stop')).code, 0);
    assert.equal(await status(), null);
    await assertPortsAvailable([SLIM_PORT]);
    assert.equal(await status(true), null);
    console.log('PASS: alias stop and repeated canonical stop release the shared port');
} finally {
    const result = await run('stop');
    assert.equal(result.code, 0, result.text);
}

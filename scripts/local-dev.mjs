import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { HOST, SLIM_PORT, SLIM_URL } from './local-dev-config.mjs';
import { withFrontendInstallLock } from './frontend-install.mjs';

const launcher = fileURLToPath(import.meta.url);
const repoRoot = realpathSync(resolve(dirname(launcher), '..'));
// Retain the existing Slim state directory and accept --slim as a compatibility alias.
const runDirectory = join(repoRoot, '.run', 'jvmscope-slim');
const applicationName = 'JvmScope';
const statePath = join(runDirectory, 'state.json');
const isWindows = process.platform === 'win32';
const startupTimeout = 180_000;

function endpoint(token) {
    const project = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
    const name = `jvmscope-${project}-${token}`;
    if (isWindows) return `\\\\.\\pipe\\${name}`;
    // macOS TMPDIR paths can be long; Unix sockets have a small path-length limit.
    const socketName = `ju-${project}-${token.replaceAll('-', '').slice(0, 12)}.sock`;
    const preferred = join(tmpdir(), socketName);
    return Buffer.byteLength(preferred) < 100 ? preferred : join('/tmp', socketName);
}

async function readState(stateFile = statePath) {
    let state;
    for (let attempt = 0; ; attempt++) {
        try { state = JSON.parse(await readFile(stateFile, 'utf8')); break; }
        catch (error) {
            if (error.code === 'ENOENT') return null;
            // A concurrent start can read the new exclusive lock before its first write finishes.
            if (error instanceof SyntaxError && attempt < 5) { await delay(100); continue; }
            throw error;
        }
    }
    if (state.root !== repoRoot || !/^[a-f0-9-]{36}$/.test(state.token)
            || !Number.isSafeInteger(state.pid) || state.pid <= 0) {
        throw new Error(`Invalid run state: ${stateFile}. No process was stopped.`);
    }
    return state;
}

function processExists(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

async function removeState(token, stateFile = statePath) {
    const state = await readState(stateFile);
    if (state?.token === token) await unlink(stateFile);
}

async function updateState(state) {
    const temporary = `${statePath}.${state.token}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, statePath);
}

export function requestControl(token, action) {
    return new Promise((accept, reject) => {
        const socket = net.createConnection(endpoint(token));
        let response = '';
        socket.setTimeout(1500, () => socket.destroy(new Error('The local launcher did not respond.')));
        socket.on('error', reject);
        socket.on('connect', () => socket.write(`${JSON.stringify({ token, action })}\n`));
        socket.on('data', chunk => {
            response += chunk;
            if (response.length > 4096) socket.destroy(new Error('Invalid launcher response.'));
        });
        socket.on('end', () => {
            try {
                const result = JSON.parse(response);
                if (result.error) reject(new Error(result.error)); else accept(result);
            } catch (error) { reject(error); }
        });
    });
}

export async function assertPortsAvailable(ports = [SLIM_PORT]) {
    const reservations = [];
    try {
        for (const port of ports) {
            const server = net.createServer();
            await new Promise((accept, reject) => {
                server.once('error', error => reject(new Error(`Port ${port} is unavailable (${error.code}). Stop its owner or try again later; ports will not change.`)));
                server.listen({ host: HOST, port, exclusive: true }, accept);
            });
            reservations.push(server);
        }
    } finally {
        await Promise.all(reservations.map(server => new Promise(accept => server.close(accept))));
    }
}

async function controlStatus(state, stateFile = statePath) {
    // Another start can see the lock before the new supervisor has opened its pipe.
    for (let attempt = 0; attempt < 10; attempt++) {
        try { return await requestControl(state.token, 'status'); }
        catch {
            const current = await readState(stateFile);
            if (!current || current.token !== state.token) return null;
            state = current;
            if (!processExists(state.pid)) { await removeState(state.token, stateFile); return null; }
            await delay(200);
        }
    }
    throw new Error(`The previous launcher (PID ${state.pid}) is not responding. Check ${dirname(stateFile)}; no unrelated process will be stopped.`);
}

function printReady() {
    console.log(`JvmScope · Java TLS Log Analyzer: ${SLIM_URL}/jvmscope/tls.html\nThread dumps:         ${SLIM_URL}/jvmscope/tda.html\nLogs:                 ${runDirectory}`);
}

export async function waitForServiceReady(child, url, logPath, marker, { timeoutMs = 60_000, isStopping = () => false } = {}) {
    const name = basename(logPath, '.log');
    const deadline = Date.now() + timeoutMs;
    while (!isStopping() && Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${name} failed to start. See ${name}.log.`);
        const log = stripVTControlCharacters(await readFile(logPath, 'utf8'));
        if (log.includes(marker)) {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(1500, Math.max(1, deadline - Date.now()))) });
                if (response.ok) { await response.arrayBuffer(); return; }
                await response.body?.cancel();
            } catch { /* The process can report startup before accepting HTTP requests. */ }
        }
        await delay(200);
    }
    if (!isStopping()) throw new Error(`${name} did not become ready. See ${name}.log.`);
}

async function waitForStart(token, child, shouldCancel = () => false) {
    const deadline = Date.now() + startupTimeout;
    let exited = false;
    child?.once('exit', () => { exited = true; });
    child?.once('error', () => { exited = true; });
    let lastPhase = '';
    while (Date.now() < deadline) {
        const state = await readState();
        if (exited || !state || state.token !== token) throw new Error(`Startup failed. See ${join(runDirectory, 'launcher.log')} and build.log/slim.log.`);
        let result;
        try { result = await requestControl(token, 'status'); }
        catch { /* The supervisor can still be opening its control endpoint. */ }
        if (result) {
            if (shouldCancel()) { await requestControl(token, 'stop'); throw new Error('Startup was cancelled.'); }
            if (result.status === 'running') { printReady(); return; }
            if (result.phase !== lastPhase) { console.log(result.phase); lastPhase = result.phase; }
            if (result.failure) throw new Error(result.failure);
            if (result.status === 'stopping') throw new Error('Startup was cancelled.');
        }
        await delay(300);
    }
    await requestControl(token, 'stop').catch(() => {});
    throw new Error(`Startup timed out. See the logs in ${runDirectory}.`);
}

async function start() {
    // An upgrade must not leave the former Spring/Vite launcher running beside
    // the sole server. Its authenticated supervisor stops only its owned children.
    await stopOwnedState(join(repoRoot, '.run', 'jvmscope', 'state.json'));
    await mkdir(runDirectory, { recursive: true });
    const existing = await readState();
    if (existing) {
        const status = await controlStatus(existing);
        if (status?.status === 'running') { console.log(`${applicationName} is already running.`); printReady(); return; }
        if (status) { await waitForStart(existing.token); return; }
    }
    const state = { root: repoRoot, token: randomUUID(), pid: process.pid };
    let lock;
    try { lock = await open(statePath, 'wx', 0o600); }
    catch (error) {
        if (error.code === 'EEXIST') { await delay(300); return start(); }
        throw error;
    }
    await lock.writeFile(JSON.stringify(state));
    await lock.close();
    let log;
    let child;
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    try {
        // Reserve the startup lock before probing ports, so simultaneous starts do not
        // mistake each other's temporary port reservations for another application.
        await assertPortsAvailable();
        log = await open(join(runDirectory, 'launcher.log'), 'w');
        child = spawn(process.execPath, [launcher, 'supervise', state.token], {
            cwd: repoRoot, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
        });
        child.unref();
        process.once('SIGINT', cancel);
        await waitForStart(state.token, child, () => cancelled);
    } catch (error) {
        await requestControl(state.token, 'stop').catch(() => {});
        if (!child?.pid || child.exitCode !== null || child.signalCode !== null) await removeState(state.token);
        throw error;
    } finally { process.removeListener('SIGINT', cancel); await log?.close(); }
}

async function stopOwnedState(stateFile) {
    const state = await readState(stateFile);
    if (!state || !await controlStatus(state, stateFile)) return false;
    await requestControl(state.token, 'stop');
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if ((await readState(stateFile))?.token !== state.token) return true;
        await delay(100);
    }
    throw new Error(`Shutdown has not completed. Check ${join(dirname(stateFile), 'launcher.log')}.`);
}

async function stop() {
    const legacyStopped = await stopOwnedState(join(repoRoot, '.run', 'jvmscope', 'state.json'));
    const stopped = await stopOwnedState(statePath);
    console.log(stopped || legacyStopped ? 'JvmScope stopped.' : `${applicationName} is already stopped.`);
}

async function supervise(token) {
    const state = await readState();
    if (state?.token !== token) throw new Error('The startup lock no longer belongs to this launcher.');
    await updateState({ ...state, pid: process.pid });
    const children = new Set();
    let status = 'starting';
    let phase = 'Preparing JvmScope...';
    let stopping = false;
    let shutdownPromise;
    let failure;

    async function terminate(child) {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
        const closed = new Promise(accept => child.once('close', accept));
        if (child.serviceName === 'slim' && child.stdin?.writable) {
            child.stdin.end('stop\n');
            const graceful = new AbortController();
            try { await Promise.race([closed, delay(5000, undefined, { signal: graceful.signal })]); }
            finally { graceful.abort(); }
            if (child.exitCode !== null || child.signalCode !== null) return;
        }
        if (isWindows) {
            // --no-daemon keeps every Gradle descendant inside this launcher's build tree.
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            await new Promise(accept => { killer.once('error', accept); killer.once('close', accept); });
        } else {
            try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        const timeout = new AbortController();
        try { await Promise.race([closed, delay(5000, undefined, { signal: timeout.signal })]); }
        finally { timeout.abort(); }
        if (child.exitCode === null && child.signalCode === null) {
            if (isWindows) child.kill();
            else { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
            await closed;
        }
    }

    function shutdown(exitCode = 0, error) {
        if (shutdownPromise) return shutdownPromise;
        stopping = true;
        status = 'stopping';
        if (exitCode !== 0) failure = error?.message || 'Startup failed. See launcher.log.';
        shutdownPromise = (async () => {
            await Promise.all([...children].map(terminate));
            await new Promise(accept => server.close(accept));
            await removeState(token);
            process.exitCode = exitCode;
        })();
        return shutdownPromise;
    }

    const server = net.createServer(socket => {
        let message = '';
        socket.setTimeout(1500, () => socket.destroy());
        socket.on('error', () => {});
        socket.on('data', chunk => {
            message += chunk;
            if (message.length > 4096) { socket.destroy(); return; }
            if (!message.includes('\n')) return;
            try {
                const request = JSON.parse(message);
                if (request.token !== token) { socket.end(JSON.stringify({ error: 'Invalid launcher token.' })); return; }
                if (request.action === 'status') socket.end(JSON.stringify({ status, phase, failure, pid: process.pid, children: [...children].map(child => ({ name: child.serviceName, pid: child.pid })) }));
                else if (request.action === 'stop') {
                    socket.end(JSON.stringify({ status: 'stopping' }));
                    shutdown().catch(error => { console.error(error); process.exitCode = 1; });
                } else socket.end(JSON.stringify({ error: 'Unknown launcher action.' }));
            } catch { socket.end(JSON.stringify({ error: 'Invalid launcher request.' })); }
        });
    });
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(endpoint(token), accept); });
    process.once('SIGTERM', () => { shutdown().catch(console.error); });
    process.once('SIGINT', () => { shutdown().catch(console.error); });
    const fatal = error => { console.error(error); shutdown(1, error).catch(console.error); };
    process.once('uncaughtException', fatal);
    process.once('unhandledRejection', fatal);

    async function managed(command, args, name, cwd = repoRoot) {
        const log = await open(join(runDirectory, `${name}.log`), 'w');
        let child;
        try {
            if (stopping) throw new Error('Startup was cancelled.');
            child = spawn(command, args, { cwd, detached: !isWindows, windowsHide: true,
                windowsVerbatimArguments: isWindows && name === 'build',
                stdio: [name === 'slim' ? 'pipe' : 'ignore', log.fd, log.fd] });
            child.serviceName = name;
            child.stdin?.on('error', () => {}); // Already closed during a simultaneous process exit.
            children.add(child);
            child.once('close', () => {
                children.delete(child);
                if (name !== 'build' && !stopping) {
                    const error = new Error(`${name} exited unexpectedly. See ${name}.log. Stopping JvmScope.`);
                    console.error(error.message);
                    shutdown(1, error).catch(console.error);
                }
            });
            // Register the error listener before the next tick, including missing executables.
            await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
        } finally { await log.close(); }
        return child;
    }

    async function build(command, args, cwd) {
        const child = await managed(command, args, 'build', cwd);
        await new Promise((accept, reject) => {
            child.once('error', reject);
            child.once('close', code => code === 0 ? accept() : reject(new Error(`Build failed (${code}). See build.log.`)));
        });
    }

    try {
        const vite = join(repoRoot, 'frontend', 'node_modules', 'vite', 'bin', 'vite.js');
        const installMarker = join(repoRoot, '.run', 'frontend-install.pending');
        const legacyMarkers = ['jvmscope', 'jvmscope-slim'].map(profile => join(repoRoot, '.run', profile, 'npm-install.pending'));
        await withFrontendInstallLock(join(repoRoot, '.run'), token, () => stopping, async () => {
            if (!existsSync(vite) || [installMarker, ...legacyMarkers].some(existsSync)) {
                phase = 'Installing frontend dependencies...';
                // An interrupted npm ci must be repaired by the next start.
                await writeFile(installMarker, token);
                if (isWindows) await build(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci'], join(repoRoot, 'frontend'));
                else await build('npm', ['ci'], join(repoRoot, 'frontend'));
                for (const marker of [installMarker, ...legacyMarkers]) {
                    await unlink(marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
                }
            }
        });
        if (stopping) return;
        phase = 'Building JvmScope and its Java runtime...';
        const gradleTasks = '-p slim assembleSlim';
        if (isWindows) {
            const wrapper = join(repoRoot, 'scripts', 'gradlew.bat');
            await build(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${wrapper}" ${gradleTasks} -x npmInstall --no-daemon --console=plain"`]);
        } else await build('bash', [join(repoRoot, 'scripts', 'gradlew'), ...gradleTasks.split(' '), '-x', 'npmInstall', '--no-daemon', '--console=plain']);
        if (stopping) return;
        phase = 'Starting JvmScope...';
        const packageDirectory = join(repoRoot, 'slim', 'build', 'package');
        const slim = await managed(join(packageDirectory, 'runtime', 'bin', isWindows ? 'java.exe' : 'java'),
            ['-Xms8m', '-Xmx64m', '-XX:+UseSerialGC', '-Xss256k', '--add-modules', 'jdk.httpserver',
                '-jar', join(packageDirectory, 'app.jar'), `--host=${HOST}`, `--port=${SLIM_PORT}`, '--stdin-control'], 'slim');
        await waitForServiceReady(slim, `${SLIM_URL}/health`, join(runDirectory, 'slim.log'), 'JvmScope slim server ready:', { isStopping: () => stopping });
        if (!stopping) { status = 'running'; phase = 'JvmScope is ready.'; }
    } catch (error) {
        if (!stopping) { console.error(error); await shutdown(1, error); }
    }
}

export async function getStatus() {
    const state = await readState();
    return state ? controlStatus(state) : null;
}

async function main() {
    const action = process.argv[2];
    if (action === 'start') await start();
    else if (action === 'stop') await stop();
    else if (action === 'supervise') await supervise(process.argv[3]);
    else if (action === 'status') console.log(JSON.stringify(await getStatus()));
    else throw new Error('Usage: node scripts/local-dev.mjs start|stop|status [--slim]');
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(launcher)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

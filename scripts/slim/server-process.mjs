// Test-only process fixture: an isolated port and the actual linked runtime/JAR.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const packageDirectory = fileURLToPath(new URL('../../slim/build/package/', import.meta.url));

// A newly built JAR can be tested with the existing linked runtime while the
// user's running package remains untouched.
export async function startSlimServer({ useEnvironment = false, jarPath = join(packageDirectory, 'app.jar') } = {}) {
    const reservation = net.createServer();
    await new Promise((accept, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', accept); });
    const port = reservation.address().port;
    await new Promise(accept => reservation.close(accept));
    const started = performance.now();
    const child = spawn(join(packageDirectory, 'runtime', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
        ['-Xms8m', '-Xmx64m', '-XX:+UseSerialGC', '-Xss256k', '--add-modules', 'jdk.httpserver', '-jar', jarPath, ...(useEnvironment ? [] : ['--host=127.0.0.1', `--port=${port}`]), '--stdin-control'],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(useEnvironment ? { HOST: '127.0.0.1', PORT: String(port) } : {}) } });
    let output = '', failure;
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdin.on('error', () => {});
    child.once('error', error => { failure = error; });
    const closed = new Promise(accept => child.once('close', code => accept(code)));
    async function stop() {
        if (child.exitCode !== null || child.signalCode !== null || failure) return;
        child.stdin.end('stop\n');
        const timeout = new AbortController();
        try { await Promise.race([closed, delay(6000, undefined, { signal: timeout.signal })]); }
        finally { timeout.abort(); }
        if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; throw new Error('Slim test server required forced shutdown.'); }
        if (child.exitCode !== 0) throw new Error(`Slim test server exit ${child.exitCode}: ${output}`);
    }
    const url = `http://127.0.0.1:${port}`;
    try {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (failure) throw failure;
            if (child.exitCode !== null) throw new Error(`Slim test startup failed: ${output}`);
            if (output.includes('JvmScope slim server ready:')) {
                const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
                if (response?.ok) { await response.arrayBuffer(); return { url, child, stop, startupMs: performance.now() - started, get output() { return output; } }; }
                await response?.body?.cancel();
            }
            await delay(25);
        }
        throw new Error(`Slim test readiness timed out: ${output}`);
    } catch (error) { await stop(); throw error; }
}

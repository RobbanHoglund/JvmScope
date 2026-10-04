// Linux-only release gate for the actual image. Owns only randomly named
// disposable containers; never connects to Railway or a user's running app.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'linux', 'Run this gate on a Linux Docker host');
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, '.run', 'container-ga');
const image = process.env.SLIM_TEST_IMAGE || 'jvmscope-slim:ga';
const memoryLimit = 128 * 1024 * 1024;
const names = [];
const report = { image, memoryLimit, cpuLimit: 0.5, coldStartsMs: [], shutdownsMs: [], peakSampledMemoryBytes: 0, passed: false };
const docker = (...args) => execute('docker', args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
await mkdir(output, { recursive: true });

async function inspect(name) {
    return JSON.parse((await docker('inspect', name)).stdout)[0];
}

async function logs(name) {
    const result = await docker('logs', name);
    return result.stdout + result.stderr;
}

async function start() {
    const name = `java-tls-ga-${randomUUID()}`;
    names.push(name);
    const started = performance.now();
    await docker('run', '--detach', '--name', name, '--memory=128m', '--memory-swap=128m',
        '--cpus=0.5', '--pids-limit=64', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=1m',
        '--publish', '127.0.0.1::23873', image);
    const mapping = (await docker('port', name, '23873/tcp')).stdout.trim();
    assert.match(mapping, /^127\.0\.0\.1:\d+$/);
    const url = `http://${mapping}`;
    const deadline = Date.now() + 20000;
    while (true) {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
        if (response?.ok) {
            assert.equal((await response.json()).status, 'UP');
            break;
        }
        await response?.body?.cancel();
        assert.ok(Date.now() < deadline, `Cold startup timed out: ${await logs(name)}`);
        assert.equal((await inspect(name)).State.Running, true, 'Container exited during cold startup');
        await delay(100);
    }
    report.coldStartsMs.push(Math.round(performance.now() - started));
    const info = await inspect(name);
    assert.equal(info.HostConfig.Memory, memoryLimit);
    assert.equal(info.HostConfig.MemorySwap, memoryLimit, 'Do not hide insufficient memory with swap');
    assert.equal(info.HostConfig.NanoCpus, 500000000);
    assert.equal((await docker('exec', name, 'id', '-u')).stdout.trim(), '10001');
    assert.equal((await docker('exec', name, 'cat', '/sys/fs/cgroup/memory.max')).stdout.trim(), String(memoryLimit));
    const [quota, period] = (await docker('exec', name, 'cat', '/sys/fs/cgroup/cpu.max')).stdout.trim().split(/\s+/).map(Number);
    assert.equal(quota / period, 0.5);
    return { name, url };
}

async function stop(server) {
    const started = performance.now();
    // Docker sends the image's SIGTERM, then would force SIGKILL at eight seconds.
    await docker('stop', '--time', '8', server.name);
    const state = (await inspect(server.name)).State;
    const elapsed = Math.round(performance.now() - started);
    assert.equal(state.OOMKilled, false);
    assert.ok([0, 143].includes(state.ExitCode), `Unexpected exit ${state.ExitCode}; forced shutdown is not graceful`);
    assert.ok(elapsed < 7000, `SIGTERM shutdown took ${elapsed} ms`);
    report.shutdownsMs.push(elapsed);
    await writeFile(join(output, `${server.name}.log`), await logs(server.name));
}

async function sampleMemory(server) {
    const bytes = Number((await docker('exec', server.name, 'cat', '/sys/fs/cgroup/memory.current')).stdout.trim());
    assert.ok(bytes > 0 && bytes <= memoryLimit);
    report.peakSampledMemoryBytes = Math.max(report.peakSampledMemoryBytes, bytes);
}

try {
    // Actual image starts, including non-root/read-only runtime and real cgroups.
    for (let i = 0; i < 2; i++) await stop(await start());
    const server = await start();
    for (const file of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']) {
        assert.equal((await docker('exec', server.name, 'cat', `/app/${file}`)).stdout,
            await readFile(join(root, file), 'utf8'), `Container notice differs from source: ${file}`);
    }
    report.legalNoticesVerified = true;
    await docker('cp', `${server.name}:/app/app.jar`, join(output, 'app.jar'));
    const index = (await execute('unzip', ['-p', join(output, 'app.jar'), 'web/assets.index'])).stdout;
    const assets = index.trim().split('\n').map(line => {
        const [path, length, digest] = line.split('\t');
        return { path, length: Number(length), digest };
    });
    assert.ok(assets.length > 0);
    let requests = 0, bytes = 0;
    const started = performance.now();
    const deadline = Date.now() + 60000;
    let loading = true;
    const sampling = (async () => {
        while (loading) { await sampleMemory(server); await delay(1000); }
    })();
    // Attach rejection handling immediately; inspect every result after load.
    const sampled = sampling.then(() => null, error => error);
    const outcomes = await Promise.allSettled(Array.from({ length: 32 }, async (_, worker) => {
        let i = worker;
        do {
            const asset = assets[i++ % assets.length];
            const response = await fetch(server.url + asset.path, { signal: AbortSignal.timeout(15000) });
            assert.equal(response.status, 200);
            const body = Buffer.from(await response.arrayBuffer());
            assert.equal(body.length, asset.length);
            assert.equal(createHash('sha256').update(body).digest('hex'), asset.digest);
            requests++;
            bytes += body.length;
        } while (Date.now() < deadline);
    }));
    loading = false;
    const samplingError = await sampled;
    if (samplingError) throw samplingError;
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
    report.load = { concurrency: 32, durationMs: Math.round(performance.now() - started), requests, receivedBytes: bytes };
    assert.ok(requests >= assets.length * 32);
    assert.equal((await inspect(server.name)).State.OOMKilled, false);

    // Same TLS/TDA desktop/laptop cases as the packaged-server gate, now under
    // container limits. Analysis remains in the host browser, outside this JVM.
    const browser = spawn(process.execPath, [join(root, 'frontend/node_modules/@playwright/test/cli.js'),
        'test', '--config', 'test/tls/playwright.slim.config.js'], {
        cwd: join(root, 'frontend'), stdio: 'inherit',
        env: { ...process.env, SLIM_TEST_CONTAINER_URL: server.url },
    });
    await new Promise((resolve, reject) => {
        browser.once('error', reject);
        browser.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Container browser checks failed: ${code ?? signal}`)));
    });
    report.browserChecks = 'passed';
    await sampleMemory(server);
    await stop(server);
    report.passed = true;
    report.checkedAt = new Date().toISOString();
    report.limitations = 'One Linux x64 container at 128 MiB/0.5 CPU; 60 seconds of load, not a production soak or a universal minimum.';
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: constrained Linux image, three cold starts, non-root runtime, 60-second verified load, browsers and SIGTERM');
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    report.failure = error.stack || String(error);
    throw error;
} finally {
    for (const name of names) {
        try {
            await writeFile(join(output, `${name}.log`), await logs(name).catch(() => ''));
        } finally { await docker('rm', '--force', name).catch(() => {}); }
    }
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}

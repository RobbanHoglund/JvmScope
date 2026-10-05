import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { FRONTEND_PORT, HOST, SLIM_PORT, SLIM_URL } from './local-dev-config.mjs';
import { assertPortsAvailable, waitForServiceReady } from './local-dev.mjs';
import viteConfig from '../frontend/vite.config.js';
import { ARTICLES } from '../frontend/assets/javautils/knowledge/data.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withFrontendInstallLock } from './frontend-install.mjs';
import { spawn } from 'node:child_process';

test('Railway detects a root Dockerfile that preserves the explicit slim build', async () => {
    const read = path => readFile(new URL(path, import.meta.url), 'utf8');
    const [rootRecipe, legacyRecipe, workflow] = await Promise.all([
        read('../Dockerfile'), read('../slim/Dockerfile'), read('../.github/workflows/analyzer-tests.yml'),
    ]);
    const directives = recipe => recipe.split(/\r?\n/)
        .filter(line => !line.trim().startsWith('#')).join('\n').trim();
    assert.equal(directives(rootRecipe), directives(legacyRecipe), 'default and legacy entry points must build the same image');
    assert.match(workflow, /run: docker build -t jvmscope-slim:ga \./, 'CI builds the automatically detected recipe');
});

test('the app and optional Vite preview use fixed high ports without an analysis API proxy', () => {
    for (const port of [SLIM_PORT, FRONTEND_PORT]) {
        assert.ok(Number.isInteger(port) && port > 20_000 && port <= 65_535);
    }
    assert.notEqual(SLIM_PORT, FRONTEND_PORT);
    const { server } = viteConfig({ mode: 'development' });
    assert.equal(server.port, FRONTEND_PORT);
    assert.equal(server.host, HOST);
    assert.equal(server.strictPort, true);
    assert.equal(server.proxy, undefined);
});

test('the application includes home and knowledge pages but excludes the optional preview utilities page', () => {
    assert.ok(SLIM_PORT > 20_000 && SLIM_PORT <= 65_535);
    assert.equal(SLIM_URL, `http://${HOST}:${SLIM_PORT}`);
    const full = viteConfig({ mode: 'production' });
    const slim = viteConfig({ mode: 'slim' });
    const knowledge = ['knowledge-index', ...ARTICLES.map(a=>`knowledge-${a.id}`)];
    assert.deepEqual(Object.keys(full.build.rollupOptions.input).sort(), [...knowledge, 'main', 'tda', 'tls', 'utils'].sort());
    assert.deepEqual(Object.keys(slim.build.rollupOptions.input).sort(), [...knowledge, 'main', 'tda', 'tls'].sort());
    assert.notEqual(full.build.outDir, slim.build.outDir);
    const navigation = config => config.plugins.find(plugin => plugin.name === 'tool-navigation')
        .transformIndexHtml.handler('<head></head><body></body>', { filename: '/jvmscope/tls.html' });
    const fullNavigation = navigation(full);
    const slimNavigation = navigation(slim);
    assert.match(fullNavigation, /href="\/">JvmScope home/);
    assert.match(slimNavigation, /JvmScope home/);
    for (const html of [fullNavigation, slimNavigation]) {
        assert.doesNotMatch(html, /dockerutils|Docker images/);
        assert.match(html, /href="\/jvmscope\/tls.html" aria-current="page"/);
        assert.match(html, /href="\/jvmscope\/tda.html"/);
        assert.match(html, /href="\/knowledge\/index.html"/);
    }
});

test('dependency installation callers serialize, release on failure and honor cancellation', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'jvmscope-install-'));
    t.after(async () => {
        assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
        await rm(scratch, { recursive: true, force: true });
    });
    let active = 0, peak = 0;
    const install = async () => { peak = Math.max(peak, ++active); await delay(100); active--; };
    await Promise.all([1, 2].map(() => withFrontendInstallLock(scratch, randomUUID(), () => false, install)));
    assert.equal(peak, 1, 'npm ci cannot run concurrently across callers');
    await assert.rejects(withFrontendInstallLock(scratch, randomUUID(), () => false, async () => { throw new Error('install failed'); }), /install failed/);
    await withFrontendInstallLock(scratch, randomUUID(), () => false, install);
    await assert.rejects(withFrontendInstallLock(scratch, randomUUID(), () => true, install), /Startup was cancelled/);
    await assert.rejects(readFile(join(scratch, 'frontend-install.lock')), { code: 'ENOENT' });
    const gone = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' });
    await new Promise((accept, reject) => { gone.once('error', reject); gone.once('close', accept); });
    await writeFile(join(scratch, 'frontend-install.lock'), JSON.stringify({ pid: gone.pid, token: randomUUID() }));
    peak = 0;
    await Promise.all([1, 2, 3, 4].map(() => withFrontendInstallLock(scratch, randomUUID(), () => false, install)));
    assert.equal(peak, 1, 'competing stale-lock recoverers cannot delete an active owner lock');
    await assert.rejects(readFile(join(scratch, 'frontend-install.lock.recovery')), { code: 'ENOENT' });
});

function listen() {
    const server = net.createServer();
    return new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen({ host: HOST, port: 0, exclusive: true }, () => accept(server));
    });
}

test('port preflight preserves the existing owner and releases earlier reservations on failure', async () => {
    const owner = await listen();
    const temporary = await listen();
    const availablePort = temporary.address().port;
    await new Promise(accept => temporary.close(accept));
    try {
        const occupiedPort = owner.address().port;
        await assert.rejects(assertPortsAvailable([availablePort, occupiedPort]), new RegExp(`Port ${occupiedPort} is unavailable`));
        assert.equal(owner.listening, true);
        await assertPortsAvailable([availablePort]);
        assert.equal(owner.listening, true);
    } finally { await new Promise(accept => owner.close(accept)); }
});

async function readinessFixture(t, log, respond) {
    const scratch = await mkdtemp(join(tmpdir(), 'jvmscope-ready-'));
    const logPath = join(scratch, 'slim.log');
    await writeFile(logPath, log);
    const server = http.createServer(respond);
    await new Promise((accept, reject) => {
        server.once('error', reject);
        server.listen(0, HOST, accept);
    });
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(accept => server.close(accept));
        assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
        await rm(scratch, { recursive: true, force: true });
    });
    return { child: { exitCode: null, signalCode: null }, url: `http://${HOST}:${server.address().port}/`, logPath };
}

for (const [name, log, marker] of [
    ['colored Java server output', '\u001b[1mJvmScope slim server ready:\u001b[22m http://127.0.0.1:23873/\n', 'JvmScope slim server ready:'],
    ['plain Java server output', 'JvmScope slim server ready: http://127.0.0.1:23873/\n', 'JvmScope slim server ready:'],
]) {
    test(`readiness recognizes ${name} and waits for actual HTTP success`, async t => {
        let requests = 0;
        const fixture = await readinessFixture(t, log, (_request, response) => {
            response.writeHead(++requests === 1 ? 503 : 200);
            response.end('ready');
        });
        await waitForServiceReady(fixture.child, fixture.url, fixture.logPath, marker, { timeoutMs: 2000 });
        assert.equal(requests, 2);
    });
}

test('an HTTP listener without this child startup marker cannot satisfy readiness', async t => {
    let requests = 0;
    const fixture = await readinessFixture(t, 'Preparing...\n', (_request, response) => {
        requests++;
        response.end('unrelated listener');
    });
    await assert.rejects(waitForServiceReady(fixture.child, fixture.url, fixture.logPath, 'JvmScope slim server ready:', { timeoutMs: 50 }), /slim did not become ready/);
    assert.equal(requests, 0);
});

test('a failed child never becomes ready even if its log contains the marker', async t => {
    const fixture = await readinessFixture(t, 'JvmScope slim server ready:\n', (_request, response) => response.end('ready'));
    fixture.child.exitCode = 1;
    await assert.rejects(waitForServiceReady(fixture.child, fixture.url, fixture.logPath, 'JvmScope slim server ready:'), /slim failed to start/);
});

test('HTTP error responses time out instead of claiming readiness', async t => {
    const fixture = await readinessFixture(t, 'JvmScope slim server ready:\n', (_request, response) => {
        response.writeHead(503);
        response.end('not ready');
    });
    await assert.rejects(waitForServiceReady(fixture.child, fixture.url, fixture.logPath, 'JvmScope slim server ready:', { timeoutMs: 50 }), /slim did not become ready/);
});

test('a stalled HTTP response body cannot hang or complete readiness', async t => {
    const fixture = await readinessFixture(t, 'JvmScope slim server ready:\n', (_request, response) => {
        response.writeHead(200, { 'Content-Length': '100' });
        response.write('partial');
    });
    await assert.rejects(waitForServiceReady(fixture.child, fixture.url, fixture.logPath, 'JvmScope slim server ready:', { timeoutMs: 100 }), /slim did not become ready/);
});

test('explicit shutdown interrupts readiness without changing it into a startup failure', async t => {
    let stopping = false;
    const fixture = await readinessFixture(t, 'JvmScope slim server ready:\n', (_request, response) => {
        stopping = true;
        response.writeHead(503);
        response.end();
    });
    await waitForServiceReady(fixture.child, fixture.url, fixture.logPath, 'JvmScope slim server ready:', { isStopping: () => stopping });
    assert.equal(stopping, true);
});

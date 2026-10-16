const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const sourceFile = path.resolve(__dirname, '../src/extension.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const ready = { channel: 'jvmscope', version: 1, type: 'ready' };

async function host(t) {
    const commands = new Map(), timers = new Map(), panels = [], errors = [];
    const disposable = () => ({ dispose() {} });
    const uri = value => ({ path: value, toString: () => 'file://' + value });
    let nextTimer = 0, failRead = false;
    const vscode = {
        Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)) },
        ViewColumn: { Active: 1 },
        EventEmitter: class { constructor() { this.event = () => disposable(); } fire() {} dispose() {} },
        workspace: {
            registerTextDocumentContentProvider: disposable,
            fs: { readFile: async resource => {
                if (resource.path.endsWith('/pages.json')) return Buffer.from(JSON.stringify(['jvmscope/tda.html', 'jvmscope/tls.html', 'knowledge/index.html']));
                if (failRead) { failRead = false; throw new Error('Cannot read packaged page'); }
                return Buffer.from('<!doctype html><html><head></head><body></body></html>');
            } },
        },
        window: {
            createTreeView: disposable,
            showErrorMessage: async message => { errors.push(message); },
            createWebviewPanel: () => {
                let onDispose, onMessage;
                const panel = {
                    disposed: false, reveals: 0,
                    webview: {
                        cspSource: 'https://test.invalid', asWebviewUri: resource => resource,
                        postMessage: async () => !panel.disposed,
                        onDidReceiveMessage: handler => { onMessage = handler; return disposable(); },
                    },
                    onDidDispose: handler => { onDispose = handler; return disposable(); },
                    dispose() { if (!this.disposed) { this.disposed = true; onDispose(); } },
                    reveal() { this.reveals++; },
                    receive: message => onMessage(message),
                };
                panels.push(panel);
                return panel;
            },
        },
        commands: { registerCommand: (name, action) => { commands.set(name, action); return disposable(); } },
    };
    const module = { exports: {} }, localRequire = createRequire(sourceFile);
    vm.runInNewContext(readFileSync(sourceFile, 'utf8'), {
        module, require: name => name === 'vscode' ? vscode : localRequire(name), TextDecoder, Buffer, Error,
        setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
        clearTimeout: id => timers.delete(id),
    }, { filename: sourceFile });
    const context = { extensionUri: uri('/extension'), subscriptions: [] };
    await module.exports.activate(context);
    t.after(() => context.subscriptions.forEach(item => item.dispose()));
    return {
        panels, errors, timers, run: name => commands.get(name)(),
        failNextRead: () => { failRead = true; },
        expireStartup() {
            for (const [id, timer] of [...timers]) if (timer.ms === 30_000) { timers.delete(id); timer.callback(); }
        },
    };
}

test('Open retries timed-out webviews and ignores late ready messages from the failed panel', async t => {
    for (const command of ['jvmscope.openTda', 'jvmscope.openTls', 'jvmscope.openKnowledge']) {
        const h = await host(t);
        const first = h.run(command);
        await tick();
        assert.ok(h.panels[0].webview.html, 'The packaged page was assigned, but the host never delivered ready');
        h.expireStartup();
        assert.match((await first).error, /did not finish loading/);
        await h.panels[0].receive(ready);
        const retry = h.run(command);
        await tick();
        assert.equal(h.panels.length, 2, 'Retry must create a fresh webview');
        assert.equal(h.panels[0].disposed, true);
        let completed = false;
        retry.then(() => { completed = true; });
        await h.panels[0].receive(ready);
        await tick();
        assert.equal(completed, false, 'The failed panel cannot complete the new startup');
        await h.panels[1].receive(ready);
        assert.equal(await retry, undefined);
        assert.equal(h.errors.length, 1);
        assert.equal(h.timers.size, 0);
    }
});

test('healthy analyzer panels remain retained when another analyzer fails and retries', async t => {
    const h = await host(t);
    const tls = h.run('jvmscope.openTls');
    await tick(); await h.panels[0].receive(ready); await tls;
    const tda = h.run('jvmscope.openTda');
    await tick(); h.expireStartup(); await tda;
    assert.equal(await h.run('jvmscope.openTls'), undefined);
    assert.equal(h.panels.length, 2);
    assert.equal(h.panels[0].disposed, false);
    assert.equal(h.panels[0].reveals, 1);
    const retry = h.run('jvmscope.openTda');
    await tick(); await h.panels[2].receive(ready); await retry;
    assert.equal(h.panels[0].disposed, false);
});

test('a packaged-page read failure disposes the incomplete session and allows a fresh open', async t => {
    const h = await host(t);
    h.failNextRead();
    assert.match((await h.run('jvmscope.openTda')).error, /Cannot read packaged page/);
    assert.equal(h.panels[0].disposed, true);
    assert.equal(h.timers.size, 0);
    const retry = h.run('jvmscope.openTda');
    await tick();
    assert.equal(h.panels.length, 2);
    await h.panels[1].receive(ready);
    assert.equal(await retry, undefined);
});

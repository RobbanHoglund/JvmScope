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
    const commands = new Map(), timers = new Map(), panels = [], errors = [], trees = [], captures = new Map();
    const disposable = () => ({ dispose() {} });
    const uri = value => ({ path: value, toString: () => 'file://' + value, with: () => uri(value.split('#')[0]) });
    let nextTimer = 0, failRead = false;
    const vscode = {
        Uri: { joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)), parse: value => uri(new URL(value).pathname) },
        FileType: { Directory: 2 },
        ViewColumn: { Active: 1 },
        EventEmitter: class { constructor() { this.event = () => disposable(); } fire() {} dispose() {} },
        workspace: {
            textDocuments: [],
            registerTextDocumentContentProvider: disposable,
            fs: { stat: async resource => { if (!captures.has(resource.path)) throw new Error('Capture missing'); return { type: 1, size: Buffer.byteLength(captures.get(resource.path)) }; }, readFile: async resource => {
                if (captures.has(resource.path)) return Buffer.from(captures.get(resource.path));
                if (resource.path.endsWith('/pages.json')) return Buffer.from(JSON.stringify(['index.html', 'jvmscope/tda.html', 'jvmscope/tls.html', 'jvmscope/gc.html', 'knowledge/index.html', 'knowledge/thread-dumps.html']));
                if (failRead) { failRead = false; throw new Error('Cannot read packaged page'); }
                return Buffer.from('<!doctype html><html><head></head><body></body></html>');
            } },
        },
        window: {
            createTreeView: (id, options) => { trees.push({ id, ...options }); return disposable(); },
            showErrorMessage: async message => { errors.push(message); },
            createWebviewPanel: () => {
                let onDispose, onMessage;
                const panel = {
                    disposed: false, reveals: 0, messages: [],
                    webview: {
                        cspSource: 'https://test.invalid', asWebviewUri: resource => resource,
                        postMessage: async message => { panel.messages.push(message); return !panel.disposed; },
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
        panels, errors, timers, trees, captures, vscode, run: name => commands.get(name)(),
        failNextRead: () => { failRead = true; },
        expireStartup() {
            for (const [id, timer] of [...timers]) if (timer.ms === 30_000) { timers.delete(id); timer.callback(); }
        },
    };
}

test('the registered sidebar drop controller delivers file contents to each actual panel and waits for analysis acknowledgement', async t => {
    const h = await host(t);
    const drop = h.trees.find(tree => tree.id === 'jvmscope.analysis').dragAndDropController;
    assert.ok(drop, 'File drops must be wired to the contributed tree, not just implemented in isolation');
    h.captures.set('/capture.log', 'real host read boundary');
    for (const analyzer of ['tda', 'tls', 'gc']) {
        const operation = drop.handleDrop({ analyzer }, new Map([['text/uri-list', { asString: async () => 'file:///capture.log' }]]), { isCancellationRequested: false });
        await tick(); const panel = h.panels.at(-1);
        await panel.receive(ready); await tick();
        const load = panel.messages.find(message => message.type === 'load');
        assert.equal(load.sources[0].text, 'real host read boundary');
        assert.match(load.sources[0].hostSourceId, /^[a-f0-9-]{36}$/);
        await panel.receive({ ...ready, type: 'loaded', id: load.id, value: { analyzed: analyzer } });
        assert.deepEqual(await operation, { analyzed: analyzer });
    }
    assert.deepEqual(h.errors, []);
});

test('webview URI drops read dirty editor content, return source IDs and reject links before filesystem access', async t => {
    const h = await host(t);
    const opening = h.run('jvmscope.openTda'); await tick();
    const panel = h.panels[0]; await panel.receive(ready); await opening;
    h.captures.set('/capture.log', 'stale disk');
    h.vscode.workspace.textDocuments.push({ uri: h.vscode.Uri.parse('file:///capture.log'), version: 2, getText: () => 'unsaved editor contents' });
    const request = uris => ({ ...ready, type: 'request', id: 'web:1', action: 'readDroppedFiles', uris });
    await panel.receive(request(['file:///capture.log#L1,1']));
    assert.equal(panel.messages.at(-1).value[0].text, 'unsaved editor contents');
    assert.match(panel.messages.at(-1).value[0].hostSourceId, /^[a-f0-9-]{36}$/);
    await panel.receive(request(['https://example.com/capture.log']));
    assert.match(panel.messages.at(-1).error, /not capture files/);
    await panel.receive(request(['file:///missing.log']));
    assert.match(panel.messages.at(-1).error, /Capture missing/);
});

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

test('reopening Knowledge Base reveals its retained page instead of resetting the reading session', async t => {
    const h = await host(t);
    const first = h.run('jvmscope.openKnowledge');
    await tick(); await h.panels[0].receive(ready); await first;
    const panel = h.panels[0], html = panel.webview.html;
    const tda = h.run('jvmscope.openTda');
    await tick(); await h.panels[1].receive(ready); await tda;
    const reopen = h.run('jvmscope.openKnowledge');
    await tick();
    assert.equal(h.panels.length, 2, 'Switching tools must reuse the existing knowledge tab');
    assert.equal(panel.disposed, false);
    assert.equal(panel.webview.html, html, 'Retain article, filters and reading position');
    assert.equal(panel.reveals, 1);
    assert.equal(await reopen, undefined);
});

test('explicit knowledge links change the reading route in the same tab and reject unknown pages', async t => {
    const h = await host(t);
    const first = h.run('jvmscope.openKnowledge');
    await tick(); await h.panels[0].receive(ready); await first;
    const panel = h.panels[0], html = panel.webview.html;
    const request = route => ({ channel: 'jvmscope', version: 1, type: 'request', id: 'web:1', action: 'navigate', route });
    const route = '/knowledge/thread-dumps.html?java=25#check';
    await panel.receive(request(route));
    assert.equal(h.panels.length, 1);
    assert.equal(panel.webview.html, html, 'The document must retain its browsing history');
    assert.ok(panel.messages.some(message => message.type === 'knowledgeRoute' && message.route === route));
    const before = panel.messages.filter(message => message.type === 'knowledgeRoute').length;
    for (const invalid of ['/knowledge/missing.html', '/knowledge/index.html?java=999', '//evil.invalid/knowledge/index.html']) {
        await panel.receive(request(invalid));
        assert.match(panel.messages.at(-1).error, /Unknown JvmScope page/);
    }
    assert.equal(panel.messages.filter(message => message.type === 'knowledgeRoute').length, before);
    await h.run('jvmscope.openKnowledge');
    assert.equal(panel.messages.filter(message => message.type === 'knowledgeRoute').length, before, 'Launcher resumes rather than navigating to the index');
    await panel.receive(request('/index.html'));
    assert.equal(h.panels.length, 2, 'The bundled home page has its own renderer');
    assert.equal(panel.disposed, true);
    await h.panels[1].receive(ready);
    const reopen = h.run('jvmscope.openKnowledge');
    await tick();
    assert.equal(h.panels.length, 3, 'The knowledge launcher must not resume the home page');
    await h.panels[2].receive(ready); await reopen;
});

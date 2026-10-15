const vscode = require('vscode');
const { randomUUID } = require('node:crypto');
const { renderWebview, resolveRoute } = require('./webview.cjs');
const { MAX_BYTES, isMessage, validateRequest, readSources } = require('./protocol.cjs');
const { SourceRegistry } = require('./source-navigation.cjs');
const decoder = new TextDecoder();
const titles = { tda: 'JvmScope · Thread dumps', tls: 'JvmScope · TLS logs', docs: 'JvmScope · Knowledge' };

async function activate(context) {
    const media = vscode.Uri.joinPath(context.extensionUri, 'media');
    const pages = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, 'pages.json'))));
    const sessions = new Map(), sequences = new Map(), evidence = new Map();
    const changes = new vscode.EventEmitter();
    context.subscriptions.push(changes, vscode.workspace.registerTextDocumentContentProvider('jvmscope-evidence', {
        onDidChange: changes.event,
        provideTextDocumentContent: uri => evidence.get(uri.toString())?.text || 'This in-memory capture has been closed or replaced.',
    }));
    const clearEvidence = owner => {
        for (const [key, value] of evidence) if (value.owner === owner) { evidence.delete(key); changes.fire(vscode.Uri.parse(key)); }
    };
    const errorMessage = error => error instanceof Error ? error.message : 'The requested JvmScope action failed.';

    async function openPage(route) {
        const { name, hash } = resolveRoute(route, pages);
        const kind = name === 'jvmscope/tda.html' ? 'tda' : name === 'jvmscope/tls.html' ? 'tls' : 'docs';
        let session = sessions.get(kind);
        if (session && session.page === name) {
            session.panel.reveal();
            if (hash) await session.panel.webview.postMessage({ channel: 'jvmscope', version: 1, type: 'revealHash', hash });
            return session;
        }
        if (session) session.panel.dispose();
        const panel = vscode.window.createWebviewPanel('jvmscope.' + kind, titles[kind], vscode.ViewColumn.Active, {
            enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media], enableFindWidget: true,
        });
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');
        const id = randomUUID();
        const sources = new SourceRegistry(vscode);
        let readyResolve, readyReject;
        const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
        // A user may close a loading panel before a command starts waiting for it.
        ready.catch(() => {});
        const readyTimer = setTimeout(() => readyReject(new Error('JvmScope did not finish loading. Close and reopen the view.')), 30_000);
        session = { panel, page: name, owner: id, sources, ready, disposed: false, loads: new Map(), nextLoad: 0, requests: new Set() };
        sessions.set(kind, session);
        panel.onDidDispose(() => {
            session.disposed = true; clearTimeout(readyTimer); readyReject(new Error('The analysis view closed.'));
            for (const job of session.loads.values()) { clearTimeout(job.timer); job.reject(new Error('The analysis view closed.')); }
            session.loads.clear(); clearEvidence(id);
            sources.dispose();
            if (sessions.get(kind) === session) sessions.delete(kind);
        }, null, context.subscriptions);
        const reply = message => panel.webview.postMessage({ channel: 'jvmscope', version: 1, ...message });
        async function handleRequest(message) {
            validateRequest(message);
            switch (message.action) {
                case 'chooseFiles': {
                    if (kind === 'docs') throw new Error('Open an analyzer before choosing captures.');
                    const uris = await vscode.window.showOpenDialog({ canSelectMany: kind === 'tda', canSelectFolders: false,
                        openLabel: kind === 'tda' ? 'Analyze thread dumps' : 'Analyze TLS log',
                        filters: { 'Capture files': ['txt', 'log', 'json', 'dump', 'tdump'], 'All files': ['*'] } });
                    return uris ? readSources(vscode, uris, kind, sources.register.bind(sources)) : null;
                }
                case 'syncSources': sources.activate(message.sourceIds); return true;
                case 'openSource': return sources.open(message);
                case 'copy': await vscode.env.clipboard.writeText(message.text); return true;
                case 'clearRaw': clearEvidence(id); return true;
                case 'paste': {
                    const text = await vscode.env.clipboard.readText();
                    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('Clipboard exceeds the 64 MiB limit.');
                    return text;
                }
                case 'openRaw': {
                    clearEvidence(id);
                    const name = message.name.replace(/[^\w. -]/g, '_') || 'capture.txt';
                    const uri = vscode.Uri.from({ scheme: 'jvmscope-evidence', path: `/${id}/${name}` });
                    evidence.set(uri.toString(), { owner: id, text: message.text }); changes.fire(uri);
                    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside, preview: true });
                    return true;
                }
                case 'save': {
                    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(message.name), saveLabel: 'Export findings' });
                    if (!uri) return false;
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(message.base64, 'base64'));
                    return true;
                }
                case 'navigate': await openPage(message.route); return true;
                case 'external': return vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
        }
        panel.webview.onDidReceiveMessage(async message => {
            if (session.disposed || !isMessage(message)) return;
            if (message.type === 'ready') {
                clearTimeout(readyTimer); readyResolve();
                if (hash) void reply({ type: 'revealHash', hash });
            } else if (message.type === 'loaded') {
                const job = session.loads.get(message.id);
                if (!job) return;
                session.loads.delete(message.id); clearTimeout(job.timer);
                if (message.error) job.reject(new Error(String(message.error).slice(0, 500))); else job.resolve(message.value);
            } else if (message.type === 'request') {
                if (session.requests.has(message.id) || session.requests.size >= 4) return;
                session.requests.add(message.id);
                try { const value = await handleRequest(message); if (!session.disposed) await reply({ type: 'response', id: message.id, value }); }
                catch (error) { if (!session.disposed) await reply({ type: 'response', id: message.id, error: errorMessage(error) }); }
                finally { session.requests.delete(message.id); }
            }
        }, null, context.subscriptions);
        const html = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, name)));
        if (!session.disposed) panel.webview.html = renderWebview(html, { page: name, pages, cspSource: panel.webview.cspSource,
            resourceUri: relative => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, relative)).toString() });
        return session;
    }

    async function analyze(kind, uri, selected) {
        const sequence = (sequences.get(kind) || 0) + 1; sequences.set(kind, sequence);
        const uris = Array.isArray(selected) && selected.length ? selected : uri ? [uri]
            : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : null;
        if (!uris) throw new Error('Open a capture in the editor or select it in Explorer first.');
        const session = await openPage(`/jvmscope/${kind}.html`);
        const sources = await readSources(vscode, uris, kind, session.sources.register.bind(session.sources));
        if (sequences.get(kind) !== sequence || session.disposed) return { cancelled: true };
        await session.ready;
        if (sequences.get(kind) !== sequence || session.disposed) return { cancelled: true };
        clearEvidence(session.owner);
        const id = `host:${++session.nextLoad}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { session.loads.delete(id); reject(new Error('Analysis timed out. Try a smaller capture.')); }, 120_000);
            session.loads.set(id, { resolve, reject, timer });
            session.panel.webview.postMessage({ channel: 'jvmscope', version: 1, type: 'load', id, sources }).then(delivered => {
                if (!delivered) { clearTimeout(timer); session.loads.delete(id); reject(new Error('The analysis view is unavailable.')); }
            });
        });
    }
    const register = (name, action) => context.subscriptions.push(vscode.commands.registerCommand(name, async (...args) => {
        try { return await action(...args); }
        catch (error) { await vscode.window.showErrorMessage(errorMessage(error)); return { error: errorMessage(error) }; }
    }));
    register('jvmscope.openTda', async () => { const session = await openPage('/jvmscope/tda.html'); await session.ready; });
    register('jvmscope.openTls', async () => { const session = await openPage('/jvmscope/tls.html'); await session.ready; });
    register('jvmscope.analyzeThreadDump', (uri, selected) => analyze('tda', uri, selected));
    register('jvmscope.analyzeTlsLog', (uri, selected) => analyze('tls', uri, selected));
    context.subscriptions.push({ dispose: () => { for (const session of sessions.values()) session.panel.dispose(); evidence.clear(); } });
}
module.exports = { activate };

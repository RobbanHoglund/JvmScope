const { renderWebview } = require('./webview.cjs');
const CHANNEL = 'jvmscope-ai-result';
const PAGE = 'ai-result.html';

function safeLink(value) {
    if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//i.test(value)) return false;
    try { const url = new URL(value); return !url.username && !url.password; }
    catch { return false; }
}

/** A completed response is an independent, in-memory report until its tab closes. */
class AiResults {
    constructor(vscode, extensionUri) {
        this.vscode = vscode; this.extensionUri = extensionUri;
        this.media = vscode.Uri.joinPath(extensionUri, 'media');
        this.panels = new Set(); this.disposed = false;
    }

    async show(result, token) {
        const v = this.vscode;
        const html = new TextDecoder().decode(await v.workspace.fs.readFile(v.Uri.joinPath(this.media, PAGE)));
        // Reading packaged assets may finish after the owning job was cancelled.
        if (this.disposed || token.isCancellationRequested) throw new Error('AI response view cancelled');
        const panel = v.window.createWebviewPanel('jvmscope.aiResult', 'JvmScope · AI analysis', v.ViewColumn.Beside, {
            enableScripts: true, localResourceRoots: [this.media], enableFindWidget: true,
        });
        panel.iconPath = v.Uri.joinPath(this.extensionUri, 'icon.png');
        this.panels.add(panel);
        let closed = false, sourceDocument, actionRunning = false, settled = false, delivered = false;
        let readyResolve, readyReject;
        const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
        const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer); cancellation.dispose();
            if (error) readyReject(error); else readyResolve(panel);
        };
        const cancellation = token.onCancellationRequested(() => {
            finish(new Error('AI response view cancelled')); panel.dispose();
        });
        const timer = setTimeout(() => {
            finish(new Error('The AI response view did not finish loading. Reload the VS Code window and try again'));
            panel.dispose();
        }, 15_000);
        const reply = message => panel.webview.postMessage({ channel: CHANNEL, version: 1, ...message });
        const messages = panel.webview.onDidReceiveMessage(async message => {
            if (closed || message?.channel !== CHANNEL || message.version !== 1) return;
            if (message.type === 'ready') {
                delivered = true;
                // No capture or answer is embedded in executable HTML or persisted
                // via webview state. Resend the same snapshot after tab recreation.
                await reply({ type: 'result', result: { model: result.model, scope: result.scope, body: result.body, ...(result.findingContext ? { findingContext: result.findingContext } : {}) } });
            } else if (message.type === 'rendered' && delivered) finish();
            else if (message.type === 'action' && Number.isSafeInteger(message.id) && message.id > 0) {
                if (actionRunning) { await reply({ type: 'actionResult', id: message.id, message: 'Finish the previous action first.' }); return; }
                actionRunning = true;
                let status;
                try {
                    switch (message.action) {
                        case 'copy':
                            await v.env.clipboard.writeText(result.markdown); status = 'Markdown copied.'; break;
                        case 'save': {
                            const uri = await v.window.showSaveDialog({ defaultUri: v.Uri.file('jvmscope-ai-analysis.md'), saveLabel: 'Save AI response', filters: { Markdown: ['md'] } });
                            if (closed) return;
                            if (uri) { await v.workspace.fs.writeFile(uri, Buffer.from(result.markdown, 'utf8')); status = 'Markdown saved.'; }
                            else status = 'Save cancelled.';
                            break;
                        }
                        case 'source':
                            if (!sourceDocument || sourceDocument.isClosed) sourceDocument = await v.workspace.openTextDocument({ content: result.markdown, language: 'markdown' });
                            if (closed) return;
                            await v.window.showTextDocument(sourceDocument, { viewColumn: panel.viewColumn || v.ViewColumn.Active, preview: false });
                            status = 'Markdown source opened.'; break;
                        case 'external':
                            if (!safeLink(message.url)) throw new Error('Only HTTP or HTTPS links can be opened');
                            status = await v.env.openExternal(v.Uri.parse(message.url)) ? 'Link opened in your browser.' : 'The link could not be opened.';
                            break;
                        default: throw new Error('Unknown AI response action');
                    }
                } catch (error) { status = `Action failed: ${String(error.message || error).slice(0, 300)}`; }
                finally { actionRunning = false; }
                if (!closed) await reply({ type: 'actionResult', id: message.id, message: status });
            }
        });
        const disposal = panel.onDidDispose(() => {
            closed = true; this.panels.delete(panel); messages.dispose(); disposal.dispose();
            finish(new Error('The AI response view was closed before it finished loading'));
        });
        try {
            panel.webview.html = renderWebview(html, { page: PAGE, pages: [PAGE], cspSource: panel.webview.cspSource,
                resourceUri: name => panel.webview.asWebviewUri(v.Uri.joinPath(this.media, name)).toString() });
        } catch (error) { finish(error); panel.dispose(); }
        return ready;
    }

    dispose() { this.disposed = true; for (const panel of [...this.panels]) panel.dispose(); }
}
module.exports = { AiResults, safeLink };

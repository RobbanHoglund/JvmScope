const { MAX_BYTES, MAX_FILES, parseDroppedUris } = require('./protocol.cjs');
const analyzers = { tda: 'Java thread dumps', tls: 'Java TLS logs', gc: 'Java garbage collection' };

// Native tree drops reach the extension directly, without a webview overlay or
// Shift gesture. Route through the same analysis/load acknowledgement as commands.
class CaptureDropController {
    constructor(vscode, analyze) {
        this.vscode = vscode; this.analyze = analyze;
        this.dropMimeTypes = ['text/uri-list', 'files'];
        this.dragMimeTypes = [];
    }
    async handleDrop(target, transfer, token) {
        try {
            if (token.isCancellationRequested) return;
            if (target && !analyzers[target.analyzer]) throw new Error('Drop captures onto Thread dumps, TLS logs or Garbage collection in the JvmScope sidebar.');
            let kind = target?.analyzer;
            if (!kind) kind = (await this.vscode.window.showQuickPick(Object.entries(analyzers).map(([kind, label]) => ({ kind, label })),
                { placeHolder: 'Choose the analyzer for the dropped capture', ignoreFocusOut: true }, token))?.kind;
            if (!kind || token.isCancellationRequested) return;
            const files = [];
            transfer.forEach(item => { const file = item.asFile?.(); if (file) files.push(file); });
            // OS file bytes belong to the client machine. Do not reinterpret a
            // client's file: URI on a remote extension host.
            const list = files.length ? undefined : await transfer.get('text/uri-list')?.asString();
            if (token.isCancellationRequested) return;
            if (list) {
                if (list.length > 512 * 1024) throw new Error('The dropped file list is too large.');
                const uris = parseDroppedUris(this.vscode, list.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')));
                return await this.analyze(kind, { uris }, token);
            }
            if (!files.length || files.length > MAX_FILES) throw new Error('Drop between 1 and 50 capture files.');
            if (kind !== 'tda' && files.length !== 1) throw new Error(`Choose one ${kind.toUpperCase()} log at a time.`);
            const sources = []; let total = 0;
            for (const file of files) {
                if (token.isCancellationRequested) return;
                const bytes = await file.data();
                if (token.isCancellationRequested) return;
                total += bytes.byteLength;
                if (total > MAX_BYTES) throw new Error('Selected captures exceed the 64 MiB import limit.');
                sources.push({ name: file.name, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
            }
            return await this.analyze(kind, { sources }, token);
        } catch (error) {
            // Notification promises resolve only when dismissed. Do not keep a
            // native drop operation alive while the user reads its error.
            if (!token.isCancellationRequested) void this.vscode.window.showErrorMessage(error instanceof Error ? error.message : 'The dropped capture could not be opened.');
        }
    }
}
module.exports = { CaptureDropController };

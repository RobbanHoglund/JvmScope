const { createHash, randomUUID } = require('node:crypto');

// Parsers normalize line endings and an initial BOM. Neither changes physical
// line numbers. Compare the entire capture, not a possibly repeated excerpt.
const normalize = text => text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
const digest = text => createHash('sha256').update(normalize(text)).digest('hex');
const stale = () => new Error('The source has changed since analysis. Analyze the file again before opening this location.');

class SourceRegistry {
    constructor(vscode) { this.vscode = vscode; this.entries = new Map(); this.active = new Set(); this.disposed = false; }
    register(uri, text, version) {
        if (this.disposed) throw new Error('The analysis view closed.');
        const id = randomUUID();
        this.entries.set(id, { uri, digest: digest(text), lines: normalize(text).split('\n').length, version });
        return id;
    }
    activate(ids) {
        if (this.disposed || ids.some(id => !this.entries.has(id))) throw new Error('The source is no longer available. Analyze it again.');
        const next = new Set(ids);
        // Pending imports may still be queued in the webview. Retire only
        // previously active sources, never another import's pending references.
        for (const id of this.active) if (!next.has(id)) this.entries.delete(id);
        this.active = next;
    }
    async open({ sourceId, startLine, endLine }) {
        const source = this.entries.get(sourceId);
        if (this.disposed || !source || !this.active.has(sourceId)) throw new Error('The source is no longer part of this analysis.');
        if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)
            || startLine < 1 || endLine < startLine || endLine > source.lines) throw new Error('Invalid source line range.');
        const vscode = this.vscode;
        const document = await vscode.workspace.openTextDocument(source.uri);
        const current = () => !this.disposed && this.active.has(sourceId);
        if (!current()) throw new Error('The analysis changed before the source could be opened.');
        if (digest(document.getText()) !== source.digest) throw stale();
        const version = document.version;
        const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
        if (!current()) throw new Error('The analysis changed before the source could be opened.');
        if (document.version !== version && digest(document.getText()) !== source.digest) throw stale();
        const range = new vscode.Range(startLine - 1, 0, endLine - 1, document.lineAt(endLine - 1).text.length);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return true;
    }
    dispose() { this.disposed = true; this.entries.clear(); this.active.clear(); }
}
module.exports = { SourceRegistry };

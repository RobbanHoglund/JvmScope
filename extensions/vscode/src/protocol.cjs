const MAX_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 50;
const actions = new Set(['chooseFiles', 'copy', 'paste', 'openRaw', 'clearRaw', 'save', 'navigate', 'external', 'syncSources', 'openSource']);
const sourceId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const text = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_BYTES;
function isMessage(message) {
    return message && message.channel === 'jvmscope' && message.version === 1 && typeof message.type === 'string';
}
function validateRequest(message) {
    if (!isMessage(message) || message.type !== 'request' || typeof message.id !== 'string'
        || !/^web:\d{1,12}$/.test(message.id) || !actions.has(message.action)) throw new Error('Unsupported extension request.');
    if (['copy', 'openRaw'].includes(message.action) && !text(message.text)) throw new Error('Text exceeds the 64 MiB limit.');
    if (message.action === 'openRaw' && (typeof message.name !== 'string' || message.name.length > 240)) throw new Error('Invalid evidence name.');
    if (message.action === 'save') {
        if (typeof message.name !== 'string' || !/^[\w.-]{1,180}\.(?:md|html|txt|json|png)$/.test(message.name)
            || typeof message.base64 !== 'string' || message.base64.length > Math.ceil(MAX_BYTES / 3) * 4
            || message.base64.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.base64)) throw new Error('Invalid export.');
    }
    if (message.action === 'navigate' && (typeof message.route !== 'string' || message.route.length > 500)) throw new Error('Invalid page.');
    if (message.action === 'syncSources' && (!Array.isArray(message.sourceIds) || message.sourceIds.length > 1000
        || !message.sourceIds.every(sourceId))) throw new Error('Invalid source references.');
    if (message.action === 'openSource' && (!sourceId(message.sourceId) || !Number.isSafeInteger(message.startLine)
        || !Number.isSafeInteger(message.endLine) || message.startLine < 1 || message.endLine < message.startLine)) throw new Error('Invalid source location.');
    if (message.action === 'external') {
        if (typeof message.url !== 'string' || message.url.length > 4096) throw new Error('Invalid external link.');
        const url = new URL(message.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) documentation links can be opened.');
    }
    return message;
}
function sourceName(uri) { return uri.path.split('/').pop() || 'capture.txt'; }
async function readSources(vscode, uris, analyzer, registerSource = null) {
    if (!Array.isArray(uris) || !uris.length || uris.length > MAX_FILES) throw new Error('Choose between 1 and 50 capture files.');
    if (analyzer === 'tls' && uris.length !== 1) throw new Error('Choose one TLS log at a time. Thread analysis supports multiple files.');
    const sources = []; let total = 0;
    for (const uri of uris) {
        const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
        let content;
        if (document) content = document.getText();
        else {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type & vscode.FileType.Directory) throw new Error('Choose capture files, not folders.');
            if (stat.size > MAX_BYTES - total) throw new Error('Selected captures exceed the 64 MiB import limit.');
            const bytes = await vscode.workspace.fs.readFile(uri);
            if (bytes.byteLength > MAX_BYTES - total) throw new Error('Selected captures exceed the 64 MiB import limit.');
            content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        total += Buffer.byteLength(content, 'utf8');
        if (total > MAX_BYTES) throw new Error('Selected captures exceed the 64 MiB import limit.');
        sources.push({ name: sourceName(uri), text: content,
            ...(registerSource ? { hostSourceId: registerSource(uri, content, document?.version) } : {}) });
    }
    return sources;
}
module.exports = { MAX_BYTES, MAX_FILES, isMessage, validateRequest, readSources };

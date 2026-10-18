const fs = require('node:fs/promises');
const path = require('node:path');
function createResultHost(AiResults, extensionRoot) {
    const panels = [], calls = [];
    const uri = value => ({ fsPath: value, toString: () => value });
    const vscode = {
        Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)), file: uri, parse: uri },
        ViewColumn: { Beside: 2, Active: 1 },
        env: { clipboard: { writeText: async text => calls.push(['copy', text]) }, openExternal: async url => { calls.push(['external', url.toString()]); return true; } },
        workspace: { fs: { readFile: value => fs.readFile(value.fsPath), writeFile: async (value, data) => { calls.push(['save', value.toString(), data.toString('utf8')]); } },
            openTextDocument: async options => { calls.push(['source', options.content]); return { ...options, isClosed: false }; } },
        window: {
            showSaveDialog: async () => uri('chosen-report.md'),
            showTextDocument: async (document, options) => { calls.push(['editor', document, options]); },
            createWebviewPanel: (type, title, column, options) => {
                let receive, disposed;
                const panel = { type, title, viewColumn: column, options, closed: false, posted: [],
                    webview: { html: '', cspSource: 'https://resources.test',
                        asWebviewUri: value => uri('https://resources.test/' + path.relative(path.join(extensionRoot, 'media'), value.fsPath).split(path.sep).join('/')),
                        onDidReceiveMessage: callback => { receive = callback; return { dispose() {} }; },
                        postMessage: async message => { panel.posted.push(message); await panel.onPost?.(message); return !panel.closed; },
                    },
                    onDidDispose: callback => { disposed = callback; return { dispose() {} }; },
                    dispose: () => { if (!panel.closed) { panel.closed = true; disposed?.(); } },
                    receive: message => receive({ channel: 'jvmscope-ai-result', version: 1, ...message }),
                };
                panels.push(panel); return panel;
            },
        },
    };
    return { view: new AiResults(vscode, uri(extensionRoot)), vscode, panels, calls };
}
module.exports = { createResultHost };

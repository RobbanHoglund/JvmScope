// Deterministic provider boundary; the controller is loaded from the tested source or VSIX.
function createAiHost(AiAnalysis, { installed = ['GitHub.copilot-chat', 'openai.chatgpt', 'anthropic.claude-code'], tokens = 50, maxInputTokens = 1000, choose = true, deny = false, failOpen = false, timeoutMs } = {}) {
    const calls = [], errors = [], results = [];
    let cancel;
    class CancellationTokenSource {
        constructor() {
            this.listeners = new Set();
            this.token = { isCancellationRequested: false, onCancellationRequested: callback => {
                this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) };
            } };
        }
        cancel() {
            if (this.token.isCancellationRequested) return;
            this.token.isCancellationRequested = true;
            for (const listener of this.listeners) listener();
        }
        dispose() { this.listeners.clear(); }
    }
    const model = { name: 'Available model', vendor: 'copilot', id: 'model-from-provider', maxInputTokens,
        countTokens: async message => { calls.push(['count', message]); return tokens; },
        sendRequest: async messages => { calls.push(['send', messages]); return { text: (async function* () { yield 'Observed '; yield 'evidence.'; })() }; },
    };
    const vscode = {
        extensions: { getExtension: id => installed.includes(id) ? { activate: async () => calls.push(['activate', id]) } : undefined },
        lm: { selectChatModels: async selector => { calls.push(['models', selector]); if (deny) throw new Error('Access denied'); return [model]; } },
        commands: { getCommands: async () => ['chatgpt.openSidebar'], executeCommand: async (...args) => { calls.push(['command', ...args]); if (failOpen) throw new Error('Unavailable'); } },
        env: { uriScheme: 'vscode-insiders', clipboard: { writeText: async text => calls.push(['copy', text]) },
            openExternal: async uri => { calls.push(['external', uri]); return !failOpen; } },
        Uri: { from: value => value },
        CancellationTokenSource, ProgressLocation: { Notification: 15 }, ViewColumn: { Beside: 2 },
        LanguageModelChatMessage: { User: content => ({ role: 'user', content }) },
        window: {
            withProgress: async (options, action) => { calls.push(['progress', options]); return action({ report() {} }, {
                isCancellationRequested: false, onCancellationRequested: callback => { cancel = callback; return { dispose() {} }; },
            }); },
            showQuickPick: async options => choose ? options[0] : undefined,
            showTextDocument: async document => calls.push(['document', document]),
            showErrorMessage: async text => errors.push(text),
        },
        workspace: { openTextDocument: async document => document },
    };
    const ai = new AiAnalysis(vscode, { timeoutMs, showResult: async result => { results.push(result); } });
    return { ai, vscode, model, calls, errors, results, cancel: () => cancel() };
}

module.exports = { createAiHost };

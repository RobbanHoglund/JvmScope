const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AiAnalysis, MAX_AI_BYTES, validateAiInput } = require('../src/ai-analysis.cjs');

function host({ installed = ['GitHub.copilot-chat', 'openai.chatgpt', 'anthropic.claude-code'], tokens = 50, maxInputTokens = 1000, choose = true, deny = false, failOpen = false } = {}) {
    const calls = [], errors = [], documents = [];
    let cancel;
    class CancellationTokenSource {
        constructor() { this.token = { isCancellationRequested: false }; }
        cancel() { this.token.isCancellationRequested = true; }
        dispose() {}
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
        workspace: { openTextDocument: async document => { documents.push(document); return document; } },
    };
    const ai = new AiAnalysis(vscode);
    return { ai, vscode, model, calls, errors, documents, cancel: () => cancel() };
}

test('discovery only reports installed providers, without activation, auth or inference', () => {
    const h = host();
    assert.deepEqual(h.ai.providers().map(p => p.id), ['copilot', 'codex', 'claude']);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(host({ installed: [] }).ai.providers(), []);
    delete h.vscode.lm;
    assert.deepEqual(h.ai.providers().map(p => p.id), ['codex', 'claude']);
});

test('AI requests are bounded by UTF-8 bytes and fixed provider IDs', async () => {
    for (const [provider, prompt] of [['shell', 'hello'], ['codex', ' '], ['claude', {}], ['copilot', '界'.repeat(MAX_AI_BYTES / 2)]]) {
        assert.throws(() => validateAiInput(provider, prompt));
    }
    assert.doesNotThrow(() => validateAiInput('codex', 'x'.repeat(MAX_AI_BYTES)));
    const h = host({ installed: [] });
    await assert.rejects(h.ai.run('codex', 'evidence'), /not available/); assert.deepEqual(h.calls, []);
});

test('Codex handoff copies the reviewed text and invokes only its public launcher without submitting', async () => {
    const h = host(), prompt = 'edited evidence: `$(not a command)`\nUnicode ✓';
    const result = await h.ai.run('codex', prompt);
    assert.match(result.message, /Paste into Codex/);
    assert.deepEqual(h.calls, [['activate', 'openai.chatgpt'], ['copy', prompt], ['command', 'chatgpt.openSidebar']]);
    h.vscode.commands.getCommands = async () => [];
    const before = h.calls.length;
    await assert.rejects(h.ai.run('codex', prompt), /Copy prompt/);
    assert.deepEqual(h.calls.slice(before), [['activate', 'openai.chatgpt']]);
});

test('Claude handoff keeps diagnostic data out of URLs and recovers from a failed launcher', async () => {
    const h = host(), result = await h.ai.run('claude', 'private diagnostic text');
    assert.match(result.message, /Paste into Claude Code/);
    assert.deepEqual(h.calls, [['copy', 'private diagnostic text'], ['external', { scheme: 'vscode-insiders', authority: 'anthropic.claude-code', path: '/open' }]]);
    const failed = host({ failOpen: true });
    assert.match((await failed.ai.run('claude', 'evidence')).message, /copied, but/);
    failed.vscode.env.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
    const before = failed.calls.length;
    await assert.rejects(failed.ai.run('claude', 'evidence'), /Clipboard unavailable/);
    assert.equal(failed.calls.length, before, 'Never open the assistant when copying failed');
});

test('Copilot uses the chosen runtime model, exact reviewed prompt and a separate response editor', async () => {
    const h = host();
    await h.ai.run('copilot', 'user-edited prompt'); await h.ai.job;
    assert.deepEqual(h.calls.find(c => c[0] === 'models'), ['models', { vendor: 'copilot' }]);
    assert.deepEqual(h.calls.find(c => c[0] === 'send'), ['send', [{ role: 'user', content: 'user-edited prompt' }]]);
    assert.equal(h.documents.length, 1); assert.equal(h.documents[0].language, 'markdown');
    assert.match(h.documents[0].content, /Observed evidence/); assert.match(h.documents[0].content, /does not change JvmScope/);
    assert.ok(!h.calls.some(c => ['copy', 'command', 'external'].includes(c[0])));
    assert.deepEqual(h.errors, []); assert.equal(h.ai.running, false);
});

test('model cancellation, unavailable models, access denial and oversized evidence never send a request', async () => {
    for (const options of [{ choose: false }, { deny: true }, { tokens: 900 }, { maxInputTokens: NaN }]) {
        const h = host(options); await h.ai.run('copilot', 'reviewed'); await h.ai.job;
        assert.ok(!h.calls.some(c => c[0] === 'send')); assert.equal(h.documents.length, 0);
        assert.equal(h.errors.length, options.choose === false ? 0 : 1);
    }
    const h = host(); h.vscode.lm.selectChatModels = async () => [];
    await h.ai.run('copilot', 'reviewed'); await h.ai.job;
    assert.match(h.errors[0], /No Copilot models/);
});

test('one AI job at a time and disposal cancel model work without opening stale output', async () => {
    const h = host(); let complete;
    h.model.sendRequest = async (_messages, _options, token) => {
        await new Promise(resolve => { complete = resolve; });
        assert.equal(token.isCancellationRequested, true);
        return { text: (async function* () { yield 'late reply'; })() };
    };
    await h.ai.run('copilot', 'reviewed');
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(h.ai.run('copilot', 'another'), /already running/);
    h.ai.dispose(); complete(); await h.ai.job;
    assert.equal(h.documents.length, 0); assert.deepEqual(h.errors, []);
});

test('progress cancellation and stream failures do not present incomplete output as a result', async () => {
    for (const cancelled of [true, false]) {
        const h = host();
        h.model.sendRequest = async () => ({ text: (async function* () {
            yield 'partial';
            if (cancelled) h.cancel(); else throw new Error('Provider disconnected');
            yield 'reply';
        })() });
        await h.ai.run('copilot', 'reviewed'); await h.ai.job;
        assert.equal(h.documents.length, 0); assert.equal(h.errors.length, cancelled ? 0 : 1);
    }
});

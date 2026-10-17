const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AiAnalysis, MAX_AI_BYTES, validateAiInput } = require('../src/ai-analysis.cjs');

const { createAiHost } = require('./ai-host.cjs');
const host = options => createAiHost(AiAnalysis, options);

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
    await assert.rejects(h.ai.run('copilot', 'another'), /analysis is running/);
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

// VS Code notification promises stay pending until the user dismisses them.
test('failed Copilot requests release the job while the error notification is still open', async () => {
    const h = host({ deny: true });
    h.vscode.window.showErrorMessage = text => { h.errors.push(text); return new Promise(() => {}); };
    await h.ai.run('copilot', 'reviewed');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.errors.length, 1);
    assert.equal(h.ai.running, false, 'An undismissed notification must not lock further analysis');
    h.vscode.lm.selectChatModels = async () => [h.model];
    await h.ai.run('copilot', 'retry'); await h.ai.job;
    assert.equal(h.documents.length, 1);
});

for (const stage of ['discovery', 'picker', 'tokens', 'request', 'stream']) {
    test(`dialog cancellation releases an unresponsive ${stage} and ignores its late completion`, async () => {
        const h = host(); let release;
        const stuck = () => new Promise(resolve => { release = resolve; });
        if (stage === 'discovery') h.vscode.lm.selectChatModels = stuck;
        if (stage === 'picker') h.vscode.window.showQuickPick = stuck;
        if (stage === 'tokens') h.model.countTokens = stuck;
        if (stage === 'request') h.model.sendRequest = stuck;
        if (stage === 'stream') h.model.sendRequest = async () => ({ text: { [Symbol.asyncIterator]: () => ({ next: stuck, return: stuck }) } });
        const states = [];
        const result = await h.ai.run('copilot', 'reviewed', { owner: 'tda', onState: state => states.push(state) });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(typeof release, 'function', 'The requested boundary is awaiting the provider');
        assert.equal(h.ai.cancel('tls', result.jobId), false, 'Another panel cannot cancel this job');
        assert.equal(h.ai.cancel('tda', 'ai:999'), false, 'A stale button cannot cancel a newer job');
        assert.equal(h.ai.cancel('tda', result.jobId), true);
        await h.ai.job;
        assert.equal(h.ai.running, false);
        assert.equal(states.at(-1).state, 'cancelled');
        assert.equal(h.documents.length, 0);
        // Start a new job while the old provider still has not cooperated.
        h.vscode.lm.selectChatModels = () => new Promise(() => {});
        const next = await h.ai.run('copilot', 'retry', { owner: 'tda' });
        assert.notEqual(next.jobId, result.jobId);
        release(stage === 'discovery' ? [h.model] : stage === 'picker' ? { model: h.model } : stage === 'tokens' ? 50 : { done: true });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(h.ai.running, true, 'Late provider completion cannot clear the new job');
        assert.equal(h.documents.length, 0);
        assert.equal(states.at(-1).state, 'cancelled');
        h.ai.cancel('tda', next.jobId); await h.ai.job;
        assert.deepEqual(h.errors, []);
    });
}

test('an unresponsive provider times out with a visible, retryable error', async () => {
    const h = host({ timeoutMs: 20 }), states = [];
    h.vscode.lm.selectChatModels = () => new Promise(() => {});
    await h.ai.run('copilot', 'reviewed', { onState: state => states.push(state) }); await h.ai.job;
    assert.equal(h.ai.running, false);
    assert.equal(states.at(-1).state, 'error');
    assert.match(states.at(-1).message, /did not finish/);
    assert.equal(h.errors.length, 1);
    h.vscode.lm.selectChatModels = async () => [h.model];
    await h.ai.run('copilot', 'retry'); await h.ai.job;
    assert.equal(h.documents.length, 1);
});

test('closing an owning panel cancels pending discovery without requiring provider cooperation', async () => {
    const h = host(); h.vscode.lm.selectChatModels = () => new Promise(() => {});
    await h.ai.run('copilot', 'reviewed', { owner: 'tda' });
    h.ai.close('tls'); assert.equal(h.ai.running, true);
    h.ai.close('tda'); await h.ai.job;
    assert.equal(h.ai.running, false); assert.equal(h.errors.length, 0);
});

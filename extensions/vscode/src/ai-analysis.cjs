const MAX_AI_BYTES = 256 * 1024;
const MAX_RESPONSE_CHARACTERS = 128000;
const AI_TIMEOUT_MS = 180_000;
class Cancelled extends Error {}
// Copilot publishes hidden utility aliases through the stable discovery API,
// which does not expose isUserSelectable. Keep this compatibility list narrow;
// ordinary model IDs/families are opaque and must not use a model-name allowlist.
// Source and boundary details: docs/VSCODE.md, Copilot model selection.
const INTERNAL_COPILOT_ALIASES = new Set([
    'copilot-dictation-cleanup-nano', 'copilot-dictation-cleanup-luna',
    'copilot-utility-small', 'copilot-utility',
]);
const modelKey = model => JSON.stringify([model.vendor, model.id, model.version]);
function isCoreOnlyError(error) {
    // VS Code can wrap the provider error in LanguageModelError.cause.
    for (let depth = 0; error && depth < 5; depth++, error = error.cause) {
        if (/\bis only available to VS Code core\.?$/i.test(String(error.message || error).trim())) return true;
    }
    return false;
}
const PROVIDERS = Object.freeze([
    { id: 'copilot', label: 'Copilot', extension: 'GitHub.copilot-chat' },
    { id: 'codex', label: 'Codex', extension: 'openai.chatgpt' },
    { id: 'claude', label: 'Claude Code', extension: 'anthropic.claude-code' },
]);

function validateAiInput(provider, prompt) {
    if (!PROVIDERS.some(p => p.id === provider) || typeof prompt !== 'string' || !prompt.trim()
        || Buffer.byteLength(prompt, 'utf8') > MAX_AI_BYTES) throw new Error('Choose a supported assistant and a prompt under 256 KiB.');
}

/** No keys, shell commands, automatic file reads or provider requests on activation. */
class AiAnalysis {
    constructor(vscode, { timeoutMs = AI_TIMEOUT_MS } = {}) {
        this.vscode = vscode; this.timeoutMs = timeoutMs;
        this.running = false; this.disposed = false; this.active = null; this.nextJob = 0;
        this.coreOnlyModels = new Set();
    }

    providers() {
        const v = this.vscode;
        return PROVIDERS.filter(p => v.extensions?.getExtension(p.extension)
            && (p.id !== 'copilot' || typeof v.lm?.selectChatModels === 'function'))
            .map(({ id, label }) => ({ id, label }));
    }

    async run(provider, prompt, { owner, onState = () => {} } = {}) {
        validateAiInput(provider, prompt);
        if (this.disposed) throw new Error('JvmScope has closed.');
        if (!this.providers().some(p => p.id === provider)) throw new Error('This assistant is not available in the current VS Code window. Enable it and reopen AI analysis.');
        const v = this.vscode;
        if (provider === 'copilot') {
            if (this.running) throw new Error('Another Copilot analysis is running. Cancel it in its AI dialog or VS Code progress notification first.');
            const job = { jobId: `ai:${++this.nextJob}`, owner, onState, source: new v.CancellationTokenSource() };
            this.active = job; this.running = true;
            this.publish(job, 'running', 'Connecting to Copilot… If VS Code asks for access, approve it there.');
            const initial = job.state;
            this.job = this.execute(prompt, job);
            return initial;
        }
        // The public Codex commands do not define a prompt argument. Claude's
        // public URI supports a short prompt, but diagnostic payloads can exceed
        // OS URL limits. Copy/open is explicit and works without private APIs.
        if (provider === 'codex') {
            await v.extensions.getExtension('openai.chatgpt').activate();
            const commands = await v.commands.getCommands(true);
            if (!commands.includes('chatgpt.openSidebar')) throw new Error('Codex does not expose its sidebar command in this version. Use Copy prompt and open Codex manually.');
        }
        if (this.disposed) throw new Error('JvmScope has closed.');
        await v.env.clipboard.writeText(prompt);
        try {
            if (provider === 'codex') await v.commands.executeCommand('chatgpt.openSidebar');
            else {
                const opened = await v.env.openExternal(v.Uri.from({ scheme: v.env.uriScheme, authority: 'anthropic.claude-code', path: '/open' }));
                if (!opened) throw new Error('The Claude Code tab could not be opened');
            }
        } catch {
            return { message: 'Prompt copied, but the assistant could not be opened. Open it manually, paste the prompt, review and send.' };
        }
        return { message: `Prompt copied. Paste into ${provider === 'codex' ? 'Codex' : 'Claude Code'}, review and send. No AI request has been submitted by JvmScope.` };
    }

    publish(job, state, message) {
        job.state = { jobId: job.jobId, state, running: state === 'running', message };
        job.onState(job.state);
    }

    async execute(prompt, job) {
        const { source } = job, token = source.token;
        // Race every provider await against cancellation: providers are not
        // required to settle their promises/streams after receiving the token.
        const stopped = new Promise((_, reject) => {
            job.stopListener = token.onCancellationRequested(() => reject(job.failure || new Cancelled()));
        });
        stopped.catch(() => {});
        const check = () => { if (token.isCancellationRequested) throw job.failure || new Cancelled(); };
        const wait = action => {
            check();
            return Promise.race([stopped, Promise.resolve().then(() => { check(); return action(); })]);
        };
        const timer = setTimeout(() => {
            job.failure = new Error('Copilot did not finish within three minutes. Check its sign-in/access prompts, then retry or use Copy prompt.');
            source.cancel();
        }, this.timeoutMs);
        let state = 'completed', message = 'AI analysis complete. The response is open in a Markdown editor.', failure;
        try { await this.analyze(prompt, job, wait); }
        catch (error) {
            if (token.isCancellationRequested && !job.failure) { state = 'cancelled'; message = 'AI analysis cancelled. You can edit the prompt and try again.'; }
            else {
                state = 'error'; failure = error;
                message = `AI analysis failed: ${String(error.message || error).slice(0, 500)}. Your local JvmScope analysis is unchanged. You can retry or use Copy prompt.`;
            }
        } finally {
            clearTimeout(timer); job.stopListener.dispose(); source.cancel(); source.dispose();
            if (this.active === job) { this.active = null; this.running = false; }
        }
        this.publish(job, state, message);
        // Notification dismissal must never hold the request lock (VS Code's
        // showErrorMessage promise may stay pending for the lifetime of a toast).
        if (failure && !this.disposed) void Promise.resolve(this.vscode.window.showErrorMessage(message)).catch(() => {});
        return job.state;
    }

    async analyze(prompt, job, wait) {
        const v = this.vscode, token = job.source.token;
        await v.window.withProgress({ location: v.ProgressLocation.Notification, title: 'JvmScope · Copilot analysis', cancellable: true }, async (progress, progressToken) => {
            const listener = progressToken.onCancellationRequested(() => job.source.cancel());
            if (progressToken.isCancellationRequested || this.disposed) job.source.cancel();
            const report = message => { this.publish(job, 'running', message); progress.report({ message }); };
            try {
                report(job.state.message);
                const models = await wait(() => v.lm.selectChatModels({ vendor: 'copilot' }));
                if (!models.length) throw new Error('No Copilot models are available. Sign in and check your plan or organization policy');
                let chosen, output, selectionMessage;
                while (!chosen) {
                    const candidates = models.filter(model => !INTERNAL_COPILOT_ALIASES.has(model.id) && !this.coreOnlyModels.has(modelKey(model)));
                    if (!candidates.length) throw new Error('No Copilot chat models usable by JvmScope are available. Copilot only exposed internal or core-only models. Use Copy prompt to analyze in Copilot Chat');
                    report(selectionMessage || 'Choose a Copilot model in the VS Code picker at the top of the window.');
                    const choice = await wait(() => v.window.showQuickPick(candidates.map(model => ({ label: model.name, description: `${model.vendor} · ${model.id}`, model })), {
                        title: 'Analyze the reviewed JvmScope evidence',
                        placeHolder: selectionMessage || 'Choose a model — uses your Copilot account and quota',
                        ignoreFocusOut: true,
                    }, token));
                    if (!choice) { job.source.cancel(); throw new Cancelled(); }
                    try {
                        output = await this.requestModel(choice.model, prompt, token, wait, report);
                        chosen = choice.model;
                    } catch (error) {
                        if (token.isCancellationRequested || !isCoreOnlyError(error)) throw error;
                        this.coreOnlyModels.add(modelKey(choice.model));
                        selectionMessage = `Copilot model ${choice.model.id} is reserved for VS Code. Choose another model in the picker, or cancel and use Copy prompt.`;
                        // Never silently switch/bill another model. The next
                        // request requires an explicit choice in a new picker.
                    }
                }
                const scope = prompt.match(/^Scope: (.+)$/m)?.[1]?.slice(0, 500) || 'User-reviewed prompt';
                const content = `# JvmScope AI analysis\n\nModel: ${chosen.name}\n\nScope: ${scope}\n\nAI interpretation of the reviewed evidence; verify claims against the capture. This does not change JvmScope findings.\n\n${output}`;
                const document = await wait(() => v.workspace.openTextDocument({ content, language: 'markdown' }));
                await wait(() => v.window.showTextDocument(document, { viewColumn: v.ViewColumn.Beside, preview: false }));
            } finally { listener.dispose(); }
        });
    }

    async requestModel(model, prompt, token, wait, report) {
        report('Checking the prompt size…');
        const message = this.vscode.LanguageModelChatMessage.User(prompt);
        const tokens = await wait(() => model.countTokens(message, token));
        if (!Number.isFinite(tokens) || !Number.isFinite(model.maxInputTokens) || tokens + 256 > model.maxInputTokens) {
            throw new Error('The reviewed evidence is too large for this model. Remove raw excerpts, shorten the prompt or choose a larger-context model');
        }
        report(`Waiting for ${model.name}… If VS Code asks for access, approve it there.`);
        const response = await wait(() => model.sendRequest([message], {}, token));
        let output = '';
        const iterator = response.text[Symbol.asyncIterator]();
        try {
            while (true) {
                const { value: fragment, done } = await wait(() => iterator.next());
                if (done) break;
                if (!output) report(`Receiving the response from ${model.name}…`);
                const remaining = MAX_RESPONSE_CHARACTERS - output.length;
                output += fragment.slice(0, remaining);
                if (fragment.length > remaining) { output += '\n\n[Response truncated at 128,000 characters.]'; break; }
            }
        } finally {
            // Returning a hung async generator can itself hang; request cleanup
            // without waiting for it or allowing late rejection.
            void Promise.resolve().then(() => iterator.return?.()).catch(() => {});
        }
        if (!output.trim()) throw new Error('The model returned no text');
        return output;
    }

    cancel(owner, jobId) {
        const job = this.active;
        if (!job || job.owner !== owner || job.jobId !== jobId) return false;
        job.source.cancel(); return true;
    }
    close(owner) { if (this.active?.owner === owner) this.active.source.cancel(); }
    dispose() { this.disposed = true; this.active?.source.cancel(); }
}
module.exports = { AiAnalysis, MAX_AI_BYTES, validateAiInput };

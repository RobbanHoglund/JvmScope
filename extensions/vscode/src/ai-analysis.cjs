const MAX_AI_BYTES = 256 * 1024;
const MAX_RESPONSE_CHARACTERS = 128000;
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
    constructor(vscode) { this.vscode = vscode; this.running = false; this.disposed = false; this.cancellation = null; }

    providers() {
        const v = this.vscode;
        return PROVIDERS.filter(p => v.extensions?.getExtension(p.extension)
            && (p.id !== 'copilot' || typeof v.lm?.selectChatModels === 'function'))
            .map(({ id, label }) => ({ id, label }));
    }

    async run(provider, prompt) {
        validateAiInput(provider, prompt);
        if (this.disposed) throw new Error('JvmScope has closed.');
        if (!this.providers().some(p => p.id === provider)) throw new Error('This assistant is not available in the current VS Code window. Enable it and reopen AI analysis.');
        const v = this.vscode;
        if (provider === 'copilot') {
            if (this.running) throw new Error('An AI analysis is already running. Finish or cancel it in the progress notification first.');
            this.running = true;
            this.job = this.analyze(prompt).catch(error => {
                if (!this.disposed) return v.window.showErrorMessage(`AI analysis failed: ${String(error.message || error).slice(0, 500)}. Your local JvmScope analysis is unchanged.`);
            }).finally(() => { this.running = false; this.cancellation = null; });
            return { message: 'Choose a Copilot model in VS Code. The response will open in a Markdown editor; cancel from the progress notification.' };
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

    async analyze(prompt) {
        const v = this.vscode;
        await v.window.withProgress({ location: v.ProgressLocation.Notification, title: 'JvmScope · Copilot analysis', cancellable: true }, async (progress, progressToken) => {
            const source = new v.CancellationTokenSource(); this.cancellation = source;
            const listener = progressToken.onCancellationRequested(() => source.cancel());
            if (progressToken.isCancellationRequested || this.disposed) source.cancel();
            const token = source.token;
            try {
                progress.report({ message: 'Choosing a model…' });
                const models = await v.lm.selectChatModels({ vendor: 'copilot' });
                if (token.isCancellationRequested) return;
                if (!models.length) throw new Error('No Copilot models are available. Sign in and check your plan or organization policy');
                const choice = await v.window.showQuickPick(models.map(model => ({ label: model.name, description: `${model.vendor} · ${model.id}`, model })), {
                    title: 'Analyze the reviewed JvmScope evidence', placeHolder: 'Choose a model — uses your Copilot account and quota',
                    ignoreFocusOut: true,
                }, token);
                if (!choice || token.isCancellationRequested) return;
                const message = v.LanguageModelChatMessage.User(prompt);
                const tokens = await choice.model.countTokens(message, token);
                if (token.isCancellationRequested) return;
                if (!Number.isFinite(tokens) || !Number.isFinite(choice.model.maxInputTokens) || tokens + 256 > choice.model.maxInputTokens) {
                    throw new Error('The reviewed evidence is too large for this model. Remove raw excerpts, shorten the prompt or choose a larger-context model');
                }
                progress.report({ message: `Analyzing with ${choice.model.name}…` });
                const response = await choice.model.sendRequest([message], {}, token);
                let output = '';
                for await (const fragment of response.text) {
                    if (token.isCancellationRequested) return;
                    const remaining = MAX_RESPONSE_CHARACTERS - output.length;
                    output += fragment.slice(0, remaining);
                    if (fragment.length > remaining) { output += '\n\n[Response truncated at 128,000 characters.]'; break; }
                }
                if (token.isCancellationRequested || this.disposed) return;
                if (!output.trim()) throw new Error('The model returned no text');
                const scope = prompt.match(/^Scope: (.+)$/m)?.[1]?.slice(0, 500) || 'User-reviewed prompt';
                const content = `# JvmScope AI analysis\n\nModel: ${choice.model.name}\n\nScope: ${scope}\n\nAI interpretation of the reviewed evidence; verify claims against the capture. This does not change JvmScope findings.\n\n${output}`;
                const document = await v.workspace.openTextDocument({ content, language: 'markdown' });
                if (!this.disposed) await v.window.showTextDocument(document, { viewColumn: v.ViewColumn.Beside, preview: false });
            } catch (error) { if (!token.isCancellationRequested) throw error; }
            finally { listener.dispose(); source.dispose(); }
        });
    }

    dispose() { this.disposed = true; this.cancellation?.cancel(); }
}
module.exports = { AiAnalysis, MAX_AI_BYTES, validateAiInput };

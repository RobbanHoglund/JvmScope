import { isVsCode, getAiProviders, analyzeWithAi, writeClipboard } from './host/platform.js';
import { aiPrompt, MAX_AI_CHARACTERS } from './ai-evidence.js';

/** Review the exact outgoing text. Nothing is sent merely by opening this view. */
export function createAiAnalysisView(getEvidence) {
    if (!isVsCode()) return { invalidate() {} };
    const opener = document.createElement('button');
    opener.id = 'analyzeAiBtn'; opener.type = 'button'; opener.className = 'btn btn-sm btn-accent';
    opener.setAttribute('data-capture-only', ''); opener.setAttribute('aria-haspopup', 'dialog');
    opener.setAttribute('aria-controls', 'aiAnalysisDialog');
    opener.innerHTML = '<svg class="ai-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/></svg>Analyze with AI';
    document.getElementById('howToUseBtn').before(opener);
    const dialog = document.createElement('dialog');
    dialog.id = 'aiAnalysisDialog'; dialog.className = 'ai-analysis-dialog';
    dialog.setAttribute('aria-labelledby', 'aiAnalysisTitle');
    // All dynamic evidence and responses are assigned as text, never HTML.
    dialog.innerHTML = `<div class="ai-analysis-heading"><h2 id="aiAnalysisTitle">Analyze with AI</h2><button type="button" class="btn btn-sm" data-ai-close aria-label="Close AI analysis">Close</button></div>
        <p id="aiScope" class="ai-scope"></p>
        <p class="ai-sharing-note">Review and edit the text below. Your chosen assistant may send it to its AI provider using your account. Names, hosts and stack traces are not anonymized.</p>
        <label class="ai-raw-choice" title="Changing this rebuilds the prompt and replaces edits."><input id="aiIncludeRaw" type="checkbox"> Include raw evidence excerpt</label>
        <label for="aiPrompt">Prompt and evidence</label><textarea id="aiPrompt" spellcheck="false" maxlength="80000"></textarea>
        <div class="ai-provider-row"><label for="aiProvider">Assistant</label><select id="aiProvider"></select><button id="aiRun" class="btn btn-primary" type="button" disabled>Choose assistant</button><button id="aiCopy" class="btn" type="button">Copy prompt</button></div>
        <p id="aiProviderHelp" class="ai-provider-help"></p><output id="aiStatus" role="status" aria-live="polite"></output>`;
    document.body.append(dialog);
    const $ = id => dialog.querySelector('#' + id);
    const prompt = $('aiPrompt'), raw = $('aiIncludeRaw'), provider = $('aiProvider'), run = $('aiRun'), copy = $('aiCopy');
    let generation = 0, evidence = null, providers = [], busy = false;
    const status = text => { $('aiStatus').textContent = text; };
    function refresh() {
        const selected = providers.find(p => p.id === provider.value);
        const valid = Boolean(prompt.value.trim()) && prompt.value.length <= MAX_AI_CHARACTERS;
        run.disabled = busy || !selected || !valid; copy.disabled = busy || !valid;
        raw.disabled = busy; provider.disabled = busy; prompt.readOnly = busy;
        run.textContent = selected?.id === 'copilot' ? 'Analyze with Copilot' : selected ? `Copy and open ${selected.label}` : 'Choose assistant';
        $('aiProviderHelp').textContent = selected?.id === 'copilot'
            ? 'Choose an available model next. The response opens in a new Markdown editor; the progress notification lets you cancel.'
            : selected ? 'Copies this exact prompt and opens the assistant. Paste into its chat, review, then send. Its sign-in and usage limits apply.'
                : 'No supported assistant is available in this VS Code window. You can copy the prompt, or enable Copilot Chat, Codex or Claude Code and reopen this dialog.';
    }
    function close() { generation++; dialog.close(); prompt.value = ''; evidence = null; busy = false; opener.focus({ preventScroll: true }); }
    dialog.querySelector('[data-ai-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    provider.addEventListener('change', refresh); prompt.addEventListener('input', refresh);
    raw.addEventListener('change', () => { prompt.value = aiPrompt(evidence, raw.checked); status('Prompt rebuilt for the new evidence selection.'); refresh(); });
    opener.addEventListener('click', async () => {
        evidence = getEvidence(); if (!evidence) return;
        const current = ++generation;
        providers = []; provider.replaceChildren(); raw.checked = false; busy = false;
        $('aiScope').textContent = evidence.scope; prompt.value = aiPrompt(evidence);
        status('Checking installed assistants…'); refresh(); dialog.showModal();
        dialog.querySelector('[data-ai-close]').focus({ preventScroll: true });
        try {
            const found = await getAiProviders();
            if (current !== generation) return;
            providers = found;
            for (const item of providers) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; provider.append(option); }
            status('Nothing has been sent.'); refresh();
        } catch (error) { if (current === generation) { status(error.message); refresh(); } }
    });
    async function act(action) {
        const current = generation; busy = true; status(''); refresh();
        try { const message = await action(); if (current === generation) status(message); }
        catch (error) { if (current === generation) status(error.message); }
        finally { if (current === generation) { busy = false; refresh(); } }
    }
    copy.addEventListener('click', () => act(async () => { await writeClipboard(prompt.value); return 'Prompt copied. Paste it into your assistant and review before sending.'; }));
    run.addEventListener('click', () => act(async () => {
        const result = await analyzeWithAi(provider.value, prompt.value);
        return result.message;
    }));
    return { invalidate() { generation++; if (dialog.open) close(); else { prompt.value = ''; evidence = null; } } };
}

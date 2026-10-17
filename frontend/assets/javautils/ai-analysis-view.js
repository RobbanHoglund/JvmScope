import { isVsCode, getAiProviders, getAiStatus, cancelAi, analyzeWithAi, writeClipboard } from './host/platform.js';
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
        <div class="ai-provider-row"><label for="aiProvider">Assistant</label><select id="aiProvider"></select><button id="aiRun" class="btn btn-primary" type="button" disabled>Choose assistant</button><button id="aiCancel" class="btn" type="button" hidden>Cancel analysis</button><button id="aiCopy" class="btn" type="button">Copy prompt</button></div>
        <p id="aiProviderHelp" class="ai-provider-help"></p><output id="aiStatus" role="status" aria-live="polite"></output>`;
    document.body.append(dialog);
    const $ = id => dialog.querySelector('#' + id);
    const prompt = $('aiPrompt'), raw = $('aiIncludeRaw'), provider = $('aiProvider'), run = $('aiRun'), copy = $('aiCopy'), cancel = $('aiCancel');
    let generation = 0, evidence = null, providers = [], busy = false, jobId = null, pollTimer = null, cancelling = false;
    const status = text => { $('aiStatus').textContent = text; };
    function refresh() {
        const selected = providers.find(p => p.id === provider.value);
        const valid = Boolean(prompt.value.trim()) && prompt.value.length <= MAX_AI_CHARACTERS;
        run.disabled = busy || !selected || !valid; copy.disabled = busy || !valid;
        raw.disabled = busy; provider.disabled = busy; prompt.readOnly = busy;
        cancel.hidden = !jobId; cancel.disabled = cancelling;
        cancel.textContent = cancelling ? 'Cancelling…' : 'Cancel analysis';
        dialog.querySelector('[data-ai-close]').textContent = jobId ? 'Cancel and close' : 'Close';
        run.textContent = selected?.id === 'copilot' ? (busy ? 'Copilot running…' : 'Analyze with Copilot') : selected ? `Copy and open ${selected.label}` : 'Choose assistant';
        $('aiProviderHelp').textContent = selected?.id === 'copilot'
            ? 'Choose a model in the VS Code picker at the top of the window. Progress appears below. You can cancel here; the response opens in a new Markdown editor.'
            : selected ? 'Copies this exact prompt and opens the assistant. Paste into its chat, review, then send. Its sign-in and usage limits apply.'
                : 'No supported assistant is available in this VS Code window. You can copy the prompt, or enable Copilot Chat, Codex or Claude Code and reopen this dialog.';
    }
    function close() {
        generation++; clearTimeout(pollTimer);
        if (jobId) void cancelAi(jobId).catch(() => {});
        jobId = null; cancelling = false; dialog.close(); prompt.value = ''; evidence = null; busy = false;
        opener.focus({ preventScroll: true });
    }
    function showJob(state, current) {
        if (current !== generation) return;
        status(state.message); busy = Boolean(state.running); jobId = busy ? state.jobId : null;
        if (!busy) cancelling = false;
        refresh(); clearTimeout(pollTimer);
        if (busy) pollTimer = setTimeout(() => poll(current), 500);
    }
    async function poll(current) {
        try { showJob(await getAiStatus(), current); }
        catch (error) {
            if (current === generation) { status(`${error.message} Cancel or close this dialog to stop the analysis.`); cancelling = false; refresh(); }
        }
    }
    cancel.addEventListener('click', async () => {
        const current = generation, id = jobId;
        if (!id) return;
        cancelling = true; status('Cancelling AI analysis…'); refresh();
        try { await cancelAi(id); if (current === generation) await poll(current); }
        catch (error) { if (current === generation) { status(error.message); cancelling = false; refresh(); } }
    });
    dialog.querySelector('[data-ai-close]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    provider.addEventListener('change', refresh); prompt.addEventListener('input', refresh);
    raw.addEventListener('change', () => { prompt.value = aiPrompt(evidence, raw.checked); status('Prompt rebuilt for the new evidence selection.'); refresh(); });
    opener.addEventListener('click', async () => {
        evidence = getEvidence(); if (!evidence) return;
        const current = ++generation;
        clearTimeout(pollTimer); jobId = null; cancelling = false;
        providers = []; provider.replaceChildren(); raw.checked = false; busy = false;
        $('aiScope').textContent = evidence.scope; prompt.value = aiPrompt(evidence);
        status('Checking installed assistants…'); refresh(); dialog.showModal();
        dialog.querySelector('[data-ai-close]').focus({ preventScroll: true });
        try {
            const [found, state] = await Promise.all([getAiProviders(), getAiStatus()]);
            if (current !== generation) return;
            providers = found;
            for (const item of providers) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; provider.append(option); }
            if (state.running) { provider.value = 'copilot'; showJob(state, current); }
            else { status('Nothing has been sent.'); refresh(); }
        } catch (error) { if (current === generation) { status(error.message); refresh(); } }
    });
    async function act(action) {
        const current = generation; busy = true; status(''); refresh();
        try { const message = await action(); if (current === generation) status(message); }
        catch (error) { if (current === generation) status(error.message); }
        finally { if (current === generation) { busy = false; refresh(); } }
    }
    copy.addEventListener('click', () => act(async () => { await writeClipboard(prompt.value); return 'Prompt copied. Paste it into your assistant and review before sending.'; }));
    run.addEventListener('click', async () => {
        const current = generation;
        busy = true; status(provider.value === 'copilot' ? 'Starting Copilot analysis…' : 'Opening the assistant…'); refresh();
        try {
            const result = await analyzeWithAi(provider.value, prompt.value);
            if (current !== generation) { if (result.jobId) await cancelAi(result.jobId); return; }
            showJob(result, current);
        } catch (error) { if (current === generation) { busy = false; status(error.message); refresh(); } }
    });
    return { invalidate() { generation++; if (dialog.open) close(); else { prompt.value = ''; evidence = null; } } };
}

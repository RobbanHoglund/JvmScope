// Keep the privileged VS Code handle private. Browser builds use their normal
// APIs; analysis, classification and rendering are shared by both deliveries.
const vscode = typeof globalThis.acquireVsCodeApi === 'function' ? globalThis.acquireVsCodeApi() : null;
const channel = 'jvmscope';
const pending = new Map();
let nextId = 0;
export const isVsCode = () => vscode !== null;

// A webview's location belongs to VS Code, not the bundled document. Keep the
// logical page URL separate so documentation links, filters and search work in
// both deliveries without navigating away from the sandboxed webview.
export function getPageUrl() {
    const page = vscode && document.querySelector('meta[name="jvmscope-page"]');
    return page ? new URL(page.content, 'https://jvmscope.invalid') : new URL(location.href);
}
export function replacePageUrl(url) {
    const page = vscode && document.querySelector('meta[name="jvmscope-page"]');
    if (page) page.content = url.pathname + url.search + url.hash;
    else history.replaceState(null, '', url);
}

function send(message) { vscode?.postMessage({ channel, version: 1, ...message }); }
export function notifyHostReady() { send({ type: 'ready' }); }
function request(action, payload = {}) {
    return new Promise((resolve, reject) => {
        const id = `web:${++nextId}`;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('The VS Code action timed out.')); }, 120_000);
        pending.set(id, { resolve, reject, timer });
        send({ type: 'request', id, action, ...payload });
    });
}
if (vscode) {
    window.addEventListener('message', ({ data }) => {
        if (data?.channel !== channel || data.version !== 1 || data.type !== 'response') return;
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id); clearTimeout(job.timer);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.value);
    });
    window.addEventListener('pagehide', () => {
        for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('The analysis view closed.')); }
        pending.clear();
    });
}

export function showHostError(error) {
    let notice = document.getElementById('hostError');
    if (!notice) {
        notice = document.createElement('p'); notice.id = 'hostError'; notice.setAttribute('role', 'alert');
        document.querySelector('main')?.prepend(notice);
    }
    notice.textContent = error?.message || 'The VS Code action could not be completed.';
}

export function initializeHostNavigation() {
    if (!vscode) return;
    document.body.dataset.jvmscopeHost = 'vscode';
    for (const notice of document.querySelectorAll('.analyzer-start-privacy, .privacy strong')) {
        notice.textContent = 'Capture analysis stays local. Optional AI sharing is controlled by you.';
    }
    window.addEventListener('message', ({ data }) => {
        if (data?.channel === channel && data.version === 1 && data.type === 'revealHash' && typeof data.hash === 'string') {
            try { document.getElementById(decodeURIComponent(data.hash.replace(/^#/, '')))?.scrollIntoView(); } catch { /* Ignore malformed anchors. */ }
        }
    });
    document.addEventListener('click', event => {
        // Analyzer links can already have revealed a panel and moved focus.
        if (event.defaultPrevented) return;
        const link = event.target.closest?.('a');
        if (!link || link.hasAttribute('download')) return;
        const route = link.dataset.hostRoute;
        const href = link.getAttribute('href');
        if (route) {
            event.preventDefault(); request('navigate', { route }).catch(showHostError);
        } else if (href?.startsWith('#')) {
            // The webview's <base> points to its resource directory, so native
            // fragment navigation would leave the article instead of scrolling.
            event.preventDefault();
            let target;
            try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
            catch { return; }
            if (!target) return;
            const url = getPageUrl();
            url.hash = href;
            replacePageUrl(url);
            target.scrollIntoView({ block: 'start' });
            if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
            target.focus({ preventScroll: true });
        } else if (/^https?:\/\//i.test(href || '')) {
            event.preventDefault(); request('external', { url: href }).catch(showHostError);
        } else if (href && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            event.preventDefault();
            const url = new URL(href, getPageUrl());
            if (url.origin === 'https://jvmscope.invalid') {
                request('navigate', { route: url.pathname + url.search + url.hash }).catch(showHostError);
            }
        }
    });
    if (!['tda', 'tls', 'gc', 'knowledge'].includes(document.body.dataset.jvmscopePage)) notifyHostReady();
}

export function bindHostInputs({ fileInput, onSources }) {
    if (!vscode) return;
    const receive = async data => {
        if (data?.channel !== channel || data.version !== 1 || data.type !== 'load' || !Array.isArray(data.sources)) return;
        try {
            const value = await onSources(data.sources, 'replace');
            send({ type: 'loaded', id: data.id, value });
        } catch (error) { showHostError(error); send({ type: 'loaded', id: data.id, error: error.message }); }
    };
    window.addEventListener('message', ({ data }) => { void receive(data); });
    fileInput?.addEventListener('click', event => {
        event.preventDefault();
        request('chooseFiles').then(sources => sources?.length && onSources(sources)).catch(showHostError);
    });
    notifyHostReady();
}

export const writeClipboard = text => vscode ? request('copy', { text }) : navigator.clipboard.writeText(text);
export const readClipboard = () => vscode ? request('paste') : navigator.clipboard.readText();
export const openRawEvidence = (text, name) => request('openRaw', { text, name });
export const invalidateHostEvidence = () => { if (vscode) request('clearRaw').catch(showHostError); };
export const syncSourceLinks = sourceIds => { if (vscode) request('syncSources', { sourceIds: sourceIds.filter(Boolean) }).catch(showHostError); };
export const openSourceLocation = location => request('openSource', location);
export const getAiProviders = () => request('aiProviders');
export const getAiStatus = () => request('aiStatus');
export const cancelAi = jobId => request('cancelAi', { jobId });
export const analyzeWithAi = (provider, prompt, findingContext) => request('analyzeAi', { provider, prompt, findingContext });

export function bindSourceButton(button, location) {
    if (!button) return;
    button.hidden = !vscode || !location;
    button.disabled = false;
    const status = button.parentElement.querySelector('.host-source-status');
    if (status) status.textContent = '';
    button.onclick = async () => {
        if (!vscode || !location) return;
        button.disabled = true;
        try { await openSourceLocation(location); }
        catch (error) { if (status && button.isConnected) status.textContent = error.message; }
        finally { if (button.isConnected) button.disabled = false; }
    };
}

export async function saveBlob(blob, name) {
    if (vscode) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return request('save', { name, base64: btoa(binary) });
    }
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}
export const saveText = (text, name, type = 'text/plain;charset=utf-8') => saveBlob(new Blob([text], { type }), name);

// Navigation transfers only a bounded page of labels/IDs, never raw captures.
// Each published analysis gets a revision, so delayed sidebar clicks cannot
// accidentally select a similarly named item in a replacement capture.
export function createHostNavigation(onSelect) {
    let revision=0, model=null;
    if (vscode) window.addEventListener('message', ({data})=>{
        if (data?.channel!==channel || data.version!==1 || data.type!=='navigationRequest') return;
        if (typeof data.id!=='string' || !/^nav:\d{1,12}$/.test(data.id)) return;
        try {
            if (data.revision!==revision || !model) throw new Error('The analysis changed. Select an item from the updated JvmScope sidebar.');
            let value;
            if (data.action==='children') value=model.children(data.key,data.offset);
            else if (data.action==='select') {onSelect(model.resolve(data.key));value=true;}
            else throw new Error('Unsupported navigation action.');
            send({type:'navigationResult',id:data.id,revision,value});
        } catch(error) {send({type:'navigationResult',id:data.id,revision,error:error.message});}
    });
    return {publish(next) {
        if (!vscode) return;
        model=next;revision++;
        send({type:'navigationState',revision,count:model?.count || 0,summary:model?.count?model.summary:'No capture loaded'});
    }};
}

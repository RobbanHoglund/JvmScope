// Keep the privileged VS Code handle private. Browser builds use their normal
// APIs; analysis, classification and rendering are shared by both deliveries.
const vscode = typeof globalThis.acquireVsCodeApi === 'function' ? globalThis.acquireVsCodeApi() : null;
const channel = 'jvmscope';
const pending = new Map();
let nextId = 0;
export const isVsCode = () => vscode !== null;

function send(message) { vscode?.postMessage({ channel, version: 1, ...message }); }
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
    for (const notice of document.querySelectorAll('.analyzer-start-privacy')) {
        notice.textContent = 'Analyzed locally in VS Code. Nothing is uploaded.';
    }
    window.addEventListener('message', ({ data }) => {
        if (data?.channel === channel && data.version === 1 && data.type === 'revealHash' && typeof data.hash === 'string') {
            try { document.getElementById(decodeURIComponent(data.hash.replace(/^#/, '')))?.scrollIntoView(); } catch { /* Ignore malformed anchors. */ }
        }
    });
    document.addEventListener('click', event => {
        const link = event.target.closest?.('a');
        if (!link || link.hasAttribute('download')) return;
        const route = link.dataset.hostRoute;
        const href = link.getAttribute('href');
        if (route) {
            event.preventDefault(); request('navigate', { route }).catch(showHostError);
        } else if (/^https?:\/\//i.test(href || '')) {
            event.preventDefault(); request('external', { url: href }).catch(showHostError);
        }
    });
    if (!['tda', 'tls'].includes(document.body.dataset.jvmscopePage)) send({ type: 'ready' });
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
    send({ type: 'ready' });
}

export const writeClipboard = text => vscode ? request('copy', { text }) : navigator.clipboard.writeText(text);
export const readClipboard = () => vscode ? request('paste') : navigator.clipboard.readText();
export const openRawEvidence = (text, name) => request('openRaw', { text, name });
export const invalidateHostEvidence = () => { if (vscode) request('clearRaw').catch(showHostError); };

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

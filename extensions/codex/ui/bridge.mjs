import { version } from '../package.json';
// MCP Apps host bridge. All messages must come from this iframe's parent.
export function createBridge({ onResult, onContext, onUnavailable }) {
    let sequence = 0, ready = false, hostCapabilities = {}, hostContext = {};
    function contextChanged(context) {
        hostContext = { ...hostContext, ...context };
        onContext(context);
    }
    const pending = new Map();
    const notify = (method, params) => window.parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
    function request(method, params, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('The host did not respond. Try again in a local session.')); }, timeout);
            pending.set(id, { resolve, reject, timer });
            window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
        });
    }
    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
        const m = event.data;
        if (m.id != null && !m.method) {
            const p = pending.get(m.id);
            if (!p) return;
            clearTimeout(p.timer); pending.delete(m.id);
            if (m.error) p.reject(new Error(m.error.message || 'Host request failed.'));
            else p.resolve(m.result);
        } else if (m.method === 'ui/notifications/tool-result') onResult(m.params);
        else if (m.method === 'ui/notifications/host-context-changed') contextChanged(m.params);
        else if (m.method === 'ui/resource-teardown') {
            for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Report closed.')); }
            pending.clear(); ready = false;
            window.parent.postMessage({ jsonrpc: '2.0', id: m.id, result: {} }, '*');
        }
    });
    // Compatibility only: the standard MCP Apps display-mode request is preferred.
    window.addEventListener('openai:set_globals', event => {
        const globals = event.detail?.globals;
        if (globals) contextChanged(globals);
    });
    return {
        async initialize() {
            if (window.parent === window) { onUnavailable(); return; }
            try {
                const host = await request('ui/initialize', { appInfo: { name: 'jvmscope-thread-report', version },
                    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: '2026-01-26' }, 6000);
                hostCapabilities = host?.hostCapabilities || {};
                ready = true; contextChanged({ ...(window.openai?.displayMode ? { displayMode: window.openai.displayMode } : {}), ...host?.hostContext });
                notify('ui/notifications/initialized', {});
                let last = '';
                new ResizeObserver(() => {
                    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
                    if (String(height) !== last) { last = String(height); notify('ui/notifications/size-changed', { height }); }
                }).observe(document.documentElement);
            } catch { onUnavailable(); }
        },
        get canCallTools() { return ready && !!hostCapabilities.serverTools; },
        async requestDisplayMode(mode) {
            if (ready && hostContext.availableDisplayModes?.includes(mode))
                return request('ui/request-display-mode', { mode }, 2000);
            if (typeof window.openai?.requestDisplayMode === 'function') {
                let timer;
                try {
                    return await Promise.race([window.openai.requestDisplayMode({ mode }),
                        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Display request timed out.')), 2000); })]);
                } finally { clearTimeout(timer); }
            }
            return { mode: hostContext.displayMode || 'inline' };
        },
        async callTool(name, args) {
            if (!ready || !hostCapabilities.serverTools) throw new Error('This host does not expose interactive source tools. Ask for the source lines in the conversation.');
            const response = await request('tools/call', { name, arguments: args }, 65000);
            if (response.isError) throw new Error(response.content?.find(c => c.type === 'text')?.text || 'Tool failed.');
            return response;
        },
    };
}

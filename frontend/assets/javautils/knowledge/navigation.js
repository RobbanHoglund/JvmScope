import { getPageUrl, replacePageUrl, isVsCode, notifyHostReady } from '../host/platform.js';

// Keep a bounded reading history in the webview's memory. Detached pages retain
// their controls, search results and listeners; no diagnostics or browser storage
// are involved. The standalone app continues to use ordinary browser navigation.
export function initializeKnowledgeNavigation(container, render, articleIds) {
    if (!isVsCode()) { render(container); return; }
    const paths = new Set(['index', ...articleIds].map(id => `/knowledge/${id}.html`));
    const entries = [];
    let position = -1;
    const toolbar = document.createElement('nav');
    toolbar.className = 'knowledge-history';
    toolbar.setAttribute('aria-label', 'Knowledge navigation');
    toolbar.innerHTML = '<button type="button" data-history="-1" title="Back (Alt+Left)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>Back</button><button type="button" data-history="1" title="Forward (Alt+Right)">Forward<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg></button>';
    const [back, forward] = toolbar.querySelectorAll('button');
    const routeOf = url => url.pathname + url.search + url.hash;
    function remember() {
        const entry = entries[position];
        if (!entry) return;
        entry.route = routeOf(getPageUrl());
        entry.title = document.title;
        entry.scroll = window.scrollY;
        if (entry.node.contains(document.activeElement)) entry.focus = document.activeElement;
    }
    function focus(element) {
        if (!element) return;
        if (!element.hasAttribute('tabindex') && !element.matches('a,button,input,select,textarea')) element.tabIndex = -1;
        element.focus({ preventScroll: true });
    }
    function revealFragment(url) {
        let target;
        try { target = document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch { /* Malformed fragment. */ }
        if (target) { target.scrollIntoView({ block: 'start' }); focus(target); }
        else if (!new URLSearchParams(url.hash.slice(1)).get('find')) window.scrollTo(0, 0);
    }
    function show(entry, restore) {
        const url = new URL(entry.route, 'https://jvmscope.invalid');
        replacePageUrl(url);
        container.replaceChildren(toolbar, entry.node);
        if (!entry.rendered) {
            entry.dispose = render(entry.node);
            entry.rendered = true;
            entry.title = document.title;
            entry.node.addEventListener('focusin', event => { entry.focus = event.target; });
        } else document.title = entry.title;
        back.disabled = position === 0;
        forward.disabled = position === entries.length - 1;
        if (restore) {
            focus(entry.focus?.isConnected ? entry.focus : entry.node.querySelector('h1'));
            window.scrollTo(0, entry.scroll);
        } else {
            if (entries.length > 1) focus(entry.node.querySelector('h1'));
            revealFragment(url);
        }
    }
    function move(next) {
        if (next < 0 || next >= entries.length || next === position) return;
        remember(); position = next; show(entries[position], true);
    }
    function navigate(route) {
        if (typeof route !== 'string' || route.length > 8192) return false;
        let url;
        try { url = new URL(route, getPageUrl()); } catch { return false; }
        const query = [...url.searchParams];
        if (url.origin !== 'https://jvmscope.invalid' || !paths.has(url.pathname)
            || (query.length && (query.length !== 1 || query[0][0] !== 'java' || !/^(?:[7-9]|1\d|2[0-7])$/.test(query[0][1])))) return false;
        if (entries.length && routeOf(url) === routeOf(getPageUrl())) { revealFragment(url); return true; }
        remember();
        for (const old of entries.splice(position + 1)) old.dispose?.();
        const node = document.createElement('div'); node.className = 'knowledge-page';
        entries.push({ route: routeOf(url), node, scroll: 0 });
        if (entries.length > 30) entries.shift().dispose?.();
        position = entries.length - 1;
        show(entries[position], false);
        return true;
    }
    toolbar.addEventListener('click', event => {
        const button = event.target.closest('button[data-history]');
        if (button && !button.disabled) move(position + Number(button.dataset.history));
    });
    container.addEventListener('click', event => {
        const link = event.target.closest('a');
        if (event.defaultPrevented || !link || link.hasAttribute('download')) return;
        const href = link.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        if (link.id === 'knowledgeBack') {
            const previous = entries.slice(0, position).findLastIndex(entry => new URL(entry.route, 'https://jvmscope.invalid').pathname === '/knowledge/index.html');
            if (previous >= 0) { event.preventDefault(); move(previous); return; }
        }
        if (navigate(href)) event.preventDefault();
    });
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); move(position + (event.key === 'ArrowLeft' ? -1 : 1));
        }
    });
    window.addEventListener('message', ({ data }) => {
        if (data?.channel === 'jvmscope' && data.version === 1 && data.type === 'knowledgeRoute') navigate(data.route);
    });
    navigate(routeOf(getPageUrl()));
    notifyHostReady();
}

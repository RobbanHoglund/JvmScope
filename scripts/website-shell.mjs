import { readFileSync } from 'node:fs';

// Pages-only shell. No imports into the Java, VS Code or Codex delivery targets.
const css = readFileSync(new URL('../frontend/assets/website-shell.css', import.meta.url), 'utf8');
const light = readFileSync(new URL('../frontend/assets/website-light.css', import.meta.url), 'utf8');
export function websiteHead() {
    return `<style>${css}\n${light.replace(':root', ':root[data-site-theme="light"]')}\n@media(prefers-color-scheme:light){${light.replace(':root', ':root:not([data-site-theme="dark"])')}}\n</style><script>
(() => {
    const root = document.documentElement;
    const key = 'jvmscope.website.theme';
    const system = matchMedia('(prefers-color-scheme: light)');
    const valid = value => ['system', 'light', 'dark'].includes(value);
    let preference = 'system';
    try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch {}
    const apply = () => {
        root.dataset.siteTheme = preference === 'system' ? (system.matches ? 'light' : 'dark') : preference;
        const select = document.querySelector('[data-theme-select]');
        if (select) select.value = preference;
    };
    root.classList.add('site-js');
    apply();
    system.addEventListener('change', apply);
    addEventListener('storage', event => {
        if (event.key === key || event.key === null) { preference = valid(event.newValue) ? event.newValue : 'system'; apply(); }
    });
    addEventListener('pageshow', apply);
    addEventListener('DOMContentLoaded', () => {
        apply();
        document.querySelector('[data-theme-select]')?.addEventListener('change', event => {
            preference = valid(event.target.value) ? event.target.value : 'system';
            try { localStorage.setItem(key, preference); } catch {}
            apply();
        });
    });
})();
</script>`;
}
export function websiteNavigation(base, active = 'home') {
    const link = (id, path, label) => `<a href="${base}${path}"${active === id ? ' aria-current="page"' : ''}>${label}</a>`;
    return `<nav class="tool-nav" aria-label="Analysis tools"><a class="tool-nav-home" href="${base}"${active === 'home' ? ' aria-current="page"' : ''}>JvmScope<span>Java diagnostics</span></a><div class="site-links">${link('tda','jvmscope/tda.html','Thread dumps')}${link('tls','jvmscope/tls.html','TLS log analyzer')}${link('gc','jvmscope/gc.html','Garbage collection')}${link('knowledge','knowledge/index.html','Knowledge base')}</div><label class="site-theme" data-theme-control>Theme<select data-theme-select aria-label="Website theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></nav>`;
}

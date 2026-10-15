const path = require('node:path').posix;
const { randomBytes } = require('node:crypto');

const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function resolveRoute(route, pages) {
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) throw new Error('Unknown JvmScope page.');
    const url = new URL(route, 'https://jvmscope.invalid');
    const name = url.pathname.slice(1);
    if (url.origin !== 'https://jvmscope.invalid' || !pages.includes(name) || url.search) throw new Error('Unknown JvmScope page.');
    return { name, hash: url.hash };
}

function renderWebview(html, { page, pages, resourceUri, cspSource }) {
    const nonce = randomBytes(24).toString('base64');
    const csp = `default-src 'none'; base-uri ${cspSource}; script-src ${cspSource} 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data: blob:; font-src ${cspSource}; connect-src ${cspSource}; worker-src blob: data:; frame-src 'self'; form-action 'none';`;
    const base = resourceUri(path.dirname(page) + '/');
    html = html.replace(/<(?:script|link|img|source|a)\b[^>]*>/gi, tag => {
        let route;
        const result = tag.replace(/\b(src|href)=("|')([^"']*)\2/gi, (attribute, key, quote, value) => {
            if (!value || value.startsWith('#') || /^(https?:|data:)/i.test(value)) return attribute;
            if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return `${key}="#"`;
            const url = new URL(value.replaceAll('&amp;', '&'), `https://jvmscope.invalid/${page}`);
            const name = url.pathname.slice(1);
            if (/^<a\b/i.test(tag) && pages.includes(name) && !url.search) {
                route = '/' + name + url.hash;
                return 'href="#"';
            }
            if (!name.startsWith('assets/')) return attribute;
            return `${key}="${escape(resourceUri(name))}"`;
        });
        return route ? result.replace(/>$/, ` data-host-route="${escape(route)}">`) : result;
    });
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
    return html.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">\n<base href="${escape(base)}">`);
}
module.exports = { renderWebview, resolveRoute };

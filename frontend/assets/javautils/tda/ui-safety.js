/** Context-specific escaping for values rendered from untrusted thread dumps. */

export function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function escapeAttr(value) {
    return escapeHtml(value)
        .replaceAll('\n', '&#10;')
        .replaceAll('\r', '&#13;');
}

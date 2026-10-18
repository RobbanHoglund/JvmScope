// Fixed local SVGs: no provider artwork, remote resources or platform-dependent emoji.
const svg = path => `<svg class="ai-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
export const AI_ICONS = Object.freeze({
    ai: svg('<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z"/><path d="M20 2v4m-2-2h4M4 18v4m-2-2h4"/>'),
    critical: svg('<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5H8Z"/><path d="M12 7v6m0 3v1"/>'),
    warning: svg('<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>'),
    important: svg('<path d="m12 2 10 10-10 10L2 12 12 2Z"/><path d="M12 7v6m0 3v1"/>'),
    note: svg('<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11v1"/>'),
});

import MarkdownIt from 'markdown-it';

// Diagnostic text and model output are untrusted. No HTML, embeds, images,
// workspace/file URLs or command links. No highlighting plugin executes code.
export function isReportLink(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return false;
    try { const url = new URL(value); return !url.username && !url.password; }
    catch { return false; }
}
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.validateLink = isReportLink;
md.renderer.rules.image = (tokens, index) => `<span class="omitted-image">[Image omitted: ${md.utils.escapeHtml(tokens[index].content)}]</span>`;
md.renderer.rules.link_open = (tokens, index) => {
    const href = tokens[index].attrGet('href');
    // The real target is inert data. Only the click bridge can open it.
    return `<a href="#" data-report-link="${md.utils.escapeHtml(href)}" title="${md.utils.escapeHtml(href)}">`;
};
export const renderAiMarkdown = text => md.render(text);

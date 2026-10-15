import { explainIssueSections } from './tls-explanations.js';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function renderTlsExplanation(issueText) {
    const sections = explainIssueSections(issueText);
    if (!sections.length) return '';
    return `<div class="tls-explanation">${sections.map(section => `
        <section class="tls-explanation-section" data-section="${escape(section.id)}">
            <h3>${escape(section.title)}</h3>
            ${section.paragraphs
                ? section.paragraphs.map(text => `<p>${escape(text)}</p>`).join('')
                : `<ul>${section.bullets.map(text => `<li>${escape(text)}</li>`).join('')}</ul>`}
        </section>`).join('')}</div>`;
}

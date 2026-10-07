import { escapeHtml as h, escapeAttr as a } from '../tda/ui-safety.js';
import { SOURCE_TITLES, VERIFIED_DATE } from './data.js';
import { SECTION_TITLES } from './search.js';
export { SECTION_TITLES } from './search.js';

function primarySource(url) {
    try {
        const parsed=new URL(url);
        return parsed.protocol==='https:' && !parsed.username && !parsed.password
            && (parsed.hostname==='docs.oracle.com' || parsed.hostname==='www.oracle.com'
                || parsed.hostname==='openjdk.org' && parsed.pathname.startsWith('/jeps/')
                || parsed.hostname==='github.com' && /^\/openjdk\/(?:jdk|jdk7u|jdk8u)\//.test(parsed.pathname));
    } catch { return false; }
}

export function sourceLabel(url) {
    if(SOURCE_TITLES[url])return SOURCE_TITLES[url];
    if(url.includes('/jeps/'))return `OpenJDK JEP ${url.split('/').at(-1)}`;
    if(url.includes('ThreadDumper.java'))return `OpenJDK ${/jdk-(\d+)-ga/.exec(url)?.[1]||''} file-dump implementation`;
    if(url.includes('/migrate/'))return 'Oracle JDK migration guide';
    return `Official JDK documentation · ${url.split('/').at(-1)||'guide'}`;
}

export function sourceLinks(sources=[]) {
    return [...new Set(sources)].filter(primarySource).map(url=>`<li><a href="${a(url)}" target="_blank" rel="noopener noreferrer">${h(sourceLabel(url))}</a></li>`).join('');
}

export function renderBlock(block) {
    if(!block || typeof block!=='object')return '';
    let content='';
    if(block.type==='paragraph')content=`<p>${h(block.text)}</p>`;
    else if(block.type==='list')content=`<ul>${(block.items||[]).map(item=>`<li>${h(item)}</li>`).join('')}</ul>`;
    else if(block.type==='table')content=`<div class="knowledge-table"><table>${block.caption?`<caption>${h(block.caption)}</caption>`:''}<thead><tr>${(block.headers||[]).map(cell=>`<th scope="col">${h(cell)}</th>`).join('')}</tr></thead><tbody>${(block.rows||[]).map(row=>`<tr>${row.map(cell=>`<td>${h(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    else if(block.type==='code')content=`<figure class="knowledge-example">${block.caption?`<figcaption>${h(block.caption)}</figcaption>`:''}<pre><code>${h(block.text)}</code></pre></figure>`;
    else if(block.type==='callout')content=`<aside class="knowledge-callout"><strong>${h(block.title)}</strong><p>${h(block.text)}</p></aside>`;
    // Unknown types cannot turn into author-controlled HTML or resource tags.
    if(!content)return '';
    const sources=sourceLinks(block.sources);
    return content+(sources?`<ul class="knowledge-sources">${sources}</ul>`:'');
}

export function articleSections(article) {
    return Object.entries(SECTION_TITLES).map(([key,title])=>`<section id="${key}"><h2>${title} <a class="knowledge-anchor" href="#${key}" aria-label="Link to ${a(title)}">#</a></h2><p>${h(article[key])}</p>${(article.blocks?.[key]||[]).map(renderBlock).join('')}</section>`).join('');
}

export function factSources(state) {
    return `<small>Source check: ${h(state.verifiedDate||VERIFIED_DATE)}</small><ul class="knowledge-sources">${sourceLinks(state.sources)}</ul>`;
}

export function coverageEvidenceUrl(revision) {
    return /^[a-f0-9]{40}$/.test(revision||'')
        ? `https://github.com/RobbanHoglund/JvmScope/blob/${revision}/docs/JVM-SAMPLE-RESULTS.md` : null;
}

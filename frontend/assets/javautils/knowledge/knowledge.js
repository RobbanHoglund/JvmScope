import { ARTICLES, FEATURES, JAVA_VERSIONS, VERIFIED_DATE, filterArticles, featureState, compareVersions, collectionEvidence } from './data.js';
import { parseGeneratedCoverage } from './coverage.js';
import { articleSections, sourceLinks, factSources, coverageEvidenceUrl } from './view.js';
import { articleExcerpt, highlightText, queryTokens, matchRanges, createArticleSearch, readSearchFragment, searchFragment, clearSearchFragment } from './search.js';
import readme from '../../../../README.md?raw';
import { escapeHtml as h, escapeAttr as a } from '../tda/ui-safety.js';
import './knowledge.css';

const root=document.getElementById('knowledgeRoot');
const coverage=parseGeneratedCoverage(readme);
const article=ARTICLES.find(item=>location.pathname.endsWith(`/${item.id}.html`));
const params=new URLSearchParams(location.search);
const initialSearch=readSearchFragment(location.hash);
const selectedVersion=()=>JAVA_VERSIONS.includes(Number(params.get('java')))?Number(params.get('java')):'';
const versionPath=(path,version)=>JAVA_VERSIONS.includes(Number(version))?`${path}?java=${Number(version)}`:path;
const revision=typeof __JVMSCOPE_REVISION__==='string'?__JVMSCOPE_REVISION__:null;
const evidenceUrl=coverageEvidenceUrl(revision);

function rememberVersion(version) {
    const url=new URL(location.href);
    if(JAVA_VERSIONS.includes(Number(version))){url.searchParams.set('java',String(Number(version)));params.set('java',String(Number(version)));}
    else {url.searchParams.delete('java');params.delete('java');}
    history.replaceState(null,'',url);
}
const options=(selected,all=false)=>`${all?'<option value="">All versions</option>':''}${JAVA_VERSIONS.map(v=>`<option value="${v}"${v===Number(selected)?' selected':''}>Java ${v}</option>`).join('')}`;

function capabilities(version,featureIds=FEATURES.map(f=>f.id)) {
    return `<div class="knowledge-table"><table><thead><tr><th>Feature / JVM scope</th><th>Java ${Number(version)} documented state</th></tr></thead><tbody>${FEATURES.filter(f=>featureIds.includes(f.id)).map(feature=>{
        const state=featureState(feature,version);
        return `<tr><td>${h(feature.name)}<small>${h(feature.scope)}</small></td><td>${h(state.status)}<small>${h(state.detail)}</small>${factSources(state)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function verifiedCoverage(version) {
    const row=coverage.find(row=>row.version===Number(version));
    return `<h3>C. What JvmScope has verified</h3><p>${row?`Generated capture evidence for Java ${row.version}: ${row.tda} TDA cases and ${row.tls} TLS cases.`:'No imported evidence row for this version.'} Counts cover exact builds/scenarios, not all vendors, updates or platforms. No CPU/allocation is inferred from file-dump stacks.</p><p>${evidenceUrl?`<a href="${a(evidenceUrl)}" target="_blank" rel="noopener noreferrer">Exact builds, VM families, formats and providers at this build revision</a>`:'Build revision unavailable; no moving evidence link is substituted.'}. The metadata above describes upstream capabilities; it does not add analyzer certification.</p>`;
}

function formatEvidence() {
    return `<section id="collection"><h3>B. What the selected collection actually contains</h3><p>Upstream HotSpot/OpenJDK context for the selected Java version. Verify the target VM/provider and update; missing fields remain unknown.</p><label>Format <select id="knowledgeFormat"><option value="classic">Classical jstack / Thread.print</option><option value="plain">Thread.dump_to_file plain</option><option value="json">Thread.dump_to_file JSON</option><option value="tls">SunJSSE TLS debug</option></select></label><div id="formatEvidence" aria-live="polite"></div></section>`;
}

// Preserve the format choice, but explicitly label unavailable combinations.
function bindFormat(version,afterChange=()=>{}) {
    const select=root.querySelector('#knowledgeFormat'),text=root.querySelector('#formatEvidence');
    const show=()=>{
        const v=version(),evidence=collectionEvidence({format:select.value,version:v});
        for(const option of select.options){
            const label={classic:'Classical jstack / Thread.print',plain:'Thread.dump_to_file plain',json:'Thread.dump_to_file JSON',tls:'SunJSSE TLS debug'}[option.value];
            const state=collectionEvidence({format:option.value,version:v});
            option.textContent=label+(state.available===false?` — unavailable in Java ${v}`:'');
        }
        text.classList.toggle('knowledge-unavailable',evidence.available!==true);
        text.innerHTML=`<strong>${h(evidence.status)}</strong><p>${h(evidence.detail)}</p>${evidence.facts.length?`<ul class="knowledge-sources">${sourceLinks(evidence.facts.flatMap(f=>f.state.sources||[]))}</ul>`:''}`;
    };
    select.addEventListener('change',()=>{show();afterChange();});show();return show;
}

function measurementContext(version) {
    return `<section id="collection"><h3>B. Evidence needed for this question</h3><p>Use measurements from the target JVM and workload described in this article. Thread dumps and TLS logs do not measure object-layout savings, retained-heap benefit or GC performance.</p></section><section id="analyzer-scope"><h3>C. Where JvmScope can help</h3><p>JvmScope analyzes thread and handshake observations; it has no heap-layout or GC analysis engine. Analyzer capture counts do not validate a tuning change.</p><a href="${a(versionPath('./index.html',version))}#support">See the separate diagnostic-format and analyzer-evidence guide</a></section>`;
}

function relatedGuides(version) {
    const ids=article.id==='thread-dumps'?['thread-counters','virtual-threads']
        :article.id==='object-headers'?['gc-memory','string-memory']:[];
    if(!ids.length)return '';
    return `<h2>Related checks</h2><ul>${ids.map(id=>`<li><a href="${a(versionPath(`./${id}.html`,version))}">${h(ARTICLES.find(item=>item.id===id).title)}</a></li>`).join('')}${article.id==='thread-dumps'?'<li><a href="../jvmscope/tda.html">Open TDA and browse the named CPU-sequence and virtual-thread examples</a></li>':''}</ul>`;
}

if(article){
    const version=selectedVersion()||27;
    document.title=`${article.title} · JvmScope Knowledge Base`;
    const backPath=()=>versionPath('./index.html',selectedVersion())+searchFragment(initialSearch.query);
    root.innerHTML=`<a id="knowledgeBack" href="${a(backPath())}">← Knowledge base</a><div id="articleIntro"><h1>${h(article.title)}</h1><p class="lead">${h(article.summary)}</p><p>Last source verification: ${h(article.verifiedDate||VERIFIED_DATE)}. Java 7–27 target range; upstream OpenJDK/HotSpot and Oracle documentation unless scoped otherwise. Individual release facts carry their source dates. Vendor backports and unsupported ports require verification.</p></div>
        <div class="knowledge-find" role="search" aria-label="Find in article"><label for="articleSearch">Search this article</label><input id="articleSearch" type="search" maxlength="512" placeholder="Words, a JVM flag or a diagnostic term…" aria-describedby="articleSearchHint"><span id="articleSearchCount" role="status" aria-live="polite"></span><button id="articleSearchPrevious" type="button" aria-label="Previous article match">↑</button><button id="articleSearchNext" type="button" aria-label="Next article match">↓</button><button id="articleSearchClear" type="button">Clear search</button><small id="articleSearchHint">Ctrl+F · Enter / Shift+Enter for next / previous · Esc clears</small></div>
        <nav class="knowledge-contents" aria-label="Article sections">${['does','versions','check','measure'].map(key=>`<a href="#${key}">${{does:'Mechanism',versions:'Version scope',check:'Inspect',measure:'Measure'}[key]}</a>`).join('')}</nav><label>Current Java version <select id="articleVersion">${options(version)}</select></label><div id="articleCapabilities"></div>${articleSections(article)}
        ${article.collection?`${formatEvidence()}<section id="articleCoverage"></section>`:'<div id="measurementContext"></div>'}<section id="relatedGuides"></section><section id="sources"><h2>Primary sources</h2><ul>${sourceLinks([...article.sources,...FEATURES.filter(f=>article.features.includes(f.id)).flatMap(f=>[...f.sources,...f.states.flatMap(s=>s.sources||[])])])}</ul></section>`;
    let articleSearch;
    const showFormat=article.collection?bindFormat(()=>root.querySelector('#articleVersion').value,()=>articleSearch?.refresh()):null;
    const render=()=>{
        const v=root.querySelector('#articleVersion').value;
        root.querySelector('#articleCapabilities').innerHTML=`<h3>A. Documented JVM capabilities</h3>${Number(v)<article.minVersion?'<p class="knowledge-unavailable">This topic was not introduced in the selected upstream version. The article remains available to explain the later feature.</p>':''}${article.features.length?capabilities(v,article.features):'<p>Field/API/configuration dependent. A major version does not establish printed diagnostic fields or a tuning need.</p>'}`;
        if(article.collection){root.querySelector('#articleCoverage').innerHTML=verifiedCoverage(v);showFormat();}
        else root.querySelector('#measurementContext').innerHTML=measurementContext(v);
        root.querySelector('#relatedGuides').innerHTML=relatedGuides(v);
        articleSearch?.refresh();
    };
    root.querySelector('#articleVersion').addEventListener('change',()=>{rememberVersion(root.querySelector('#articleVersion').value);root.querySelector('#knowledgeBack').href=backPath();render();});render();
    articleSearch=createArticleSearch(root,initialSearch);
}else{
    const initialVersion=selectedVersion();
    root.innerHTML=`<h1>Java Knowledge Base</h1><p class="lead">Choose diagnostic evidence and understand runtime changes before tuning. Analysis tools remain independent.</p>
        <div class="knowledge-controls"><label>Search articles <input id="knowledgeSearch" type="search" maxlength="512" placeholder="CPU allocation, virtual threads Java 21…"></label><button id="knowledgeSearchClear" type="button">Clear search</button><label>Java version <select id="knowledgeVersion">${options(initialVersion,true)}</select></label><label>Topic <select id="knowledgeTopic"><option value="">All topics</option>${['diagnostics','threads','performance','memory','gc','upgrades'].map(t=>`<option>${t}</option>`).join('')}</select></label></div><p id="knowledgeCount" aria-live="polite"></p><div id="knowledgeArticles" class="knowledge-grid"></div>
        <section id="compare"><h2>Compare potential upgrade changes</h2><p>The article filter, upgrade pair and support inspection are independent controls. An explicit page version initializes the current/support versions; changing the filter preserves your chosen upgrade pair.</p><p>Upstream transitions only. This is not a full migration checker or a performance promise. Backports, collector/platform constraints and unsupported flags require target-specific checks. Each modeled fact links its source and verification date.</p><label>Current version <select id="compareFrom">${options(initialVersion||17)}</select></label> <label>Target version <select id="compareTo">${options(27)}</select></label><div id="knowledgeComparison"></div></section>
        <section id="support"><h2>Three different kinds of support</h2><p>A. Documented runtime capabilities. B. Actual collection evidence. C. JvmScope's verified analyzer cases. These are separate.</p><label>Inspect version <select id="capabilityVersion">${options(initialVersion||27)}</select></label><div id="knowledgeCapabilities"></div>${formatEvidence()}<div id="knowledgeCoverage"></div></section>`;
    const list=()=>{
        const query=root.querySelector('#knowledgeSearch').value,tokens=queryTokens(query);
        const version=root.querySelector('#knowledgeVersion').value,selected=filterArticles({query,version,topic:root.querySelector('#knowledgeTopic').value});
        root.querySelector('#knowledgeCount').textContent=`${selected.length} articles`;
        root.querySelector('#knowledgeArticles').innerHTML=selected.map(item=>{
            const excerpt=articleExcerpt(item,query),path=versionPath(`./${item.id}.html`,version)+(tokens.length?searchFragment(query,excerpt.section):'');
            return `<a class="knowledge-card" href="${a(path)}"><h2>${highlightText(item.title,tokens)}</h2><p>${h(item.summary)}</p>${tokens.length?`<div class="knowledge-excerpt"><small>${h(excerpt.label)}</small><p>${highlightText(excerpt.text,tokens)}</p><span>${matchRanges(excerpt.text,tokens).length?'Open matching section':'Open article'} →</span></div>`:''}<small>${h(item.topics.join(' · '))}</small></a>`;
        }).join('')||'<p>No matching articles. Clear the search or filters.</p>';
        root.querySelector('#knowledgeSearchClear').disabled=!query;
    };
    for(const id of ['knowledgeSearch','knowledgeVersion','knowledgeTopic'])root.querySelector(`#${id}`).addEventListener(id==='knowledgeSearch'?'input':'change',list);
    root.querySelector('#knowledgeVersion').addEventListener('change',()=>rememberVersion(root.querySelector('#knowledgeVersion').value));
    root.querySelector('#knowledgeSearch').value=initialSearch.query;
    root.querySelector('#knowledgeSearch').addEventListener('input',clearSearchFragment);
    root.querySelector('#knowledgeSearch').addEventListener('search',()=>{clearSearchFragment();list();});
    root.querySelector('#knowledgeSearchClear').addEventListener('click',()=>{root.querySelector('#knowledgeSearch').value='';list();root.querySelector('#knowledgeSearch').focus();clearSearchFragment();});
    const compare=()=>{
        const from=root.querySelector('#compareFrom').value,to=root.querySelector('#compareTo').value,rows=compareVersions(from,to);
        root.querySelector('#knowledgeComparison').innerHTML=rows.length?`<div class="knowledge-table"><table><thead><tr><th>Capability / scope</th><th>Java ${from}</th><th>Java ${to}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.feature.name)}<small>${h(r.feature.scope)}</small></td><td>${h(r.from.status)}<small>${h(r.from.detail)}</small>${factSources(r.from)}</td><td>${h(r.to.status)}<small>${h(r.to.detail)}</small>${factSources(r.to)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No changes in this verified metadata subset. This does not mean the releases are equivalent.</p>';
    };
    for(const id of ['compareFrom','compareTo'])root.querySelector(`#${id}`).addEventListener('change',compare);
    const showFormat=bindFormat(()=>root.querySelector('#capabilityVersion').value);
    const support=()=>{const v=root.querySelector('#capabilityVersion').value;root.querySelector('#knowledgeCapabilities').innerHTML=`<h3>A. Documented JVM capabilities</h3>${capabilities(v)}`;root.querySelector('#knowledgeCoverage').innerHTML=verifiedCoverage(v);showFormat();};
    root.querySelector('#capabilityVersion').addEventListener('change',support);list();compare();support();
}

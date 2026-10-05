import { ARTICLES, FEATURES, JAVA_VERSIONS, VERIFIED_DATE, filterArticles, featureState, compareVersions } from './data.js';
import { parseGeneratedCoverage } from './coverage.js';
import readme from '../../../../README.md?raw';
import {escapeHtml as h,escapeAttr as a} from '../tda/ui-safety.js';
import './knowledge.css';

const root=document.getElementById('knowledgeRoot');
const coverage=parseGeneratedCoverage(readme);
const article=ARTICLES.find(item=>location.pathname.endsWith(`/${item.id}.html`));
const params=new URLSearchParams(location.search);
const options=(selected,all=false)=>`${all?'<option value="">All versions</option>':''}${JAVA_VERSIONS.map(v=>`<option value="${v}"${v===Number(selected)?' selected':''}>Java ${v}</option>`).join('')}`;
const labelSource=url=>url.includes('/jeps/')?`OpenJDK JEP ${url.split('/').at(-1)}`:url.includes('threadDump.html')?'OpenJDK 27 file-dump schema':url.includes('/migrate/')?'Oracle JDK 27 migration guide':`Official JDK documentation · ${url.split('/').at(-1)||'guide'}`;
const links=sources=>sources.map(url=>`<li><a href="${a(url)}" target="_blank" rel="noopener noreferrer">${h(labelSource(url))}</a></li>`).join('');
function capabilities(version,featureIds=FEATURES.map(f=>f.id)) {
    return `<table><thead><tr><th>Feature / JVM scope</th><th>Java ${Number(version)} documented state</th></tr></thead><tbody>${FEATURES.filter(f=>featureIds.includes(f.id)).map(f=>{
        const state=featureState(f,version);return `<tr><td>${h(f.name)}<small>${h(f.scope)}</small></td><td>${h(state.status)}<small>${h(state.detail)}</small></td></tr>`;
    }).join('')}</tbody></table>`;
}
function verifiedCoverage(version) {
    const row=coverage.find(row=>row.version===Number(version));
    return `<h3>C. What JvmScope has verified</h3><p>${row?`Generated capture evidence for Java ${row.version}: ${row.tda} TDA cases and ${row.tls} TLS cases.`:'No imported evidence row for this version.'} Counts cover exact builds/scenarios, not all vendors, updates or platforms. No CPU/allocation is inferred from file-dump stacks.</p><p><a href="https://github.com/RobbanHoglund/JvmScope/blob/main/docs/JVM-SAMPLE-RESULTS.md" target="_blank" rel="noopener noreferrer">Generated exact builds, VM families, formats and providers</a>. The metadata above describes upstream capabilities; it does not add analyzer certification.</p>`;
}
function formatEvidence() {
    return `<h3>B. What the selected collection actually contains</h3><label>Format <select id="knowledgeFormat"><option value="classic">Classical jstack / Thread.print</option><option value="plain">Thread.dump_to_file plain</option><option value="json">Thread.dump_to_file JSON</option><option value="tls">SunJSSE TLS debug</option></select></label><p id="formatEvidence"></p>`;
}
function bindFormat(){const select=root.querySelector('#knowledgeFormat'),text=root.querySelector('#formatEvidence');const show=()=>text.textContent={
    classic:'Stacks, states and printed lock ownership; CPU/elapsed/allocation only if actually supplied. Check -l/-e and target help. Platform/mounted scope differs by build. PID identifies only a local process context.',
    plain:'File-dump stacks with schema/build-dependent identity/state fields; virtual-thread scope. No CPU/allocation counters. Individually sampled threads are not an atomic confirmed deadlock.',
    json:'Structured file dump; inspect formatVersion/runtimeVersion and optional per-thread time/carrier/lock fields. Missing fields remain unknown. No CPU/allocation counters; non-atomic sampling.',
    tls:'SunJSSE observation text; actual provider, debug flags and format govern evidence. Thread grouping is not a connection identifier. Partial or contradictory groups can remain unknown.',
}[select.value];select.addEventListener('change',show);show();}

if(article){
    const version=JAVA_VERSIONS.includes(Number(params.get('java')))?Number(params.get('java')):27;
    document.title=`${article.title} · JvmScope Knowledge Base`;
    root.innerHTML=`<a href="./index.html">← Knowledge base</a><h1>${h(article.title)}</h1><p class="lead">${h(article.summary)}</p><p>Last source verification: ${VERIFIED_DATE}. Java 7–27 target range; upstream OpenJDK/HotSpot and Oracle documentation unless scoped otherwise. Vendor backports and unsupported ports require verification.</p><label>Current Java version <select id="articleVersion">${options(version)}</select></label><div id="articleCapabilities"></div>
        ${Object.entries({does:'What it does — and does not do',versions:'Versions, status and defaults',benefits:'When it can help',limits:'Costs, limits and when to avoid it',check:'Check your actual configuration',measure:'Measure before recommending a change'}).map(([key,title])=>`<section><h2>${title}</h2><p>${h(article[key])}</p></section>`).join('')}
        ${formatEvidence()}<div id="articleCoverage"></div><h2>Primary sources</h2><ul>${links([...new Set([...article.sources,...FEATURES.filter(f=>article.features.includes(f.id)).flatMap(f=>f.sources)])])}</ul>`;
    const render=()=>{const v=root.querySelector('#articleVersion').value;root.querySelector('#articleCapabilities').innerHTML=`<h3>A. Documented JVM capabilities</h3>${article.features.length?capabilities(v,article.features):'<p>Field/API/configuration dependent. Read the qualifications below; a major version does not establish the printed diagnostic fields or tuning need.</p>'}`;root.querySelector('#articleCoverage').innerHTML=verifiedCoverage(v);};
    root.querySelector('#articleVersion').addEventListener('change',render);bindFormat();render();
} else {
    root.innerHTML=`<h1>Java Knowledge Base</h1><p class="lead">Choose diagnostic evidence and understand runtime changes before tuning. Analysis tools remain independent.</p>
        <div class="knowledge-controls"><label>Search articles <input id="knowledgeSearch" type="search" placeholder="Threads, strings, pinning, memory…"></label><label>Java version <select id="knowledgeVersion">${options('',true)}</select></label><label>Topic <select id="knowledgeTopic"><option value="">All topics</option>${['diagnostics','threads','performance','memory','gc','upgrades'].map(t=>`<option>${t}</option>`).join('')}</select></label></div><p id="knowledgeCount" aria-live="polite"></p><div id="knowledgeArticles" class="knowledge-grid"></div>
        <section><h2>Compare potential upgrade changes</h2><p>Upstream transitions only. This is not a full migration checker or a performance promise. Backports, collector/platform constraints and unsupported flags require target-specific checks. Last verification ${VERIFIED_DATE}.</p><label>Current version <select id="compareFrom">${options(17)}</select></label> <label>Target version <select id="compareTo">${options(27)}</select></label><div id="knowledgeComparison"></div></section>
        <section><h2>Three different kinds of support</h2><p>A. Documented runtime capabilities. B. Actual collection evidence. C. JvmScope's verified analyzer cases. These are separate.</p><label>Inspect version <select id="capabilityVersion">${options(27)}</select></label><div id="knowledgeCapabilities"></div>${formatEvidence()}<div id="knowledgeCoverage"></div></section>`;
    const list=()=>{const selected=filterArticles({query:root.querySelector('#knowledgeSearch').value,version:root.querySelector('#knowledgeVersion').value,topic:root.querySelector('#knowledgeTopic').value});root.querySelector('#knowledgeCount').textContent=`${selected.length} articles`;root.querySelector('#knowledgeArticles').innerHTML=selected.map(item=>`<a class="knowledge-card" href="./${item.id}.html"><h2>${h(item.title)}</h2><p>${h(item.summary)}</p><small>${h(item.topics.join(' · '))}</small></a>`).join('')||'<p>No matching articles. Clear the search or filters.</p>';};
    for(const id of ['knowledgeSearch','knowledgeVersion','knowledgeTopic'])root.querySelector(`#${id}`).addEventListener(id==='knowledgeSearch'?'input':'change',list);
    const compare=()=>{const from=root.querySelector('#compareFrom').value,to=root.querySelector('#compareTo').value;const rows=compareVersions(from,to);root.querySelector('#knowledgeComparison').innerHTML=rows.length?`<table><thead><tr><th>Capability / scope</th><th>Java ${from}</th><th>Java ${to}</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${h(r.feature.name)}<small>${h(r.feature.scope)}</small></td><td>${h(r.from.status)}<small>${h(r.from.detail)}</small></td><td>${h(r.to.status)}<small>${h(r.to.detail)}</small><ul>${links(r.feature.sources)}</ul></td></tr>`).join('')}</tbody></table>`:'<p>No changes in this verified metadata subset. This does not mean the releases are equivalent.</p>';};
    for(const id of ['compareFrom','compareTo'])root.querySelector(`#${id}`).addEventListener('change',compare);
    const support=()=>{const v=root.querySelector('#capabilityVersion').value;root.querySelector('#knowledgeCapabilities').innerHTML=`<h3>A. Documented JVM capabilities</h3>${capabilities(v)}`;root.querySelector('#knowledgeCoverage').innerHTML=verifiedCoverage(v);};root.querySelector('#capabilityVersion').addEventListener('change',support);
    list();compare();support();bindFormat();
}

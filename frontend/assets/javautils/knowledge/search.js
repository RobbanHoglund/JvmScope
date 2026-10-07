import { escapeHtml } from '../tda/ui-safety.js';

export const SECTION_TITLES = {
    does:'What it does — and does not do', versions:'Versions, status and defaults',
    benefits:'When it can help', limits:'Costs, limits and when to avoid it',
    check:'Check your actual configuration', measure:'Measure before recommending a change',
};
export const MAX_QUERY = 512;

// Same literal word semantics for result ranking, excerpts and article finding.
// JVM-option punctuation is syntax; VT is a documented virtual-thread alias.
export function queryTokens(value) {
    const query=String(value??'').trim().toLowerCase();
    if(query.length>MAX_QUERY)return [];
    return [...new Set((query.replace(/(^|[^\p{L}\p{N}_])-xx:[+-]?/gu,'$1').match(/[\p{L}\p{N}_]+/gu)||[])
        .map(token=>token==='vt'?'virtual':token))];
}

export function matchRanges(text,tokens) {
    const ranges=[];
    const patterns=tokens.map(token=>({token,numeric:/^\d+$/.test(token),pattern:new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu')}));
    for(const word of String(text).matchAll(/[\p{L}\p{N}_]+/gu)) {
        const lower=word[0].toLowerCase();
        for(const {token,numeric,pattern} of patterns) {
            if(numeric && lower!==token)continue;
            // Match the original text, so Unicode case folding cannot shift offsets.
            for(const hit of word[0].matchAll(pattern))
                ranges.push({start:word.index+hit.index,end:word.index+hit.index+hit[0].length,token});
        }
    }
    ranges.sort((a,b)=>a.start-b.start||b.end-a.end);
    const merged=[];
    for(const range of ranges){const last=merged.at(-1);if(last && range.start<last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});}
    return merged;
}

export function highlightText(text,tokens) {
    text=String(text??'');let end=0,html='';
    for(const range of matchRanges(text,tokens)){
        html+=escapeHtml(text.slice(end,range.start))+`<mark>${escapeHtml(text.slice(range.start,range.end))}</mark>`;
        end=range.end;
    }
    return html+escapeHtml(text.slice(end));
}

function blockText(block) {
    return [block.text,block.title,block.caption,...(block.items||[]),...(block.headers||[]),...(block.rows||[]).flat()].filter(Boolean).join(' ');
}

export function articleExcerpt(article,query) {
    const tokens=queryTokens(query);
    const records=Object.entries(SECTION_TITLES).map(([section,label])=>({section,label,text:[article[section],...(article.blocks?.[section]||[]).map(blockText)].filter(Boolean).join(' ').replace(/\s+/g,' ')}));
    records.push({section:'articleIntro',label:'Overview',text:article.summary});
    const ranked=records.map((record,index)=>({...record,index,ranges:matchRanges(record.text,tokens)}))
        .sort((a,b)=>new Set(b.ranges.map(r=>r.token)).size-new Set(a.ranges.map(r=>r.token)).size||a.index-b.index);
    const record=ranked[0];
    if(!tokens.length||!record?.ranges.length)return {section:'articleIntro',label:'Overview',text:article.summary};
    // Center on the window containing the most query words, then the earliest one.
    const centers=record.ranges.map(range=>{
        const start=Math.max(0,range.start-65),end=Math.min(record.text.length,start+240);
        return {start,end,count:new Set(record.ranges.filter(r=>r.start>=start&&r.end<=end).map(r=>r.token)).size};
    }).sort((a,b)=>b.count-a.count||a.start-b.start);
    let {start,end}=centers[0];
    if(start>0){const boundary=record.text.indexOf(' ',start);if(boundary>=0&&boundary<start+25)start=boundary+1;}
    if(end<record.text.length){const boundary=record.text.lastIndexOf(' ',end);if(boundary>end-25)end=boundary;}
    return {section:record.section,label:record.label,text:`${start?'…':''}${record.text.slice(start,end)}${end<record.text.length?'…':''}`};
}

// Fragments stay out of HTTP requests and referrers. No browser storage is used.
export function searchFragment(query,section='articleIntro') {
    if(!queryTokens(query).length)return '';
    return '#'+new URLSearchParams({find:String(query).trim(),section:validSection(section)});
}
function validSection(section){return Object.hasOwn(SECTION_TITLES,section)?section:'articleIntro';}
export function readSearchFragment(hash) {
    const params=new URLSearchParams(String(hash).replace(/^#/,''));
    const query=params.get('find')||'';
    return {query:queryTokens(query).length?query:'',section:validSection(params.get('section'))};
}
export function clearSearchFragment() {
    if(readSearchFragment(location.hash).query){const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);}
}

export function createArticleSearch(root,{query='',section='articleIntro'}={}) {
    const input=root.querySelector('#articleSearch');
    const count=root.querySelector('#articleSearchCount');
    const previous=root.querySelector('#articleSearchPrevious'),next=root.querySelector('#articleSearchNext'),clear=root.querySelector('#articleSearchClear');
    const MAX_MARKS=500;
    let marks=[],current=-1,total=0;
    const clean=()=>{
        for(const mark of root.querySelectorAll('mark[data-article-match]'))mark.replaceWith(...mark.childNodes);
        root.normalize();marks=[];current=-1;total=0;
    };
    function status(){
        count.textContent=!input.value.trim()?'Search the article text':!total?'No matches':`${current+1} of ${marks.length} word matches${total>marks.length?` shown (${total} total)`:''}`;
        previous.disabled=next.disabled=!marks.length;clear.disabled=!input.value;
    }
    function select(index,scroll){
        marks[current]?.classList.remove('knowledge-current-match');
        marks[current]?.removeAttribute('aria-current');
        current=marks.length?(index+marks.length)%marks.length:-1;
        if(current>=0){marks[current].classList.add('knowledge-current-match');marks[current].setAttribute('aria-current','true');if(scroll)marks[current].scrollIntoView({block:'center',inline:'nearest'});}
        status();
    }
    function refresh({scroll=false,preferredSection=''}={}) {
        clean();const tokens=queryTokens(input.value);
        if(tokens.length){
            const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('label,input,select,button,.knowledge-find,.knowledge-contents,#knowledgeBack,script,style')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
            const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
            for(const node of nodes){
                const ranges=matchRanges(node.textContent,tokens);total+=ranges.length;
                if(!ranges.length||marks.length>=MAX_MARKS)continue;
                const fragment=document.createDocumentFragment();let end=0;
                for(const range of ranges.slice(0,MAX_MARKS-marks.length)){
                    fragment.append(document.createTextNode(node.textContent.slice(end,range.start)));
                    const mark=document.createElement('mark');mark.dataset.articleMatch='';mark.textContent=node.textContent.slice(range.start,range.end);marks.push(mark);fragment.append(mark);end=range.end;
                }
                fragment.append(document.createTextNode(node.textContent.slice(end)));node.replaceWith(fragment);
            }
        }
        const preferred=preferredSection?marks.findIndex(mark=>mark.closest(`#${validSection(preferredSection)}`)):-1;
        select(preferred>=0?preferred:0,scroll);
    }
    function reset(){
        input.value='';refresh();input.focus();clearSearchFragment();
    }
    input.value=queryTokens(query).length?query:'';
    input.addEventListener('input',()=>{clearSearchFragment();refresh();});
    input.addEventListener('search',()=>{clearSearchFragment();refresh();});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();select(current+(event.shiftKey?-1:1),true);}else if(event.key==='Escape'){event.preventDefault();reset();}});
    previous.addEventListener('click',()=>select(current-1,true));next.addEventListener('click',()=>select(current+1,true));clear.addEventListener('click',reset);
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&!event.altKey){event.preventDefault();input.focus();input.select();}});
    refresh({scroll:Boolean(input.value),preferredSection:section});
    return {refresh};
}

import './style.css';
import { analyzeGc, MAX_GC_BYTES } from './parser.js';
import { createGcClient } from './client.js';
import { GC_EXAMPLES } from './examples.js';
import { bindHostInputs, bindSourceButton, createHostNavigation, syncSourceLinks, writeClipboard } from '../host/platform.js';

const $=id=>document.getElementById(id);
const client=createGcClient();
const examples=Object.fromEntries(GC_EXAMPLES.map(sample=>[sample.id,sample]));
let parsed=null,model=null,source=null,lines=[],selected=null,generation=0,page=0,controller=null;
let range=[0,1000],currentAnnotations=[];
const kindNames={pause:'Stop-the-world pause',concurrent:'Concurrent phase',cycle:'Collection cycle',stall:'Allocation stall'};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const ms=n=>finite(n)?`${n<1?n.toFixed(3):n.toFixed(2)} ms`:'Not recorded';
const mib=n=>finite(n)?`${(n/1048576).toFixed(1)} MiB`:'Not recorded';
const title=e=>e.label.replace(/\s+[\d.,]+[KMGT].*$/,'').replace(/\s*\[.*$/,'').replace(/\s*\d{4}-\d\d-\d\dT.*$/,'').replace(/[,\s]+$/,'');
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const svg=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
function time(n){if(!finite(n))return 'No timestamp';return parsed?.sessions.find(s=>s.id===model.session)?.clock==='wall'?new Date(n).toISOString().slice(11,23):`${(n/1000).toFixed(3)} s`;}
function error(cause){$('gcError').hidden=false;$('gcError').textContent=(cause.message||String(cause))+(source?' The previous capture was kept.':'');}
function busy(on){$('gcStatus').textContent=on?'Reading and analyzing GC records locally…':'HotSpot / OpenJDK · Java 8–27 · analyzed locally';$('gcClear').disabled=!on&&!parsed;$('gcWorkspace').setAttribute('aria-busy',String(on));}
function reset(){generation++;controller?.abort();client.cancel();parsed=model=source=null;lines=[];selected=null;page=0;range=[0,1000];$('gcError').hidden=true;$('gcWorkspace').hidden=true;$('gcStart').hidden=false;$('gcFile').value='';syncSourceLinks([]);navigation.publish(null);busy(false);}
function begin(){const id=++generation;controller?.abort();client.cancel();$('gcError').hidden=true;busy(true);return id;}
async function accept(text,name,hostSourceId,id){
    if(id!==generation)return null;
    const result=await client.analyze(text);if(!result||id!==generation)return null;
    const budget=Number($('gcBudget').value);
    if(!finite(budget)||budget<=0||budget>60000)throw new Error('Correct the pause budget before loading another capture.');
    parsed=result;source={text,name,hostSourceId};lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
    page=0;range=[0,1000];$('gcType').value='all';$('gcSearch').value='';
    $('gcSession').replaceChildren(...parsed.sessions.map((s,i)=>{const o=el('option',`Segment ${i+1} · ${s.collector}`);o.value=s.id;return o;}));
    $('gcFilename').textContent=name;$('gcWorkspace').hidden=false;$('gcStart').hidden=true;
    syncSourceLinks([hostSourceId]);recalculate(true);publishNavigation();
    return {events:parsed.events.length,segments:parsed.sessions.length};
}
async function onSources(sources){const id=begin();try{
    if(sources.length!==1)throw new Error('Choose one GC log at a time. JVM segments inside a file are analyzed separately.');
    const s=sources[0];return await accept(s.text,s.name,s.hostSourceId,id);
}catch(e){if(id===generation)error(e);throw e;}finally{if(id===generation)busy(false);}}
async function loadFiles(files){const id=begin();try{
    if(files.length!==1)throw new Error('Drop or choose one GC log at a time.');
    const file=files[0];if(file.size>MAX_GC_BYTES)throw new Error('The GC log exceeds 64 MiB. Split it into smaller captures.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
    await accept(text,file.name,null,id);
}catch(e){if(id===generation)error(e);}finally{if(id===generation)busy(false);}}
async function loadExample(){const id=begin(),sample=examples[$('gcExample').value];controller=new AbortController();try{
    const response=await fetch(sample.url,{signal:controller.signal});if(!response.ok)throw new Error('The bundled GC example could not be read.');
    await accept(await response.text(),sample.name,null,id);
}catch(e){if(id===generation)error(e);}finally{if(id===generation)busy(false);}}

function recalculate(choose=false){
    if(!parsed)return;
    const budget=Number($('gcBudget').value);
    if(!finite(budget)||budget<=0||budget>60000){$('gcBudget').setAttribute('aria-invalid','true');$('gcError').hidden=false;$('gcError').textContent='Enter a pause budget greater than 0 and at most 60,000 ms. Existing results use the previous budget.';return;}
    $('gcBudget').removeAttribute('aria-invalid');$('gcError').hidden=true;
    model=analyzeGc(parsed,{session:Number($('gcSession').value),pauseBudgetMs:budget});
    if(choose||!model.events.some(e=>e.id===selected)) selected=model.findings.find(f=>f.eventId!==null)?.eventId??model.events.find(e=>e.kind==='pause')?.id??model.events[0].id;
    const s=parsed.sessions.find(s=>s.id===model.session);
    $('gcMetadata').textContent=`${s.collector} · ${s.version?'Java '+s.version:'Java version not recorded'} · ${parsed.format} logging · ${parsed.lineCount.toLocaleString()} lines`;
    const stats=model.stats;
    const metrics=[['Recorded pauses',stats.pauses.toLocaleString(),'completed stop-the-world phases'],['Longest pause',ms(stats.maxPauseMs),`selected budget ${budget} ms`],['P95 pause',ms(stats.p95PauseMs),stats.pauses<20?'Small sample · nearest-rank estimate':'nearest-rank percentile'],['Observed pause share',stats.pauseShare===null?'Unavailable':stats.pauseShare.toFixed(2)+'%','observed event window · overlapping pauses merged'],['Review markers',model.findings.length.toLocaleString(),'JVM signals & transparent heuristics']];
    $('gcMetrics').replaceChildren(...metrics.map(([label,value,note],i)=>{const box=el('div',undefined,'gc-metric'+(i===4&&model.findings.length?' attention':''));box.append(el('span',label),el('strong',value),el('small',note));return box;}));
    const warnings=[...parsed.warnings];
    if(s.collector==='Unknown')warnings.push('The collector was not identified from recorded evidence. No collector-specific defaults are assumed.');
    $('gcWarnings').replaceChildren(...warnings.map(w=>el('p',w)));
    $('gcCoverage').open=warnings.length>0;
    draw();renderTable();inspect();
}
function bounds(){const full=Math.max(1,(model.end??0)-(model.start??0));return [(model.start??0)+full*range[0]/1000,(model.start??0)+full*range[1]/1000];}
function eventFindings(id){return model.findings.filter(f=>f.eventId===id);}
function select(id,{zoom=false}={}){selected=id;const e=model.events.find(e=>e.id===id);if(!e)return;
    if(zoom&&e.startMs!==null){const span=Math.max(20,Math.min((model.end-model.start)*.2,Math.max(e.durationMs*8,100)));const full=Math.max(1,model.end-model.start);range=[Math.max(0,(e.startMs-span/2-model.start)/full*1000),Math.min(1000,(e.endMs+span/2-model.start)/full*1000)];}
    draw();inspect();renderTable();
}
function draw(){
    if(!model)return;
    const width=Math.max(340,$('gcTimeline').clientWidth),height=330,left=52,right=width-15,plot=right-left;
    const [from,to]=bounds(),span=Math.max(1,to-from),x=n=>left+(n-from)/span*plot;
    const chart=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':'GC timeline. Select an event to inspect its evidence.'});
    const visible=model.events.filter(e=>e.startMs!==null&&e.endMs>=from&&e.startMs<=to);
    if(model.start===null){$('gcTimeline').replaceChildren(el('p','No usable timestamps were recorded. Inspect the completed phases in the event list.','gc-footnote'));$('gcAnnotations').replaceChildren();$('gcChartNote').textContent='Untimed events cannot be placed on a timeline.';$('gcRangeLabel').textContent='Time range unavailable';return;}
    const heap=visible.filter(e=>e.heap),maxHeap=Math.max(1,heap.reduce((m,e)=>Math.max(m,e.heap.before,e.heap.after,e.heap.capacity??0),0));
    const maxPause=Math.max(visible.filter(e=>e.kind==='pause').reduce((m,e)=>Math.max(m,e.durationMs),0),.01)*1.12;
    const hy=n=>138-n/maxHeap*100,py=n=>252-n/maxPause*70;
    for(let i=0;i<=4;i++){const xx=left+plot*i/4;chart.append(svg('line',{x1:xx,x2:xx,y1:30,y2:302,class:'gc-grid'}),svg('text',{x:xx,y:322,'text-anchor':i===0?'start':i===4?'end':'middle'},time(from+span*i/4)));}
    chart.append(svg('text',{x:0,y:19},'HEAP'),svg('text',{x:0,y:40},`${(maxHeap/1048576).toFixed(0)} MiB`),svg('text',{x:0,y:141},'0'),svg('text',{x:0,y:171},'PAUSE'),svg('text',{x:0,y:190},`${maxPause.toFixed(maxPause<1?2:0)} ms`),svg('text',{x:0,y:255},'0'),svg('text',{x:0,y:293},'OTHER'));
    for(const yy of [138,252,302])chart.append(svg('line',{x1:left,x2:right,y1:yy,y2:yy,class:'gc-grid'}));
    const clip=svg('clipPath',{id:'gcPlotClip'});clip.append(svg('rect',{x:left,y:25,width:plot,height:279}));const defs=svg('defs');defs.append(clip);chart.append(defs);
    const content=svg('g',{'clip-path':'url(#gcPlotClip)'});chart.append(content);
    // Bound SVG nodes by horizontal pixel buckets; raw samples stay in the table.
    const heapBins=new Map();for(const e of heap){const key=Math.floor(x(e.endMs));const old=heapBins.get(key);if(!old||e.heap.before>old.heap.before||e.heap.after<old.heap.after)heapBins.set(key,e);}
    const sampledHeap=[...heapBins.values()].sort((a,b)=>a.startMs-b.startMs);
    if(sampledHeap.length){const points=sampledHeap.flatMap(e=>[[x(e.startMs),hy(e.heap.before)],[x(e.endMs),hy(e.heap.after)]]);const path=points.map(([xx,yy],i)=>`${i?'L':'M'}${xx.toFixed(2)},${yy.toFixed(2)}`).join(' ');content.append(svg('path',{d:`${path} L${points.at(-1)[0]},138 L${points[0][0]},138 Z`,class:'gc-heap-area'}),svg('path',{d:path,class:'gc-heap-line'}));}
    else chart.append(svg('text',{x:left+plot/2,y:85,'text-anchor':'middle'},'No total-heap samples recorded in this range'));
    if(model.pauseBudgetMs<=maxPause)content.append(svg('line',{x1:left,x2:right,y1:py(model.pauseBudgetMs),y2:py(model.pauseBudgetMs),class:'gc-budget-line'}));
    chart.append(svg('text',{x:right,y:model.pauseBudgetMs<=maxPause?py(model.pauseBudgetMs)-5:171,'text-anchor':'end'},`${model.pauseBudgetMs} ms budget${model.pauseBudgetMs>maxPause?' · above scale':''}`));
    const byId=new Map();for(const f of model.findings){if(f.eventId!==null&&!byId.has(f.eventId))byId.set(f.eventId,f);}
    const bins=new Map();for(const e of visible){const key=e.id===selected?'selected':`${e.kind}:${Math.floor(x(e.startMs))}`;const old=bins.get(key);if(!old||(e.durationMs??0)>(old.durationMs??0)||byId.has(e.id)&&!byId.has(old.id))bins.set(key,e);}
    for(const e of bins.values()){
        const f=byId.get(e.id),pause=e.kind==='pause',xx=Math.max(left,x(e.startMs)),yy=pause?py(e.durationMs):e.kind==='stall'?282:274;
        const mark=svg('rect',{x:xx,y:yy,width:Math.max(3,Math.min(right-xx,x(e.endMs)-xx)),height:pause?Math.max(2,252-yy):e.kind==='stall'?15:8,rx:1,
            class:`gc-mark ${e.kind} ${f?.severity||''} ${e.id===selected?'selected':''}`,tabindex:0,role:'button','aria-label':`${time(e.startMs)}: ${title(e)}. ${ms(e.durationMs)}${f?'. '+f.title:''}`});
        mark.append(svg('title',{},`${title(e)} · ${ms(e.durationMs)} · ${time(e.startMs)}`));
        mark.addEventListener('click',()=>select(e.id));mark.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select(e.id);$('gcEventTitle').tabIndex=-1;$('gcEventTitle').focus({preventScroll:true});}});content.append(mark);
    }
    const candidates=model.findings.filter(f=>f.startMs!==null&&f.startMs>=from&&f.startMs<=to);
    currentAnnotations=[];const ids=new Set();for(const f of candidates){const key=f.eventId??'line:'+f.line;if(ids.has(key))continue;ids.add(key);currentAnnotations.push(f);if(currentAnnotations.length===3)break;}
    currentAnnotations.sort((a,b)=>a.startMs-b.startMs);
    currentAnnotations.forEach((f,i)=>{const actual=x(f.startMs),cx=left+plot*(i+1)/(currentAnnotations.length+1);
        chart.append(svg('line',{x1:actual,x2:actual,y1:31,y2:302,class:'gc-annotation-line'}),svg('line',{x1:actual,x2:cx,y1:31,y2:18,class:'gc-annotation-line'}),svg('circle',{cx,cy:17,r:10,class:'gc-annotation-dot'}),svg('text',{x:cx,y:21,class:'gc-annotation-number'},i+1));});
    $('gcTimeline').replaceChildren(chart);
    $('gcAnnotations').replaceChildren(...currentAnnotations.map((f,i)=>{const b=el('button',undefined,'gc-annotation');b.type='button';const copy=el('span');copy.append(el('strong',f.title),el('small',`${time(f.startMs)} · ${f.severity} · line ${f.line}`));b.append(el('span',i+1),copy);b.addEventListener('click',()=>{if(f.eventId!==null)select(f.eventId);else inspectSignal(f);});return b;}));
    if(!currentAnnotations.length)$('gcAnnotations').append(el('p','No review markers in this time range. This does not establish overall application health.','gc-footnote'));
    $('gcChartNote').textContent=`${visible.length.toLocaleString()} events in range${bins.size<visible.length?`; ${bins.size.toLocaleString()} representative marks shown. All events remain in the table`:''}. Concurrent work is not stop-the-world time. ${candidates.length>3?'Showing up to 3 annotated events; use “With review markers” for the complete list.':''}`;
    $('gcFrom').value=range[0];$('gcTo').value=range[1];$('gcRangeLabel').textContent=time(from)+' – '+time(to);
}
function findingNode(f){const box=el('div',undefined,'gc-finding '+f.severity);box.append(el('strong',`${f.severity==='critical'?'Critical':f.severity==='warning'?'Review':'Info'} · ${f.title}`),el('p',f.detail));return box;}
function rawFor(e){return lines.slice(e.line-1,e.endLine).join('\n');}
function inspect(){const e=model?.events.find(e=>e.id===selected);if(!e)return;$('gcEventTitle').textContent=title(e);const facts=el('dl');
    for(const [name,value] of [['Kind',kindNames[e.kind]],['GC ID',e.gcId===null?'Not recorded':'GC('+e.gcId+')'],['Start',time(e.startMs)],['Duration',ms(e.durationMs)+(e.durationDerived?' (from timestamps)':'')],['Heap before',mib(e.heap?.before)],['Heap after',mib(e.heap?.after)],['Reported capacity',mib(e.heap?.capacity)]]){facts.append(el('dt',name),el('dd',value));}
    $('gcEventFacts').replaceChildren(facts);$('gcEventFindings').replaceChildren(...eventFindings(e.id).map(findingNode));
    $('gcRawLocation').textContent=`lines ${e.line}–${e.endLine}`;$('gcRaw').textContent=rawFor(e);$('gcInspector').dataset.selectedId=e.id;
    bindSourceButton($('gcSource'),source.hostSourceId?{sourceId:source.hostSourceId,startLine:e.line,endLine:e.endLine}:null);
}
function inspectSignal(f){$('gcEventTitle').textContent=f.title;$('gcEventFacts').replaceChildren();$('gcEventFindings').replaceChildren(findingNode(f));$('gcRawLocation').textContent='line '+f.line;$('gcRaw').textContent=lines[f.line-1]||'';bindSourceButton($('gcSource'),source.hostSourceId?{sourceId:source.hostSourceId,startLine:f.line,endLine:f.line}:null);}
function renderTable(){if(!model)return;const type=$('gcType').value,query=$('gcSearch').value.toLowerCase();const foundIds=new Set(model.findings.map(f=>f.eventId));
    const filtered=model.events.filter(e=>(type==='all'||type==='findings'?type!=='findings'||foundIds.has(e.id):e.kind===type)&&(`${e.label} GC(${e.gcId})`.toLowerCase().includes(query)));
    page=Math.max(0,Math.min(page,Math.ceil(filtered.length/40)-1));const shown=filtered.slice(page*40,page*40+40);
    $('gcRows').replaceChildren(...shown.map(e=>{const tr=el('tr');tr.dataset.selected=String(e.id===selected);const button=el('button',title(e),'gc-event-link');button.type='button';button.append(el('span',`${kindNames[e.kind]} · ${e.gcId===null?'line '+e.line:'GC('+e.gcId+')'}`));button.addEventListener('click',()=>select(e.id));const cell=el('td');cell.append(button);tr.append(el('td',time(e.startMs)),cell,el('td',ms(e.durationMs)),el('td',e.heap?`${mib(e.heap.before)} → ${mib(e.heap.after)}`:'Not recorded'));
        const fs=eventFindings(e.id),review=el('td');if(fs.length){const badge=el('span',undefined,'gc-badge '+fs[0].severity),icon=svg('svg',{viewBox:'0 0 16 16','aria-hidden':'true'});icon.append(svg('path',{d:fs[0].severity==='critical'?'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 3v5m0 2v1':'M8 1 15 14H1Z M8 5v4m0 2v1'}));badge.append(icon,el('span',`${fs.length} ${fs[0].severity==='info'?'info':'review'}`));review.append(badge);}else review.textContent='—';tr.append(review);return tr;}));
    if(!shown.length){const tr=el('tr'),td=el('td','No events match these filters.');td.colSpan=5;tr.append(td);$('gcRows').append(tr);}
    $('gcCount').textContent=filtered.length?`${page*40+1}–${Math.min(page*40+40,filtered.length)} of ${filtered.length.toLocaleString()} events`:'0 events';$('gcPrev').disabled=page===0;$('gcNext').disabled=(page+1)*40>=filtered.length;
}
const navigation=createHostNavigation(selection=>{
    const e=parsed.events.find(e=>e.id===selection);if(!e)return;
    if(model.session!==e.session){$('gcSession').value=e.session;range=[0,1000];recalculate(true);}select(e.id,{zoom:true});
});
function publishNavigation(){const items=parsed.events;navigation.publish({count:items.length,summary:`${items.length} GC events · ${parsed.sessions.length} JVM segment(s)`,children:(key,offset=0)=>{
    if(key)return {total:0,items:[]};return {total:items.length,items:items.slice(offset,offset+100).map(e=>({key:`event:0:${e.id}`,kind:'event',label:title(e).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,240),description:ms(e.durationMs),children:false}))};},resolve:key=>{const m=key.match(/^event:0:(\d+)$/);if(!m)throw new Error('Unknown GC event');return Number(m[1]);}});}
$('gcOpen').onclick=()=>$('gcFile').click();$('gcFile').onchange=()=>loadFiles([...$('gcFile').files]);$('gcSample').onclick=loadExample;$('gcClear').onclick=reset;
$('gcBudget').onchange=()=>recalculate();$('gcSession').onchange=()=>{range=[0,1000];page=0;recalculate(true);};
$('gcZoom').onclick=()=>select(selected,{zoom:true});$('gcReset').onclick=()=>{range=[0,1000];draw();};
$('gcFrom').oninput=()=>{range[0]=Math.min(Number($('gcFrom').value),range[1]-1);draw();};$('gcTo').oninput=()=>{range[1]=Math.max(Number($('gcTo').value),range[0]+1);draw();};
$('gcType').onchange=()=>{page=0;renderTable();};$('gcSearch').oninput=()=>{page=0;renderTable();};$('gcPrev').onclick=()=>{page--;renderTable();};$('gcNext').onclick=()=>{page++;renderTable();};
$('gcCopy').onclick=async()=>{try{await writeClipboard($('gcRaw').textContent);$('gcStatus').textContent='Event evidence copied.';}catch(e){error(e);}};
let dragDepth=0;document.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;$('gcDropOverlay').hidden=false;}});
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('gcDropOverlay').hidden=true;}});
document.addEventListener('drop',event=>{if(!event.dataTransfer?.files.length)return;event.preventDefault();dragDepth=0;$('gcDropOverlay').hidden=true;void loadFiles([...event.dataTransfer.files]);});
new ResizeObserver(()=>{if(model)draw();}).observe($('gcTimeline'));
bindHostInputs({fileInput:$('gcFile'),onSources});

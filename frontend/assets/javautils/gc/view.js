import './style.css';
import { captureSummary, eventWindow } from './presentation.js';
import { formatGcTime } from './time.js';
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
function time(n,options){return formatGcTime(n,parsed?.sessions.find(s=>s.id===model.session)?.clock,options);}
function error(cause){$('gcError').hidden=false;$('gcError').textContent=(cause.message||String(cause))+(source?' The previous capture was kept.':'');}
function busy(on){$('gcStatus').textContent=on?'Reading and analyzing GC records locally…':'HotSpot / OpenJDK · Java 8–27 · analyzed locally';$('gcClear').disabled=!on&&!parsed;$('gcWorkspace').setAttribute('aria-busy',String(on));}
function reset(){hideTooltip();generation++;controller?.abort();client.cancel();parsed=model=source=null;lines=[];selected=null;page=0;range=[0,1000];$('gcError').hidden=true;$('gcWorkspace').hidden=true;$('gcStart').hidden=false;$('gcFile').value='';syncSourceLinks([]);navigation.publish(null);busy(false);}
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
    const signals=model.findings.filter(f=>f.eventId===null);
    for(const f of signals){const button=el('button',`${f.severity} · ${f.title} · line ${f.line}`,'gc-button');button.type='button';button.onclick=()=>{inspectSignal(f);$('gcEventTitle').tabIndex=-1;$('gcEventTitle').focus();};$('gcWarnings').append(button);}
    $('gcCoverage').open=warnings.length>0||signals.length>0;
    renderSummary();draw();renderTable();inspect();
}
function bounds(){const full=Math.max(1,(model.end??0)-(model.start??0));return [(model.start??0)+full*range[0]/1000,(model.start??0)+full*range[1]/1000];}
function eventFindings(id){return model.findings.filter(f=>f.eventId===id);}
function select(id,{zoom=false}={}){selected=id;const e=model.events.find(e=>e.id===id);if(!e)return;
    if(zoom&&e.startMs!==null){
        const window=eventWindow(model.events,e,model.start,model.end),full=Math.max(1,model.end-model.start);
        range=window.map(value=>(value-model.start)/full*1000);
    }
    draw();inspect();renderTable();
    focusInspector();
}
function focusInspector(){
    const heading=$('gcEventTitle');heading.tabIndex=-1;heading.focus({preventScroll:true});
    if($('gcInspector').getBoundingClientRect().top>$('gcTimeline').getBoundingClientRect().bottom)heading.scrollIntoView({block:'nearest'});
}
function openFinding(f){
    if(f.eventId!==null)select(f.eventId);else{inspectSignal(f);focusInspector();}
}
function openChartFindings(findings,index=0){
    openFinding(findings[index]);
    if(findings.length>1){
        const choices=$('gcClusterFindings');choices.hidden=false;
        choices.replaceChildren(el('span',`${findings.length} findings at this marker`,'gc-eyebrow'),...findings.map((f,i)=>{
            const button=el('button',`${i+1}. ${f.title} · ${time(f.startMs)}`,'gc-cluster-choice');
            button.type='button';button.setAttribute('aria-pressed',String(i===index));
            button.onclick=()=>openChartFindings(findings,i);return button;
        }));
    }
    focusInspector();
}
function clearChartFindings(){$('gcClusterFindings').hidden=true;$('gcClusterFindings').replaceChildren();}
function draw(){
    if(!model)return;
    hideTooltip();
    const width=Math.max(240,$('gcTimeline').clientWidth),height=330,left=52,right=width-15,plot=right-left;
    const [from,to]=bounds(),span=Math.max(1,to-from),x=n=>left+(n-from)/span*plot;
    const chart=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','data-from':from,'data-to':to,'aria-label':'GC timeline. Select an event to inspect its evidence.'});
    const visible=model.events.filter(e=>e.startMs!==null&&e.endMs>=from&&e.startMs<=to);
    for(const id of ['gcFrom','gcTo','gcReset'])$(id).disabled=model.start===null;
    $('gcZoom').disabled=!model.events.some(e=>e.id===selected&&e.startMs!==null);
    if(model.start===null){$('gcTimeline').replaceChildren(el('p','No usable timestamps were recorded. Inspect the completed phases in the event list.','gc-footnote'));$('gcAnnotations').replaceChildren();$('gcChartNote').textContent='Untimed events cannot be placed on a timeline.';$('gcRangeLabel').textContent='Time range unavailable';return;}
    const heap=visible.filter(e=>e.heap),maxHeap=Math.max(1,heap.reduce((m,e)=>Math.max(m,e.heap.before,e.heap.after,e.heap.capacity??0),0));
    const maxPause=Math.max(visible.filter(e=>e.kind==='pause').reduce((m,e)=>Math.max(m,e.durationMs),0),.01)*1.12;
    const hy=n=>138-n/maxHeap*100,py=n=>252-n/maxPause*70;
    const ticks=width<500?2:4;
    for(let i=0;i<=ticks;i++){const xx=left+plot*i/ticks;chart.append(svg('line',{x1:xx,x2:xx,y1:30,y2:302,class:'gc-grid'}),svg('text',{x:xx,y:322,'text-anchor':i===0?'start':i===ticks?'end':'middle'},time(from+span*i/ticks,{compact:true,span})));}
    chart.append(svg('text',{x:0,y:19},'HEAP'),svg('text',{x:0,y:40},`${(maxHeap/1048576).toFixed(0)} MiB`),svg('text',{x:0,y:141},'0'),svg('text',{x:0,y:171},'PAUSE'),svg('text',{x:0,y:190},`${maxPause.toFixed(maxPause<1?2:0)} ms`),svg('text',{x:0,y:255},'0'),svg('text',{x:0,y:293},'OTHER'));
    for(const yy of [138,252,302])chart.append(svg('line',{x1:left,x2:right,y1:yy,y2:yy,class:'gc-grid'}));
    const clip=svg('clipPath',{id:'gcPlotClip'});clip.append(svg('rect',{x:left,y:25,width:plot,height:279}));const defs=svg('defs');defs.append(clip);chart.append(defs);
    const content=svg('g',{'clip-path':'url(#gcPlotClip)'});chart.append(content);
    // Bound SVG nodes by horizontal pixel buckets; raw samples stay in the table.
    const heapBins=new Map();for(const e of heap){const key=Math.floor(x(e.endMs));const old=heapBins.get(key);if(!old||e.heap.before>old.heap.before||e.heap.after<old.heap.after)heapBins.set(key,e);}
    const sampledHeap=[...heapBins.values()].sort((a,b)=>a.startMs-b.startMs);
    if(sampledHeap.length){
        let previous=null;
        for(const e of sampledHeap){
            const before=[x(e.startMs),hy(e.heap.before)],after=[x(e.endMs),hy(e.heap.after)];
            if(previous&&e.startMs>=previous.endMs)content.append(svg('path',{d:`M${x(previous.endMs)},${hy(previous.heap.after)} L${before[0]},${before[1]}`,class:'gc-heap-guide'}));
            content.append(svg('path',{d:`M${before[0]},${before[1]} L${after[0]},${after[1]}`,class:'gc-heap-line'}));
            for(const [point,phase] of [[before,'before'],[after,'after']]){
                const dot=svg('circle',{cx:point[0],cy:point[1],r:2.6,class:`gc-heap-point ${phase}`});
                // Mouse inspection complements the keyboard-accessible event marks below.
                dot.addEventListener('pointerenter',()=>showEventTooltip(dot,e));
                dot.addEventListener('pointerleave',scheduleTooltipHide);
                dot.addEventListener('click',()=>select(e.id));content.append(dot);
            }
            previous=e;
        }
    }
    else chart.append(svg('text',{x:left+plot/2,y:85,'text-anchor':'middle'},'No total-heap samples recorded in this range'));
    if(model.pauseBudgetMs<=maxPause)content.append(svg('line',{x1:left,x2:right,y1:py(model.pauseBudgetMs),y2:py(model.pauseBudgetMs),class:'gc-budget-line'}));
    chart.append(svg('text',{x:right,y:model.pauseBudgetMs<=maxPause?py(model.pauseBudgetMs)-5:171,'text-anchor':'end'},`${model.pauseBudgetMs} ms budget${model.pauseBudgetMs>maxPause?' · above scale':''}`));
    const byId=new Map();for(const f of model.findings){if(f.eventId!==null&&!byId.has(f.eventId))byId.set(f.eventId,f);}
    const bins=new Map();for(const e of visible){const key=e.id===selected?'selected':`${e.kind}:${Math.floor(x(e.startMs))}`;const old=bins.get(key);if(!old||(e.durationMs??0)>(old.durationMs??0)||byId.has(e.id)&&!byId.has(old.id))bins.set(key,e);}
    for(const e of bins.values()){
        const f=byId.get(e.id),pause=e.kind==='pause',xx=Math.max(left,x(e.startMs)),yy=pause?py(e.durationMs):e.kind==='stall'?282:274;
        const mark=svg('rect',{x:xx,y:yy,width:Math.max(3,Math.min(right-xx,x(e.endMs)-xx)),height:pause?Math.max(2,252-yy):e.kind==='stall'?15:8,rx:1,
            class:`gc-mark ${e.kind} ${e.id===selected?'selected':''}`,tabindex:0,role:'button','aria-label':`${time(e.startMs)}: ${title(e)}. ${ms(e.durationMs)}${f?'. '+f.title:''}`});
        bindTooltip(mark,()=>showEventTooltip(mark,e));
        if(f){const diamond=svg('path',{d:`M${xx+3},${yy-10} l4,4 -4,4 -4,-4 Z`,class:`gc-review-diamond ${f.severity}`});bindTooltip(diamond,()=>showEventTooltip(diamond,e));diamond.addEventListener('click',()=>select(e.id));content.append(diamond);}
        mark.addEventListener('click',()=>select(e.id));mark.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select(e.id);$('gcEventTitle').tabIndex=-1;$('gcEventTitle').focus({preventScroll:true});}});content.append(mark);
    }
    const candidates=model.findings.filter(f=>f.startMs!==null&&f.startMs>=from&&f.startMs<=to);
    currentAnnotations=[];const ids=new Set();for(const f of candidates){const key=f.eventId??'line:'+f.line;if(ids.has(key))continue;ids.add(key);currentAnnotations.push(f);if(currentAnnotations.length===3)break;}
    currentAnnotations.sort((a,b)=>a.startMs-b.startMs);
    // Nearby findings share a badge anchored to their actual time region.
    // Spreading badges evenly would imply anomalies at unrelated timestamps.
    const clusters=[];
    currentAnnotations.forEach((f,i)=>{const actual=x(f.startMs),last=clusters.at(-1);if(last&&actual-last.end<46){last.end=actual;last.indices.push(i);}else clusters.push({start:actual,end:actual,indices:[i]});});
    for(const cluster of clusters){
        const {indices,start,end}=cluster,label=indices.length>1?`${indices.length} findings`:String(indices[0]+1),half=indices.length>1?39:11,cx=Math.max(left+half,Math.min(right-half,(start+end)/2));
        const severity=indices.some(i=>currentAnnotations[i].severity==='critical')?'critical':indices.some(i=>currentAnnotations[i].severity==='warning')?'warning':'info';
        const group=svg('g',{class:`gc-annotation-group ${severity}`,tabindex:0,role:'button','aria-label':indices.map(i=>`Finding ${i+1}: ${currentAnnotations[i].title}`).join('. ')});
        bindTooltip(group,()=>showFindingsTooltip(group,indices));
        const findings=indices.map(i=>currentAnnotations[i]);
        const reveal=()=>openChartFindings(findings);
        group.addEventListener('click',reveal);group.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();reveal();}});
        group.append(svg('line',{x1:start,x2:start,y1:31,y2:302,class:'gc-annotation-line'}),svg('line',{x1:start,x2:cx,y1:31,y2:27,class:'gc-annotation-line'}),svg('rect',{x:cx-half,y:6,width:half*2,height:22,rx:11,class:'gc-annotation-dot'}),svg('text',{x:cx,y:21,class:'gc-annotation-number'},label));chart.append(group);
    }
    $('gcTimeline').replaceChildren(chart);
    $('gcAnnotations').replaceChildren(...currentAnnotations.map((f,i)=>{const b=el('button',undefined,'gc-annotation '+f.severity);b.type='button';const copy=el('span');copy.append(el('strong',f.title),el('small',`${time(f.startMs)} · ${f.severity} · line ${f.line}`));b.append(el('span',i+1),copy);b.addEventListener('click',()=>openFinding(f));return b;}));
    if(!currentAnnotations.length)$('gcAnnotations').append(el('p','No review markers in this time range. This does not establish overall application health.','gc-footnote'));
    $('gcChartNote').textContent=`${visible.length.toLocaleString()} events in range${bins.size<visible.length?`; ${bins.size.toLocaleString()} representative marks shown. All events remain in the table`:''}. Concurrent work is not stop-the-world time. ${candidates.length>3?'Showing up to 3 annotated events; use “With review markers” for event findings; standalone JVM signals appear under capture coverage.':''}`;
    $('gcFrom').value=range[0];$('gcTo').value=range[1];$('gcRangeLabel').textContent=time(from)+' – '+time(to);
}
function renderSummary(){
    const summary=captureSummary(model,parsed.warnings),box=$('gcSummary');
    box.className='gc-summary '+summary.severity;
    box.replaceChildren(el('span','Selected JVM segment','gc-eyebrow'),el('strong',summary.headline),el('p',summary.detail));
}
let tooltipAnchor=null,tooltipTimer;
function hideTooltip(){clearTimeout(tooltipTimer);tooltipAnchor?.removeAttribute('aria-describedby');tooltipAnchor=null;$('gcTooltip').hidden=true;}
function scheduleTooltipHide(){clearTimeout(tooltipTimer);tooltipTimer=setTimeout(()=>{if(document.activeElement!==tooltipAnchor)hideTooltip();},160);}
function showTooltip(anchor,nodes){
    hideTooltip();tooltipAnchor=anchor;anchor.setAttribute('aria-describedby','gcTooltip');
    const tip=$('gcTooltip');tip.replaceChildren(...nodes);tip.hidden=false;
    positionTooltip();
}
function positionTooltip(){
    if(!tooltipAnchor)return;
    const tip=$('gcTooltip'),rect=tooltipAnchor.getBoundingClientRect(),box=tip.getBoundingClientRect();
    tip.style.left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left+rect.width/2-box.width/2))+'px';
    tip.style.top=Math.max(8,rect.top-box.height-10>=8?rect.top-box.height-10:Math.min(innerHeight-box.height-8,rect.bottom+10))+'px';
}
function showEventTooltip(anchor,e){
    const facts=el('dl');
    for(const [label,value] of [['Start',time(e.startMs)],[e.kind==='pause'?'Pause':'Duration',ms(e.durationMs)],['Heap',e.heap?`${mib(e.heap.before)} → ${mib(e.heap.after)}`:'Not recorded']])facts.append(el('dt',label),el('dd',value));
    const findings=eventFindings(e.id),list=el('div',undefined,'gc-tooltip-findings');
    for(const f of findings)list.append(el('p',`${f.severity==='critical'?'Critical':f.severity==='warning'?'Review':'Info'} · ${f.title}`,f.severity));
    showTooltip(anchor,[el('span',`${kindNames[e.kind]}${e.gcId===null?'':` · GC(${e.gcId})`}`,'gc-eyebrow'),el('strong',title(e)),facts,list,el('small','Click or press Enter for event evidence.')]);
}
function showFindingsTooltip(anchor,indices){
    showTooltip(anchor,[el('strong',`${indices.length} annotated finding${indices.length===1?'':'s'} in this region`),...indices.map(i=>el('p',`${i+1}. ${currentAnnotations[i].title} · ${time(currentAnnotations[i].startMs)}`)),el('small',indices.length===1?'Click or press Enter to open details.':'Click or press Enter to open details; switch findings in the detail panel.')]);
}
function bindTooltip(mark,show){mark.addEventListener('pointerenter',show);mark.addEventListener('pointerleave',scheduleTooltipHide);mark.addEventListener('focus',show);mark.addEventListener('blur',hideTooltip);}
$('gcTooltip').addEventListener('pointerenter',()=>clearTimeout(tooltipTimer));
$('gcTooltip').addEventListener('pointerleave',scheduleTooltipHide);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideTooltip();});
window.addEventListener('scroll',event=>{if(event.target instanceof Node&&$('gcTooltip').contains(event.target))return;if(document.activeElement===tooltipAnchor)positionTooltip();else hideTooltip();},true);
window.addEventListener('resize',hideTooltip);
function findingNode(f){const box=el('div',undefined,'gc-finding '+f.severity);box.append(el('strong',`${f.severity==='critical'?'Critical':f.severity==='warning'?'Review':'Info'} · ${f.title}`),el('p',f.detail));return box;}
function rawFor(e){return lines.slice(e.line-1,e.endLine).join('\n');}
function inspect(){clearChartFindings();const e=model?.events.find(e=>e.id===selected);if(!e)return;$('gcEventTitle').textContent=title(e);const facts=el('dl');
    const duration=el('div');duration.append(el('span',e.kind==='pause'?'Stop-the-world pause':'Duration'),el('strong',ms(e.durationMs)));
    const heap=el('div');heap.append(el('span','Heap change'),el('strong',e.heap?`${e.heap.after>e.heap.before?'+':e.heap.after<e.heap.before?'−':''}${mib(Math.abs(e.heap.after-e.heap.before))}`:'Not recorded'));
    $('gcEventHighlights').replaceChildren(duration,heap);
    for(const [name,value] of [['Kind',kindNames[e.kind]],['GC ID',e.gcId===null?'Not recorded':'GC('+e.gcId+')'],['Start',time(e.startMs)],['Duration',ms(e.durationMs)+(e.durationDerived?' (from timestamps)':'')],['Heap before',mib(e.heap?.before)],['Heap after',mib(e.heap?.after)],['Reported capacity',mib(e.heap?.capacity)]]){facts.append(el('dt',name),el('dd',value));}
    $('gcEventFacts').replaceChildren(facts);$('gcEventFindings').replaceChildren(...eventFindings(e.id).map(findingNode));
    $('gcRawLocation').textContent=`lines ${e.line}–${e.endLine}`;$('gcRaw').textContent=rawFor(e);$('gcInspector').dataset.selectedId=e.id;
    bindSourceButton($('gcSource'),source.hostSourceId?{sourceId:source.hostSourceId,startLine:e.line,endLine:e.endLine}:null);
}
function inspectSignal(f){clearChartFindings();selected=null;draw();renderTable();$('gcInspector').removeAttribute('data-selected-id');$('gcEventTitle').textContent=f.title;$('gcEventHighlights').replaceChildren();$('gcEventFacts').replaceChildren();$('gcEventFindings').replaceChildren(findingNode(f));$('gcRawLocation').textContent='line '+f.line;$('gcRaw').textContent=lines[f.line-1]||'';bindSourceButton($('gcSource'),source.hostSourceId?{sourceId:source.hostSourceId,startLine:f.line,endLine:f.line}:null);}
function renderTable(){if(!model)return;const type=$('gcType').value,query=$('gcSearch').value.toLowerCase();const foundIds=new Set(model.findings.map(f=>f.eventId));
    const filtered=model.events.filter(e=>(type==='all'||type==='findings'?type!=='findings'||foundIds.has(e.id):e.kind===type)&&(`${e.label} GC(${e.gcId})`.toLowerCase().includes(query)));
    page=Math.max(0,Math.min(page,Math.ceil(filtered.length/40)-1));const shown=filtered.slice(page*40,page*40+40);
    $('gcRows').replaceChildren(...shown.map(e=>{const tr=el('tr');tr.dataset.selected=String(e.id===selected);const button=el('button',title(e),'gc-event-link');button.type='button';button.append(el('span',`${kindNames[e.kind]} · ${e.gcId===null?'line '+e.line:'GC('+e.gcId+')'}`));button.addEventListener('click',()=>select(e.id));const cell=el('td');cell.append(button);tr.append(el('td',time(e.startMs)),cell,el('td',ms(e.durationMs)),el('td',e.heap?`${mib(e.heap.before)} → ${mib(e.heap.after)}`:'Not recorded'));
        const fs=eventFindings(e.id),review=el('td');if(fs.length){const badge=el('span',undefined,'gc-badge '+fs[0].severity),icon=svg('svg',{viewBox:'0 0 16 16','aria-hidden':'true'});icon.append(svg('path',{d:fs[0].severity==='critical'?'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 3v5m0 2v1':fs[0].severity==='info'?'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1m0 6v5m0-8v1':'M8 1 15 14H1Z M8 5v4m0 2v1'}));badge.append(icon,el('span',`${fs.length} ${fs[0].severity==='info'?'info':'review'}`));review.append(badge);}else review.textContent='—';tr.append(review);return tr;}));
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

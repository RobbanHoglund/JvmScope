const number = value => Number(String(value).replace(',', '.'));
const durationPattern = /([\d.,]+)\s*(ns|us|µs|ms|secs?|s)\s*\]?\s*$/;
const scale = { ns:1e-6, us:1e-3, 'µs':1e-3, ms:1, s:1000, sec:1000, secs:1000 };
const bytes = (value, unit='') => number(value) * (1024 ** ('KMGT'.indexOf(unit.toUpperCase()) + 1));
const numeric = value => Number.isFinite(value) && value >= 0;
export const MAX_GC_BYTES = 64 * 1024 * 1024;
export const MAX_GC_EVENTS = 200_000;

function heapOf(text) {
    // Metaspace and generation subtotals are not total Java heap occupancy.
    const withoutMeta = text.split(/\[Metaspace:| Metaspace:/)[0];
    const g1 = withoutMeta.match(/Heap:\s*([\d.,]+)([KMGT])\([^)]*\)->([\d.,]+)([KMGT])\(([\d.,]+)([KMGT])\)/i);
    if (g1) return {before:bytes(g1[1],g1[2]),after:bytes(g1[3],g1[4]),capacity:bytes(g1[5],g1[6])};
    const matches = [...withoutMeta.matchAll(/([\d.,]+)([KMGT]?)\s*(?:\(\d+(?:[.,]\d+)?%\))?\s*->\s*([\d.,]+)([KMGT]?)\s*\(([\d.,]+)([KMGT]?)\)/gi)];
    const m = matches.at(-1);
    if(m) return {before:bytes(m[1],m[2]),after:bytes(m[3],m[4]),capacity:bytes(m[5],m[6])};
    const z=withoutMeta.match(/([\d.,]+)([KMGT])\(\d+%\)->([\d.,]+)([KMGT])\(\d+%\)/);
    return z?{before:bytes(z[1],z[2]),after:bytes(z[3],z[4]),capacity:null}:null;
}

function clockOf(prefix, legacy=false) {
    const tokens = legacy ? [prefix] : [...prefix.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1].trim());
    for (const token of tokens) {
        const m = token.match(legacy ? /(?:^|\s)(\d+(?:[.,]\d+)?):\s*$/ : /^(\d+(?:[.,]\d+)?)(s|ms|us|ns)$/);
        if (m) return {time:number(m[1]) * (legacy?1000:scale[m[2]]),clock:'uptime'};
    }
    const date = prefix.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)/)?.[0];
    const time=date?Date.parse(date.replace(',','.')):NaN;
    return Number.isFinite(time)?{time,clock:'wall'}:{time:null,clock:'unknown'};
}

function family(text) {
    if (/Using G1|G1 Evacuation|G1 Compaction|G1 Humongous|garbage-first/i.test(text)) return 'G1';
    if (/Using The Z Garbage Collector|Using ZGC|ZGeneration|ZHeap|ZGC/i.test(text)) return 'ZGC';
    if (/Using Shenandoah|Shenandoah/i.test(text)) return 'Shenandoah';
    if (/Using Concurrent Mark Sweep|CMS|ParNew/.test(text)) return 'CMS';
    if (/Using Parallel|PSYoungGen|ParOldGen/.test(text)) return 'Parallel';
    if (/Using Serial|DefNew|Tenured/.test(text)) return 'Serial';
    return null;
}

function typeOf(label, legacy) {
    label=label.replace(/^[YyOo]:\s*/,'');
    if (/^Allocation Stall\b/.test(label)) return 'stall';
    if (/^Pause |^GC pause|^Full GC|^GC \(|CMS-initial-mark|CMS Final Remark/.test(label)) return 'pause';
    if (legacy && /^GC\b/.test(label) && !/concurrent/i.test(label)) return 'pause';
    if (/Concurrent (?:Mark Cycle|Cycle)|^(?:Garbage Collection|Major Collection|Minor Collection)/.test(label)) return 'cycle';
    if (/^Concurrent |CMS-concurrent-|GC concurrent-/.test(label)) return 'concurrent';
    return null;
}

/** Parse HotSpot records. Never infer a Java release from a collector name. */
export function parseGcLog(input) {
    if (typeof input !== 'string' || new TextEncoder().encode(input).length > MAX_GC_BYTES) throw new Error('Choose a UTF-8 GC log no larger than 64 MiB.');
    if (input.includes('\0')) throw new Error('This looks like a binary file. Choose a text GC log.');
    const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
    const events=[], signals=[], warnings=[], sessions=[];
    let session, lastTime=null, legacyBlock=null, format='unknown', gcLike=0;
    const pending = new Map();
    const newSession=()=>{session={id:sessions.length,collector:'Unknown',clock:'unknown',version:null};sessions.push(session);lastTime=null;pending.clear();};
    newSession();
    const note=text=>{if(!warnings.includes(text)) warnings.push(text);};
    function emit(text, prefix, line, endLine=line, legacy=false, recordId=null) {
        const trimmed=text.replace(/\[Times:[^\]]*\]/g,'').trim();
        let duration=trimmed.match(durationPattern);
        const kind=typeOf(trimmed,legacy);
        const clock=clockOf(prefix,legacy);
        if (numeric(clock.time) && numeric(lastTime) && clock.time < lastTime-1000) {
            newSession();note('A clock reset was found. JVM segments are shown separately; no cross-restart rates are calculated.');
        }
        if (numeric(clock.time)) {lastTime=Math.max(lastTime??0,clock.time);session.clock=clock.clock;}
        session.collector=family(text)||session.collector;
        const idMatch=text.match(/^GC\((\d+)\)\s*/);
        const label=trimmed.replace(/^GC\(\d+\)\s*/,'');
        if (!kind) return;
        const gcId=recordId??(idMatch?Number(idMatch[1]):null);
        const startKey=`${session.id}:${gcId}:${label.replace(durationPattern,'').replace(/\s+[\d.,]+[KMGT].*$/,'').trim()}`;
        const matched=[...pending.keys()].find(key=>key.startsWith(`${session.id}:${gcId}:`) && label.startsWith(key.slice(`${session.id}:${gcId}:`.length)));
        const start=pending.get(matched||startKey);
        if(!duration && !(kind==='cycle'&&heapOf(text))) return;
        pending.delete(matched||startKey);
        const durationMs=duration?number(duration[1])*scale[duration[2]]:start&&numeric(start.time)&&numeric(clock.time)?Math.max(0,clock.time-start.time):null;
        if(duration && !numeric(durationMs))return;
        const startMs=numeric(clock.time)?(legacy?clock.time:Math.max(0,clock.time-durationMs)):null;
        events.push({id:events.length,session:session.id,gcId,kind,label:label.split('\n')[0].replace(durationPattern,'').replace(/[,\s]+$/,'').slice(0,260),
            durationMs,durationDerived:!duration&&durationMs!==null,startMs,endMs:startMs===null?null:startMs+(durationMs??0),clock:clock.clock,
            line:start?.line||line,endLine,heap:heapOf(text),full:/(?:Pause Full|Full GC|Pause Degenerated)/.test(label),explicit:/System\.gc\(\)|Diagnostic Command|Heap Inspection|Heap Dump/.test(label)});
    }
    function flushLegacy() {
        if(!legacyBlock)return;
        const {text,prefix,line,endLine}=legacyBlock;
        // G1 prints its pause duration on the opening line, heap on later lines.
        const clean=text.replace(/\[Times:[^\]]*\]/g,'');
        const depth=[...clean].reduce((n,c)=>n+(c==='['?1:c===']'?-1:0),1);
        if(depth>0) {note('An incomplete or interleaved legacy GC record could not be assigned a reliable duration. Inspect the original log.');legacyBlock=null;return;}
        const duration=[...clean.matchAll(/(?:,\s*|:\s*[\d.,]+\/)([\d.,]+)\s+(secs?)\]/g)].at(-1);
        const body=duration?clean+' '+duration[1]+' '+duration[2]:clean;
        emit(body,prefix,line,endLine,true);legacyBlock=null;
    }
    for(let i=0;i<lines.length;i++) {
        const raw=lines[i], line=i+1;
        // Shutdown heap summaries contain address ranges with unmatched '[';
        // they are not part of the preceding completed collection.
        if (/^Heap\s*$/.test(raw)) { flushLegacy(); continue; }
        if(events.length>=MAX_GC_EVENTS) {note('Event limit reached (200,000). Analysis is partial; split the log to inspect the remainder.');break;}
        const version=raw.match(/Version:\s*(\d+)[.+_-]/)||raw.match(/\(1\.(8)\.\d+_/);
        if(version) session.version=Number(version[1]);
        if(/\bUsing (?:G1|Serial|Parallel|Shenandoah|The Z Garbage Collector|ZGC|Concurrent Mark Sweep)\b/.test(raw)) {
            flushLegacy();
            if(events.some(e=>e.session===session.id)) {newSession();note('Multiple JVM segments found. Select a segment to avoid combining unrelated timelines.');}
            session.collector=family(raw)||'Unknown';
        }
        const unified=raw.match(/^((?:\[[^\]]+\]\s*)+)(?:GC\((\d+)\)\s*)?(.*)$/);
        const looksUnified=unified && /\[\s*gc(?:,|\s*\])/.test(unified[1]);
        const legacy=raw.match(/^(.*?)\[(GC pause|Full GC|GC(?:\s|\[)|CMS-(?:initial-mark|concurrent-)|GC concurrent-)(.*)$/);
        if(looksUnified) {
            flushLegacy();format=format==='legacy'?'mixed':'unified';
            const [,prefix,gcId,body]=unified;
            if(gcId!==undefined) gcLike++;
            if(/\[\s*gc,stats\s*\]/.test(prefix)) continue;
            // Start records have no duration and must never count as another pause.
            if(/\[\s*gc,start\s*\]/.test(prefix) && typeOf(body,false)) {
                pending.set(`${session.id}:${gcId}:${body.trim()}`,{line,time:clockOf(prefix).time});
            }
            // The GC id is stored separately so classification sees the event name.
            emit(body,prefix,line,line,false,gcId===undefined?null:Number(gcId));
        } else if(legacy && !/^\s*\[/.test(raw)) {
            if(legacyBlock && /concurrent-/.test(legacy[2]+legacy[3]) && [...legacyBlock.text].reduce((n,c)=>n+(c==='['?1:c===']'?-1:0),1)>0) {
                legacyBlock.text+='\n'+raw;legacyBlock.endLine=line;continue;
            }
            flushLegacy();format=format==='unified'?'mixed':'legacy';gcLike++;
            legacyBlock={prefix:legacy[1],text:legacy[2]+legacy[3],line,endLine:line};
        } else if(legacyBlock) {
            if(legacyBlock.text.length<100000) {legacyBlock.text+='\n'+raw;legacyBlock.endLine=line;}
        }
        if(/to-space exhausted|evacuation failure|promotion failed|concurrent mode failure|OutOfMemoryError|Allocation Stall\b|Pause Degenerated GC/i.test(raw) && !/\[\s*gc,stats\s*\]/.test(raw) && !/Collection \(Allocation Stall\)/.test(raw)) {
            const c=clockOf(unified?.[1]||legacy?.[1]||'',!unified);
            signals.push({line,session:session.id,time:c.time,text:raw.trim().slice(0,500),critical:/OutOfMemoryError|Allocation Stall/.test(raw)});
        }
    }
    flushLegacy();
    if(!events.length) throw new Error(gcLike?'GC records were found, but no supported completed GC phases. Include timestamps and completed pause records.':'No supported HotSpot GC events found. Choose a GC log, not a thread dump or JSSE TLS log.');
    if(events.some(e=>e.startMs===null)) note('Some completed phases have no usable timestamp. They appear in the event list, but cannot be placed on the timeline.');
    if(pending.size) note('Some GC start records have no matching completion. The capture may end mid-collection; incomplete durations are not estimated.');
    if(format==='mixed') note('Legacy and unified logging formats were found together. Check the source and JVM segment boundaries.');
    return {format,events,signals,warnings,sessions:sessions.filter(s=>events.some(e=>e.session===s.id)),lineCount:lines.length};
}

export function analyzeGc(parsed, {session=parsed.sessions[0]?.id, pauseBudgetMs=200}={}) {
    if(!Number.isFinite(pauseBudgetMs)||pauseBudgetMs<=0||pauseBudgetMs>60000) throw new Error('Pause budget must be greater than 0 and at most 60,000 ms.');
    const events=parsed.events.filter(e=>e.session===session), pauses=events.filter(e=>e.kind==='pause');
    const timed=events.filter(e=>numeric(e.startMs)), start=timed.length?timed.reduce((v,e)=>Math.min(v,e.startMs),Infinity):null,end=timed.length?timed.reduce((v,e)=>Math.max(v,e.endMs),-Infinity):null;
    const durations=pauses.map(e=>e.durationMs).sort((a,b)=>a-b);
    // Union pause intervals; phases may overlap or appear twice at differing detail.
    let stopped=0,lastEnd=-Infinity;
    for(const p of pauses.filter(e=>numeric(e.startMs)).sort((a,b)=>a.startMs-b.startMs)) {stopped+=Math.max(0,p.endMs-Math.max(p.startMs,lastEnd));lastEnd=Math.max(lastEnd,p.endMs);}
    const findings=[];
    const completionByLine=new Map(events.map(e=>[e.endLine,e]));
    const add=(e,severity,title,detail,rule)=>findings.push({id:findings.length,eventId:e?.id??null,line:e?.line??null,startMs:e?.startMs??null,endMs:e?.endMs??null,severity,title,detail,rule});
    for(const e of events) {
        if(e.kind==='pause'&&e.durationMs>pauseBudgetMs) add(e,'warning','Pause exceeds your budget',`${e.durationMs.toFixed(3)} ms exceeds the selected ${pauseBudgetMs} ms budget. This is a user-defined threshold, not a JVM error or a universal latency limit.`,'pause-budget');
        if(e.full) add(e,e.explicit?'info':'warning',e.explicit?'Explicit full collection':'Full / degenerated collection',e.explicit?'The log records an explicit request. Inspect the caller or diagnostic tool; this alone does not prove memory pressure.':'Inspect the recorded cause and surrounding heap data. Full collection is a pause, but is not proof of a memory leak.','full-collection');
        if(e.heap && e.heap.capacity>0 && e.heap.after/e.heap.capacity>=.9) add(e,'warning','High occupancy after collection',`${(100*e.heap.after/e.heap.capacity).toFixed(1)}% of the reported heap capacity remains used. This capacity is not necessarily -Xmx; a young collection does not establish the live set.`,'heap-occupancy');
    }
    for(const signal of parsed.signals.filter(s=>s.session===session)) {
        const e=completionByLine.get(signal.line)||events.find(e=>e.line<=signal.line&&e.endLine>=signal.line)||events.find(e=>e.startMs!==null&&signal.time!==null&&Math.abs(e.endMs-signal.time)<1);
        add(e,signal.critical?'critical':'warning',/Allocation Stall/.test(signal.text)?'Allocation stall':/OutOfMemoryError/.test(signal.text)?'Out of memory reported':'Collector pressure signal',signal.text,'jvm-signal');
        Object.assign(findings.at(-1),{line:signal.line,startMs:e?.startMs??signal.time,endMs:e?.endMs??signal.time});
    }
    const ordered=findings.sort((a,b)=>({critical:0,warning:1,info:2}[a.severity]-{critical:0,warning:1,info:2}[b.severity])||(a.startMs??Infinity)-(b.startMs??Infinity));
    return {session,events,findings:ordered,pauseBudgetMs,start,end,stats:{pauses:pauses.length,totalPauseMs:durations.reduce((a,b)=>a+b,0),maxPauseMs:durations.at(-1)??null,p95PauseMs:durations.length?durations[Math.ceil(durations.length*.95)-1]:null,
        observedMs:start!==null?end-start:null,pauseShare:start!==null&&end>start?Math.min(100,stopped/(end-start)*100):null,heapSamples:events.filter(e=>e.heap).length}};
}

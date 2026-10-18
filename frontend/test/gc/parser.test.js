import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseGcLog, analyzeGc } from '../../assets/javautils/gc/parser.js';
const line=(time,body,tags='gc')=>`[${time}s][info][${tags}] ${body}`;
const pause=(time=1,duration=10,cause='Normal')=>line(time,`GC(0) Pause Young (${cause}) 20M->4M(32M) ${duration}ms`);
const parse=(...lines)=>parseGcLog(lines.join('\n'));

test('unified start/end records count once, retain GC identity and exact physical source span',()=>{
    const p=parse(line(.99,'GC(0) Pause Young (Normal)','gc,start'),line(.995,'GC(0) Eden regions: 8->0(10)','gc,heap'),pause());
    assert.equal(p.events.length,1);assert.equal(p.events[0].durationMs,10);assert.equal(p.events[0].gcId,0);
    assert.equal(p.events[0].line,1);assert.equal(p.events[0].endLine,3);assert.equal(p.events[0].startMs,990);
    assert.deepEqual(p.events[0].heap,{before:20*1048576,after:4*1048576,capacity:32*1048576});assert.deepEqual(p.warnings,[]);
});
test('concurrent cycles and allocation stalls are never summed into stop-the-world pause time',()=>{
    const p=parse(pause(),line(2,'GC(1) Concurrent Mark Cycle 900ms'),line(2.01,'Allocation Stall (worker) 700ms'));
    const a=analyzeGc(p);assert.equal(a.stats.totalPauseMs,10);assert.equal(a.stats.pauses,1);assert.deepEqual(p.events.map(e=>e.kind),['pause','cycle','stall']);
    assert.equal(a.findings.filter(f=>f.rule==='pause-budget').length,0);
});
test('Shenandoah aggregate statistics do not become duplicate pauses',()=>{
    const p=parse(pause(),line(1.2,'Pause Init Mark (G) 3958 us','gc,stats'),line(1.2,'Pause Init Mark (N) 37 us','gc,stats'));
    assert.equal(p.events.length,1);assert.equal(analyzeGc(p).stats.totalPauseMs,10);
});
test('generational ZGC phase prefixes, percentages and zero stall counters retain their meaning',()=>{
    const p=parse(line(.1,'Using The Z Garbage Collector'),line(1,'GC(1) Y: Pause Mark Start (Major) 0.020ms','gc,phases'),line(1.2,'GC(1) O: Pause Mark End 0.010ms','gc,phases'),line(1.3,'GC(1) Y: Allocation Stalls: 0 0 0 0','gc,alloc'),line(1.5,'GC(1) Major Collection (Warmup) 10M(31%)->4M(12%) 0.500s'));
    assert.equal(p.events.length,3);assert.equal(analyzeGc(p).stats.totalPauseMs,.03);assert.equal(p.signals.length,0);
    assert.equal(p.events[2].heap.after,4*1048576);assert.equal(p.events[2].heap.capacity,null);
});
test('older ZGC cycles derive duration only from a matching recorded start',()=>{
    const p=parse(line(1,'GC(4) Garbage Collection (Warmup)','gc,start'),line(1.005,'GC(4) Garbage Collection (Warmup) 20M(62%)->4M(12%)'));
    assert.ok(Math.abs(p.events[0].durationMs-5)<1e-9);assert.equal(p.events[0].durationDerived,true);assert.equal(p.events[0].kind,'cycle');assert.deepEqual(p.warnings,[]);
    const unknown=parse(line(1.005,'GC(4) Garbage Collection (Warmup) 20M(62%)->4M(12%)'));
    assert.equal(unknown.events[0].durationMs,null);
});
test('ordinary allocation failure triggers and System.gc full collections are not diagnosed as a leak',()=>{
    const a=analyzeGc(parse(pause(1,2,'Allocation Failure'),line(2,'GC(1) Pause Full (System.gc()) 20M->4M(32M) 4ms')));
    assert.equal(a.findings.length,1);assert.equal(a.findings[0].severity,'info');assert.equal(a.findings[0].rule,'full-collection');
});
test('pause budget is explicit, configurable and independent from collector defaults',()=>{
    const p=parse(pause(1,201));assert.equal(analyzeGc(p).findings[0].rule,'pause-budget');assert.equal(analyzeGc(p,{pauseBudgetMs:250}).findings.length,0);
    for(const budget of [0,-1,NaN,Infinity,60001])assert.throws(()=>analyzeGc(p,{pauseBudgetMs:budget}),/budget/);
});
test('evacuation failure appended to a completion matches its start and preserves a pressure signal',()=>{
    const p=parse(line(1,'GC(0) Pause Young (Normal) (G1 Evacuation Pause)','gc,start'),line(1.02,'GC(0) Pause Young (Normal) (G1 Evacuation Pause) (Evacuation Failure: Allocation) 30M->28M(32M) 20ms'));
    assert.equal(p.events[0].line,1);assert.deepEqual(p.warnings,[]);assert.equal(analyzeGc(p).findings[0].rule,'jvm-signal');
});
test('legacy Parallel uses the total heap and wall duration, not young/Metaspace or worker CPU',()=>{
    const p=parse('0.123: [Full GC (System.gc()) [PSYoungGen: 10K->0K(20K)] [ParOldGen: 20K->8K(40K)] 30K->8K(60K), [Metaspace: 99K->99K(100K)], 0.0123456 secs] [Times: user=0.40 sys=0.02, real=0.01 secs]');
    assert.equal(p.events.length,1);assert.equal(p.events[0].durationMs,12.3456);assert.equal(p.events[0].startMs,123);assert.equal(p.events[0].heap.before,30720);assert.equal(p.events[0].heap.capacity,61440);
});
test('legacy G1 multiline heap and decimal-comma durations are preserved',()=>{
    const p=parse('0.500: [GC pause (G1 Evacuation Pause) (young), 0,012 secs]', '   [Parallel Time: 4.0 ms, GC Workers: 2]', '   [Eden: 20.0M(20.0M)->0.0B(18.0M) Survivors: 1.0M->2.0M Heap: 25.0M(32.0M)->6.0M(32.0M)]',' [Times: user=0.03 sys=0.00, real=0.01 secs]');
    assert.equal(p.events[0].durationMs,12);assert.equal(p.events[0].heap.after,6*1048576);assert.equal(p.events[0].endLine,4);
});
test('HotSpot VM 25 in a Java 8 banner is not Java 25',()=>{
    const p=parse('OpenJDK 64-Bit Server VM (25.504-b01) for linux JRE (Zulu) (1.8.0_504-b01)','0.100: [GC (Allocation Failure) [PSYoungGen: 10K->2K(20K)] 10K->2K(40K), 0.001 secs]');
    assert.equal(p.sessions[0].version,8);
});
test('separate JVM starts retain independent identities and metrics',()=>{
    const p=parse(line(.001,'Using G1'),pause(50,100),line(.001,'Using Serial'),pause(1,2));
    assert.equal(p.sessions.length,2);assert.equal(analyzeGc(p,{session:0}).stats.totalPauseMs,100);assert.equal(analyzeGc(p,{session:1}).stats.totalPauseMs,2);
});
test('missing timestamps are visible coverage gaps, never invented timeline positions',()=>{
    const p=parse('[info][gc] GC(0) Pause Young (Normal) 20M->4M(32M) 2ms');assert.equal(p.events[0].startMs,null);assert.equal(analyzeGc(p).stats.pauseShare,null);assert.ok(p.warnings.length);
});
test('wall-clock-only decorators are supported without interpreting dates as JVM uptime',()=>{
    const p=parse('[2026-10-18T10:00:00.100+0200][info][gc] GC(0) Pause Young (Normal) 20M->4M(32M) 2ms');assert.equal(p.sessions[0].clock,'wall');assert.equal(p.events[0].startMs,Date.parse('2026-10-18T08:00:00.098Z'));
});
test('partial last pause does not contribute an invented duration',()=>{
    const p=parse(pause(),line(2,'GC(1) Pause Full (G1 Compaction Pause)','gc,start'));assert.equal(p.events.length,1);assert.ok(p.warnings.some(w=>w.includes('completion')));
});
test('pause share merges overlaps instead of double counting nested observations',()=>{
    const p=parse(pause(1,100),line(1,'GC(1) Pause Remark 50ms'),pause(2,100));const a=analyzeGc(p);
    assert.ok(Math.abs(a.stats.pauseShare-200/1100*100)<1e-9);
});
test('unrecognized, binary, empty, thread and TLS input fail explicitly',()=>{
    for(const text of ['', 'hello', '\0binary', 'Full thread dump OpenJDK', 'javax.net.ssl|DEBUG|ClientHello'])assert.throws(()=>parseGcLog(text),/GC|binary/);
});

const fixtureDir=new URL('../../../testdata/gc-logs/',import.meta.url);
const reports=readdirSync(fixtureDir).filter(f=>f.endsWith('-provenance.json')).map(f=>JSON.parse(readFileSync(new URL(f,fixtureDir))));
test('real runtime coverage includes every Java major from 8 through 27',()=>{
    assert.deepEqual(reports.map(r=>r.major).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+8));
});
for(const report of reports)for(const c of report.cases.filter(c=>c.status==='captured'))test(`real Java ${report.major} ${c.collector}: captured bytes, event semantics and independent workload oracle`,()=>{
    const stored=readFileSync(new URL(c.file,fixtureDir)),data=c.file.endsWith('.gz')?gunzipSync(stored):stored;assert.equal(createHash('sha256').update(data).digest('hex'),c.sha256);
    assert.match(c.oracle,/pressureReached=true/);assert.match(c.oracle,/OpenJDK/);
    assert.equal(report.workloadSha256,createHash('sha256').update(readFileSync(new URL('../../../tools/gc-samples/GcWorkload.java',import.meta.url))).digest('hex'));
    const p=parseGcLog(data.toString()),a=analyzeGc(p);
    assert.equal(p.sessions.length,1);assert.ok(p.events.length>5);assert.ok(a.stats.pauses>0);assert.ok(p.events.every(e=>e.durationMs===null||Number.isFinite(e.durationMs)&&e.durationMs>=0));
    assert.ok(p.events.every(e=>e.line>=1&&e.endLine>=e.line&&e.endLine<=p.lineCount));
    if(['serial','parallel'].includes(c.collector)){
        const counts=[...c.oracle.matchAll(/\|count=(\d+)/g)].reduce((sum,m)=>sum+Number(m[1]),0);
        // Serial 8 may attempt DefNew then Tenured within ONE enclosing pause.
        // Both collector beans increment; the timeline must not double-count it.
        const combined=report.major===8&&c.collector==='serial' ? data.toString().split('\n').filter(l=>/\[GC /.test(l)&&/\[DefNew:/.test(l)&&/\[Tenured:/.test(l)).length : 0;
        assert.equal(a.stats.pauses+combined,counts,'Pause records plus combined-generation attempts must match independent MXBean counts');
        assert.ok(a.events.filter(e=>e.kind==='pause').every(e=>e.heap));
    }
    if(c.collector==='zgc'){
        assert.ok(p.events.some(e=>e.kind==='cycle'));assert.ok(p.events.some(e=>e.kind==='concurrent'));
        assert.ok(a.stats.totalPauseMs<p.events.filter(e=>e.kind==='concurrent').reduce((sum,e)=>sum+e.durationMs,0));
    }
    const pauseBeans=[...c.oracle.matchAll(/collector=([^|]*Pauses)\|count=(\d+)/g)];
    if(pauseBeans.length)assert.equal(a.stats.pauses,pauseBeans.reduce((sum,m)=>sum+Number(m[2]),0),'Completed phases match independent pause-specific MXBeans');
    if(c.collector==='g1'){
        const collections=[...c.oracle.matchAll(/collector=G1 (Young|Old) Generation\|count=(\d+)/g)];
        assert.equal(a.stats.pauses,collections.reduce((sum,m)=>sum+Number(m[2]),0),'G1 pause count matches young plus old generation beans, excluding concurrent cycles');
    }
});

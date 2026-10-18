import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {parseGcLog,analyzeGc,MAX_GC_EVENTS,MAX_GC_BYTES} from '../../assets/javautils/gc/parser.js';
import {formatGcTime} from '../../assets/javautils/gc/time.js';

test('additional bundled samples preserve every byte of the real captured logs',()=>{
    for(const name of ['java27-serial','java27-parallel','java8-cms']){
        const path=new URL(`../../../testdata/gc-logs/${name}.log`,import.meta.url);
        assert.deepEqual(readFileSync(path),gunzipSync(readFileSync(new URL(path.href+'.gz'))));
    }
});

test('synthetic three-day capture retains 100,000 events and late pressure evidence',()=>{
    // Deliberately synthetic scale fixture; never described as a real JVM capture.
    const text=Array.from({length:100000},(_,i)=>`[${(1+i*2.592).toFixed(3)}s][info][gc] GC(${i}) Pause Young (Normal) 20M->${i===99999?'30':'4'}M(32M) 2ms`).join('\n');
    const begin=performance.now(),parsed=parseGcLog(text),model=analyzeGc(parsed);
    assert.equal(parsed.sessions.length,1);assert.equal(model.events.length,100000);
    assert.ok(model.end-model.start>2.99*86400000);assert.equal(model.stats.p95PauseMs,2);
    assert.ok(model.findings.some(f=>f.eventId===99999&&f.rule==='heap-occupancy'));
    console.log(`Synthetic 3-day capture: ${(Buffer.byteLength(text)/1048576).toFixed(1)} MiB, 100,000 events, ${(performance.now()-begin).toFixed(0)} ms parse + analysis (this test host).`);
});

test('size and event limits fail explicitly or mark partial analysis',()=>{
    assert.throws(()=>parseGcLog(' '.repeat(MAX_GC_BYTES+1)),/64 MiB/);
    const line='[1s][info][gc] GC(0) Pause Young (Normal) 20M->4M(32M) 2ms\n';
    const parsed=parseGcLog(line.repeat(MAX_GC_EVENTS+1));
    assert.equal(parsed.events.length,MAX_GC_EVENTS);
    assert.ok(parsed.warnings.some(w=>/Analysis is partial/.test(w)));
});

test('long-capture labels retain elapsed days and UTC calendar dates',()=>{
    assert.equal(formatGcTime(93784005),'1d 02:03:04.005');
    assert.equal(formatGcTime(93784005,'uptime',{compact:true,span:3*86400000}),'1d 02:03');
    assert.equal(formatGcTime(Date.parse('2026-10-18T23:59:59Z'),'wall'),'2026-10-18 23:59:59.000Z');
    assert.equal(formatGcTime(Date.parse('2026-10-19T00:00:01Z'),'wall',{compact:true,span:3*86400000}),'10-19 00:00');
});

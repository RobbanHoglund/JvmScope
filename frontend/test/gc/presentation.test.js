import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventWindow, captureSummary } from '../../assets/javautils/gc/presentation.js';
import { parseGcLog, analyzeGc } from '../../assets/javautils/gc/parser.js';

const analyze = text => analyzeGc(parseGcLog(text));
test('summary separates short pauses from memory pressure and explicit full GC', () => {
    const pressure = captureSummary(analyze('[1s][info][gc] GC(1) Pause Young (Normal) 20M->30M(32M) 2ms'));
    assert.match(pressure.headline, /within your 200 ms budget/);
    assert.match(pressure.detail, /Memory pressure/);
    assert.equal(pressure.severity, 'warning');
    const explicit = captureSummary(analyze('[1s][info][gc] GC(1) Pause Full (System.gc()) 20M->4M(32M) 2ms'));
    assert.equal(explicit.severity, 'info');
    assert.doesNotMatch(explicit.detail, /Memory pressure/);
});
test('summary respects pause threshold boundary and critical JVM signals', () => {
    const summary = captureSummary(analyze('[1s][info][gc] GC(1) Pause Young (Normal) 20M->4M(32M) 200ms\n[2s][info][gc] GC(2) Pause Young (Normal) 20M->4M(32M) 201ms\n[3s][error][gc] java.lang.OutOfMemoryError: Java heap space'), ['partial capture']);
    assert.match(summary.headline, /^1 recorded pause exceeds/);
    assert.match(summary.detail, /critical JVM signal/);
    assert.match(summary.detail, /coverage notes/);
    assert.equal(summary.severity, 'critical');
});
test('concurrent-only capture does not claim pauses met the budget', () => {
    const summary = captureSummary({events:[],findings:[],stats:{pauses:0},pauseBudgetMs:200});
    assert.match(summary.headline, /No completed stop-the-world pauses/);
});
test('zoom frames neighboring short events without an arbitrary 100 ms margin', () => {
    const events = Array.from({length:10}, (_,id)=>({id,startMs:1000+id*3,endMs:1002+id*3,durationMs:2}));
    const [from,to] = eventWindow(events,events[8],1000,1029);
    assert.ok(from > 1010);assert.equal(to,1029);
    assert.ok(from <= events[6].startMs);assert.ok(to >= events[9].endMs);
});
test('zoom preserves real gaps and supports multi-day timestamps and untimed records', () => {
    const day=86400000,events=[{id:0,startMs:day,endMs:day+2,durationMs:2},{id:1,startMs:3*day,endMs:3*day+2,durationMs:2}];
    assert.deepEqual(eventWindow(events,events[1],day,3*day+2),[day,3*day+2]);
    assert.equal(eventWindow(events,{startMs:null},day,3*day),null);
});

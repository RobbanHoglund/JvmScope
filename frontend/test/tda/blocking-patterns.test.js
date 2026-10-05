import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { buildBlockingPatterns, patternSnapshot } from '../../assets/javautils/tda/blocking-patterns.js';
import { blockingDump, blockingSequence, longClassInitializationDump } from './blocking-fixture.js';

test('a previously ambiguous owner does not become a definite recurring relation when ownership becomes unambiguous', () => {
    const result=analyzeThreadDumpData([blockingDump(0,[{id:1,held:['0xa']},{id:2,held:['0xa']},{id:3,wait:'0xa'}]),
        blockingDump(1,[{id:1,held:['0xa']},{id:2},{id:3,wait:'0xa'}])].join('\n'));
    const p=result.blockingPatterns.find(p=>p.title==='Dependencies on worker-1');
    assert.equal(p.observations[0].dependentCount,0);
    assert.equal(p.observations[1].dependentCount,1);
    assert.equal(p.observations[1].relations[0].change,'uncertain');
    assert.equal(p.comparableRecurrences,0);
    const t=result.parsedDumps[1].threads.find(t=>t.threadName==='worker-1');
    t.seriesMatchConfidence='none';t.seriesMatchStatus='ambiguous';
    assert.equal(buildBlockingPatterns(result.parsedDumps).find(p=>p.title==='Dependencies on worker-1').comparableRecurrences,0);
});

test('duplicate, reversed, missing times and a partial gap cannot establish temporal recurrence or disappearance', () => {
    for(const replacement of ['2026-10-05T12:00:00.000Z','2026-10-04T12:00:00.000Z','']) {
        const second=blockingSequence[1].replace('2026-10-05T12:00:01.000Z',replacement);
        const result=analyzeThreadDumpData([blockingSequence[0],second].join('\n'));
        assert.ok(result.blockingPatterns.every(p=>p.comparableRecurrences===0));
        assert.ok(result.blockingPatterns.every(p=>p.observations.every(o=>o.relations.every(r=>r.change==='uncertain'))));
    }
    const result=analyzeThreadDumpData([...blockingSequence,blockingDump(3,[{id:1},{id:2},{id:3},{id:4}])].join('\n'));
    result.parsedDumps[2].parsingStatus='partial';
    const p=buildBlockingPatterns(result.parsedDumps).find(p=>p.title==='Dependencies on worker-1');
    assert.equal(patternSnapshot(p,result.parsedDumps,3).status,'uncertain');
});

test('long dependency chains cannot exhaust the new worker projection or produce a silently partial ranking', () => {
    const entries=Array.from({length:400},(_,i)=>({id:i+1,held:[`0x${(i+1).toString(16)}`],...(i?{wait:`0x${i.toString(16)}`}:{})}));
    const result=analyzeThreadDumpData(blockingDump(0,entries));
    assert.equal(result.parsedDumps[0].threads.length,400);
    assert.equal(result.blockingPatternSummary.status,'limited');
    assert.deepEqual(result.blockingPatterns,[]);
    assert.match(result.blockingPatternSummary.reason,/No pattern ranking or disappearance conclusions/);
    assert.doesNotThrow(()=>JSON.stringify(result.parsedDumps[0].threads));
    const classes=analyzeThreadDumpData(longClassInitializationDump());
    assert.equal(classes.parsedDumps[0].classInitializationChains.length,399);
    assert.equal(classes.blockingPatternSummary.status,'limited');
    assert.doesNotThrow(()=>JSON.stringify(classes.parsedDumps[0].threads));
});

test('ranks unique direct/indirect snapshot observations and follows exact endpoints rather than lock addresses', () => {
    const result = analyzeThreadDumpData(blockingSequence.map((text,i) => ({text,name:`capture-${i}.txt`})));
    const pattern = result.blockingPatterns.find(p => p.title === 'Dependencies on worker-1');
    assert.equal(pattern.peakDependents, 3);
    assert.equal(pattern.comparableRecurrences, 1);
    assert.deepEqual(pattern.observations.map(o => [o.directCount,o.indirectCount,o.dependentCount]), [[1,0,1],[2,1,3]]);
    assert.equal(pattern.observations[1].relations.find(r => r.waiter.name === 'worker-2').change, 'observed again');
    assert.equal(pattern.observations[1].relations.find(r => r.waiter.name === 'worker-3').change, 'newly observed');
    assert.equal(patternSnapshot(pattern,result.parsedDumps,2).status,'not observed');
    for (const o of pattern.observations) for (const r of o.relations) {
        const d = result.parsedDumps[o.snapshotIndex];
        assert.match(d.rawText.split('\n')[r.waiter.startLine - 1], new RegExp(r.waiter.name));
        assert.equal(r.waiter.sourceLabel, `capture-${o.snapshotIndex}.txt`);
    }
});

test('cycles never double-count the blocker and never combine edges from different snapshots', () => {
    const result = analyzeThreadDumpData([blockingDump(0,[{id:1,held:['0xa'],wait:'0xb'},{id:2,held:['0xb'],wait:'0xa'},{id:3,wait:'0xa'}]),
        blockingDump(1,[{id:1,held:['0xa']},{id:2,held:['0xb'],wait:'0xa'},{id:3}])].join('\n'));
    const pattern = result.blockingPatterns.find(p=>p.title==='Dependencies on worker-1');
    assert.equal(pattern.observations[0].dependentCount,2);
    assert.ok(pattern.observations[0].relations.some(r=>r.cycle));
    assert.ok(pattern.observations[1].relations.every(r=>!r.cycle));
    assert.ok(pattern.observations[1].noLongerObserved.length > 0);
    assert.ok(pattern.observations.every(o=>o.relations.every(r=>!r.confirmedDeadlock)));
});

test('partial captures, ambiguous identity/owners and process changes cannot prove disappearance or recurrence', () => {
    const result = analyzeThreadDumpData(blockingSequence.join('\n'));
    result.parsedDumps[1].parsingStatus='partial';
    result.parsedDumps[2].parsingStatus='partial';
    const patterns=buildBlockingPatterns(result.parsedDumps), p=patterns.find(p=>p.title==='Dependencies on worker-1');
    assert.equal(p.comparableRecurrences,0);
    assert.equal(patternSnapshot(p,result.parsedDumps,2).status,'uncertain');
    const changed=analyzeThreadDumpData([blockingDump(0,[{id:1,held:['0xa']},{id:2,wait:'0xa'}]),blockingDump(1,[{id:1,held:['0xa']},{id:2,wait:'0xa'}],'5678')].join('\n'));
    assert.ok(changed.blockingPatterns.every(p=>p.comparableRecurrences===0));
    assert.equal(patternSnapshot(changed.blockingPatterns[0],changed.parsedDumps,1).status,'uncertain');
    const ambiguous=analyzeThreadDumpData(blockingDump(0,[{id:1,held:['0xa']},{id:2,held:['0xa']},{id:3,wait:'0xa'}]));
    assert.ok(ambiguous.blockingPatterns.every(p=>p.peakDependents===0 && p.observations[0].uncertainDependentCount>0));
    assert.deepEqual(analyzeThreadDumpData(blockingDump(0,[{id:1}])).blockingPatterns,[]);
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../../assets/javautils/tda/analysis.js';
import {buildThreadDetailsViewModel} from '../../../assets/javautils/tda/thread-modal.js';
import {buildThreadDependencyGraph} from '../../../assets/javautils/tda/dependency-graph.js';

test('real virtual deadlock is not described as absent when no JVM confirmation exists',()=>{
    const text=readFileSync(new URL('../fixtures/ga-regressions/coverage.json',import.meta.url),'utf8');
    const dump=analyzeThreadDumpData(text).parsedDumps[0];
    const participants=dump.threads.filter(t=>t.threadName.startsWith('audit-virtual-deadlock-'));
    assert.equal(participants.length,2);
    assert.ok(participants.every(t=>t.javaState==='BLOCKED' && t.isVirtualThread));
    for(const thread of participants){
        const other=participants.find(t=>t!==thread);
        assert.equal(thread.waitingToLock.lockId,other.heldLocks[0].lockId);
        const fact=buildThreadDetailsViewModel(thread).summaryMeta.find(f=>f.label==='Deadlock');
        assert.equal(fact.value,'Not confirmed by source');
    }
    const graph=buildThreadDependencyGraph(dump.threads);
    assert.ok(graph.observedCycles.length>0,'retain observed cycles without inventing JVM confirmation');
    assert.ok(participants.every(t=>!t.isDeadlocked));
});

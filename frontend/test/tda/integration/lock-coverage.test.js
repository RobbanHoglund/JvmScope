import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../../assets/javautils/tda/analysis.js';
import {buildThreadDetailsViewModel} from '../../../assets/javautils/tda/thread-modal.js';
for(const [file,ownables,count] of [['coverage-default.txt',false,0],['coverage-with-locks.txt',true,1],['coverage.json',false,0]]){
    test(`real ReentrantLock owner has explicit evidence coverage in ${file}`,()=>{
        const text=readFileSync(new URL(`../fixtures/ga-regressions/${file}`,import.meta.url),'utf8');
        const thread=analyzeThreadDumpData(text).parsedDumps[0].threads.find(t=>t.threadName==='audit-ownable-owner');
        assert.equal(thread.lockCoverage?.ownableSynchronizers,ownables);
        assert.equal(thread.heldLocks.length,count);
        const details=buildThreadDetailsViewModel(thread);
        assert.equal(details.summaryMeta.find(f=>f.label==='Locks observed').value,String(count));
        if(!ownables)assert.match(details.lockEvidence.coverage,/Ownable synchronizers not reported/);
        assert.match(details.lockEvidence.coverage,/not total ownership/);
    });
}

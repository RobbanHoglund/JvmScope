import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../../assets/javautils/tda/analysis.js';
import {buildThreadDetailsViewModel} from '../../../assets/javautils/tda/thread-modal.js';
for(const file of ['carrier-classic.txt','carrier-json.json'])test(`real Condition.awaitUninterruptibly retains its specific classification in ${file}`,()=>{
    const text=readFileSync(new URL(`../fixtures/ga-regressions/${file}`,import.meta.url),'utf8');
    const thread=analyzeThreadDumpData(text).parsedDumps[0].threads.find(t=>t.threadName==='audit-uninterruptible-condition');
    assert.equal(thread.javaState,'WAITING');
    assert.equal(thread.scenarioKey,'condition-await');
    assert.equal(buildThreadDetailsViewModel(thread).assessment.title,'Condition await');
    assert.equal(thread.heldLocks.length,0,'await releases the associated lock');
});

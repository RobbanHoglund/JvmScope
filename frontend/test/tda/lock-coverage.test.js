import assert from 'node:assert/strict';
import test from 'node:test';
import {parseThreadDump} from '../../assets/javautils/tda/parser.js';
const header='"worker" #1 prio=5 tid=0x1 nid=0x1 waiting on condition\n   java.lang.Thread.State: WAITING (parking)\n    at java.util.concurrent.locks.LockSupport.park(LockSupport.java:1)\n';
for(const [section,reported] of [['',false],['\nLocked ownable synchronizers:\n',false],['\nLocked ownable synchronizers:\n - None\n',true],['\nLocked ownable synchronizers:\n - <0xab> (a Lock)\n',true]]){
    test(`ownable coverage requires an actual section observation: ${JSON.stringify(section)}`,()=>{
        const [thread]=parseThreadDump(header+section);
        assert.equal(thread.lockCoverage.monitors,true);
        assert.equal(thread.lockCoverage.ownableSynchronizers,reported);
    });
}
test('older file dumps with no lock data retain unknown coverage',()=>{
    const [thread]=parseThreadDump('#1 "worker"\n    example.Work.run(Work.java:1)\n');
    assert.deepEqual(thread.lockCoverage,{monitors:false,ownableSynchronizers:false});
    assert.equal(thread.lockDataAvailable,false);
});

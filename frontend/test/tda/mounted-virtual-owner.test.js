import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../assets/javautils/tda/analysis.js';
import {parseThreadDump} from '../../assets/javautils/tda/parser.js';
import {buildThreadDetailsViewModel} from '../../assets/javautils/tda/thread-modal.js';
import {buildRawDumpModel} from '../../assets/javautils/tda/raw-dump-model.js';
const prefix='Full thread dump OpenJDK 64-Bit Server VM (25 mixed mode):\n\n';
const carrier='"carrier" #10 [10] prio=5 os_prio=0 cpu=1.00ms elapsed=1.00s tid=0x10 [0x1000]\n   Carrying virtual thread #20\n    at jdk.internal.vm.Continuation.run(Continuation.java:1)\n';
const mounted='   Mounted virtual thread #20\n    at example.Init.<clinit>(Init.java:1)\n    - locked <0xaa> (a java.lang.Object)\n    - waiting to lock <0xbb> (a java.lang.Object)\n    - waiting on the Class initialization monitor for example.Other\n';
const ownable='\n   Locked ownable synchronizers:\n    - <0xcc> (a java.util.concurrent.locks.ReentrantLock$NonfairSync)\n';

test('mounted stacks keep virtual monitors, waits and class initialization separate from carrier synchronizers',()=>{
    const [platform,virtual]=parseThreadDump(prefix+carrier+mounted+ownable);
    assert.deepEqual(platform.heldLocks.map(l=>l.lockId),['0xcc']);
    assert.deepEqual(platform.waitingLocks,[]);
    assert.deepEqual(platform.initializingClasses,[]);
    assert.deepEqual(platform.classInitializationWaits,[]);
    assert.equal(platform.stackFrames,1);
    assert.equal(virtual.isVirtualThread,true);
    assert.equal(virtual.jvmId,20);
    assert.equal(virtual.javaState,null,'mounting does not assert a Java state');
    assert.deepEqual(virtual.heldLocks.map(l=>l.lockId),['0xaa']);
    assert.equal(virtual.waitingLocks[0].lockId,'0xbb');
    assert.equal(virtual.initializingClasses[0].className,'example.Init');
    assert.equal(virtual.classInitializationWaits[0].className,'example.Other');
    assert.equal(virtual.cpuMs,null);
    const details=buildThreadDetailsViewModel(platform);
    assert.doesNotMatch(details.stackText,/example.Init/);
    assert.match(details.rawText,/example.Init/,'original evidence is preserved');
    const raw=buildRawDumpModel({rawText:prefix+carrier+mounted+ownable,threads:[platform,virtual]});
    assert.equal(raw.lockIndex.get('0xbb').contendedWaiters[0].sourceKey,virtual.sourceKey);
    assert.equal(raw.classInitializationOccurrences[0].sourceKey,virtual.sourceKey);
});

test('unmounting cannot be mistaken for a thread ending',()=>{
    const result=analyzeThreadDumpData([prefix+carrier+mounted+ownable,prefix+carrier.replace('   Carrying virtual thread #20\n','')+ownable].join('\n'));
    assert.equal(result.parsedDumps[1].threadChanges.endedCount,null);
    assert.ok(result.threadSeries.every(s=>s.endedAfterDumpIndexes.length===0));
});

test('a mounted section ending at EOF retains its last monitor and source line',()=>{
    const text=prefix+carrier+mounted.trimEnd();
    const threads=parseThreadDump(text);
    const virtual=threads.find(t=>t.isVirtualThread);
    assert.equal(virtual.rawEndLine,text.split('\n').length);
    assert.equal(virtual.heldLocks.length,1);
    assert.equal(threads[0].heldLocks.length,0);
});

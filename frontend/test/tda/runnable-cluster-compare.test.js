import assert from 'node:assert/strict';
import test from 'node:test';

import { groupRunnableClusterMembersByStack } from '../../assets/javautils/tda/runnable-stack.js';

test('groupRunnableClusterMembersByStack keeps the full raw stack header', () => {
    const members = [{
        rawBlock: [
            '"worker-1" #21 prio=5 os_prio=0 tid=0x123 nid=0x456 waiting on condition',
            '   java.lang.Thread.State: WAITING (parking)',
            '        at com.example.Worker.run(Worker.java:12)',
            '--- CARRIER STACK ---',
            '        at jdk.internal.vm.Continuation.run(java.base@25.0.1/Continuation.java:251)',
        ],
        normalizedFrames: ['com.example.Worker.run', 'jdk.internal.vm.Continuation.run'],
        topFrame: 'com.example.Worker.run',
    }];

    const groups = groupRunnableClusterMembersByStack(members);
    assert.equal(groups.length, 1);
    assert.match(groups[0].stackText, /^"worker-1" #21 prio=5 os_prio=0 tid=0x123 nid=0x456 waiting on condition/m);
    assert.match(groups[0].stackText, /--- CARRIER STACK ---/);
});

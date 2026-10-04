import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RAW_DUMP_FILTERS,
    buildRawDumpModel,
    filterRawDumpThreadBlocks,
} from '../../assets/javautils/tda/raw-dump-model.js';
import { parseThreadDump } from '../../assets/javautils/tda/parser.js';

const rawText = [
    '"monitor-owner" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 runnable [0x1]',
    '   java.lang.Thread.State: RUNNABLE',
    '\t- locked <0x0000000000000001> (a example.Monitor)',
    '',
    '"monitor-waiter" #2 [2] prio=5 os_prio=0 tid=0x2 nid=0x2 waiting [0x2]',
    '   java.lang.Thread.State: BLOCKED',
    '\t- waiting to lock <0x0000000000000001> (a example.Monitor)',
    '',
    '"sync-owner-bridge" #3 [3] prio=5 os_prio=0 tid=0x3 nid=0x3 waiting [0x3]',
    '   java.lang.Thread.State: WAITING (parking)',
    '\t- parking to wait for  <0x0000000000000003> (a example.Sync)',
    'Locked ownable synchronizers:',
    '\t- <0x0000000000000002> (a example.Sync)',
    '',
    '"sync-waiter" #4 [4] prio=5 os_prio=0 tid=0x4 nid=0x4 waiting [0x4]',
    '   java.lang.Thread.State: WAITING (parking)',
    '\t- parking to wait for  <0x0000000000000002> (a example.Sync)',
    'Locked ownable synchronizers:',
    '\t- None',
    '',
    '"notification" #5 [5] prio=5 os_prio=0 tid=0x5 nid=0x5 waiting [0x5]',
    '   java.lang.Thread.State: TIMED_WAITING',
    '\t- waiting on <0x0000000000000004> (a java.lang.Object)',
    '',
    '"routine" #6 [6] prio=5 os_prio=0 tid=0x6 nid=0x6 runnable [0x6]',
    '   java.lang.Thread.State: RUNNABLE',
].join('\n');

function sourceKeys(model, filterId, lockId = '') {
    return new Set(filterRawDumpThreadBlocks(model, filterId, lockId).map((block) => block.sourceKey));
}

function names(model, keys) {
    return new Set([...keys].map((key) => model.blockBySourceKey.get(key).thread.threadName));
}

const threads = parseThreadDump(rawText);
threads.find((thread) => thread.threadName === 'monitor-waiter').isDeadlocked = true;
const model = buildRawDumpModel({ rawText, threads });

const expected = {
    everything: ['monitor-owner', 'monitor-waiter', 'sync-owner-bridge', 'sync-waiter', 'notification', 'routine'],
    problems: ['monitor-owner', 'monitor-waiter', 'sync-owner-bridge', 'sync-waiter'],
    contended: ['monitor-owner', 'monitor-waiter', 'sync-owner-bridge', 'sync-waiter'],
    deadlocks: ['monitor-waiter'],
    blocked: ['monitor-waiter'],
    holders: ['monitor-owner', 'sync-owner-bridge'],
    holdingAndWaiting: ['sync-owner-bridge'],
    monitorEnter: ['monitor-waiter'],
    monitorHolders: ['monitor-owner'],
    synchronizerWait: ['sync-owner-bridge', 'sync-waiter'],
    synchronizerHolders: ['sync-owner-bridge'],
    notificationWait: ['notification'],
    classInitialization: [],
    unresolved: ['sync-owner-bridge'],
};

for (const [filterId, expectedNames] of Object.entries(expected)) {
    test(`${RAW_DUMP_FILTERS[filterId]} filter returns complete source-key blocks`, () => {
        assert.deepEqual(names(model, sourceKeys(model, filterId)), new Set(expectedNames));
    });
}

test('selected lock neighborhood includes owners, contention waiters, and notification waiters', () => {
    assert.deepEqual(
        names(model, sourceKeys(model, 'selectedLock', '0X0000000000000001')),
        new Set(['monitor-owner', 'monitor-waiter']),
    );
    assert.deepEqual(
        names(model, sourceKeys(model, 'selectedLock', '0x0000000000000004')),
        new Set(['notification']),
    );
});

test('diagnostic counts use thread roles rather than raw occurrence totals', () => {
    assert.deepEqual(model.counts, {
        all: 6,
        problems: 4,
        deadlocks: 1,
        blocked: 1,
        waiting: 2,
        timedWaiting: 1,
        contendedWaiters: 3,
        observedOwners: 2,
        holdingAndWaiting: 1,
        unresolved: 1,
        classInitializationWaiters: 0,
        classInitializationInitializers: 0,
    });
});

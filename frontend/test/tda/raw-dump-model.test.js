import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    buildRawDumpModel,
    evidenceLabelForKind,
    filterRawDumpThreadBlocks,
} from '../../assets/javautils/tda/raw-dump-model.js';
import { analyzeClassInitialization } from '../../assets/javautils/tda/class-initialization.js';
import { parseThreadDump } from '../../assets/javautils/tda/parser.js';

const fixtures = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

function modelFor(rawText) {
    return buildRawDumpModel({ rawText, threads: parseThreadDump(rawText) });
}

test('exact source round-trips canonical raw text without generated content', async () => {
    const rawText = await fixtures('malicious-html-content.txt');
    const model = modelFor(rawText);

    assert.equal(model.exactSourceText, rawText);
    assert.match(model.exactSourceText, /<script>alert\('stack'\)<\/script>/);
    assert.equal(model.rawSections.flatMap((section) => section.lines).some((line) => line.includes('Full thread dump')), true);
});

test('classifies monitor enter, notification wait, and monitor hold precisely', () => {
    const rawText = [
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '',
        '"owner" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 runnable [0x1]',
        '   java.lang.Thread.State: RUNNABLE',
        '\t- locked <0x0000000000000001> (a example.Lock)',
        '',
        '"entry-waiter" #2 [2] prio=5 os_prio=0 tid=0x2 nid=0x2 waiting [0x2]',
        '   java.lang.Thread.State: BLOCKED (on object monitor)',
        '\t- waiting to lock <0x0000000000000001> (a example.Lock)',
        '',
        '"notification-waiter" #3 [3] prio=5 os_prio=0 tid=0x3 nid=0x3 waiting [0x3]',
        '   java.lang.Thread.State: WAITING (on object monitor)',
        '\t- waiting on <0x0000000000000002> (a java.lang.Object)',
    ].join('\n');
    const model = modelFor(rawText);
    const byKind = new Map(model.occurrences.map((occurrence) => [occurrence.kind, occurrence]));

    assert.equal(byKind.get('monitor').label, 'HOLDING MONITOR');
    assert.equal(byKind.get('monitor-enter').label, 'WAITING TO ENTER MONITOR');
    assert.equal(byKind.get('monitor-wait').label, 'OBJECT.WAIT / NOTIFICATION');
    assert.equal(model.lockIndex.get('0x0000000000000001').owners[0].threadName, 'owner');
    assert.equal(model.lockIndex.get('0x0000000000000001').contendedWaiters[0].threadName, 'entry-waiter');
    assert.equal(model.lockIndex.get('0x0000000000000002').notificationWaiters[0].threadName, 'notification-waiter');
    assert.equal(model.lockIndex.get('0x0000000000000002').unresolved, false);
});

test('classifies synchronizer ownership and parking waits with an observed owner', async () => {
    const rawText = await fixtures('ownable-synchronizer-contention.txt');
    const model = modelFor(rawText);
    const lock = model.lockIndex.get('0x00000000aaaabbbb');

    assert.equal(evidenceLabelForKind('synchronizer-park'), 'WAITING FOR SYNCHRONIZER');
    assert.equal(evidenceLabelForKind('ownable-synchronizer'), 'HOLDING SYNCHRONIZER');
    assert.deepEqual(lock.owners.map((thread) => thread.threadName), ['lock-owner']);
    assert.deepEqual(lock.contendedWaiters.map((thread) => thread.threadName), ['lock-waiter']);
    assert.equal(lock.resourceCategory, 'synchronizer');
    assert.equal(lock.unresolved, false);
});

test('marks only ownerless contended waits unresolved', () => {
    const rawText = [
        '"entry" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 waiting [0x1]',
        '   java.lang.Thread.State: BLOCKED',
        '\t- waiting to lock <0x0000000000000011> (a example.Lock)',
        '',
        '"notify" #2 [2] prio=5 os_prio=0 tid=0x2 nid=0x2 waiting [0x2]',
        '   java.lang.Thread.State: WAITING',
        '\t- waiting on <0x0000000000000022> (a java.lang.Object)',
    ].join('\n');
    const model = modelFor(rawText);

    assert.equal(model.lockIndex.get('0x0000000000000011').unresolved, true);
    assert.equal(model.lockIndex.get('0x0000000000000022').unresolved, false);
    assert.equal(model.counts.unresolved, 1);
});

test('keeps duplicate thread names distinct through sourceKey', async () => {
    const rawText = await fixtures('duplicate-thread-names.txt');
    const model = modelFor(rawText);

    assert.equal(model.threadBlocks.length, 2);
    assert.equal(new Set(model.threadBlocks.map((block) => block.sourceKey)).size, 2);
    assert.equal(model.blockBySourceKey.size, 2);
});

test('holding and waiting remains a problem while starting collapsed', () => {
    const rawText = [
        '"bridge" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 waiting [0x1]',
        '   java.lang.Thread.State: BLOCKED',
        '\t- locked <0x0000000000000001> (a example.First)',
        '\t- waiting to lock <0x0000000000000002> (a example.Second)',
    ].join('\n');
    const block = modelFor(rawText).threadBlocks[0];

    assert.equal(block.holdingAndWaiting, true);
    assert.equal(block.problem, true);
    assert.equal(block.initiallyExpanded, false);
});

test('confirmed deadlock state depends only on confirmed thread metadata', () => {
    const rawText = [
        '"alpha" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 waiting [0x1]',
        '   java.lang.Thread.State: BLOCKED',
        '\t- waiting to lock <0x0000000000000001> (a example.Lock)',
    ].join('\n');
    const threads = parseThreadDump(rawText);
    assert.equal(buildRawDumpModel({ rawText, threads }).threadBlocks[0].confirmedDeadlock, false);

    threads[0].isDeadlocked = true;
    const deadlockedBlock = buildRawDumpModel({ rawText, threads }).threadBlocks[0];
    assert.equal(deadlockedBlock.confirmedDeadlock, true);
    assert.equal(deadlockedBlock.initiallyExpanded, false);
});

test('surfaces class-initialization waiters and the initializer in annotated raw evidence', async () => {
    const rawText = await fixtures('class-initialization-stall.txt');
    const threads = parseThreadDump(rawText);
    analyzeClassInitialization(threads);
    const model = buildRawDumpModel({ rawText, threads });
    const classBlocks = filterRawDumpThreadBlocks(model, 'classInitialization');
    const initializer = classBlocks.find((block) => block.classInitializationInitializer);

    assert.equal(model.counts.classInitializationWaiters, 2);
    assert.equal(model.counts.classInitializationInitializers, 1);
    assert.equal(classBlocks.length, 3);
    assert.equal(initializer.thread.threadName, 'class-initializer');
    assert.equal(initializer.classInitializationBlockedWaiterCount, 2);
    assert.equal(evidenceLabelForKind('class-initialization-wait'), 'WAITING FOR CLASS INITIALIZATION');
    assert.equal(model.classInitializationOccurrences.length, 2);
    assert.equal(model.exactSourceText, rawText);
});

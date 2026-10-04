import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
    analyzeThreadDump,
    extractNormalizedFrames,
    normalizeStackFrame,
    parseBytes,
    parseDeadlocks,
    parseThreadHeader,
    parseThreadDump,
    splitThreadDumpSnapshots,
} from '../../assets/javautils/tda/parser.js';

const fixtures = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

test('parses the characterized HotSpot JDK 17 thread fields and monitor data', async () => {
    const threads = parseThreadDump(await fixtures('hotspot-jdk17-standard.txt'));

    assert.equal(threads.length, 1);
    assert.deepEqual(
        {
            name: threads[0].threadName,
            daemon: threads[0].daemon,
            cpuMs: threads[0].cpuMs,
            elapsedS: threads[0].elapsedS,
            state: threads[0].javaState,
            topFrame: threads[0].topFrame,
            locksHeld: threads[0].locksHeldCount,
        },
        {
            name: 'worker-1',
            daemon: true,
            cpuMs: 12.5,
            elapsedS: 3.25,
            state: 'WAITING',
            topFrame: 'example.Worker.await(Worker.java:42)',
            locksHeld: 1,
        },
    );
    assert.deepEqual(threads[0].waitingToLock, {
        lockId: '0x00000000a1b2c3d4',
        lockType: 'a example.Lock',
        kind: 'monitor-enter',
    });
});

test('parses relaxed Java 25 fields without a JVM id or stack pointer', async () => {
    const [thread] = parseThreadDump(await fixtures('hotspot-jdk25-relaxed.txt'));

    assert.equal(thread.threadName, 'relaxed-worker');
    assert.equal(thread.jvmId, null);
    assert.equal(thread.stackPtr, null);
    assert.equal(thread.cpuMs, 1500);
    assert.equal(thread.elapsedS, 0.25);
    assert.equal(thread.allocatedBytes, 1572864);
    assert.equal(thread.definedClasses, 7);
});

test('parses carrier and mounted virtual-thread markers', async () => {
    const [thread] = parseThreadDump(await fixtures('virtual-thread-carrier.txt'));

    assert.equal(thread.isCarrierThread, true);
    assert.equal(thread.carrierVirtualThreadId, '77');
    assert.equal(thread.mountedVirtualThreadId, '77');
    assert.match(thread.mountedVirtualStackLines.join('\n'), /example\.VirtualTask\.run/);
});

test('distinguishes owned synchronizers from parked synchronizer waits', async () => {
    const threads = parseThreadDump(await fixtures('ownable-synchronizer-contention.txt'));
    const [owner, waiter] = threads;

    assert.deepEqual(owner.ownedSynchronizers, [{
        lockId: '0x00000000aaaabbbb',
        lockType: 'a java.util.concurrent.locks.ReentrantLock$NonfairSync',
        kind: 'ownable-synchronizer',
    }]);
    assert.equal(owner.locksHeldCount, 1);
    assert.deepEqual(waiter.waitingLocks, [{
        lockId: '0x00000000aaaabbbb',
        lockType: 'a java.util.concurrent.locks.ReentrantLock$NonfairSync',
        kind: 'synchronizer-park',
    }]);
    assert.equal(waiter.waitingToLock, null);
});

test('parses classic HotSpot headers that omit CPU and elapsed counters', async () => {
    const [thread] = parseThreadDump(await fixtures('hotspot-jdk8-classic.txt'));

    assert.equal(thread.threadName, 'classic-worker');
    assert.equal(thread.format, 'hotspot-classic');
    assert.equal(thread.cpuMs, null);
    assert.equal(thread.elapsedS, null);
    assert.equal(thread.nid, '0x5');
});

test('splits the characterized timestamp and Full thread dump snapshot format', async () => {
    const snapshots = splitThreadDumpSnapshots(await fixtures('multi-snapshot-timestamp.txt'));

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].timestamp, '2026-08-06 10:15:30');
    assert.equal(snapshots[0].timestampQuality, 'valid');
    assert.equal(snapshots[0].timestampFormat, 'classic');
    assert.equal(snapshots[0].timestampTimezoneKind, 'unspecified');
    assert.equal(snapshots[1].timestamp, '2026-08-06 10:15:35');
    assert.match(snapshots[1].rawText, /"second"/);
});

test('splits repeated Full thread dump headers that have no timestamps', async () => {
    const snapshots = splitThreadDumpSnapshots(await fixtures('multi-snapshot-no-timestamp.txt'));

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].boundaryStrategy, 'header');
    assert.equal(snapshots[0].timestamp, null);
    assert.match(snapshots[0].rawText, /"first"/);
    assert.match(snapshots[1].rawText, /"second"/);
});

test('keeps ISO timestamp text, records its quality, and attaches preamble to the first snapshot', async () => {
    const snapshots = splitThreadDumpSnapshots(await fixtures('multi-snapshot-iso-time.txt'));

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0].timestampRaw, '2026-08-06T10:15:30.123+02:00');
    assert.equal(snapshots[0].timestampQuality, 'valid');
    assert.equal(snapshots[0].timestampFormat, 'iso-8601');
    assert.equal(snapshots[0].timestampTimezoneLabel, 'UTC+02:00');
    assert.equal(snapshots[1].timestampRaw, '2026-08-06T10:15:35,500Z');
    assert.equal(snapshots[1].timestampQuality, 'valid');
    assert.equal(snapshots[1].timestampTimezoneLabel, 'UTC');
    assert.match(snapshots[0].rawText, /^Captured by diagnostic tool/);
});

test('collector ISO timestamps survive jcmd PID/date prefixes without leaking into the previous dump', () => {
    const snapshot = (time, name) => `${time}\n1234:\n2026-10-03 16:00:00\nFull thread dump OpenJDK 64-Bit Server VM:\n"${name}" #1 prio=5 tid=0x1 nid=0x1 runnable [0x1]\n   java.lang.Thread.State: RUNNABLE`;
    const first = snapshot('2026-10-03T14:00:00.123Z', 'first');
    const second = snapshot('2026-10-03T14:00:01.623Z', 'second');
    const snapshots = splitThreadDumpSnapshots(`${first}\n\n${second}`);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots.map(value => value.timestampRaw), ['2026-10-03T14:00:00.123Z', '2026-10-03T14:00:01.623Z']);
    assert.equal(snapshots[1].timestampEpochMs - snapshots[0].timestampEpochMs, 1500);
    assert.equal(snapshots[0].rawText, first);
    assert.equal(snapshots[1].rawText, second);
});

test('collector prefixes require a jcmd PID marker and preserve invalid timestamp quality', () => {
    for (const [prefix, expectedTime, expectedQuality] of [
        ['2026-10-03T14:00:00.123Z\nnot-a-PID', '2026-10-03 16:00:00', 'valid'],
        ['2026-02-30T14:00:00.123Z\n1234:', '2026-02-30T14:00:00.123Z', 'invalid'],
    ]) {
        const [snapshot] = splitThreadDumpSnapshots(`${prefix}\n2026-10-03 16:00:00\nFull thread dump OpenJDK 64-Bit Server VM:`);
        assert.equal(snapshot.timestampRaw, expectedTime);
        assert.equal(snapshot.timestampQuality, expectedQuality);
    }
});

test('marks calendar-invalid timestamp lines explicitly', () => {
    const snapshots = splitThreadDumpSnapshots([
        '2026-02-30T10:15:30Z',
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '"worker" #1 [1] prio=5 os_prio=0 cpu=1.00ms elapsed=1.00s tid=0x1 nid=0x1 runnable [0x1]',
        '   java.lang.Thread.State: RUNNABLE',
    ].join('\n'));

    assert.equal(snapshots[0].timestampRaw, '2026-02-30T10:15:30Z');
    assert.equal(snapshots[0].timestampQuality, 'invalid');
    assert.equal(snapshots[0].timestampEpochMs, null);
    assert.match(snapshots[0].timestampQualityReason, /invalid calendar/i);
});

test('parses explicit Java-level deadlock cycles', async () => {
    const cycles = parseDeadlocks(await fixtures('confirmed-deadlock.txt'));

    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].threads.map((thread) => thread.threadName), ['alpha', 'beta']);
    assert.equal(cycles[0].threads[0].heldBy, 'beta');
});

test('records exact 1-based raw source ranges without absorbing a deadlock tail', () => {
    const rawText = [
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '',
        '"first" #1 [1] prio=5 os_prio=0 tid=0x1 nid=0x1 runnable [0x1]',
        '   java.lang.Thread.State: RUNNABLE',
        '\tat example.First.run(First.java:1)',
        '',
        '"second" #2 [2] prio=5 os_prio=0 tid=0x2 nid=0x2 waiting [0x2]',
        '   java.lang.Thread.State: WAITING (on object monitor)',
        '\t- waiting on <0x0000000000000001> (a java.lang.Object)',
        '',
        'Found one Java-level deadlock:',
        '=============================',
        '"first":',
    ].join('\n');
    const lines = rawText.split('\n');
    const threads = parseThreadDump(rawText);

    assert.equal(threads.length, 2);
    assert.deepEqual(
        threads.map((thread) => [thread.rawStartLine, thread.rawEndLine]),
        [[3, 6], [7, 10]],
    );
    for (const thread of threads) {
        assert.equal(
            lines.slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n'),
            thread.rawBlock.join('\n'),
        );
    }
    assert.equal(lines[threads[1].rawEndLine], 'Found one Java-level deadlock:');
});

test('normalizes volatile stack data and keeps raw-frame extraction independent', () => {
    assert.equal(
        normalizeStackFrame('example.Task.run(Task.java:42)'),
        'example.Task.run(Task.java)',
    );
    assert.equal(normalizeStackFrame('example.Native.call(Native Method)'), 'example.Native.call()');
    assert.deepEqual(
        extractNormalizedFrames({ rawBlock: ['\tat example.Task.run(Task.java:42)'] }),
        ['example.Task.run(Task.java)'],
    );
});

test('removes only the volatile lambda suffix while preserving lambda method identity', () => {
    const foo = normalizeStackFrame('example.Task.lambda$foo$123(Task.java:42)');
    const bar = normalizeStackFrame('example.Task.lambda$bar$456(Task.java:43)');

    assert.equal(foo, 'example.Task.lambda$foo(Task.java)');
    assert.equal(bar, 'example.Task.lambda$bar(Task.java)');
    assert.notEqual(foo, bar);
});

test('parses all allocation units supported by the analyzer', () => {
    assert.equal(parseBytes('304B'), 304);
    assert.equal(parseBytes('1.5M'), 1572864);
    assert.equal(parseBytes('2GB'), 2147483648);
    assert.equal(parseBytes('invalid'), null);
});

test('preserves unknown credible-header fields without treating quoted log entries as threads', () => {
    const header = parseThreadHeader(
        '"future-worker" daemon prio=5 os_prio=0 cpu=1ms elapsed=2s custom_metric=12 tid=0x0001 nid=0x2 runnable',
    );

    assert.equal(header.format, 'hotspot-relaxed');
    assert.equal(header.extraHeaderFields.custom_metric, '12');
    assert.equal(parseThreadHeader('"not a thread" application emitted a quoted message'), null);
});

test('reports empty, unsupported, and partial inputs explicitly', async () => {
    assert.equal(analyzeThreadDump('').status, 'empty');

    const unsupported = analyzeThreadDump(await fixtures('unknown-format.txt'));
    assert.equal(unsupported.status, 'unsupported');
    assert.match(unsupported.warnings[0], /No supported thread headers/);

    const partial = analyzeThreadDump(await fixtures('truncated-dump.txt'));
    assert.equal(partial.status, 'partial');
    assert.match(partial.warnings[0], /appears truncated/);
});

test('accepts complete header-only HotSpot VM threads', () => {
    const vmOnly = analyzeThreadDump([
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '',
        '"ZDirector" os_prio=0 cpu=12.00ms elapsed=20.00s tid=0x1 nid=2 runnable',
    ].join('\n'));

    assert.equal(vmOnly.status, 'success');
    assert.equal(vmOnly.diagnostics.headerOnlyVmThreads, 1);
});

test('accepts complete JDK 11-style header-only VM threads', () => {
    const result = analyzeThreadDump([
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '',
        '"main" #1 prio=5 os_prio=0 tid=0x0000000000000001 nid=0x1 runnable [0x0000000000001000]',
        '   java.lang.Thread.State: RUNNABLE',
        '\tat example.Main.main(Main.java:1)',
        '',
        '"VM Thread" os_prio=0 tid=0x0000000000000002 nid=0x2 runnable',
        '',
        '"GC Thread#0" os_prio=0 tid=0x0000000000000003 nid=0x3 runnable',
        '',
        '"VM Periodic Task Thread" os_prio=0 tid=0x0000000000000004 nid=0x4 waiting on condition',
    ].join('\n'));

    assert.equal(result.status, 'success');
    assert.equal(result.diagnostics.headerOnlyVmThreads, 3);
    assert.deepEqual(result.warnings, []);
});

test('keeps a truncated JDK 25-style Java thread partial', () => {
    const truncatedJavaThread = analyzeThreadDump([
        'Full thread dump OpenJDK 64-Bit Server VM:',
        '',
        '"application-worker" #1 [1] prio=5 os_prio=0 cpu=1.00ms elapsed=2.00s tid=0x2 nid=3 runnable [0x3]',
    ].join('\n'));

    assert.equal(truncatedJavaThread.status, 'partial');
    assert.equal(truncatedJavaThread.diagnostics.truncatedThreads, 1);
});

test('treats a synthetic class-initialization dump as complete with header-only VM entries', async () => {
    const rawText = await readFile(join(
        import.meta.dirname,
        'fixtures',
        'class-initialization-vm-threads.txt',
    ), 'utf8');
    const result = analyzeThreadDump(rawText);

    assert.equal(result.status, 'success');
    assert.equal(result.diagnostics.supportedThreadHeaders, 28);
    assert.equal(result.diagnostics.headerOnlyVmThreads, 17);
    assert.deepEqual(result.warnings, []);
});

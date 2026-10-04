import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildThreadDependencyGraph } from '../../assets/javautils/tda/dependency-graph.js';
import { formatLockCount } from '../../assets/javautils/tda/dependency-graph-view.js';

import { parseThreadDump } from '../../assets/javautils/tda/parser.js';
import { renderThreadStackMarkup, stackFrameGroup } from '../../assets/javautils/tda/thread-stack-view.js';
import {
    buildThreadDetailsViewModel,
    classifyStackTraceLine,
    getThreadDetailsTabOrder,
} from '../../assets/javautils/tda/thread-modal.js';

for (const [name, thread, expected] of [
    ['unavailable', { lockDataAvailable: false, heldLocks: [], waitingLocks: [], locksHeldCount: 0 }, '—'],
    ['known zero', { lockDataAvailable: true, heldLocks: [], waitingLocks: [], locksHeldCount: 0 }, '0'],
    ['known owner', { heldLocks: [{ lockId: '0x123', lockType: 'Object', kind: 'monitor' }] }, '1'],
]) {
    test(`lock counts remain ${name} in the identity summary and graph displays`, () => {
        const details = buildThreadDetailsViewModel(thread);
        assert.equal(details.summaryMeta.find(item => item.label === 'Locks held').value, expected);
        assert.equal(details.coreFacts.some(item => item.label === 'Locks held'), false);
        const node = buildThreadDependencyGraph([thread]).threadNodes[0];
        assert.equal(formatLockCount(node), expected);
        assert.equal(node.locksHeldCount, expected === '—' ? null : Number(expected));
        assert.equal(formatLockCount(node, 'waiting'), expected === '—' ? '—' : '0');
    });
}

test('classifyStackTraceLine identifies stack trace structure for styled rendering', () => {
    assert.equal(classifyStackTraceLine('"worker-1" #12 daemon'), 'header');
    assert.equal(classifyStackTraceLine('   java.lang.Thread.State: BLOCKED'), 'state');
    assert.equal(classifyStackTraceLine('\tat com.example.Worker.run(Worker.java:42)'), 'frame');
    assert.equal(classifyStackTraceLine('\t- waiting to lock <0x123>'), 'lock');
    assert.equal(classifyStackTraceLine('   Locked ownable synchronizers:'), 'section');
    assert.equal(classifyStackTraceLine(''), 'empty');
});

test('stack decorations escape untrusted evidence and searches remain literal, bounded and Unicode-safe', () => {
    const text = '\t<script>alert("x")</script> & İ [.*]\n\tat example.Worker.run(Worker.java:7)';
    const result = renderThreadStackMarkup(text, '[.*]');
    assert.equal(result.matchCount, 1);
    assert.match(result.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp;/);
    assert.doesNotMatch(result.html, /<script>/);
    assert.match(result.html, />\[\.\*\]<\/mark>/);
    assert.equal(renderThreadStackMarkup('İ I i', 'i').matchCount, 2);
    const large = renderThreadStackMarkup('x\n'.repeat(2000), 'x');
    assert.equal(large.matchCount, 1000);
    assert.equal(large.capped, true);
    assert.equal(large.lineCount, 2001);
    assert.equal((large.html.match(/<mark/g) || []).length, 1000);
    assert.equal(stackFrameGroup('\tat java.base@27/java.lang.Thread.run(Thread.java:1)'), 'jvm');
    assert.equal(stackFrameGroup('\tat org.postgresql.PGStream.receive(PGStream.java:1)'), 'library');
    assert.equal(stackFrameGroup('\tat custom.Loader$Lambda/0x123.run(Unknown Source)'), 'other');
    assert.equal(stackFrameGroup('\tat java.lang.invoke.LambdaForm$DMH/0x123.invoke(Unknown Source)'), 'jvm');
    assert.match(renderThreadStackMarkup('    - <0x123> (a java.util.concurrent.locks.ReentrantLock)').html, /is-lock/);
    assert.equal(stackFrameGroup('not a frame'), null);
});

test('buildThreadDetailsViewModel exposes information tabs and a complete raw dump', () => {
    const thread = {
        threadName: 'cache-owner-1',
        javaState: 'TIMED_WAITING',
        javaStateDetail: 'Thread.sleep',
        jvmId: 42,
        nid: '0x145be',
        locksHeldCount: 1,
        cpuMs: 2500,
        allocated: '128M',
        allocatedBytes: 128 * 1024 ** 2,
        allocatedDeltaBytes: 32 * 1024 ** 2,
        allocationRateBytesPerSecond: 16 * 1024 ** 2,
        elapsedS: 6,
        scenarioLabel: 'Likely lock bottleneck',
        scenarioKey: 'likely-lock-bottleneck',
        scenarioReason: 'Waited on lock while others held it',
        scenarioConfidence: 'HIGH',
        scenarioEvidence: { label: 'INFERRED', basis: 'lock contention', qualification: 'Evidence is inference only' },
        scenarioPatternScore: 84,
        findings: [{ label: 'Lock contention', evidence: { label: 'INFERRED' } }],
        rawBlock: ['main', 'Thread.sleep', 'waiting'],
        crossSnapshotDiagnostics: { status: 'active', occurrenceCount: 2, diagnostics: [] },
    };

    const model = buildThreadDetailsViewModel(thread);
    assert.deepEqual(getThreadDetailsTabOrder(), ['overview', 'locks', 'history']);
    assert.equal(model.title, 'cache-owner-1');
    assert.equal(model.summaryMeta[0].label, 'Java state');
    assert.equal(model.tabs[0].id, 'overview');
    assert.equal(model.tabs.at(-1).id, 'history');
    assert.equal(model.stackText, model.rawText);
    assert.match(model.assessment.reason, /Waited on lock/);
    assert.equal(model.coreFacts.some(item => ['Java state', 'Scenario', 'Evidence', 'Confidence'].includes(item.label)), false);
    assert.equal(model.coreFacts.find((item) => item.label === 'Allocated total').value, '128M');
    assert.equal(model.coreFacts.find((item) => item.label === 'Allocation delta').value, '32.00 MiB');
    assert.equal(model.coreFacts.find((item) => item.label === 'Allocation rate').value, '16.00 MiB/s');
    assert.equal(model.hasHistory, true);
    assert.equal(model.history.scenarioKey, 'likely-lock-bottleneck');
    assert.equal(model.history.summary.occurrenceCount, 2);
});

test('detail metrics round only the presentation and qualify the source and CPU interval', () => {
    const thread = { cpuMs: 1848.15, cpuDeltaMs: 63.680000000000064, cpuIntervalMs: 10000,
        cpuRateBasis: 'thread-elapsed', cpuDeltaStatus: 'computed', elapsedS: 1961.29 };
    const before = { ...thread };
    const model = buildThreadDetailsViewModel(thread, {
        snapshot: { timestamp: '2026-10-03 12:00:10', sourceLabel: '<source>.txt' }, snapshotIndex: 2, snapshotCount: 7,
    });
    assert.equal(model.coreFacts.find(item => item.label === 'CPU delta').value, '63.68 ms');
    assert.equal(model.coreFacts.find(item => item.label === 'CPU total').value, '1848.15 ms');
    assert.equal(model.context.label, 'Snapshot 3 of 7');
    assert.equal(model.context.source, '<source>.txt');
    assert.match(model.context.time.tooltip, /timezone not supplied/i);
    assert.deepEqual(model.cpuComparison, { label: 'Snapshot 2 → 3', intervalMs: 10000, basis: 'thread-elapsed', status: 'computed' });
    assert.deepEqual(thread, before);
});

test('unmatched rules and missing metrics do not imply a healthy thread or invented interval', () => {
    const model = buildThreadDetailsViewModel({ cpuMs: NaN, cpuDeltaMs: null, elapsedS: Infinity });
    assert.equal(model.assessment.matched, false);
    assert.equal(model.assessment.title, 'No diagnostic rule matched');
    assert.match(model.assessment.reason, /does not establish.*problem-free/);
    assert.equal(model.cpuComparison.label, 'No comparable CPU sample');
    assert.equal(model.context.time.headline, 'Dump time unavailable');
    for (const label of ['CPU total', 'CPU delta', 'Elapsed']) {
        assert.equal(model.coreFacts.find(item => item.label === label).value, '—');
    }
});

test('buildThreadDetailsViewModel keeps the full raw thread block when virtual stacks also exist', () => {
    const thread = {
        threadName: 'worker-7',
        javaState: 'WAITING',
        rawBlock: ['"worker-7" #7 prio=5 os_prio=0 tid=0x1234 nid=0x9 waiting on condition', '   java.lang.Thread.State: WAITING (parking)', '        at java.base/java.lang.Thread.sleep(Native Method)'],
        mountedVirtualStackLines: ['virtual frame 1', 'virtual frame 2'],
        carrierStackLines: ['carrier frame 1'],
    };

    const model = buildThreadDetailsViewModel(thread);
    assert.equal(model.stackText, thread.rawBlock.join('\n'));
    assert.equal(model.rawText, thread.rawBlock.join('\n'));
    assert.equal(model.hasHistory, false);
    assert.equal(model.history.summary, null);
});

test('buildThreadDetailsViewModel preserves header when rawBlock is unavailable', () => {
    const thread = {
        threadName: 'carrier-3',
        rawHeaderLine: '"carrier-3" #333 prio=5 os_prio=0 tid=0x123 nid=0x456 runnable',
        carrierStackLines: [
            '        at com.example.service.OrderService.process(OrderService.java:88)',
            '        at java.net.http.HttpClient.send(java.net.http/Unknown Source)',
        ],
    };

    const model = buildThreadDetailsViewModel(thread);
    assert.match(model.stackText, /^"carrier-3" #333 prio=5 os_prio=0 tid=0x123 nid=0x456 runnable/m);
    assert.match(model.stackText, /--- CARRIER STACK ---/);
    assert.match(model.stackText, /OrderService\.process/);
});

for (const file of ['jdk21-dump-to-file.json', 'jdk25-mounted-virtual.json', 'jdk27-mounted-virtual.json',
    'jdk27-dump-to-file-v1.json', 'jdk21-dump-to-file.txt', 'jdk27-dump-to-file.txt']) {
    test(`${file} has a readable colored stack and an independent exact original`, () => {
        const source = readFileSync(new URL(`./fixtures/runtime/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
        const thread = parseThreadDump(source)[0];
        const before = structuredClone(thread);
        const model = buildThreadDetailsViewModel(thread);
        assert.equal(model.rawText, source.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n'));
        assert.equal(model.hasOriginal, true);
        assert.equal(model.originalLabel, file.endsWith('.json') ? 'Original JSON' : 'Original');
        assert.ok(model.stackText.startsWith(JSON.stringify(thread.threadName)));
        assert.match(model.stackText, /\n    at java\.base\//);
        assert.doesNotMatch(model.stackText, /1970-01-01|cpu=|prio=|"stack":/);
        assert.match(renderThreadStackMarkup(model.stackText).html, /is-jvm/);
        assert.equal(model.coreFacts.find(item => item.label === 'CPU total').value, '—');
        assert.deepEqual(thread, before, 'presentation does not mutate parser/source/analysis data');
    });
}

test('Original retains leading whitespace and trailing blank lines while Stack remains readable', () => {
    const original = '  "worker" #7\n    at example.Worker.run(Worker.java:7)\n\n';
    const model = buildThreadDetailsViewModel({ threadName: 'worker', rawBlock: original.split('\n') });
    assert.equal(model.rawText, original);
    assert.equal(model.stackText, original.trim());
    const markup = renderThreadStackMarkup(model.rawText, 'Worker', { decorate: false });
    assert.equal(markup.matchCount, 3);
    assert.doesNotMatch(markup.html, /is-header|is-frame|is-other|is-jvm/);
});

test('minified untrusted JSON retains its source and exact large ID without fabricating unavailable state', () => {
    const name = ' <img src=x onerror=alert(1)> "worker" ';
    const source = JSON.stringify({ threadDump: { threadContainers: [{ threads: [{
        tid: '9007199254740993', name, stack: ['example.<script>alert(1)</script>.run(Unknown Source)'],
    }] }] } });
    const [thread] = parseThreadDump(source);
    const model = buildThreadDetailsViewModel(thread);
    assert.equal(model.rawText, source);
    assert.ok(model.stackText.startsWith(`${JSON.stringify(name)} #9007199254740993`));
    assert.doesNotMatch(model.stackText, /java.lang.Thread.State:|1970-01-01|cpu=/);
    for (const text of [model.stackText, model.rawText]) {
        const markup = renderThreadStackMarkup(text, '<script>');
        assert.equal(markup.matchCount, 1);
        assert.doesNotMatch(markup.html, /<script>|<img/);
        assert.match(markup.html, /&lt;script&gt;/);
    }
});

test('missing original evidence does not offer a fabricated raw block for copying', () => {
    const model = buildThreadDetailsViewModel({ threadName: 'fallback-only' });
    assert.equal(model.hasOriginal, false);
    assert.equal(model.rawText, '');
    assert.equal(model.stackText, '"fallback-only"');
});

test('buildThreadDetailsViewModel exposes parsed waiting and held monitor evidence', () => {
    const [thread] = parseThreadDump([
        '"ONS-task-thread-139" #139 [145] daemon prio=5 os_prio=0 cpu=7.71ms elapsed=21254.41s allocated=250K defined_classes=0 tid=0x00007fe1c29c31f0 nid=145 waiting for monitor entry  [0x00007fe1b5cba000]',
        '   java.lang.Thread.State: BLOCKED (on object monitor)',
        '\tat oracle.ons.NotificationNetwork.onNodeDown(Unknown Source)',
        '\t- waiting to lock <0x000004000531d120> (a oracle.ons.NotificationNetwork)',
        '\tat oracle.ons.Node.onNodeDown(Unknown Source)',
        '\t- locked <0x0000040003f256f8> (a oracle.ons.Node)',
        '\tat oracle.ons.NotificationManager$MaintenanceTask.run(Unknown Source)',
        '\t- locked <0x0000040005319ee0> (a java.util.concurrent.ConcurrentHashMap)',
        '',
        '   Locked ownable synchronizers:',
        '\t- None',
    ].join('\n'));

    const model = buildThreadDetailsViewModel(thread);

    assert.equal(model.hasLocks, true);
    assert.equal(model.summaryMeta.find((item) => item.label === 'Locks held').value, '2');
    assert.deepEqual(model.lockEvidence.waitingLocks, [{
        lockId: '0x000004000531d120',
        lockType: 'a oracle.ons.NotificationNetwork',
        kind: 'monitor-enter',
    }]);
    assert.deepEqual(model.lockEvidence.heldLocks, [
        {
            lockId: '0x0000040003f256f8',
            lockType: 'a oracle.ons.Node',
            kind: 'monitor',
        },
        {
            lockId: '0x0000040005319ee0',
            lockType: 'a java.util.concurrent.ConcurrentHashMap',
            kind: 'monitor',
        },
    ]);
});

test('buildThreadDetailsViewModel exposes class-initialization relationships without cyclic graph data', () => {
    const initializer = { threadName: 'initializer' };
    const thread = {
        threadName: 'class-waiter',
        javaState: 'RUNNABLE',
        classInitializationChains: [{
            role: 'waiter',
            chain: {
                className: 'example.Metadata',
                status: 'stall-candidate',
                waiterCount: 4,
                initializer,
                initializerState: 'WAITING',
                initializerWaitingResources: [{
                    lockId: '0xabc',
                    lockType: 'a example.Future',
                    kind: 'monitor-wait',
                }],
                qualification: 'Snapshot only.',
            },
        }],
    };

    const model = buildThreadDetailsViewModel(thread);

    assert.equal(model.hasClassInitialization, true);
    assert.deepEqual(model.classInitialization[0], {
        role: 'waiter',
        className: 'example.Metadata',
        status: 'stall-candidate',
        waiterCount: 4,
        initializerThreadName: 'initializer',
        initializerState: 'WAITING',
        initializerWaitingResources: [{
            lockId: '0xabc',
            lockType: 'a example.Future',
            kind: 'monitor-wait',
        }],
        qualification: 'Snapshot only.',
    });
    assert.equal(model.summaryMeta.find((item) => item.label === 'Class init').value, 'waiter');
});

test('buildThreadDetailsViewModel keeps class-initialization resources identified only by type', () => {
    const thread = {
        threadName: 'initializer',
        classInitializationChains: [{
            role: 'initializer',
            chain: {
                className: 'pkg.A',
                initializerWaitingResources: [
                    {
                        lockId: null,
                        lockType: 'Class initialization monitor for pkg.B',
                        kind: 'class-initialization-wait',
                    },
                    { lockId: null, lockType: null, kind: 'unknown' },
                ],
            },
        }],
    };

    const model = buildThreadDetailsViewModel(thread);

    assert.deepEqual(model.classInitialization[0].initializerWaitingResources, [{
        lockId: '',
        lockType: 'Class initialization monitor for pkg.B',
        kind: 'class-initialization-wait',
    }]);
});

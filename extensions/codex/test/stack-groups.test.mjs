import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupStacks, selectionTitle } from '../ui/stack-groups.mjs';

const thread = (name, lock = '0x1') => ({ name, sourceKey: name, state: 'RUNNABLE', nextLine: null,
    context: { range: { startLine: 10, endLine: 13 } }, lines: [
        { line: 10, text: `"${name}" tid=0x1 nid=1 runnable` },
        { line: 11, text: ' at sun.nio.ch.EPoll.wait(Native Method)' },
        { line: 12, text: ` - locked <${lock}> (a java.lang.Object)` },
        { line: 13, text: ' at sample.Selector.run(Selector.java:10)' },
    ] });

test('equal complete frames group without merging identities, locks or source lines', () => {
    const a = thread('client1'), b = thread('client2', '0x2'), c = thread('worker');
    c.lines[3].text = ' at sample.Worker.run(Worker.java:10)';
    const before = JSON.stringify([a, b, c]), groups = groupStacks([a, b, c]);
    assert.deepEqual(groups.map(g => g.threads.map(t => t.name)), [['client1', 'client2'], ['worker']]);
    assert.equal(groups[0].frames.length, 2);
    assert.equal(groups[0].threads[0], a); assert.equal(groups[0].threads[1], b);
    assert.match(b.lines[2].text, /0x2/); assert.equal(JSON.stringify([a, b, c]), before);
});

test('partial, missing, discontinuous and differently stated stacks are not declared equal', () => {
    const a = thread('complete'), partial = thread('partial'), gap = thread('gap'), other = thread('other');
    partial.nextLine = 14; gap.lines[1].line = 99; other.state = 'WAITING';
    const empty = { ...thread('empty'), lines: [] }, empty2 = { ...empty, name: 'empty2', sourceKey: 'empty2' };
    assert.equal(groupStacks([a, partial, gap, other, empty, empty2]).length, 6);
    const unknown1 = { ...a, state: null }, unknown2 = { ...thread('unknown2'), state: null };
    assert.equal(groupStacks([unknown1, unknown2]).length, 2);
});

test('selection headings use actual names and snapshot numbers without inventing an HTTP relationship', () => {
    assert.equal(selectionTitle({ threads: [thread('main')], snapshotNumber: 3 }, 'en'), 'main · Snapshot 3');
    const http = ['HttpClient-1-SelectorManager', 'HttpClient-4-Worker-0'].map(n => thread(n));
    assert.equal(selectionTitle({ threads: http, snapshotNumber: 1 }, 'sv'), 'HTTP-klienttrådar · Snapshot 1');
    assert.equal(selectionTitle({ threads: [...http, thread('main')], snapshotNumber: 2 }, 'en'), '3 threads · Snapshot 2');
});

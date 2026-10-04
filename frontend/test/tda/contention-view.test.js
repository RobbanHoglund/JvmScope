import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfirmedContentionDeadlock, renderContentionTable } from '../../assets/javautils/tda/contention-view.js';

const thread = index => ({ sourceKey: `thread-${index}`, threadName: `worker-${index}` });

test('contention preview keeps every waiter reachable without duplicate buttons', () => {
    const html = renderContentionTable([{ lockId: '0x123', owners: [thread(0)], waiters: Array.from({ length: 12 }, (_, i) => thread(i + 1)) }]);
    assert.match(html, /Show all 12/);
    const [preview, expanded] = html.split('<details class="contention-waiters-more">');
    for (let i = 1; i <= 3; i++) assert.match(preview, new RegExp(`data-source-key="thread-${i}"`));
    for (let i = 4; i <= 12; i++) assert.match(expanded, new RegExp(`data-source-key="thread-${i}"`));
    assert.equal((html.match(/data-source-key=/g) || []).length, 13);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
});

test('rows are ordered by waiting count without mutating the source collection', () => {
    const chains = [
        { lockId: '0x11', waiters: [thread(1)] },
        { lockId: '0x22', waiters: [thread(2), thread(3)] },
    ];
    const html = renderContentionTable(chains);
    assert.ok(html.indexOf('data-lock-id="0x22"') < html.indexOf('data-lock-id="0x11"'));
    assert.equal(chains[0].lockId, '0x11');
    assert.doesNotMatch(html, /Show all/);
});

test('only a lock explicitly present in a reported cycle gets a deadlock marker', () => {
    const cycles = [{ threads: [{ waitingLockId: '0xABC' }] }];
    assert.equal(isConfirmedContentionDeadlock({ lockId: '0xabc' }, cycles), true);
    assert.equal(isConfirmedContentionDeadlock({ lockId: '0xdef', owners: [{ isDeadlocked: true }] }, cycles), false);
    assert.equal(isConfirmedContentionDeadlock({ lockId: '' }, [{ threads: [{}] }]), false);
    const html = renderContentionTable([{ lockId: '0xABC' }, { lockId: '0xDEF' }], cycles);
    assert.equal((html.match(/💀 Deadlock/g) || []).length, 1);
});

test('full addresses and types survive abbreviation and untrusted names are escaped', () => {
    const lockId = '0x0000000000012345';
    const html = renderContentionTable([{ lockId, lockType: 'a example.LongClass$Nested',
        owners: [{ sourceKey: 'a"b', threadName: '<script>bad()</script>' }], waiters: [] }]);
    assert.match(html, /0x…00012345/);
    assert.match(html, new RegExp(`data-copy-lock="${lockId}"`));
    assert.match(html, /a example.LongClass\$Nested/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /data-source-key="a&quot;b"/);
    assert.doesNotMatch(html, /<script>/);
});

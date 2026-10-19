const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CaptureDropController } = require('../src/capture-drop.cjs');
const { validateRequest, MAX_BYTES } = require('../src/protocol.cjs');
const token = () => ({ isCancellationRequested: false });
const uri = value => ({ path: new URL(value).pathname, toString: () => value,
    with: ({ fragment }) => uri(value.split('#')[0] + (fragment ? '#' + fragment : '')) });
function host() {
    const calls = [], errors = [];
    const vscode = { Uri: { parse: uri }, window: { showErrorMessage: value => { errors.push(value); return new Promise(() => {}); },
        showQuickPick: async items => items[2] } };
    const drop = new CaptureDropController(vscode, async (...args) => { calls.push(args); return { loaded: true }; });
    return { drop, calls, errors, vscode };
}
const transfer = value => new Map([['text/uri-list', { asString: async () => value }]]);

test('Explorer drops route to all three analyzers, preserving URI order and removing selection fragments', async () => {
    for (const analyzer of ['tda', 'tls', 'gc']) {
        const h = host();
        await h.drop.handleDrop({ analyzer }, transfer('# VS Code selection\r\nfile:///tmp/Java%20log.txt#L3,5\r\nfile:///tmp/Java%20log.txt'), token());
        assert.equal(h.calls.length, 1);
        assert.equal(h.calls[0][0], analyzer);
        assert.deepEqual(h.calls[0][1].uris.map(String), ['file:///tmp/Java%20log.txt']);
        assert.deepEqual(h.errors, []);
    }
    const h = host();
    await h.drop.handleDrop({ analyzer: 'tda' }, transfer('vscode-remote://ssh-remote+server/home/b.txt\r\nfile:///C:/a.txt'), token());
    assert.deepEqual(h.calls[0][1].uris.map(String), ['vscode-remote://ssh-remote+server/home/b.txt', 'file:///C:/a.txt']);
});

test('native file drops read bytes exactly once and prompt for an analyzer on empty sidebar space', async () => {
    const h = host(); let reads = 0;
    const data = new Map([['files', { asFile: () => ({ name: 'capture.log', data: async () => { reads++; return Buffer.from('JVM ✓'); } }) }],
        ['text/uri-list', { asString: () => assert.fail('Do not read a client file URI on the remote extension host') }]]);
    await h.drop.handleDrop(undefined, data, token());
    assert.equal(reads, 1);
    assert.deepEqual(h.calls[0].slice(0, 2), ['gc', { sources: [{ name: 'capture.log', text: 'JVM ✓' }] }]);
    assert.deepEqual(h.errors, []);
});

test('invalid native drops fail atomically without hanging on the error notification', async () => {
    for (const [files, pattern] of [
        [[], /between 1 and 50/],
        [[{ name: 'large', data: async () => ({ byteLength: MAX_BYTES + 1 }) }], /64 MiB/],
        [[{ name: 'binary', data: async () => Uint8Array.of(0xc3, 0x28) }], /encoded data|encoding/],
    ]) {
        const h = host();
        await h.drop.handleDrop({ analyzer: 'gc' }, new Map(files.map((file, i) => [String(i), { asFile: () => file }])), token());
        assert.equal(h.calls.length, 0); assert.match(h.errors[0], pattern);
    }
    const h = host();
    await h.drop.handleDrop({ id: 'knowledge' }, transfer('file:///tmp/a.log'), token());
    assert.equal(h.calls.length, 0); assert.match(h.errors[0], /onto Thread dumps/);
    for (const analyzer of ['tls', 'gc']) {
        const h = host();
        const item = { asFile: () => ({ name: 'a', data: () => assert.fail('Reject multiple logs before reading') }) };
        await h.drop.handleDrop({ analyzer }, new Map([['a', item], ['b', item]]), token());
        assert.equal(h.calls.length, 0); assert.match(h.errors[0], /one .* log/);
    }
});

test('cancellation before and during a file read never imports or notifies', async () => {
    const h = host(), cancelled = token(); cancelled.isCancellationRequested = true;
    await h.drop.handleDrop({ analyzer: 'tda' }, transfer('file:///tmp/a.txt'), cancelled);
    const pending = token();
    await h.drop.handleDrop({ analyzer: 'tda' }, new Map([['files', { asFile: () => ({ name: 'a', data: async () => {
        pending.isCancellationRequested = true; return Buffer.from('capture');
    } }) }]]), pending);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.errors, []);
});

test('webview drop requests accept only bounded file URIs, never commands, URLs or malformed input', () => {
    const message = uris => ({ channel: 'jvmscope', version: 1, type: 'request', id: 'web:1', action: 'readDroppedFiles', uris });
    for (const value of ['file:///C:/Users/Java%20dump.txt', 'vscode-remote://ssh-remote+test/home/gc.log#L1', 'untitled:Untitled-1']) {
        assert.deepEqual(validateRequest(message([value])).uris, [value]);
    }
    for (const uris of [null, [], Array(51).fill('file:///a'), [12], ['https://example.com/a.log'], ['command:run'],
        ['javascript:alert(1)'], ['../a.log'], ['file:relative'], ['file:///a?query'], ['file:///a\nb'], ['file:///a%ZZ'], ['file:///' + 'a'.repeat(8192)]]) {
        assert.throws(() => validateRequest(message(uris)));
    }
});

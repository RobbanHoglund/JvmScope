const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_BYTES, validateRequest, readSources } = require('../src/protocol.cjs');
const uri = name => ({ path: '/' + name, toString: () => 'testfs:/' + name });
const request = (action, fields = {}) => ({ channel: 'jvmscope', version: 1, type: 'request', id: 'web:1', action, ...fields });

test('knowledge navigation accepts the full encoded search field while remaining bounded', () => {
    const route = '/knowledge/thread-dumps.html?java=21#find=' + encodeURIComponent('界'.repeat(512)) + '&section=check';
    assert.equal(validateRequest(request('navigate', { route })).route, route);
    assert.throws(() => validateRequest(request('navigate', { route: '/' + 'a'.repeat(8192) })), /Invalid page/);
});

test('native requests reject command execution, paths and executable exports', () => {
    for (const message of [request('executeCommand'), request('save', { name: '../secret.txt', base64: 'YQ==' }),
        request('save', { name: 'launch.js', base64: 'YQ==' }), request('external', { url: 'command:workbench.action.terminal.new' }),
        request('external', { url: 'file:///private/capture.log' }), { ...request('paste'), channel: 'other' },
        { ...request('paste'), version: 2 }, request('save', { name: 'report.html', base64: '@@@=' })]) {
        assert.throws(() => validateRequest(message));
    }
    assert.equal(validateRequest(request('save', { name: 'jvmscope-findings.md', base64: 'YQ==' })).action, 'save');
    assert.equal(validateRequest(request('external', { url: 'https://docs.oracle.com/en/java/' })).action, 'external');
});

test('selected dirty and untitled editors use their in-memory text, never stale disk data', async () => {
    const capture = uri('unsaved.txt'); let reads = 0;
    const vscode = { FileType: { Directory: 2 }, workspace: { textDocuments: [{ uri: capture, getText: () => 'current buffer ✓' }],
        fs: { stat: async () => { reads++; throw new Error('Must not read disk'); } } } };
    assert.deepEqual(await readSources(vscode, [capture], 'tda'), [{ name: 'unsaved.txt', text: 'current buffer ✓' }]);
    assert.equal(reads, 0);
});

test('virtual filesystem inputs preserve selection order and reject binary or oversized sources', async () => {
    const values = { 'a.txt': 'first', 'b.txt': 'second' }; let reads = 0;
    const vscode = { FileType: { Directory: 2 }, workspace: { textDocuments: [], fs: {
        stat: async () => ({ type: 1, size: 6 }),
        readFile: async value => { reads++; return Buffer.from(values[value.path.slice(1)]); },
    } } };
    assert.deepEqual((await readSources(vscode, [uri('b.txt'), uri('a.txt')], 'tda')).map(source => source.text), ['second', 'first']);
    await assert.rejects(readSources(vscode, [uri('a.txt'), uri('b.txt')], 'tls'), /one TLS log/);
    vscode.workspace.fs.stat = async () => ({ type: 1, size: MAX_BYTES + 1 });
    await assert.rejects(readSources(vscode, [uri('a.txt')], 'tda'), /64 MiB/); assert.equal(reads, 2);
    vscode.workspace.fs.stat = async () => ({ type: 2, size: 0 });
    await assert.rejects(readSources(vscode, [uri('a.txt')], 'tda'), /not folders/);
    vscode.workspace.fs.stat = async () => ({ type: 1, size: 2 });
    vscode.workspace.fs.readFile = async () => Uint8Array.from([0xc3, 0x28]);
    await assert.rejects(readSources(vscode, [uri('binary.txt')], 'tda'), /encoded data|encoding/);
});

test('a file growing after stat is checked again, and input errors do not yield partial imports', async () => {
    let reads = 0;
    const vscode = { FileType: { Directory: 2 }, workspace: { textDocuments: [], fs: {
        stat: async () => ({ type: 1, size: 1 }), readFile: async () => { reads++; return { byteLength: MAX_BYTES + 1 }; },
    } } };
    await assert.rejects(readSources(vscode, [uri('growing.txt')], 'tda'), /64 MiB/); assert.equal(reads, 1);
    await assert.rejects(readSources(vscode, [], 'tda'), /between 1 and 50/);
});

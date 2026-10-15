const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SourceRegistry } = require('../src/source-navigation.cjs');
const { readSources, validateRequest } = require('../src/protocol.cjs');
function environment(text = 'first\nsecond\nthird') {
    const uri = { toString: () => 'testfs:/capture.txt', path: '/capture.txt' };
    const document = { uri, version: 1, getText: () => text, lineAt: i => ({ text: text.split(/\r\n?|\n/)[i] }) };
    const editor = { revealRange: range => { editor.revealed = range; } };
    const opened = [];
    const vscode = { workspace: { textDocuments: [document], openTextDocument: async requested => { opened.push(requested); return document; } },
        window: { showTextDocument: async () => editor }, ViewColumn: { Beside: 2 }, TextEditorRevealType: { InCenterIfOutsideViewport: 1 },
        Range: class { constructor(a,b,c,d) { this.start={line:a,character:b};this.end={line:c,character:d}; } },
        Selection: class { constructor(start,end) { this.start=start;this.end=end; } } };
    return { vscode, document, editor, opened, uri, change: value => { text=value;document.version++; } };
}
test('source navigation selects the physical range in the originally imported URI', async () => {
    const env=environment();const registry=new SourceRegistry(env.vscode);
    const [source]=await readSources(env.vscode,[env.uri],'tda',registry.register.bind(registry));
    registry.activate([source.hostSourceId]);
    await registry.open({sourceId:source.hostSourceId,startLine:2,endLine:3});
    assert.deepEqual(env.opened,[env.uri]);
    assert.deepEqual(env.editor.selection.start,{line:1,character:0});
    assert.deepEqual(env.editor.selection.end,{line:2,character:5});
    assert.deepEqual(env.editor.revealed.start,env.editor.selection.start);
});
test('stale capture contents and edits during editor opening never select a misleading range', async () => {
    const env=environment();const registry=new SourceRegistry(env.vscode);
    const id=registry.register(env.uri,env.document.getText(),1);registry.activate([id]);
    env.change('inserted\nfirst\nsecond\nthird');
    await assert.rejects(registry.open({sourceId:id,startLine:2,endLine:2}),/changed since analysis/);
    assert.equal(env.editor.selection,undefined);
    env.change('first\nsecond\nthird');
    env.vscode.window.showTextDocument=async()=>{env.change('changed while opening');return env.editor;};
    await assert.rejects(registry.open({sourceId:id,startLine:2,endLine:2}),/changed since analysis/);
    assert.equal(env.editor.selection,undefined);
});
test('source capabilities cannot cross panels, outlive replacement or navigate arbitrary line ranges', async () => {
    const env=environment();const registry=new SourceRegistry(env.vscode), other=new SourceRegistry(env.vscode);
    const old=registry.register(env.uri,env.document.getText());registry.activate([old]);
    const pending=registry.register(env.uri,env.document.getText());
    registry.activate([old]); // an earlier queued import must not retire pending sources
    for(const location of [{sourceId:old,startLine:0,endLine:1},{sourceId:old,startLine:1,endLine:4},{sourceId:pending,startLine:1,endLine:1}]) await assert.rejects(registry.open(location));
    await assert.rejects(other.open({sourceId:old,startLine:1,endLine:1}));
    assert.equal(env.opened.length,0);
    registry.activate([pending]);
    await assert.rejects(registry.open({sourceId:old,startLine:1,endLine:1}));
    registry.activate([]);
    await assert.rejects(registry.open({sourceId:pending,startLine:1,endLine:1}));
    registry.dispose();assert.throws(()=>registry.register(env.uri,'text'),/closed/);
});
test('CRLF/BOM normalization preserves physical source coordinates and untouched dirty editors', async () => {
    const env=environment('first\nsecond\nthird');const registry=new SourceRegistry(env.vscode);
    const id=registry.register(env.uri,'\uFEFFfirst\r\nsecond\r\nthird',1);registry.activate([id]);
    await registry.open({sourceId:id,startLine:2,endLine:2});assert.equal(env.editor.selection.start.line,1);
});
test('source protocol only accepts opaque IDs and ordered positive line numbers', () => {
    const base={channel:'jvmscope',version:1,type:'request',id:'web:7',action:'openSource',sourceId:'00000000-0000-0000-0000-000000000001',startLine:1,endLine:2};
    assert.equal(validateRequest(base),base);
    for(const patch of [{sourceId:'file:///private.log'},{startLine:1.5},{startLine:0},{endLine:0},{endLine:Infinity}]) assert.throws(()=>validateRequest({...base,...patch}));
    assert.throws(()=>validateRequest({...base,action:'syncSources',sourceIds:['command:execute']}));
});

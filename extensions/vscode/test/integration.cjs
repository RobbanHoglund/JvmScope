const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const { SourceRegistry } = require('../src/source-navigation.cjs');
const root = path.resolve(__dirname, '../../..');
const fixture = relative => vscode.Uri.file(path.join(root, relative));
exports.run = async () => {
    const extension = vscode.extensions.getExtension('RobbanHoglund.jvmscope');
    assert.ok(extension, 'Extension is installed in the real extension host');
    await extension.activate();
    const tda = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump',
        fixture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt'));
    assert.ok(tda?.snapshots === 1 && tda.threads > 0, JSON.stringify(tda));
    const tls = await vscode.commands.executeCommand('jvmscope.analyzeTlsLog',
        fixture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt'));
    assert.ok(tls?.interactions > 0, JSON.stringify(tls));
    const pair = ['allocation-before.txt', 'allocation-after.txt'].map(name => fixture('frontend/test/tda/fixtures/ga-regressions/' + name));
    const series = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump', pair[0], pair);
    assert.equal(series?.snapshots, 2, JSON.stringify(series));
    const content = await vscode.workspace.fs.readFile(pair[0]);
    const document = await vscode.workspace.openTextDocument({ content: Buffer.from(content).toString('utf8'), language: 'plaintext' });
    await vscode.window.showTextDocument(document);
    const unsaved = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump');
    assert.equal(unsaved?.snapshots, 1, JSON.stringify(unsaved));
    await vscode.window.showTextDocument(document);
    const sources = new SourceRegistry(vscode);
    const sourceId = sources.register(document.uri, document.getText(), document.version);
    sources.activate([sourceId]);
    await sources.open({sourceId, startLine: 2, endLine: 3});
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), document.uri.toString());
    assert.equal(vscode.window.activeTextEditor.selection.start.line, 1);
    assert.equal(vscode.window.activeTextEditor.selection.end.line, 2);
    await vscode.window.activeTextEditor.edit(edit => edit.insert(new vscode.Position(0, 0), 'changed after analysis\n'));
    await assert.rejects(sources.open({sourceId, startLine: 2, endLine: 3}), /changed since analysis/);
    sources.dispose();
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    console.log('PASS: real VS Code extension activation, both webviews/workers, multiple snapshots, unsaved input, source selection and stale-source rejection.');
};

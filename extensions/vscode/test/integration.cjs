const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const fixture = relative => vscode.Uri.file(path.join(root, relative));
exports.run = async () => {
    const extension = vscode.extensions.getExtension('RobbanHoglund.jvmscope');
    assert.ok(extension, 'Extension is installed in the real extension host');
    if (process.env.JVMSCOPE_TEST_INSTALL_ROOT) {
        const relative = path.relative(process.env.JVMSCOPE_TEST_INSTALL_ROOT, extension.extensionPath);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'JvmScope must run from the installed VSIX, not the source folder');
        assert.equal(extension.packageJSON.version, process.env.JVMSCOPE_TEST_VERSION);
    }
    const { SourceRegistry } = require(path.join(extension.extensionPath, 'src/source-navigation.cjs'));
    // Exercise the contributed view's focus command and editor toolbar commands
    // without explicitly activating the extension, as a user opening the view would.
    await vscode.commands.executeCommand('jvmscope.analysis.focus');
    const editorDocument = await vscode.workspace.openTextDocument(
        fixture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt'));
    for (const [command, title] of [
        ['jvmscope.openTda', 'JvmScope · Thread dumps'],
        ['jvmscope.openTls', 'JvmScope · TLS logs'],
        ['jvmscope.openKnowledge', 'JvmScope · Knowledge'],
    ]) {
        await vscode.window.showTextDocument(editorDocument);
        // editor/title supplies the current resource URI. Opening a tool must
        // remain a launcher, even when that editor contains the other log format.
        const result = await vscode.commands.executeCommand(command, editorDocument.uri);
        assert.ok(!result?.error, JSON.stringify(result));
        assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, title,
            'The native navigation command opens and focuses the requested view');
    }
    assert.ok(extension.isActive, 'Opening the view and its tools activates JvmScope');
    const api = extension.exports;
    await vscode.commands.executeCommand('jvmscope.openAnalysis');
    assert.deepEqual(await api.getAnalysisItems('tda'), []);
    assert.deepEqual(await api.getAnalysisItems('tls'), []);
    const tda = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump',
        fixture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt'));
    assert.ok(tda?.snapshots === 1 && tda.threads > 0, JSON.stringify(tda));
    const tls = await vscode.commands.executeCommand('jvmscope.analyzeTlsLog',
        fixture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt'));
    assert.ok(tls?.interactions > 0, JSON.stringify(tls));
    // Knowledge opens independently of the retained analyzer sessions. Both
    // loaded trees must still navigate back to their exact threads and events.
    const knowledge = await vscode.commands.executeCommand('jvmscope.openKnowledge');
    assert.ok(!knowledge?.error, JSON.stringify(knowledge));
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'JvmScope · Knowledge');
    const [tdaFile] = await api.getAnalysisItems('tda');
    const [snapshot] = await api.getAnalysisItems('tda', tdaFile.id);
    const threads = await api.getAnalysisItems('tda', snapshot.id);
    assert.ok(threads.some(item => item.kind === 'thread'));
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem', threads[0].id), true);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'JvmScope · Thread dumps');
    const [tlsFile] = await api.getAnalysisItems('tls');
    const [interaction] = await api.getAnalysisItems('tls', tlsFile.id);
    const events = await api.getAnalysisItems('tls', interaction.id);
    assert.ok(events.some(item => item.kind === 'event'));
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem', events[0].id), true);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'JvmScope · TLS logs');
    const pair = ['allocation-before.txt', 'allocation-after.txt'].map(name => fixture('frontend/test/tda/fixtures/ga-regressions/' + name));
    const series = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump', pair[0], pair);
    assert.equal(series?.snapshots, 2, JSON.stringify(series));
    await assert.rejects(api.getAnalysisItems('tda', tdaFile.id), /analysis changed/);
    const files = await api.getAnalysisItems('tda');
    assert.equal(files.length, 2);
    const [secondSnapshot] = await api.getAnalysisItems('tda', files[1].id);
    const secondThreads = await api.getAnalysisItems('tda', secondSnapshot.id);
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem', secondThreads[0].id), true);
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
    console.log('PASS: real VS Code view/menu activation, knowledge base, both webviews/workers, multiple snapshots, unsaved input, source selection, stale-source rejection and native sidebar navigation across retained webviews.');
};

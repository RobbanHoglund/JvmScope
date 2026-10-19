const vscode = require('vscode');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const fixture = relative => vscode.Uri.file(path.join(root, relative));
// WebviewPanel.reveal() returns void; the workbench reports activation later.
// Wait for the real tab event, including retained panels whose ready promise
// has already resolved, instead of assuming a command return updates the UI.
async function expectActiveTab(label) {
    const tabs = vscode.window.tabGroups;
    const matches = () => tabs.activeTabGroup.activeTab?.label === label;
    if (!matches()) await new Promise((resolve, reject) => {
        const listeners = [];
        const finish = error => {
            clearTimeout(timer);
            for (const listener of listeners) listener.dispose();
            if (error) reject(error); else resolve();
        };
        const check = () => { if (matches()) finish(); };
        const timer = setTimeout(() => finish(new Error(`Expected active tab ${label}; got ${tabs.activeTabGroup.activeTab?.label}`)), 5000);
        listeners.push(tabs.onDidChangeTabs(check), tabs.onDidChangeTabGroups(check));
        check();
    });
    assert.equal(tabs.activeTabGroup.activeTab?.label, label, 'The requested view is active');
}
exports.run = async () => {
    const extension = vscode.extensions.getExtension('RobbanHoglund.jvmscope');
    assert.ok(extension, 'Extension is installed in the real extension host');
    if (process.env.JVMSCOPE_TEST_INSTALL_ROOT) {
        const relative = path.relative(process.env.JVMSCOPE_TEST_INSTALL_ROOT, extension.extensionPath);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'JvmScope must run from the installed VSIX, not the source folder');
        assert.equal(extension.packageJSON.version, process.env.JVMSCOPE_TEST_VERSION);
    }
    const { SourceRegistry } = require(path.join(extension.extensionPath, 'src/source-navigation.cjs'));
    const { AiAnalysis } = require(path.join(extension.extensionPath, 'src/ai-analysis.cjs'));
    const { AiResults } = require(path.join(extension.extensionPath, 'src/ai-result.cjs'));
    // Discovery is read-only even in the real host; CI never requires an AI
    // account, submits a prompt or consumes a provider's quota.
    const ai = new AiAnalysis(vscode);
    assert.ok(ai.providers().every(provider => ['copilot', 'codex', 'claude'].includes(provider.id)));
    assert.equal(ai.running, false);
    ai.dispose();
    // Exercise the actual native progress, notification promises, cancellation
    // tokens and response editor, with only the provider/picker boundary stubbed.
    // No installed assistant, AI account or inference is needed by this test.
    const states = []; let notificationDismissed = false;
    const model = { name: 'Integration fixture', vendor: 'copilot', id: 'fixture', maxInputTokens: 1000,
        countTokens: async () => 10,
        sendRequest: async () => ({ text: (async function* () { yield 'Native host AI lifecycle fixture.'; })() }),
    };
    const internalModel = { ...model, id: 'copilot-dictation-cleanup-luna',
        countTokens: async () => { assert.fail('Do not pass evidence to internal Copilot aliases'); },
        sendRequest: async () => { assert.fail('Do not request internal Copilot aliases'); },
    };
    const boundary = {
        // Do not spread API namespaces: enumerating window also evaluates
        // proposal-gated getters such as nativeHandle in real VS Code.
        CancellationTokenSource: vscode.CancellationTokenSource,
        ProgressLocation: vscode.ProgressLocation, ViewColumn: vscode.ViewColumn,
        LanguageModelChatMessage: vscode.LanguageModelChatMessage,
        workspace: vscode.workspace, extensions: { getExtension: () => ({}) },
        lm: { selectChatModels: async () => { throw new Error('Fixture access denied'); } },
        window: {
            withProgress: (...args) => vscode.window.withProgress(...args),
            showTextDocument: (...args) => vscode.window.showTextDocument(...args),
            showQuickPick: async items => {
                assert.deepEqual(items.map(item => item.model.id), [model.id], 'Only the public model is offered');
                return items[0];
            },
            showErrorMessage: message => {
                const pending = vscode.window.showErrorMessage(message);
                pending.then(() => { notificationDismissed = true; }); return pending;
            },
        },
    };
    const nativeResults = new AiResults(vscode, extension.extensionUri);
    const nativeAi = new AiAnalysis(boundary, { showResult: (result, token) => nativeResults.show(result, token) });
    const completed = async (phase, expectedState, timeoutMs = 5000) => {
        let timer;
        try {
            const result = await Promise.race([nativeAi.job, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Native AI ${phase} did not settle within ${timeoutMs} ms; last state: ${JSON.stringify(states.at(-1))}`)), timeoutMs);
            })]);
            assert.equal(result.state, expectedState, `Native AI ${phase}: ${result.message}`);
        }
        finally { clearTimeout(timer); }
    };
    try {
        await nativeAi.run('copilot', 'Synthetic evidence', { owner: 'test', onState: state => states.push(state) });
        await completed('provider error', 'error');
        assert.equal(nativeAi.running, false);
        assert.equal(states.at(-1).state, 'error');
        assert.equal(notificationDismissed, false, 'Job finishes while the real VS Code error notification is still open');
        boundary.lm.selectChatModels = async () => [internalModel, model];
        await nativeAi.run('copilot', 'Synthetic retry evidence', { onState: state => states.push(state) });
        // AiResults allows 15 seconds for a cold webview to acknowledge rendering.
        // Let that production deadline report failure before this test's watchdog;
        // provider errors and cancellation retain their stricter five-second limit.
        await completed('report rendering', 'completed', 20000);
        await expectActiveTab('JvmScope · AI analysis');
        assert.equal(nativeResults.panels.size, 1, 'Formatted report acknowledged rendering in the installed webview');
        for (const panel of nativeResults.panels) panel.dispose();
        boundary.lm.selectChatModels = () => new Promise(() => {});
        const job = await nativeAi.run('copilot', 'Synthetic cancellation evidence', { owner: 'test', onState: state => states.push(state) });
        assert.equal(nativeAi.cancel('test', job.jobId), true); await completed('cancellation', 'cancelled');
        assert.equal(nativeAi.running, false);
    } finally { nativeAi.dispose(); nativeResults.dispose(); }
    console.log('PASS: native AI error notification remains open without locking retries; internal Copilot aliases are excluded; progress cancellation releases a non-cooperating provider; formatted response renders in an installed webview.');
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
        await expectActiveTab(title);
    }
    assert.ok(extension.isActive, 'Opening the view and its tools activates JvmScope');
    const api = extension.exports;
    await vscode.commands.executeCommand('jvmscope.openAnalysis');
    assert.deepEqual(await api.getAnalysisItems('tda'), []);
    assert.deepEqual(await api.getAnalysisItems('tls'), []);
    assert.deepEqual(await api.getAnalysisItems('gc'), []);
    const tda = await vscode.commands.executeCommand('jvmscope.analyzeThreadDump',
        fixture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt'));
    assert.ok(tda?.snapshots === 1 && tda.threads > 0, JSON.stringify(tda));
    const tls = await vscode.commands.executeCommand('jvmscope.analyzeTlsLog',
        fixture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt'));
    assert.ok(tls?.interactions > 0, JSON.stringify(tls));
    const gc=await vscode.commands.executeCommand('jvmscope.analyzeGcLog',fixture('testdata/gc-logs/java27-g1.log'));
    assert.ok(gc?.events>20&&gc.segments===1,JSON.stringify(gc));
    // Real DataTransfer/URI objects exercise the native drop boundary and the
    // installed extension's read -> webview -> parser -> acknowledgement path.
    // OS pointer gestures and workbench overlay routing are separate UI checks.
    const { CaptureDropController } = require(path.join(extension.extensionPath, 'src/capture-drop.cjs'));
    const dropper = new CaptureDropController(vscode, (kind, input) => vscode.commands.executeCommand({
        tda: 'jvmscope.analyzeThreadDump', tls: 'jvmscope.analyzeTlsLog', gc: 'jvmscope.analyzeGcLog',
    }[kind], input.uris[0], input.uris));
    for (const [analyzer, file, expected] of [
        ['tda', 'frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt', 'threads'],
        ['tls', 'frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt', 'interactions'],
        ['gc', 'testdata/gc-logs/java27-g1.log', 'events'],
    ]) {
        const transfer = new vscode.DataTransfer();
        transfer.set('text/uri-list', new vscode.DataTransferItem('# Explorer capture\r\n' + fixture(file).with({ fragment: 'L1,1' }).toString()));
        const cancellation = new vscode.CancellationTokenSource();
        try {
            const result = await dropper.handleDrop({ analyzer }, transfer, cancellation.token);
            assert.ok(result?.[expected] > 0, `${analyzer} native drop: ${JSON.stringify(result)}`);
        } finally { cancellation.dispose(); }
    }
    console.log('PASS: native URI drops analyze real thread, TLS and GC captures through installed webviews.');
    const gcEvents=await api.getAnalysisItems('gc');
    assert.ok(gcEvents.some(item=>item.kind==='event'));
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem',gcEvents[0].id),true);
    await expectActiveTab('JvmScope · Garbage collection');
    // Knowledge opens independently of the retained analyzer sessions. Both
    // loaded trees must still navigate back to their exact threads and events.
    const knowledge = await vscode.commands.executeCommand('jvmscope.openKnowledge');
    assert.ok(!knowledge?.error, JSON.stringify(knowledge));
    await expectActiveTab('JvmScope · Knowledge');
    const [tdaFile] = await api.getAnalysisItems('tda');
    const [snapshot] = await api.getAnalysisItems('tda', tdaFile.id);
    const threads = await api.getAnalysisItems('tda', snapshot.id);
    assert.ok(threads.some(item => item.kind === 'thread'));
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem', threads[0].id), true);
    await expectActiveTab('JvmScope · Thread dumps');
    const [tlsFile] = await api.getAnalysisItems('tls');
    const [interaction] = await api.getAnalysisItems('tls', tlsFile.id);
    const events = await api.getAnalysisItems('tls', interaction.id);
    assert.ok(events.some(item => item.kind === 'event'));
    assert.equal(await vscode.commands.executeCommand('jvmscope.revealAnalysisItem', events[0].id), true);
    await expectActiveTab('JvmScope · TLS logs');
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

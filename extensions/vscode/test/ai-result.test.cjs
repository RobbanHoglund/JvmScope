const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { AiResults } = require('../src/ai-result.cjs');
const { AiAnalysis } = require('../src/ai-analysis.cjs');
const { createResultHost } = require('./ai-result-host.cjs');
const { createAiHost } = require('./ai-host.cjs');
const root = path.resolve(__dirname, '..');
const fixture = { model: 'Fixture model', scope: 'Snapshot 1', body: '## Facts\n\n**Two** threads.', markdown: '# JvmScope AI analysis\n\nModel: Fixture model\n\n## Facts\n\n**Two** threads.' };
const tokenSource = () => new (createAiHost(AiAnalysis).vscode.CancellationTokenSource)();
test('Markdown formats prose, tables and code while treating executable HTML and embedded resources as text', async () => {
    const { renderAiMarkdown } = await import('../../../frontend/assets/javautils/ai-result-markdown.js');
    const html = renderAiMarkdown('## Observed facts\n\n**Two** threads with `BLOCKED` state.\n\n| Thread | State |\n| --- | --- |\n| worker | BLOCKED |\n\n```java\nif (a < b) wait();\n```\n\n<script>alert(1)</script>\n\n![tracker](https://tracker.example/pixel)\n\n[Run](command:workbench.action.openSettings) [File](file:///secret) [JS](javascript:alert%281%29) [Docs](https://docs.example/java)');
    assert.match(html, /<h2>Observed facts<\/h2>/);
    assert.match(html, /<strong>Two<\/strong>/); assert.match(html, /<table>/);
    assert.match(html, /if \(a &lt; b\) wait\(\);/);
    assert.ok(!/<(?:script|img|iframe)\b/i.test(html));
    assert.match(html, /&lt;script&gt;/);
    assert.equal((html.match(/data-report-link=/g) || []).length, 1);
    assert.match(html, /href="#" data-report-link="https:\/\/docs.example\/java"/);
});
async function showing(host, source = tokenSource()) {
    const promise = host.view.show(fixture, source.token);
    promise.catch(() => {});
    // Asset reads finish asynchronously; do not assume setImmediate covers IO.
    for (let i = 0; i < 50 && !host.panels.length; i++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(host.panels.length, 1);
    return { promise, panel: host.panels[0], source };
}
test('a result opens beside the analyzer and waits for rendering; actions use the original Markdown', async () => {
    const h = createResultHost(AiResults, root), { promise, panel } = await showing(h);
    try {
        assert.equal(panel.type, 'jvmscope.aiResult'); assert.equal(panel.viewColumn, h.vscode.ViewColumn.Beside);
        assert.equal(panel.options.localResourceRoots.length, 1);
        assert.ok(!panel.webview.html.includes(fixture.body), 'Response is not injected into HTML');
        await panel.receive({ type: 'ready' });
        assert.deepEqual(panel.posted[0].result, { model: fixture.model, scope: fixture.scope, body: fixture.body });
        await panel.receive({ type: 'rendered' }); await promise;
        for (const action of ['copy', 'save', 'source']) await panel.receive({ type: 'action', id: 1, action, markdown: 'forged replacement' });
        assert.deepEqual(h.calls.filter(c => ['copy', 'save', 'source'].includes(c[0])).map(c => c.at(-1)), [fixture.markdown, fixture.markdown, fixture.markdown]);
        await panel.receive({ type: 'ready' });
        assert.deepEqual(panel.posted.at(-1).result.body, fixture.body, 'Hidden webviews can rehydrate the same completed response');
        assert.equal(h.view.panels.size, 1);
    } finally { h.view.dispose(); }
    assert.equal(h.view.panels.size, 0);
});
test('result actions reject commands and local URLs; cancelled saves and failures remain recoverable', async () => {
    const h = createResultHost(AiResults, root), { promise, panel } = await showing(h);
    try {
        await panel.receive({ type: 'ready' }); await panel.receive({ type: 'rendered' }); await promise;
        for (const url of ['command:workbench.action.openSettings', 'file:///private.txt', 'javascript:alert(1)', 'data:text/html,x', '//external.test', 'https://name:password@external.test']) {
            await panel.receive({ type: 'action', id: 1, action: 'external', url });
            assert.match(panel.posted.at(-1).message, /Only HTTP or HTTPS/);
        }
        assert.equal(h.calls.length, 0);
        h.vscode.window.showSaveDialog = async () => undefined;
        await panel.receive({ type: 'action', id: 2, action: 'save' }); assert.match(panel.posted.at(-1).message, /cancelled/);
        h.vscode.env.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); };
        await panel.receive({ type: 'action', id: 3, action: 'copy' }); assert.match(panel.posted.at(-1).message, /Clipboard unavailable/);
        await panel.receive({ type: 'action', id: 4, action: 'external', url: 'https://docs.example.test/java' });
        assert.deepEqual(h.calls, [['external', 'https://docs.example.test/java']]);
    } finally { h.view.dispose(); }
});
test('cancellation prevents late report creation and closes a report still waiting to render', async () => {
    const h = createResultHost(AiResults, root), source = tokenSource();
    source.cancel();
    await assert.rejects(h.view.show(fixture, source.token), /cancelled/);
    assert.equal(h.panels.length, 0);
    const running = await showing(h); running.source.cancel();
    await assert.rejects(running.promise, /cancelled/);
    assert.equal(running.panel.closed, true); assert.equal(h.view.panels.size, 0);
    h.view.dispose();
});

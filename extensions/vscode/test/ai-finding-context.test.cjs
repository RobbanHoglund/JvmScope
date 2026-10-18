const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateFindingContext } = require('../src/ai-finding-context.cjs');
const { AiAnalysis } = require('../src/ai-analysis.cjs');
const { createAiHost } = require('./ai-host.cjs');
const fixture = () => ({scope: 'Snapshots #1, #2', edited: true, findings: [{severity: 'critical', title: 'Confirmed Java deadlock', detail: 'Two reported cycles per snapshot.', qualification: 'Application impact unknown.'}]});

test('display-only local findings remain immutable and never enter the exact reviewed model prompt', async () => {
    const host = createAiHost(AiAnalysis), context = fixture();
    const prompt = 'My edited prompt without capture names.';
    await host.ai.run('copilot', prompt, {findingContext: context});
    context.findings[0].title = 'Changed after submission';
    await host.ai.job;
    assert.equal(host.results[0].findingContext.findings[0].title, 'Confirmed Java deadlock');
    assert.equal(host.results[0].findingContext.edited, true);
    assert.ok(!host.results[0].markdown.includes('Two reported cycles'));
    const request = host.calls.find(c => c[0] === 'send');
    assert.equal(request[1][0].content, prompt);
    assert.ok(!JSON.stringify(request).includes('Two reported cycles'));
});

test('local findings protocol rejects oversized and malformed contexts', () => {
    validateFindingContext(undefined); validateFindingContext(fixture());
    for (const invalid of [{...fixture(), edited: 'yes'}, {...fixture(), scope: 'x'.repeat(501)}, {...fixture(), findings: Array(4).fill(fixture().findings[0])}, {...fixture(), findings: [{...fixture().findings[0], severity: 'success'}]}]) assert.throws(() => validateFindingContext(invalid), /Invalid local analyzer/);
});

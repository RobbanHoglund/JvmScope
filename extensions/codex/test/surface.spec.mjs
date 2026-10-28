import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); });
test.afterAll(async () => host?.close());
const widget = page => page.frameLocator('iframe');
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
async function sendResult(page, name) {
    await page.evaluate(async name => {
        const params = await (await fetch('/data?case=' + name)).json();
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params }, '*');
    }, name);
}

test('chat starts with one useful conclusion, context and an explicit action, without deep navigation or scrolling containers', async ({ page }) => {
    await mkdir(previews, { recursive: true });
    for (const [name, theme, width] of [['assessmentSv', 'dark', 735], ['noFindings', 'light', 390]]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(host.url + `?case=${name}&theme=${theme}`); const f = widget(page);
        await expect(f.locator('.ai-conclusion')).toHaveCount(1);
        await expect(f.locator('.ai-conclusion-next')).toBeVisible();
        await expect(f.locator('.compact-context')).toContainText('22');
        await expect(f.locator('.analysis-content, .thread-inventory, .graph, .snapshot-conclusion, .evidence, .summary')).toHaveCount(0);
        await expect(f.locator('button')).toHaveCount(1);
        await expect(f.locator('.open-analysis')).toBeEnabled();
        expect((await f.locator('main').boundingBox()).height).toBeLessThan(640);
        expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
        expect(await f.locator('*').evaluateAll(nodes => nodes.some(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1 && !['HTML', 'BODY'].includes(n.tagName)))).toBe(false);
        await page.screenshot({ path: previews + `compact-${theme}-${width}.png`, fullPage: true });
    }
});

test('open and close negotiate native display modes and preserve selected thread, open stack and assessment', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentThread&native'); const f = widget(page);
    const summary = await f.locator('.ai-conclusion-summary').textContent();
    await f.locator('.open-analysis').focus(); await page.keyboard.press('Enter');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.surface-status')).toHaveCount(0);
    await expect(f.locator('.thread-stack pre')).toBeVisible();
    const stack = await f.locator('.evidence').textContent();
    await f.locator('.surface-back').click();
    await expect(f.locator('.analysis-content')).toHaveCount(0);
    await expect(f.locator('.open-analysis')).toBeFocused();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
    await f.locator('.open-analysis').click();
    await expect(f.locator('.thread-stack')).toHaveAttribute('open', '');
    await expect(f.locator('.evidence')).toHaveText(stack);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
    expect(await page.evaluate(() => window.displayRequests.map(r => r.mode))).toEqual(['fullscreen', 'inline', 'fullscreen']);
    expect(await page.evaluate(() => window.initialization.appCapabilities.availableDisplayModes)).toEqual(['inline', 'fullscreen']);
    expect(await page.evaluate(() => window.completedCalls.length)).toBe(0);
});

for (const behavior of ['unsupported', 'refuse', 'error', 'timeout']) {
    test(`${behavior} display support opens an explicit local fallback and collapses without losing filters`, async ({ page }) => {
        await page.goto(host.url + `?case=noFindings${behavior === 'unsupported' ? '' : '&native&display=' + behavior}`); const f = widget(page);
        await f.locator('.open-analysis').click();
        await expect(f.locator('.surface-status')).toContainText('Analysis opened here');
        await f.getByRole('searchbox').fill('main');
        await expect(f.locator('.inventory-row')).toHaveCount(1);
        await f.locator('.surface-back').click();
        await expect(f.locator('.open-analysis')).toBeFocused();
        if (behavior === 'timeout') await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', id: window.delayedDisplay.id, result: { mode: 'fullscreen' } }, '*'));
        await expect(f.locator('.analysis-content')).toHaveCount(0);
        await f.locator('.open-analysis').click();
        await expect(f.getByRole('searchbox')).toHaveValue('main');
        await expect(f.locator('.inventory-row')).toHaveCount(1);
    });
}

test('host-initiated fullscreen and inline changes preserve comparison view and snapshot assessments', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentComparison&native&mode=fullscreen'); const f = widget(page);
    await expect(f.locator('.comparison')).toBeVisible();
    await f.getByRole('button', { name: 'Snapshot details', exact: true }).click();
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
    await page.evaluate(() => window.sendHostContext({ displayMode: 'inline', theme: 'light' }));
    await expect(f.locator('.compact-context')).toContainText('Snapshot 2 / 2');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.locator('.open-analysis').click();
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveValue('1');
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('0');
    await f.locator('.surface-back').click();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
});

test('critical findings remain visible even when a focused assessment or no assessment is shown', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentDeadlock'); const f = widget(page);
    await expect(f.locator('.compact-alert.critical')).toContainText('1 JVM-reported deadlock cycle');
    await expect(f.locator('.compact-alert svg')).toHaveCount(1);
    await expect(f.locator('.graph')).toHaveCount(0);
    await sendResult(page, 'assessmentFocusedOverview');
    await expect(f.locator('.compact-alert.critical')).toBeVisible();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of this participant only.');
    await expect(f.locator('.compact-selection')).toHaveText('alpha');
    await sendResult(page, 'nativeOnly');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await expect(f.locator('.compact-result')).toContainText('does not establish health');
    await expect(f.locator('.compact-context')).toContainText('1 thread record');
});

test('a follow-up replaces the inline assessment without requiring the user to open its stack', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentSv'); const f = widget(page);
    await sendResult(page, 'assessmentThread');
    await expect(f.locator('.compact-selection')).toHaveText('main');
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main is parked');
    await expect(f.locator('.thread-focus-card')).toHaveCount(0);
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.locator('.ai-conclusion-language')).toHaveText('Originalspråk: English');
    await f.locator('.open-analysis').click();
    await expect(f.locator('.thread-focus-card h2')).toHaveText('main');
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main is parked');
    await expect(f.locator('.ai-conclusion')).toHaveCount(1);
});

test('refused native close remains honest and host context can still close it', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings&native&display=refuseClose'); const f = widget(page);
    await f.locator('.open-analysis').click();
    await f.locator('.surface-back').click();
    await expect(f.locator('.analysis-content')).toBeVisible();
    await expect(f.locator('.surface-status')).toContainText('host kept this view open');
    await page.evaluate(() => window.sendHostContext({ displayMode: 'inline' }));
    await expect(f.locator('.compact-report')).toBeVisible();
});

test('expanded analysis has one assessment and one next check without the old duplicate conclusion', async ({ page }) => {
    await page.setViewportSize({ width: 1060, height: 1000 });
    await page.goto(host.url + '?case=assessmentSv&native'); const f = widget(page);
    await f.locator('.open-analysis').click();
    await expect(f.locator('.snapshot-conclusion')).toContainText('Analysunderlag');
    await expect(f.locator('.snapshot-conclusion')).not.toContainText('Ingen JVM-rapporterad deadlock');
    await expect(f.locator('.overview-next')).toHaveCount(0);
    await expect(f.locator('.ai-conclusion-next')).toHaveCount(1);
    await expect(f.locator('.overview-thread')).toContainText('StatusClient.java:152');
    await page.screenshot({ path: previews + 'opened-analysis-dark.png', fullPage: true });
});

test('optional OpenAI display helper is feature-detected when standard modes are absent', async ({ page }) => {
    await page.addInitScript(() => {
        window.compatibilityCalls = [];
        window.openai = { requestDisplayMode: async ({ mode }) => {
            window.compatibilityCalls.push(mode);
            window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { displayMode: mode } } }));
            return { mode };
        } };
    });
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    await f.locator('.open-analysis').click();
    await expect(f.locator('.analysis-content')).toBeVisible();
    await expect(f.locator('.surface-status')).toHaveCount(0);
    await f.locator('.surface-back').click();
    await expect(f.locator('.compact-report')).toBeVisible();
    expect(await f.locator('body').evaluate(() => window.compatibilityCalls)).toEqual(['fullscreen', 'inline']);
    expect(await page.evaluate(() => window.displayRequests)).toEqual([]);
});

test('long assessments, partial input and unavailable pages remain explicit at narrow widths', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    await expect(f.locator('.compact-report')).toBeVisible();
    const summary = 'A long but literal assessment. '.repeat(28) + '<svg/onload=alert(1)> Ending qualification.';
    await page.evaluate(async summary => {
        const result = await (await fetch('/data?case=noFindings')).json();
        result._meta.jvmscopeConclusion.summary = summary;
        result._meta.jvmscopeReport.status = 'partial';
        result._meta.jvmscopeReport.warnings = ['Synthetic partial-input test'];
        const send = params => document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params }, '*');
        send(result);
    }, summary);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
    await expect(f.locator('.compact-coverage')).toContainText('Partial capture');
    await expect(f.locator('.ai-conclusion svg')).toHaveCount(0);
    expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
    await page.evaluate(async () => {
        const result = await (await fetch('/data?case=noFindings')).json();
        result._meta.jvmscopeReport.snapshots.items = [];
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
    });
    await expect(f.locator('.compact-report')).toContainText('No snapshots are available');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await expect(f.locator('.compact-report')).not.toContainText('NaN');
    await f.locator('.open-analysis').click();
    await f.getByRole('button', { name: 'Previous snapshots' }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(8);
});

test('presentation and theme changes cannot cancel an in-flight stack navigation', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings&native'); const f = widget(page);
    await f.locator('.open-analysis').click();
    let release, started;
    const gate = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
    await page.route('**/tool', async route => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); });
    try {
        await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
        await ready;
        await page.evaluate(() => window.sendHostContext({ theme: 'light', displayMode: 'inline' }));
        release();
        await expect(f.locator('.compact-selection')).toHaveText('worker-2');
        await expect(f.locator('.compact-result')).toContainText('No separate AI assessment');
        await expect(f.locator('.analysis-content')).toHaveCount(0);
        await f.locator('.open-analysis').click();
        await expect(f.locator('.thread-focus-card h2')).toHaveText('worker-2');
    } finally { release(); }
});

test('source loading finishes while the analysis is collapsed and is retained on reopening', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentDeadlock&native'); const f = widget(page);
    await f.locator('.open-analysis').click();
    let release, started;
    const gate = new Promise(r => { release = r; }), ready = new Promise(r => { started = r; });
    await page.route('**/tool', async route => { const response = await route.fetch(); started(); await gate; await route.fulfill({ response }); });
    try {
        await f.getByRole('button', { name: /^alpha\. Waits for/ }).click();
        await ready;
        await f.locator('.surface-back').click();
        release();
        await page.waitForFunction(() => window.completedCalls.length === 1);
        await f.locator('.open-analysis').click();
        await expect(f.locator('.evidence')).toContainText('4  "alpha"');
        await expect(f.locator('#source-content')).not.toContainText('Checking source hash');
        await expect(f.locator('.node[aria-pressed="true"]')).toContainText('alpha');
        expect(await page.evaluate(() => window.completedCalls.length)).toBe(1);
    } finally { release(); }
});

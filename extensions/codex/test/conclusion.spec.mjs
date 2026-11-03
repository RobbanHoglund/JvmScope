import { openAnalysis } from './ui-navigation.mjs';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); });
test.afterAll(async () => host?.close());
const widget = page => page.frameLocator('iframe');
const before = async (f, selector) => expect(await f.locator('.ai-conclusion').evaluate((n, s) =>
    !!(n.compareDocumentPosition(document.querySelector(s)) & Node.DOCUMENT_POSITION_FOLLOWING), selector)).toBe(true);

test('actual AI conclusion is above rules, counts and threads in both languages and themes', async ({ page }) => {
    const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
    await mkdir(previews, { recursive: true });
    for (const [name, locale] of [['noFindings', 'en'], ['assessmentSv', 'sv']]) {
        for (const [theme, width] of [['dark', 735], ['light', 390]]) {
            await page.setViewportSize({ width, height: 1000 });
            await openAnalysis(page, host.url + `?case=${name}&theme=${theme}`); const f = widget(page);
            await expect(f.getByRole('heading', { name: locale === 'sv' ? 'AI-bedömning' : 'AI conclusion', exact: true })).toBeVisible();
            await expect(f.locator('.ai-conclusion-summary')).toContainText(locale === 'sv' ? 'main väntar i ett HTTP-anrop' : 'main is parked in an HTTP send call');
            await before(f, '.snapshot-conclusion'); await before(f, '.summary'); await before(f, '.inventory-list');
            expect((await f.locator('.ai-conclusion-next').boundingBox()).y).toBeLessThan(500);
            expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
            await page.screenshot({ path: previews + `ai-conclusion-${locale}-${theme}-${width}.png`, fullPage: true });
        }
    }
});

test('assessment remains bound to its snapshot and survives returning from a stack', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=assessmentSeries'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('0');
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await openAnalysis(page, host.url + '?case=noFindings');
    await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await expect(f.locator('.focus-evidence-only')).toHaveText('Stack evidence');
    await f.getByRole('button', { name: /^All threads · snapshot / }).click();
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main is parked');
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.locator('.ai-conclusion-language')).toHaveText('Originalspråk: English');
    await expect(f.locator('.ai-conclusion-summary span')).toHaveAttribute('lang', 'en');
});

test('conclusions render as text and stay above deadlock, comparison and focused content', async ({ page }) => {
    let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
    await openAnalysis(page, host.url + '?case=large'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toContainText('<img src=x onerror=alert(1)>');
    await expect(f.locator('.ai-conclusion img, .ai-conclusion script, .ai-conclusion a')).toHaveCount(0);
    expect(dialogs).toBe(0);
    await openAnalysis(page, host.url + '?case=assessmentDeadlock');
    await expect(f.locator('.node')).toHaveCount(2); await before(f, '.graph');
    await openAnalysis(page, host.url + '?case=assessmentComparison');
    await expect(f.locator('.ai-conclusion-summary')).toContainText('two captures'); await before(f, '.comparison');
    await openAnalysis(page, host.url + '?case=assessmentThread');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1); await before(f, '.thread-focus-card');
    await openAnalysis(page, host.url + '?case=nativeOnly');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
});

test('overview to a main-thread explanation presents the new assessment before the stack', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await openAnalysis(page, host.url + '?case=assessmentSv');
    const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main väntar i ett HTTP-anrop');
    const summary = 'main väntar på att HTTP-anropet ska slutföras via CompletableFuture.get. Den här snapshoten visar inte om anropet har fastnat.';
    const nextCheck = 'Jämför en senare dump med anropets start, svar och timeout.';
    await page.evaluate(async ({ summary, nextCheck }) => {
        const overview = await (await fetch('/data?case=assessmentSv')).json();
        const args = { reportId: overview.structuredContent.reportId, snapshotIndex: 0, language: 'sv',
            sourceKeys: [overview._meta.jvmscopeReport.snapshots.items[0].threadInventory.items[0].sourceKey] };
        const call = async (name, arguments_) => {
            const r = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name, arguments: arguments_ }) })).json();
            if (r.isError) throw new Error(JSON.stringify(r));
            return r;
        };
        const evidence = await call('inspect_thread_details', args);
        if (evidence.structuredContent.presentation !== 'evidence-only') throw new Error('Premature presentation');
        const rendered = await call('render_thread_details', { ...args, conclusion: { summary, nextCheck } });
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: rendered }, '*');
    }, { summary, nextCheck });
    await expect(f.getByRole('heading', { name: 'main · Snapshot 1', exact: true })).toBeVisible();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
    await expect(f.locator('.ai-conclusion-next')).toContainText(nextCheck);
    await expect(f.locator('.focus-evidence-only')).toHaveCount(0);
    await before(f, '.thread-focus-card');
    await expect(f.locator('.thread-stack pre')).toBeVisible();
    await expect(f.locator('.evidence')).toContainText('HttpClientImpl.send');
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
    expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
    await f.getByRole('button', { name: /^Alla trådar · snapshot / }).click();
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main väntar i ett HTTP-anrop');
    await f.getByRole('button', { name: 'Granska stack', exact: true }).click();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText(summary);
});

test('a thread-specific overview assessment disappears when another graph participant is selected', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=assessmentFocusedOverview'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of this participant only.');
    const selected = await f.locator('.node[aria-pressed="true"]').getAttribute('data-participant');
    await f.locator('.node[aria-pressed="false"]').click();
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.locator('.node').evaluateAll((nodes, selected) => nodes.find(n => n.dataset.participant === selected).click(), selected);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of this participant only.');
});

test('switching between overview and comparison restores each cached assessment', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=assessmentComparison'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('These two captures have no comparable rates.');
    await f.getByRole('button', { name: 'Snapshot details', exact: true }).click();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await f.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('These two captures have no comparable rates.');
    await f.getByRole('button', { name: 'Snapshot details', exact: true }).click();
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
    await expect(f.locator('.snapshot-context')).toContainText('Viewing snapshot 2');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('0');
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
});

test('hosts without tools keep local snapshot and view navigation without inventing assessments', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=assessmentSeries&noTools'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await f.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
    await expect(f.locator('.comparison')).toBeVisible();
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('button', { name: 'Snapshot details', exact: true }).click();
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('0');
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    expect(await page.evaluate(() => window.completedCalls.length)).toBe(0);
});

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
            await page.goto(host.url + `?case=${name}&theme=${theme}`); const f = widget(page);
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
    await page.goto(host.url + '?case=assessmentSeries'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('0');
    await expect(f.locator('.ai-conclusion-summary')).toHaveText('Assessment of snapshot 1 only.');
    await page.goto(host.url + '?case=noFindings');
    await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
    await f.getByRole('button', { name: 'Snapshot overview' }).click();
    await expect(f.locator('.ai-conclusion-summary')).toContainText('main is parked');
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.locator('.ai-conclusion-language')).toHaveText('Originalspråk: English');
    await expect(f.locator('.ai-conclusion-summary span')).toHaveAttribute('lang', 'en');
});

test('conclusions render as text and stay above deadlock, comparison and focused content', async ({ page }) => {
    let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
    await page.goto(host.url + '?case=large'); const f = widget(page);
    await expect(f.locator('.ai-conclusion-summary')).toContainText('<img src=x onerror=alert(1)>');
    await expect(f.locator('.ai-conclusion img, .ai-conclusion script, .ai-conclusion a')).toHaveCount(0);
    expect(dialogs).toBe(0);
    await page.goto(host.url + '?case=assessmentDeadlock');
    await expect(f.locator('.node')).toHaveCount(2); await before(f, '.graph');
    await page.goto(host.url + '?case=assessmentComparison');
    await expect(f.locator('.ai-conclusion-summary')).toContainText('two captures'); await before(f, '.comparison');
    await page.goto(host.url + '?case=assessmentThread');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1); await before(f, '.thread-focus-card');
    await page.goto(host.url + '?case=nativeOnly');
    await expect(f.locator('.ai-conclusion')).toHaveCount(0);
});

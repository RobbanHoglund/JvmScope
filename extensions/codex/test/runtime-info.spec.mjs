import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => {
    test.setTimeout(120_000);
    host = await startHost({ inventoryOnly: true, capturePath: fileURLToPath(new URL('../../../frontend/test/tda/fixtures/runtime/jdk27-thread-print.txt', import.meta.url)) });
});
test.afterAll(async () => host?.close());

test('runtime metadata stays with the real snapshot through overview, exact source and Swedish navigation', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await expect(f.locator('.runtime-info summary')).toHaveText('Java runtime · 27+35-2325');
    expect(await f.locator('.runtime-info').evaluate(n => !!(document.querySelector('.snapshot-conclusion').compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await f.locator('.runtime-info summary').click();
    await expect(f.locator('.runtime-info dl')).toContainText('27.0+35');
    await expect(f.locator('.runtime-info dl')).toContainText('interpreted mode, sharing');
    await f.locator('.inventory-row').first().click();
    await expect(f.locator('.runtime-info summary')).toHaveText('Java runtime · 27+35-2325');
    await expect(f.locator('.thread-stack .evidence')).toContainText('5  "sample-owner"');
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.locator('.runtime-info summary')).toHaveText('Java-runtime · 27+35-2325');
    await f.locator('.runtime-info summary').click();
    await expect(f.locator('.runtime-info dl')).toContainText('Runtime / leverantörstext');
    await f.getByRole('button', { name: 'Alla trådar · snapshot 1', exact: true }).click();
    await expect(f.locator('.runtime-info summary')).toHaveText('Java-runtime · 27+35-2325');
});

test('runtime details fit light/dark and narrow panels with keyboard access', async ({ page }) => {
    for (const theme of ['light','dark']) for (const width of [1060,390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(host.url + `?case=noFindings&native&mode=fullscreen&theme=${theme}`);
        const f = page.frameLocator('iframe');
        await expect(f.locator('.runtime-info summary')).toBeVisible();
        await f.locator('.runtime-info summary').focus(); await page.keyboard.press('Enter');
        await expect(f.locator('.runtime-info dl')).toBeVisible();
        expect(await f.locator('body').evaluate(n => n.scrollWidth > n.clientWidth + 1)).toBe(false);
        await page.screenshot({ path: fileURLToPath(new URL(`../../../build/codex-previews/runtime-${theme}-${width}.png`, import.meta.url)), fullPage: true });
    }
});

import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost(); await mkdir(previews, { recursive: true }); });
test.afterAll(async () => host?.close());

test('loaded stack lines use natural height by default and bounded scrolling is an explicit persistent choice', async ({ page }) => {
    for (const width of [1060, 390]) {
        await page.setViewportSize({ width, height: 1300 });
        await page.goto(host.url + '?case=deep&native&mode=fullscreen');
        const f = page.frameLocator('iframe'), source = f.locator('.thread-stack .evidence');
        await expect(source).toBeVisible();
        const original = await source.textContent();
        await f.getByRole('checkbox', { name: 'Colors', exact: true }).uncheck();
        expect(await source.evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
        expect(await f.locator('body').evaluate(n => n.scrollWidth > n.clientWidth + 1)).toBe(false);
        const limit = f.getByRole('button', { name: 'Limit stack height', exact: true });
        await limit.focus(); await page.keyboard.press('Enter');
        expect(await source.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
        await f.locator('.surface-back').click(); await f.locator('.open-analysis').click();
        expect(await source.evaluate(n => n.scrollHeight > n.clientHeight)).toBe(true);
        await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
        await expect(f.getByRole('checkbox', { name: 'Färger', exact: true })).not.toBeChecked();
        await expect(f.getByRole('button', { name: 'Utöka stacken', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await f.getByRole('button', { name: 'Utöka stacken', exact: true }).click();
        expect(await source.evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
        await expect(source).toHaveText(original);
        await f.locator('.source-next').click();
        await expect(source).toContainText('Service.step79');
        await expect(source).toHaveAttribute('data-colored', 'false');
        await f.getByRole('checkbox', { name: 'Färger', exact: true }).check();
        await expect(source).toHaveAttribute('data-colored', 'true');
        await expect(source.locator('.is-other').last()).toContainText('Service.step79');
        expect(await source.evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
        await expect.poll(async () => {
            const body = await f.locator('body').evaluate(n => n.getBoundingClientRect().height);
            return Math.abs((await page.locator('iframe').boundingBox()).height - body) < 2;
        }).toBe(true);
        await page.screenshot({ path: previews + `natural-stack-${width}.png`, fullPage: true });
    }
});

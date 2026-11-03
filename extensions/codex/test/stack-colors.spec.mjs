import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => {
    test.setTimeout(120_000);
    host = await startHost({ conclusionOnly: true, capturePath: fileURLToPath(new URL('./fixtures/stack-colors.txt', import.meta.url)) });
    await mkdir(previews, { recursive: true });
});
test.afterAll(async () => host?.close());

test('stack colors default to application categories with exact safe source and readable light/dark palettes', async ({ page }) => {
    const data = (await (await page.request.get(host.url + '/data?case=assessmentThread')).json())._meta.jvmscopeThreadDetails;
    const original = data.threads[0].lines.map(l => `${l.line}  ${l.text}`).join('\n');
    for (const theme of ['dark', 'light']) for (const width of [1060, 390]) {
        await page.setViewportSize({ width, height: 1300 });
        await page.goto(host.url + `?case=assessmentThread&native&mode=fullscreen&theme=${theme}`);
        const f = page.frameLocator('iframe'), source = f.locator('.thread-stack .evidence');
        await expect(f.getByRole('checkbox', { name: 'Colors', exact: true })).toBeChecked();
        await expect(source).toHaveAttribute('data-colored', 'true');
        expect(await source.textContent()).toBe(original);
        await expect(source.locator('.is-jvm')).toHaveCount(3);
        await expect(source.locator('.is-library')).toHaveCount(1);
        await expect(source.locator('.is-other')).toHaveCount(3);
        await expect(source.locator('.is-lock')).toHaveCount(4);
        await expect(source.locator('.is-state')).toHaveCount(1);
        await expect(source.locator('img,svg,script')).toHaveCount(0);
        await expect(f.locator('.stack-color-key')).toContainText('Other / application');
        await expect(f.locator('.stack-color-key')).toHaveAttribute('title', /not diagnostic severity/);
        const ratios = await source.evaluate(pre => {
            const luminance = color => {
                const channels = color.match(/[\d.]+/g).slice(0, 3).map(x => Number(x) / 255)
                    .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
                return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
            };
            const bg = luminance(getComputedStyle(pre).backgroundColor);
            return [...pre.querySelectorAll('.thread-stack-line,.source-line-number')].map(n => {
                const fg = luminance(getComputedStyle(n).color); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
            });
        });
        expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
        expect(await f.locator('body').evaluate(n => n.scrollWidth > n.clientWidth + 1)).toBe(false);
        expect(await source.evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
        await expect.poll(async () => Math.abs((await page.locator('iframe').boundingBox()).height - await f.locator('body').evaluate(n => n.getBoundingClientRect().height)) < 2).toBe(true);
        await page.screenshot({ path: previews + `stack-colors-${theme}-${width}.png`, fullPage: true });
    }
});

test('keyboard color choice survives language, theme and compact views without tool calls or source edits', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentThread&native&mode=fullscreen');
    const f = page.frameLocator('iframe'), source = f.locator('.thread-stack .evidence');
    await expect(source).toBeVisible(); const original = await source.textContent(), before = host.calls.length;
    await f.getByRole('checkbox', { name: 'Colors', exact: true }).focus(); await page.keyboard.press('Space');
    await expect(source).toHaveAttribute('data-colored', 'false');
    await expect(f.locator('.stack-color-key')).toBeHidden();
    const plain = await source.locator('.thread-stack-line').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).color));
    expect(new Set(plain).size).toBe(1);
    await f.locator('.surface-back').click(); await f.locator('.open-analysis').click();
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.getByRole('checkbox', { name: 'Färger', exact: true })).not.toBeChecked();
    await page.evaluate(() => window.sendHostContext({ theme: 'light' }));
    await expect(source).toHaveAttribute('data-colored', 'false');
    expect(await source.textContent()).toBe(original);
    await f.getByRole('checkbox', { name: 'Färger', exact: true }).check();
    await expect(f.locator('.stack-color-key')).toContainText('Bibliotek');
    await expect(source.locator('.is-library')).toHaveAttribute('title', 'Biblioteksram (ledtråd från paketnamn)');
    expect(await source.textContent()).toBe(original);
    expect(host.calls.length).toBe(before);
});

test('system high contrast keeps source readable and the color choice accessible', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(host.url + '?case=assessmentThread&native&mode=fullscreen');
    const f = page.frameLocator('iframe'), source = f.locator('.thread-stack .evidence');
    await expect(source).toBeVisible();
    const ink = await source.locator('.thread-stack-line').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).color));
    expect(new Set(ink).size).toBe(1);
    await f.getByRole('checkbox', { name: 'Colors', exact: true }).focus(); await page.keyboard.press('Space');
    await expect(f.getByRole('checkbox', { name: 'Colors', exact: true })).not.toBeChecked();
    await expect(source).toContainText('<img src=x onerror=alert(2)>');
    await expect(source.locator('img')).toHaveCount(0);
});

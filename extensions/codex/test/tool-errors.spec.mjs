import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); await mkdir(previews, { recursive: true }); });
test.afterAll(async () => host?.close());
async function restart(page) { await page.evaluate(async () => { const r = await fetch('/restart', { method: 'POST' }); if (!r.ok) throw new Error('Restart failed'); }); }

test('an old report without a source reference shows one actionable Swedish error after repeated clicks', async ({ page }) => {
    await page.route('**/data?case=assessmentSv', async route => {
        const response = await route.fetch(), data = await response.json();
        delete data._meta.jvmscopeReportContext;
        delete data._meta.jvmscopeReport.reportContext;
        delete data.structuredContent.reportContext;
        await route.fulfill({ response, json: data });
    });
    await page.goto(host.url + '?case=assessmentSv&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await expect(f.locator('.overview-thread')).toBeVisible();
    await restart(page);
    const open = f.getByRole('button', { name: 'Granska stack', exact: true });
    for (let i = 0; i < 4; i++) {
        await open.click();
        await expect(f.locator('.overview-thread [role=alert]')).toContainText('Analysera');
        await expect(open).toBeEnabled();
    }
    await expect(f.locator('.overview-thread [role=alert]')).toHaveCount(1);
    await expect(f.locator('.overview-thread')).not.toContainText('Report expired');
    await page.screenshot({ path: previews + 'expired-report-sv.png', fullPage: true });
});

test('a changed source is explained in the selected language and retry clears the error once the original is restored', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentDeadlock&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await restart(page);
    try {
        await writeFile(host.capture, host.original + '\n');
        await f.locator('.node').first().click();
        await expect(f.locator('#source-content [role=alert]')).toContainText('En källfil har ändrats');
        const read = f.getByRole('button', { name: /^Visa källrader/ });
        await read.click();
        await expect(f.locator('#source-content [role=alert]')).toHaveCount(1);
        await expect(f.locator('#source-content .evidence')).toHaveCount(0);
        await writeFile(host.capture, host.original);
        await read.click();
        await expect(f.locator('#source-content .evidence')).toContainText('waiting to lock');
        await expect(f.locator('#source-content [role=alert]')).toHaveCount(0);
    } finally { await writeFile(host.capture, host.original); }
});

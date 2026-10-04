import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

test('TLS branding leaves TDA capture, filtering, details and raw-dump styles working', async ({ page, appUrl }) => {
    test.setTimeout(30_000);
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await expect(page).toHaveTitle('JvmScope · Java Thread Dump Analyzer');
    await expect(page.getByRole('heading', { name: 'JvmScope · Java Thread Dump Analyzer', exact: true })).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--tls-accent'))).toBe('');
    await page.locator('#fileInput').setInputFiles(fileURLToPath(new URL('../../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url)));
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    const rows = page.locator('#threadTableBody tr');
    await expect(page.locator('#rowCount')).toHaveText('1–50 of 67 threads');
    await expect(rows).toHaveCount(50);
    const count = await rows.count();
    await page.locator('#onlyBlockedToggle').check();
    await expect.poll(() => rows.count()).toBeLessThan(count);
    expect(await rows.count()).toBeGreaterThan(0);
    expect((await rows.allTextContents()).every(text => text.includes('BLOCKED'))).toBe(true);
    await rows.first().getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#threadModal')).toBeVisible();
    for (const tab of await page.locator('#threadModal [role="tab"]').all()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#threadModal [role="tabpanel"]:visible')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    const opened = page.waitForEvent('popup');
    await page.locator('#openRawDumpBtn').click();
    const raw = await opened;
    await expect(raw.locator('body')).toHaveClass('raw-workspace-page');
    await expect(raw.getByRole('button', { name: 'Show the canonical raw dump', exact: true })).toBeVisible();
    expect(await raw.locator('body').evaluate(body => getComputedStyle(body).getPropertyValue('--tls-accent'))).toBe('');
    await raw.getByRole('button', { name: 'Close raw dump evidence workspace', exact: true }).click().catch(error => {
        if (!raw.isClosed() || !error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    await expect.poll(() => raw.isClosed()).toBe(true);
    await expect(page.locator('#rawDumpDialog, #rawDumpFrame')).toHaveCount(0);
    await page.locator('#onlyBlockedToggle').uncheck();
    await page.locator('#nextDumpBtn').click();
    await expect(page.locator('#dumpSelect')).toHaveValue('1');
    await page.locator('#clearBtn').click();
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#fileName')).toHaveText('No file loaded');
});

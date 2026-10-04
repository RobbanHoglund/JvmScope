import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

for (const major of [7, 8]) test(`TDA real Java ${major} sequence loads without a false partial warning and keeps CPU unavailable`, async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    const path = fileURLToPath(new URL(`../../../../testdata/jvm-samples/local-zulu${major}-pilot2-zulu-${major}-all/classic-sequence.txt`, import.meta.url));
    await page.locator('#fileInput').setInputFiles(path);
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    await expect(page.locator('#inputFeedbackModal')).not.toBeVisible();
    await expect(page.locator('#errorState')).not.toBeVisible();
    await page.locator('#dumpSelect').selectOption('2');
    await page.locator('#searchInput').fill('matrix-cpu-hot');
    const row = page.locator('#threadTableBody tr').filter({ hasText: 'matrix-cpu-hot' });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#threadModal')).toBeVisible();
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU total' })).toHaveText('CPU total —');
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU delta' })).toHaveText('CPU delta —');
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history.locator('dt:has-text("Occurrences") + dd')).toHaveText('3');
});

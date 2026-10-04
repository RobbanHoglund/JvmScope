import { test, expect } from './fixtures.js';
import { largeThreadDump } from '../../tda/large-dump-fixture.js';
import { writeFile } from 'node:fs/promises';

// Trace snapshot serialization also runs on the UI thread. Measure the
// application without including that instrumentation overhead.
test.use({ trace: 'off' });

test('TDA large analysis keeps the browser event loop responsive', async ({ page, appUrl }) => {
    test.setTimeout(60_000);
    // Use a real file: injecting a multi-megabyte base64 File through Playwright
    // would measure the automation's decoding work on the UI thread as well.
    const capturePath = test.info().outputPath('large-thread-dump.txt');
    await writeFile(capturePath, largeThreadDump());
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.evaluate(() => {
        window.tdaLongTasks = [];
        new PerformanceObserver(list => window.tdaLongTasks.push(...list.getEntries().map(entry => entry.duration)))
            .observe({ type: 'longtask' });
    });
    await page.locator('#fileInput').setInputFiles(capturePath);
    await expect(page.locator('#loadingState')).not.toBeVisible({ timeout: 50_000 });
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    await expect(page.locator('#rowCount')).toHaveText('1–50 of 3000 threads');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    const longTasks = await page.evaluate(() => window.tdaLongTasks);
    expect(Math.max(0, ...longTasks), 'Analysis and result rendering must not block the UI for a second').toBeLessThan(1000);
    await page.locator('#runnableClusterPanelBody .runnable-cluster-panel-summary').click();
    await expect(page.locator('.runnable-cluster-card')).toHaveCount(25);
    const firstTitle = await page.locator('.runnable-cluster-card-title').first().textContent();
    await page.getByRole('button', { name: 'Next clusters', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Cluster pages' })).toContainText('26–50 of 3000');
    expect(await page.locator('.runnable-cluster-card-title').first().textContent()).not.toBe(firstTitle);
    await page.locator('.runnable-cluster-card-summary').first().click();
    await expect(page.locator('.runnable-cluster-card').first()).toHaveAttribute('data-details-loaded', 'true');
    await expect(page.locator('.runnable-cluster-card').first().locator('.runnable-cluster-compare-btn')).toBeVisible();
});

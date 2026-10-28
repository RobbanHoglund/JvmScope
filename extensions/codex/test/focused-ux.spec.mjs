import { test, expect } from '@playwright/test';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); });
test.afterAll(async () => host?.close());

test('show the main stack displays the requested evidence immediately in a newly opened panel', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentThread&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await expect(f.locator('.thread-stack')).toHaveAttribute('open', '');
    await expect(f.locator('.evidence')).toBeVisible();
    await expect(f.locator('.evidence')).toContainText('CompletableFuture.get');
    await expect(f.locator('.evidence')).toContainText('HttpClientImpl.send');
    await expect(f.locator('.frame-location')).toHaveText('StatusClient.java:152');
    // A disclosure is still available to compact long/multiple stacks.
    await f.locator('.thread-stack summary').focus(); await page.keyboard.press('Enter');
    await expect(f.locator('.evidence')).not.toBeVisible();
    await page.keyboard.press('Enter');
    await expect(f.locator('.evidence')).toBeVisible();
});

test('a single snapshot uses one rate qualification instead of two unavailable metric cards', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentThread&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.thread-rates')).toHaveCount(0);
    await expect(f.locator('.thread-metrics-note')).toContainText('No comparable baseline');
    await expect(f.locator('.focus-scope')).toHaveCount(0);
    await expect(f.locator('.evidence')).toBeVisible();
});

test('zero measured CPU remains visible and a missing allocation rate is not invented', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentThread&native&mode=fullscreen'); const f = page.frameLocator('iframe');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await page.evaluate(async () => {
        // Synthetic presentation edge case, using a real focused MCP result.
        const r = await (await fetch('/data?case=assessmentThread')).json();
        const t = r._meta.jvmscopeThreadDetails.threads[0]; t.cpu.percent = 0;
        t.baseline = { snapshotNumber: 1 };
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: r }, '*');
    });
    await expect(f.locator('.thread-rates strong')).toHaveText(['≈ 0%', 'Unavailable']);
    await expect(f.locator('.focus-scope')).toContainText('one logical CPU');
    await expect(f.locator('.thread-metrics-note')).toHaveCount(0);
});

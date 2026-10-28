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

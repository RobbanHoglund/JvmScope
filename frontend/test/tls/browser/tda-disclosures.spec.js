import { test, expect } from './fixtures.js';

test('TDA snapshot information and findings use clear whole-row keyboard disclosures without losing context', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.getByRole('button', { name: 'Browse examples', exact: true }).click();
    await page.locator('[data-example-id="tda-java26-runtime"]').click();
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    const selectors = ['.tda-snapshot-details > summary', '#runtimeInfo summary', '.smart-analysis-details > summary', '.deadlock-panel-details > summary'];
    const left = await page.locator('.tda-snapshot-details > summary').boundingBox();
    const right = await page.locator('#runtimeInfo summary').boundingBox();
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    for (const selector of selectors) {
        const summary = page.locator(selector);
        await expect(summary).toBeVisible();
        expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(40);
        const wasOpen = await summary.evaluate(n => n.parentElement.open);
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => summary.evaluate(n => n.parentElement.open)).toBe(!wasOpen);
        expect(await summary.evaluate(n => getComputedStyle(n, '::after').content)).toContain(wasOpen ? 'Show details' : 'Hide details');
        await page.keyboard.press('Space');
        await expect.poll(() => summary.evaluate(n => n.parentElement.open)).toBe(wasOpen);
    }
    await expect(page.locator('.smart-analysis-summary')).toContainText('1 JVM-reported deadlock cycle');
    const context = page.locator('.tda-snapshot-details > summary');
    await context.click({ position: { x: (await context.boundingBox()).width - 12, y: 20 } });
    await expect(page.locator('.tda-snapshot-details > p').first()).toBeVisible();
    await page.locator('#searchInput').fill('matrix-deadlock');
    await expect(page.locator('#threadTableBody > tr')).toHaveCount(2);
    await expect(page.locator('.tda-snapshot-details')).toHaveAttribute('open', '');
    await page.locator('#clearBtn').click();
    await expect(page.getByRole('group', { name: 'Snapshot information', exact: true })).toBeHidden();
});

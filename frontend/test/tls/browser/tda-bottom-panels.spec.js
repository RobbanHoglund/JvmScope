import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#threadTableBody tr')).toHaveCount(50);
});

test('section shortcuts open lower panels and move keyboard focus to their headings', async ({ page }) => {
    for (const [button, heading] of [
        ['Recurring stacks', '#runnableClusterPanelBody > details > summary'],
        ['Dependency map', '#dependencyGraphDetails > summary'],
    ]) {
        await page.getByRole('navigation', { name: 'Investigation sections' }).getByRole('button', { name: button, exact: true }).click();
        await expect(page.locator(heading)).toBeFocused();
        await expect(page.locator(heading).locator('..')).toHaveAttribute('open', '');
        await expect(page.locator(heading)).toBeInViewport();
    }
});

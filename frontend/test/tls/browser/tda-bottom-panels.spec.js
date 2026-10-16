import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#threadTableBody tr')).toHaveCount(50);
});

test('TDA section shortcuts open lower panels and move keyboard focus to their headings', async ({ page }) => {
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

test('TDA recurring cards explain class waits and observations without overflowing a narrow view', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.locator('#jumpToClusters').click();
    const panel = page.locator('#runnableClusterPanel');
    await expect(panel).toContainText('not proof of CPU usage or livelock');
    const card = panel.locator('.runnable-cluster-card').filter({ hasText: 'Class initialization wait ·' });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.runnable-cluster-card-stats')).toContainText('Observations30');
    await card.locator('summary').first().click();
    await expect(card.locator('.runnable-cluster-timeline-value')).toHaveText(['10', '10', '10']);
    await expect(card.locator('.runnable-cluster-method-details')).not.toHaveAttribute('open', '');
    await card.getByText(/Grouping details ·/).click();
    await expect(card).toContainText('not a probability of a bug');
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 2)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
});

test('TDA class initialization waits and owners have visible graph arrowheads', async ({ page }) => {
    await page.locator('#jumpToGraph').click();
    for (const relation of ['class-init-wait', 'initialize']) {
        const paths = page.locator(`.dependency-graph-edge-${relation}`);
        await expect(paths.first()).toBeVisible();
        expect(await paths.evaluateAll(edges => edges.every(edge => {
            const id = edge.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
            return id && document.getElementById(id)?.querySelector('path');
        }))).toBe(true);
    }
});

test('TDA graph overview discloses omitted waits and keeps wait and hold edges distinguishable', async ({ page }) => {
    await page.locator('#jumpToGraph').click();
    await expect(page.locator('#dependencyGraphDensity')).toBeVisible();
    const metrics = page.locator('#dependencyGraphMetrics');
    await expect(metrics).toContainText('Hidden by density: 0 resources · 4 waiter observations');
    const wait = page.locator('.dependency-graph-edge-wait.is-confirmed-deadlock').first();
    const hold = page.locator('.dependency-graph-edge-hold.is-confirmed-deadlock').first();
    await expect(wait).toHaveCSS('stroke-dasharray', 'none');
    await expect(hold).toHaveCSS('stroke-dasharray', '5px, 3px');
    const waiter = page.locator('.dependency-graph-node-thread').filter({ has: page.locator('[text-anchor="end"]') }).first();
    await expect(waiter).toBeVisible();
    await metrics.getByRole('button', { name: 'Show all matching contention' }).click();
    await expect(page.locator('#dependencyGraphDensity')).toHaveValue('complete');
    await expect(metrics).not.toContainText('Hidden by density');
    await expect(page.locator('.dependency-graph-node-lock')).toHaveCount(10);
    await expect(page.locator('.dependency-graph-edge-wait, .dependency-graph-edge-park, .dependency-graph-edge-class-init-wait')).toHaveCount(28);
    await page.locator('#dependencyGraphSearch').fill('lambda$daemon$0');
    await expect(page.locator('#dependencyGraphSearchCount')).not.toHaveText('0 matches');
});

import { test, expect } from './fixtures.js';

function dump(second, metrics = '') {
    return `2026-10-03 12:00:0${second}\nFull thread dump OpenJDK 64-Bit Server VM (25 mixed mode):\n\n"chart-worker" #7 prio=5 os_prio=0 ${metrics} tid=0x00000007 nid=7 runnable\n   java.lang.Thread.State: RUNNABLE\n        at example.Worker.run(Worker.java:7)`;
}
const upload = (page, text) => page.locator('#fileInput').setInputFiles({ name: 'chart-dump.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
const card = (page, id) => page.locator('.thread-state-chart-card').filter({ has: page.locator(`#${id}`) });

test('TDA hides missing charts and restores them for measured zero values and later snapshots', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await expect(page.locator('#threadStateChartPanel')).not.toBeVisible();
    await upload(page, dump(0));
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await page.locator('#sessionInputMode').selectOption('replace');
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(card(page, 'threadStateChart')).toBeVisible();
    for (const id of ['cpuTimeChart', 'elapsedChart', 'allocatedChart', 'allocationRateChart']) await expect(card(page, id)).not.toBeVisible();
    await expect(page.locator('.cpu-timeline-card')).not.toBeVisible();
    const gridBounds = await page.locator('.thread-state-chart-grid').boundingBox();
    const stateBounds = await card(page, 'threadStateChart').boundingBox();
    expect(Math.abs(stateBounds.width - gridBounds.width)).toBeLessThan(2);

    await upload(page, [dump(0, 'cpu=0.00ms elapsed=1.00s allocated=0B'), dump(1, 'cpu=0.00ms elapsed=2.00s allocated=0B')].join('\n\n'));
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    for (const id of ['cpuTimeChart', 'elapsedChart', 'allocatedChart']) await expect(card(page, id).locator('svg')).toBeVisible();
    await expect(card(page, 'allocationRateChart')).not.toBeVisible();
    await expect(page.locator('#cpuTimelineChart svg')).toBeVisible();
    await page.locator('#dumpSelect').selectOption('1');
    await expect(card(page, 'allocationRateChart').locator('svg')).toBeVisible();
    await expect(page.locator('#allocationRateLegend')).toContainText('0 B/s');
    await page.locator('#dumpSelect').selectOption('0');
    await expect(card(page, 'allocationRateChart')).not.toBeVisible();

    // A user must still be able to clear a timeline query that has no matches.
    await page.locator('#cpuTimelineSearch').fill('does-not-exist');
    await expect(page.locator('.cpu-timeline-card')).toBeVisible();
    await expect(page.locator('#cpuTimelineSummary')).toContainText('No measured CPU series match');
    await page.locator('#cpuTimelineSearch').fill('');
    await expect(page.locator('#cpuTimelineChart svg')).toBeVisible();
    await page.locator('#clearBtn').click();
    await expect(page.locator('#threadStateChartPanel')).not.toBeVisible();
    await upload(page, dump(0));
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await expect(card(page, 'cpuTimeChart')).not.toBeVisible();
    await expect(page.locator('.cpu-timeline-card')).not.toBeVisible();
});

test('canonical analyzer URLs and legacy bookmarks work with query parameters', async ({ page, appUrl }) => {
    for (const analyzer of ['tda', 'tls']) {
        const query = '?cpuProfile=sensitive&search=a%3Fb?c';
        const legacy = `${appUrl}/javautils/${analyzer}.html${query}`;
        const canonical = `${appUrl}/jvmscope/${analyzer}.html${query}`;
        const redirect = await page.request.get(legacy, { maxRedirects: 0 });
        expect(redirect.status()).toBe(308);
        expect(redirect.headers().location).toBe(`/jvmscope/${analyzer}.html${query}`);
        const head = await page.request.head(`${appUrl}/javautils/${analyzer}.html`, { maxRedirects: 0 });
        expect(head.status()).toBe(308);
        await page.goto(legacy);
        // TDA normalizes query encoding when it restores the CPU profile.
        const actual = new URL(page.url());
        const expected = new URL(canonical);
        expect(actual.pathname).toBe(expected.pathname);
        expect([...actual.searchParams]).toEqual([...expected.searchParams]);
        await expect(page).toHaveTitle(analyzer === 'tda' ? 'JvmScope · Java Thread Dump Analyzer' : 'JvmScope · Java TLS Log Analyzer');
    }
});

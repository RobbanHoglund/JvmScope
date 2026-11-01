import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); await mkdir(previews, { recursive: true }); });
test.afterAll(async () => host?.close());
async function restart(page) { await page.evaluate(async () => { const r = await fetch('/restart', { method: 'POST' }); if (!r.ok) throw new Error('Restart failed'); }); }

for (const language of ['en', 'sv']) {
    test(`an open ${language} report recovers across real MCP restarts without losing its assessment or source identity`, async ({ page }) => {
        await page.setViewportSize({ width: 735, height: 1100 });
        await page.goto(host.url + '?case=' + (language === 'sv' ? 'assessmentSv' : 'noFindings') + '&native&mode=fullscreen&theme=' + (language === 'sv' ? 'light' : 'dark'));
        const f = page.frameLocator('iframe');
        await expect(f.locator('.ai-conclusion')).toBeVisible();
        const assessment = await f.locator('.ai-conclusion-summary').textContent();
        await restart(page);
        await f.getByRole('button', { name: language === 'sv' ? 'Granska stack' : 'Inspect stack', exact: true }).click();
        await expect(f.locator('.evidence')).toContainText('StatusClient.java:152');
        await expect(f.locator('.thread-focus-card h2')).toHaveText('main');
        await expect(f.locator('.ai-conclusion')).toHaveCount(0, 'The overview assessment does not become a main-only assessment');
        await restart(page);
        await f.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true }).click();
        await expect(f.locator('.ai-conclusion-summary')).toHaveText(assessment);
        await expect(f.locator('.thread-observation')).toHaveCount(0);
        const calls = host.calls.filter(c => c.name === 'inspect_thread_details' || c.name === 'render_thread_report');
        expect(calls.at(-1).arguments.reportContext.reportId).toBe(calls.at(-1).arguments.reportId);
        await expect.poll(async () => {
            const height = await f.locator('body').evaluate(n => n.getBoundingClientRect().height);
            return (await page.locator('iframe').boundingBox()).height >= height - 1;
        }).toBe(true);
        await page.screenshot({ path: previews + `restored-report-${language}.png`, fullPage: true });
    });
}

test('deadlock source inspection recovers on the graph click without a model round trip', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentDeadlock&native&mode=fullscreen');
    const f = page.frameLocator('iframe');
    await expect(f.locator('.node')).toHaveCount(2);
    await restart(page);
    await f.locator('.node').first().click();
    await expect(f.locator('#source-content .evidence')).toContainText('waiting to lock');
    await expect(f.locator('#source-content .error')).toHaveCount(0);
});

test('source paging and both comparison endpoints survive subsequent MCP process restarts', async ({ page }) => {
    const extra = await startHost();
    try {
        await page.goto(extra.url + '?case=deep&native&mode=fullscreen');
        const f = page.frameLocator('iframe');
        await expect(f.locator('.source-next')).toBeVisible();
        await restart(page);
        await f.locator('.source-next').click();
        await expect(f.locator('.evidence')).toContainText('Service.step79');
        await expect(f.locator('.source-next')).toHaveCount(0);
        await page.goto(extra.url + '?case=comparison&native&mode=fullscreen');
        await f.getByRole('button', { name: 'Allocation', exact: true }).click();
        const churn = f.locator('.metric-row').filter({ has: f.getByRole('heading', { name: 'scenario-allocation-churn-1', exact: true }) });
        await churn.locator('.metric-cell').nth(1).click();
        await restart(page);
        await f.getByRole('button', { name: 'Baseline · Snapshot 2', exact: true }).click();
        await expect(f.locator('.comparison-source .evidence')).toContainText('1397  "scenario-allocation-churn-1"');
        await restart(page);
        await f.getByRole('button', { name: 'Endpoint · Snapshot 3', exact: true }).click();
        await expect(f.locator('.comparison-source .evidence')).toContainText('2239  "scenario-allocation-churn-1"');
        await f.getByRole('button', { name: 'View thread · snapshot 3', exact: true }).click();
        await expect(f.locator('.thread-focus-card h2')).toHaveText('scenario-allocation-churn-1');
    } finally { await extra.close(); }
});


import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ inventoryOnly: true }); });
test.afterAll(async () => host?.close());
const widget = page => page.frameLocator('iframe');

test('a no-findings report shows parsed content and opens its exact Java stack', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    await expect(f.locator('.summary strong')).toHaveText(['22', '20', '0']);
    await expect(f.locator('.inventory-summary')).toHaveText('22 parsed records · 20 with Java state · 2 header-only VM records');
    await expect(f.locator('.state-runnable')).toHaveText('RUNNABLE13');
    await expect(f.locator('.state-waiting')).toHaveText('WAITING3');
    await expect(f.locator('.state-timed_waiting')).toHaveText('TIMED_WAITING4');
    await expect(f.locator('.state-unknown')).toHaveText('Not recorded2');
    await expect(f.locator('.inventory-limits')).toContainText('One snapshot');
    await expect(f.getByRole('heading', { name: 'Findings in this snapshot' })).toHaveCount(0);
    await expect(f.locator('.no-findings')).toContainText('does not establish health');
    await expect(f.locator('.inventory-row')).toHaveCount(22);
    const offset = host.calls.length;
    await f.getByRole('button', { name: 'Inspect thread: main', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.snapshot-context')).toContainText('1 selected thread');
    await expect(f.locator('.frame-location')).toHaveText('StatusClient.java:152');
    await expect(f.locator('.thread-rates')).not.toContainText('0%');
    await f.locator('.thread-stack summary').click();
    await expect(f.locator('.evidence')).toContainText('CompletableFuture.get');
    expect(host.calls.slice(offset).map(c => c.name)).toEqual(['render_thread_details']);
    await f.getByRole('button', { name: 'Snapshot overview' }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(22);
});

test('VM records outside the measurement leaders remain inspectable without invented Java states', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    await f.getByRole('combobox', { name: 'Java state', exact: true }).selectOption('UNKNOWN');
    await expect(f.locator('.inventory-row')).toHaveCount(2);
    await f.getByRole('button', { name: 'Inspect thread: VM Periodic Task Thread', exact: true }).click();
    await expect(f.locator('.thread-focus-card .thread-state')).toHaveText('Unavailable');
    await expect(f.getByText('No stack frames in the available source lines.')).toBeVisible();
    await f.locator('.thread-stack summary').click();
    await expect(f.locator('.evidence')).toContainText('"VM Periodic Task Thread"');
    await page.goto(host.url + '?case=nativeOnly');
    await expect(f.locator('.inventory-native-only')).toContainText('Only header-only VM records');
    await expect(f.locator('.summary strong')).toHaveText(['1', '0', '0']);
});

test('inventory filtering and bounded paging preserve duplicate identities and escaped labels', async ({ page }) => {
    let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
    await page.goto(host.url + '?case=large'); const f = widget(page);
    await expect(f.locator('.inventory-row')).toHaveCount(25);
    await expect(f.locator('.inventory-status')).toContainText('200 retained of 240');
    await expect(f.locator('.inventory-omitted')).toContainText('not searched');
    const before = host.calls.length;
    await f.getByRole('button', { name: 'Show more threads' }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(50);
    await f.getByRole('searchbox', { name: 'Find a thread' }).fill('worker-239');
    await expect(f.locator('.inventory-list')).toContainText('No matching records in this retained list');
    await f.getByRole('searchbox', { name: 'Find a thread' }).fill('<svg');
    await expect(f.locator('.inventory-row')).toHaveCount(2);
    await expect(f.locator('.inventory-list svg')).toHaveCount(0); expect(dialogs).toBe(0);
    const key = await f.locator('.inventory-row').nth(1).getAttribute('data-source-key');
    expect(host.calls.length).toBe(before);
    await f.locator('.inventory-row').nth(1).click();
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    expect(host.calls.at(-1).arguments.sourceKeys).toEqual([key]);
});

test('no-findings overview remains readable in both themes, languages and narrow hosts', async ({ page }) => {
    const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
    await mkdir(previews, { recursive: true });
    for (const [theme, width] of [['dark', 735], ['light', 390]]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(host.url + `?case=noFindings&theme=${theme}`); const f = widget(page);
        await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
        await expect(f.getByRole('heading', { name: 'Trådar i denna snapshot' })).toBeVisible();
        await expect(f.locator('.inventory-summary')).toContainText('20 med Java-tillstånd');
        await expect(f.locator('.inventory-limits')).toContainText('En snapshot');
        expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
        await page.screenshot({ path: previews + `no-findings-${theme}-${width}.png`, fullPage: true });
    }
    await page.goto(host.url + '?case=noFindings&noTools'); const f = widget(page);
    await expect(f.locator('.inventory-row').first()).toBeDisabled();
    await f.getByRole('searchbox', { name: 'Find a thread' }).fill('main');
    await expect(f.locator('.inventory-row')).toHaveCount(1);
    await expect(f.getByText('This host cannot open thread details. Ask for the named thread in the conversation.')).toBeVisible();
});

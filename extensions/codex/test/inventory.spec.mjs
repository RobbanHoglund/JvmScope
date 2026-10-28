import { openAnalysis } from './ui-navigation.mjs';
import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ inventoryOnly: true }); });
test.afterAll(async () => host?.close());
const widget = page => page.frameLocator('iframe');

test('a no-findings report shows parsed content and opens its exact Java stack', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=noFindings'); const f = widget(page);
    await expect(f.locator('.summary strong')).toHaveText(['22', '20', '0']);
    await expect(f.locator('.inventory-summary')).toHaveText('22 parsed records · 20 with Java state · 2 header-only VM records');
    await expect(f.locator('.state-runnable')).toHaveText('RUNNABLE13');
    await expect(f.locator('.state-waiting')).toHaveText('WAITING3');
    await expect(f.locator('.state-timed_waiting')).toHaveText('TIMED_WAITING4');
    await expect(f.locator('.state-unknown')).toHaveText('Not recorded2');
    await expect(f.locator('.inventory-limits')).toContainText('One snapshot');
    await expect(f.getByRole('heading', { name: 'Findings in this snapshot' })).toHaveCount(0);
    await expect(f.locator('.no-findings')).toContainText('does not establish health');
    await expect(f.locator('.snapshot-conclusion')).toContainText('No JVM-reported deadlock');
    await expect(f.locator('.overview-thread')).toContainText('Parked in CompletableFuture.get inside HttpClient.send');
    await expect(f.locator('.overview-frame')).toContainText('StatusClient.java:152');
    expect(await f.locator('.snapshot-conclusion').evaluate(n => n.compareDocumentPosition(document.querySelector('.summary')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    expect((await f.locator('.overview-next').boundingBox()).y).toBeLessThan(600);
    await expect(f.locator('.inventory-row')).toHaveCount(8);
    await expect(f.getByRole('button', { name: 'Show all 22', exact: true })).toHaveAttribute('aria-expanded', 'false');
    const offset = host.calls.length;
    await f.getByRole('button', { name: 'Inspect thread: main', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(f.locator('.thread-focus-card')).toHaveCount(1);
    await expect(f.locator('.snapshot-context')).toContainText('1 selected thread');
    await expect(f.locator('.frame-location')).toHaveText('StatusClient.java:152');
    await expect(f.locator('.thread-rates')).toHaveCount(0);
    await expect(f.locator('.thread-metrics-note')).toContainText('rates are unavailable');
    await expect(f.locator('.thread-stack pre')).toBeVisible();
    await expect(f.locator('.evidence')).toContainText('CompletableFuture.get');
    expect(host.calls.slice(offset).map(c => c.name)).toEqual(['inspect_thread_details']);
    await f.getByRole('button', { name: 'Snapshot overview' }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(8);
    await f.getByRole('button', { name: 'Show all 22', exact: true }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(22);
    await f.getByRole('button', { name: 'Show fewer threads' }).focus(); await page.keyboard.press('Enter');
    await expect(f.locator('.inventory-row')).toHaveCount(8);
    await expect(f.getByRole('button', { name: 'Show all 22', exact: true })).toBeFocused();
});

test('VM records outside the measurement leaders remain inspectable without invented Java states', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=noFindings'); const f = widget(page);
    await f.getByRole('combobox', { name: 'Java state', exact: true }).selectOption('UNKNOWN');
    await expect(f.locator('.inventory-row')).toHaveCount(2);
    await f.getByRole('button', { name: 'Inspect thread: VM Periodic Task Thread', exact: true }).click();
    await expect(f.locator('.thread-focus-card .thread-state')).toHaveText('Unavailable');
    await expect(f.getByText('No stack frames in the available source lines.')).toBeVisible();
    await expect(f.locator('.thread-stack pre')).toBeVisible();
    await expect(f.locator('.evidence')).toContainText('"VM Periodic Task Thread"');
    await openAnalysis(page, host.url + '?case=nativeOnly');
    await expect(f.locator('.inventory-native-only')).toContainText('Only header-only VM records');
    await expect(f.locator('.summary strong')).toHaveText(['1', '0', '0']);
    await expect(f.locator('.overview-thread')).toHaveCount(0);
});

test('inventory filtering and bounded paging preserve duplicate identities and escaped labels', async ({ page }) => {
    let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
    await openAnalysis(page, host.url + '?case=large'); const f = widget(page);
    await expect(f.locator('.inventory-row')).toHaveCount(8);
    await expect(f.locator('.inventory-status')).toContainText('200 retained of 240');
    await expect(f.locator('.inventory-omitted')).toContainText('not searched');
    const before = host.calls.length;
    await f.getByRole('button', { name: 'Show all 200', exact: true }).click();
    await expect(f.locator('.inventory-row')).toHaveCount(200);
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
        await openAnalysis(page, host.url + `?case=noFindings&theme=${theme}`); const f = widget(page);
        await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
        await expect(f.getByRole('heading', { name: 'Trådar i denna snapshot' })).toBeVisible();
        await expect(f.locator('.inventory-summary')).toContainText('20 med Java-tillstånd');
        await expect(f.locator('.inventory-limits')).toContainText('En snapshot');
        await expect(f.locator('.overview-thread')).toContainText('Nästa kontroll:');
        await expect(f.getByRole('button', { name: 'Visa alla 22', exact: true })).toBeVisible();
        expect(await f.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
        await page.screenshot({ path: previews + `no-findings-${theme}-${width}.png`, fullPage: true });
    }
    await openAnalysis(page, host.url + '?case=noFindings&noTools'); const f = widget(page);
    await expect(f.locator('.inventory-row').first()).toBeDisabled();
    await f.getByRole('searchbox', { name: 'Find a thread' }).fill('main');
    await expect(f.locator('.inventory-row')).toHaveCount(1);
    await expect(f.getByText('This host cannot open thread details. Ask for the named thread in the conversation.')).toBeVisible();
});

test('overview stack action opens only the observed thread and language follows navigation', async ({ page }) => {
    await openAnalysis(page, host.url + '?case=noFindings&locale=sv'); const f = widget(page);
    // The explicit tool language is authoritative, even with a Swedish host locale.
    await expect(f.getByRole('heading', { name: 'Thread analysis', exact: true })).toBeVisible();
    const before = host.calls.length;
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await f.getByRole('button', { name: 'Granska stack', exact: true }).click();
    await expect(f.locator('.snapshot-context')).toContainText('1 vald tråd');
    await expect(f.locator('.frame-location')).toHaveText('StatusClient.java:152');
    expect(host.calls.slice(before).map(c => c.name)).toEqual(['inspect_thread_details']);
    expect(host.calls.at(-1).arguments.language).toBe('sv');
    await f.getByRole('combobox', { name: 'Rapportspråk' }).selectOption('en');
    await f.getByRole('button', { name: 'Snapshot overview' }).click();
    await expect(f.locator('.overview-next')).toContainText('Next check:');
    expect(host.calls.at(-1).arguments.language).toBe('en');
});

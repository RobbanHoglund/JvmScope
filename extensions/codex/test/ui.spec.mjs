import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { startHost } from './ui-host.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const previewDir = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
let host;
test.beforeAll(async () => { host = await startHost(); });
test.afterAll(async () => { await host?.close(); });
const widget = page => page.frameLocator('iframe');
const overflow = frame => frame.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1);

test('deadlock graph exposes exact source evidence on click and keyboard activation', async ({ page }) => {
    await page.goto(host.url);
    const f = widget(page);
    await expect(f.getByRole('heading', { name: 'Thread analysis', exact: true })).toBeVisible();
    await expect(f.locator('.edge')).toHaveCount(2);
    await expect(f.locator('.node')).toHaveCount(2);
    await expect(f.locator('.node-holding').first()).toContainText('Holds:example.LockB');
    await expect(f.locator('.node-holding').first()).toContainText('0x00000000ccccdddd');
    await f.getByRole('button', { name: /^alpha\. Waits for/ }).click();
    await expect(f.locator('.evidence')).toContainText('4  "alpha"');
    await expect(f.locator('.evidence')).toContainText('waiting to lock <0x00000000aaaabbbb>');
    expect(host.calls.at(-1).name).toBe('read_thread_evidence');
    expect(host.calls.at(-1).arguments.snapshotIndex).toBe(0);
    await f.getByRole('button', { name: /^beta\. Waits for/ }).focus();
    await page.keyboard.press('Enter');
    await expect(f.locator('.evidence')).toContainText('10  "beta"');
    expect(await overflow(f)).toBe(false);
});

test('single snapshots omit series controls while a one-item series page keeps navigation', async ({ page }) => {
    await page.goto(host.url);
    const f = widget(page);
    await expect(f.locator('.node')).toHaveCount(2);
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveCount(0);
    await expect(f.locator('.observation')).toHaveCount(0);
    await expect(f.getByText('deadlock.txt', { exact: true })).toHaveCount(1);
    await page.goto(host.url + '?case=series');
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toBeVisible();
    await expect(f.locator('.observation')).toBeVisible();
    await f.getByRole('button', { name: 'Next snapshots' }).click();
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toBeVisible();
    await expect(f.getByRole('button', { name: 'Previous snapshots' })).toBeEnabled();
});

test('one-call example renders localized provenance and keeps source interaction working', async ({ page }) => {
    await page.goto(host.url + '?case=demo');
    const f = widget(page);
    await expect(f.locator('.example-label')).toHaveText('Syntetiskt exempel · medföljande Java-deadlock');
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveCount(0);
    await expect(f.locator('.node-holding').first()).toContainText('Håller:example.LockB');
    await f.locator('.node').first().click();
    await expect(f.locator('.evidence')).toContainText('4  "alpha"');
    await f.getByRole('combobox', { name: 'Rapportspråk' }).selectOption('en');
    await expect(f.locator('.example-label')).toHaveText('Synthetic example · bundled Java deadlock');
});

test('cycles stay separate and snapshot paging returns actual next-page data', async ({ page }) => {
    await page.goto(host.url + '?case=multi');
    const f = widget(page);
    await expect(f.getByRole('combobox', { name: 'Cycle', exact: true })).toBeVisible();
    await f.getByRole('combobox', { name: 'Cycle', exact: true }).selectOption('1');
    await expect(f.getByRole('button', { name: /^gamma\. Waits for/ })).toBeVisible();
    await expect(f.getByRole('button', { name: /^alpha\. Waits for/ })).toHaveCount(0);
    await page.goto(host.url + '?case=series');
    await expect(f.getByText('Displayed snapshots: 1–1 / 2')).toBeVisible();
    await f.getByRole('button', { name: 'Next snapshots' }).click();
    await expect(f.getByText('Displayed snapshots: 2–2 / 2')).toBeVisible();
    await expect(f.getByRole('heading', { name: 'No JVM-reported deadlock in this snapshot' })).toBeVisible();
    await f.getByRole('button', { name: 'Previous snapshots' }).click();
    await expect(f.getByText('Displayed snapshots: 1–1 / 2')).toBeVisible();
    await page.goto(host.url + '?case=paged');
    await expect(f.getByText('Displayed snapshots: 1–2 / 3')).toBeVisible();
    await f.getByRole('button', { name: 'Next snapshots' }).click();
    await expect(f.getByText('Displayed snapshots: 3–3 / 3')).toBeVisible();
    await f.getByRole('button', { name: 'Previous snapshots' }).click();
    await expect(f.getByText('Displayed snapshots: 1–2 / 3')).toBeVisible();
});

test('changed capture is reported instead of displaying stale evidence', async ({ page }) => {
    await page.goto(host.url);
    const f = widget(page);
    await expect(f.locator('.node')).toHaveCount(2);
    await writeFile(host.capture, 'changed capture');
    try {
        await f.getByRole('button', { name: /^alpha\. Waits for/ }).click();
        await expect(f.locator('.error')).toContainText('changed since analysis');
        await expect(f.locator('.evidence')).toHaveCount(0);
    } finally { await writeFile(host.capture, host.original); }
});

test('unmapped participants have no invented arrows and unavailable tools degrade explicitly', async ({ page }) => {
    await page.goto(host.url + '?case=unmapped');
    const f = widget(page);
    await expect(f.getByText(/Some participants or owners could not be matched/)).toBeVisible();
    await expect(f.locator('.edge')).toHaveCount(0);
    await expect(f.locator('.node-holding').first()).toContainText('Not established in the matched thread block');
    await page.goto(host.url + '?noTools=1');
    await f.getByRole('button', { name: /^alpha\. Waits for/ }).click();
    await expect(f.getByText(/Interactive source tools are unavailable/)).toBeVisible();
    await expect(f.getByRole('button', { name: /^View source lines / })).toBeDisabled();
});

test('untrusted labels render as text and outside messages cannot replace the report', async ({ page }) => {
    let dialogs = 0; page.on('dialog', async d => { dialogs++; await d.dismiss(); });
    await page.goto(host.url + '?case=injection');
    const f = widget(page);
    await expect(f.locator('.node').first()).toContainText('<svg/onload=alert(1)>');
    await expect(f.locator('[onload]')).toHaveCount(0);
    await f.locator('body').evaluate(() => window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { locale: 'sv' } }, '*'));
    await expect(f.getByRole('heading', { name: 'Thread analysis', exact: true })).toBeVisible();
    expect(dialogs).toBe(0);
});

test('report language follows the conversation and keeps evidence qualifications', async ({ page }) => {
    await page.goto(host.url + '?case=realSv&locale=en');
    const f = widget(page);
    await expect(f.getByRole('heading', { name: 'Trådanalys', exact: true })).toBeVisible();
    await expect(f.locator('.finding').first()).toContainText('2 JVM-rapporterade cykler med 5 rapporterade deltagarposter');
    await expect(f.locator('.finding')).not.toContainText([/observed lock holder/, /application threads exceed/]);
    await page.evaluate(() => window.sendHostContext({ locale: 'en-US', theme: 'light' }));
    await expect(f.getByRole('heading', { name: 'Trådanalys', exact: true })).toBeVisible();
    await f.locator('.finding summary').first().click();
    await expect(f.getByText('Direkt rapporterat i tråddumpen, inte härlett av analysverktyget.', { exact: true })).toBeVisible();
    await expect(f.getByText('Originaldiagnostik från analysverktyget (engelska)').first()).toBeVisible();
    await f.getByRole('combobox', { name: 'Rapportspråk' }).selectOption('en');
    await expect(f.getByRole('heading', { name: 'Thread analysis', exact: true })).toBeVisible();
    await expect(f.locator('.finding').first()).toContainText('2 JVM-reported cycles with 5 reported participant entries');
});

test('real three-snapshot report keeps counts scoped, text readable and all cycle edges usable at chat widths', async ({ page }) => {
    await mkdir(previewDir, { recursive: true });
    for (const theme of ['light', 'dark']) {
        await page.goto(host.url + `?case=real&theme=${theme}`);
        const f = widget(page);
        await expect(f.locator('.summary strong')).toHaveText(['2', '5', '3']);
        await expect(f.locator('.observation')).toContainText('Snapshots with reported cycles: 3/3');
        for (const width of [1060, 735, 640, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const [cycle, count] of [[0, 2], [1, 3]]) {
                await f.getByRole('combobox', { name: 'Cycle', exact: true }).selectOption(String(cycle));
                await expect(f.locator('.node')).toHaveCount(count);
                await expect(f.locator('.edge')).toHaveCount(count);
                expect(await overflow(f)).toBe(false);
                await expect.poll(() => f.locator('.graph').evaluate(graph => {
                    const bounds = graph.getBoundingClientRect(), nodes = [...graph.querySelectorAll('.node')];
                    return nodes.every(node => {
                        const r = node.getBoundingClientRect(), name = node.querySelector('.node-name');
                        return parseFloat(getComputedStyle(name).fontSize) >= 14 && r.left >= bounds.left && r.right <= bounds.right
                            && node.scrollWidth <= node.clientWidth + 1;
                    });
                })).toBe(true);
                await expect.poll(() => f.locator('.graph').evaluate(graph => {
                    const nodes = [...graph.querySelectorAll('.node')].map(n => n.getBoundingClientRect());
                    return [...graph.querySelectorAll('.edge')].every(edge => {
                        const matrix = edge.getScreenCTM(), length = edge.getTotalLength();
                        for (let k = 1; k < 40; k++) {
                            const p = edge.getPointAtLength(length * k / 40).matrixTransform(matrix);
                            if (nodes.some(r => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom)) return false;
                        }
                        return true;
                    });
                })).toBe(true);
                if (width === 735 || width === 390) await page.screenshot({ path: path.join(previewDir, `real-${theme}-${width}-cycle-${cycle + 1}.png`), fullPage: true });
            }
        }
    }
});

test('every real snapshot exposes the selected participant source, including after resize', async ({ page }) => {
    await page.goto(host.url + '?case=real');
    const f = widget(page);
    for (const snapshot of ['0', '1', '2']) {
        await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption(snapshot);
        await f.locator('.node').first().click();
        const name = await f.locator('.node-name').first().textContent();
        await expect(f.locator('.evidence')).toContainText(`"${name}"`);
        await expect(f.locator('.evidence')).toContainText('waiting to lock');
        await expect(f.locator('.node').first()).toBeFocused();
        const evidence = await f.locator('.evidence').textContent();
        await page.setViewportSize({ width: 735 - Number(snapshot) * 100, height: 1000 });
        await expect(f.locator('.evidence')).toHaveText(evidence);
        await expect(f.locator('.summary strong')).toHaveText(['2', '5', '3']);
    }
});

test('large cycle discloses omitted participants and never invents a closing edge', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto(host.url + '?case=many');
    const f = widget(page);
    await expect(f.locator('.summary strong')).toHaveText(['1', '9', '1']);
    await expect(f.locator('.node')).toHaveCount(8);
    await expect(f.locator('.edge')).toHaveCount(7);
    await expect(f.getByText(/Graph limited to the first 8 reported participants/)).toBeVisible();
    expect(await overflow(f)).toBe(false);
    await f.locator('.node').last().click();
    await expect(f.locator('.evidence')).toContainText('"worker-7-with-a-long-descriptive-thread-name"');
    await expect(f.locator('#detail')).toContainText('Held by: worker-8-with-a-long-descriptive-thread-name');
});

test('dark, light and narrow layouts have no horizontal overflow and respond to host context', async ({ page }) => {
    await mkdir(previewDir, { recursive: true });
    for (const [theme, width] of [['dark', 1060], ['light', 1060], ['dark', 390]]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(host.url + `?case=long&theme=${theme}`);
        const f = widget(page);
        await expect(f.locator('.node')).toHaveCount(2);
        expect(await overflow(f)).toBe(false);
        await expect(f.locator('.filename')).toHaveText('production-payments-service-capture-2026-10-23-region-eu-north-cluster-primary-thread-dump.txt');
        await page.screenshot({ path: path.join(previewDir, `threads-${theme}-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => window.sendHostContext({ locale: 'sv-SE', theme: 'light' }));
    await expect(widget(page).getByRole('heading', { name: 'Thread analysis', exact: true })).toBeVisible();
    await widget(page).getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(widget(page).getByRole('heading', { name: 'Trådanalys', exact: true })).toBeVisible();
    await expect(widget(page).locator('html')).toHaveAttribute('data-theme', 'light');
});


test('focused report, graph and evidence follow the exact global snapshot', async ({ page }) => {
    await page.goto(host.url + '?case=focused');
    const f = widget(page);
    await expect(f.locator('.snapshot-context')).toContainText('Viewing snapshot 3 / 3');
    await expect(f.getByRole('combobox', { name: 'Snapshot', exact: true })).toHaveValue('0');
    await expect(f.locator('.node.selected')).toHaveCount(1);
    await expect(f.locator('#source-content')).toBeEmpty();
    await expect(f.getByRole('button', { name: 'View source lines 1801–1814', exact: true })).toBeVisible();
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.getByRole('button', { name: 'Visa källrader 1801–1814', exact: true })).toBeVisible();
    await f.locator('.node.selected').click();
    await expect(f.locator('.evidence-context')).toContainText('Snapshot 3');
    await expect(f.locator('.evidence')).toContainText('1801  "scenario-deadlock-2-1"');
    await expect(f.locator('.evidence')).toContainText('0x000000070920ac70');
    expect(host.calls.at(-1).arguments.snapshotIndex).toBe(2);
});

test('series navigation reads cached pages without rerunning the analyzer', async ({ page }) => {
    await page.goto(host.url + '?case=paged');
    const f = widget(page), start = host.calls.length;
    await f.getByRole('button', { name: 'Next snapshots' }).click();
    await expect(f.getByText('Displayed snapshots: 3–3 / 3')).toBeVisible();
    expect(host.calls.slice(start).map(c => c.name)).toEqual(['render_thread_report']);
});


test('comparison plots CPU and bounded allocation and reads both exact interval endpoints', async ({ page }) => {
    await page.goto(host.url + '?case=comparison');
    const f = widget(page);
    await expect(f.getByRole('heading', { name: 'Snapshot comparison', exact: true })).toBeVisible();
    await expect(f.locator('.interval-summary')).toHaveCount(2);
    await expect(f.locator('.interval-summary').first()).toContainText('76.8%');
    await expect(f.locator('.interval-summary').nth(1)).toContainText('98%');
    const before = host.calls.length;
    await f.getByRole('button', { name: 'Allocation', exact: true }).click();
    const churn = f.locator('.metric-row').filter({ has: f.getByRole('heading', { name: 'scenario-allocation-churn-1', exact: true }) });
    await expect(churn.locator('.metric-value')).toHaveText(['25.6–26.5 MiB/s', '3.5–4.8 MiB/s']);
    await expect(churn.locator('.measure-bound')).toHaveCount(2);
    await churn.locator('.metric-cell').nth(1).focus(); await page.keyboard.press('Enter');
    await f.getByRole('button', { name: 'Baseline · Snapshot 2', exact: true }).click();
    await expect(f.locator('.comparison-source .evidence')).toContainText('1397  "scenario-allocation-churn-1"');
    await expect(f.locator('.comparison-source .evidence-context')).toContainText('Snapshot 2');
    await f.getByRole('button', { name: 'Endpoint · Snapshot 3', exact: true }).click();
    await expect(f.locator('.comparison-source .evidence')).toContainText('2239  "scenario-allocation-churn-1"');
    expect(host.calls.slice(before).map(c => c.name)).toEqual(['read_thread_evidence', 'read_thread_evidence']);
    await f.getByRole('button', { name: 'View this snapshot 3', exact: true }).click();
    await expect(f.locator('.snapshot-context')).toContainText('Viewing snapshot 3 / 3');
    await expect(f.locator('#detail')).toContainText('scenario-allocation-churn-1');
});

test('comparison is localized, bounded and readable in dark/light and narrow layouts', async ({ page }) => {
    await mkdir(previewDir, { recursive: true });
    for (const theme of ['dark', 'light']) for (const width of [735, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(host.url + `?case=comparison&theme=${theme}`);
        const f = widget(page);
        await expect(f.locator('.metric-row')).toHaveCount(8);
        await f.getByRole('button', { name: 'Allocation', exact: true }).click();
        await expect(f.locator('.measure-bound').first()).toBeVisible();
        expect(await overflow(f)).toBe(false);
        await page.screenshot({ path: path.join(previewDir, `comparison-${theme}-${width}.png`), fullPage: true });
    }
    const f = widget(page);
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.getByRole('heading', { name: 'Jämför snapshots', exact: true })).toBeVisible();
    await expect(f.locator('.metric-chart')).toContainText('3,5–4,8 MiB/s');
    await expect(f.locator('.metric-legend')).toContainText('osäkerhet');
    await f.getByRole('button', { name: 'Visa fler trådar' }).click();
    expect(await f.locator('.metric-row').count()).toBeGreaterThan(8);
    expect(await overflow(f)).toBe(false);
});

test('comparison tab reuses already loaded analysis and source controls degrade without host tools', async ({ page }) => {
    await page.goto(host.url + '?case=real&noTools=1');
    const f = widget(page), before = host.calls.length;
    await f.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
    await expect(f.locator('.interval-summary')).toHaveCount(2);
    await f.locator('.metric-cell').first().click();
    await expect(f.getByRole('button', { name: 'Baseline · Snapshot 1', exact: true })).toBeDisabled();
    await expect(f.getByRole('button', { name: 'Endpoint · Snapshot 2', exact: true })).toBeDisabled();
    expect(host.calls.length).toBe(before);
});

test('finding overviews expand with the keyboard and retain full evidence and source actions', async ({ page }) => {
    await page.goto(host.url + '?case=focused');
    const f = widget(page), card = f.locator('[data-finding="cpu-hot"]');
    await expect(card.locator('summary')).toContainText('9 application threads above the configured CPU threshold');
    await expect(card.locator('.finding-action')).toBeHidden();
    await card.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(card.locator('.finding-action')).toBeVisible();
    await expect(card.locator('.finding-description')).toContainText('endpoint state describes capture time');
    await expect(card.getByRole('button').first()).toBeVisible();
    await card.getByRole('button').first().click();
    await expect(card.locator('.evidence')).toBeVisible();
    expect(host.calls.at(-1).arguments.snapshotIndex).toBe(2);
    await card.locator('summary').click();
    await expect(card.locator('.evidence')).toBeHidden();
    await expect(f.locator('[data-finding="confirmed-deadlock"] summary')).toContainText('Critical');
});

test('matching contention and bottleneck findings share one overview while retaining distinct evidence', async ({ page }) => {
    await page.goto(host.url + '?case=focused');
    const f = widget(page), contention = f.locator('[data-finding="observed-lock-contention"]');
    await expect(f.locator('.findings > [data-finding="likely-lock-bottleneck"]')).toHaveCount(0);
    await expect(contention.locator(':scope > details > summary')).toContainText('same locks');
    await contention.locator(':scope > details > summary').click();
    const interpretation = contention.locator('[data-finding="likely-lock-bottleneck"]');
    await expect(interpretation.locator('summary')).toContainText('Review');
    await interpretation.locator('summary').click();
    await expect(interpretation.locator('.finding-description')).toContainText('root cause remains an inference');
    await interpretation.getByRole('button', { name: 'Source evidence: scenario-lock-holder', exact: true }).click();
    await expect(interpretation.locator('.evidence')).toContainText('1871  "scenario-lock-holder"');
    await expect(interpretation.locator('.evidence-context')).toContainText('Snapshot 3');
});

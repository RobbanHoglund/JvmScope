import { test, expect } from '@playwright/test';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); });
test.afterAll(async () => host?.close());
const widget = page => page.frameLocator('iframe');

// Hold a real, completed MCP response so later user actions can overtake it.
async function holdFirstCall(page, error) {
    let release, started, held = false;
    const gate = new Promise(r => { release = r; });
    const ready = new Promise(r => { started = r; });
    await page.route('**/tool', async route => {
        if (held) { await route.continue(); return; }
        held = true;
        const response = await route.fetch();
        started(); await gate;
        if (error) await route.fulfill({ json: { isError: true, content: [{ type: 'text', text: error }] } });
        else await route.fulfill({ response });
    });
    return { ready, release };
}
async function delivered(page, count) {
    await page.waitForFunction(count => window.completedCalls.length === count, count);
    // Yield in the receiving frame after the host posted the response.
    await widget(page).locator('body').evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
}

test('a slower first thread click cannot replace the most recent thread selection', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    const held = await holdFirstCall(page);
    try {
        await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
        await held.ready;
        await f.getByRole('button', { name: 'Inspect thread: worker-3', exact: true }).click();
        await expect(f.locator('.thread-focus-card h2')).toHaveText('worker-3');
        held.release(); await delivered(page, 2);
        await expect(f.locator('.thread-focus-card h2')).toHaveText('worker-3');
    } finally { held.release(); }
});

test('a pending navigation cannot overwrite a newer host assessment or language', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    const held = await holdFirstCall(page);
    try {
        await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
        await held.ready;
        await page.evaluate(async () => {
            const result = await (await fetch('/data?case=assessmentSv')).json();
            document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
        });
        await expect(f.locator('.ai-conclusion-summary')).toContainText('main väntar i ett HTTP-anrop');
        held.release(); await delivered(page, 1);
        await expect(f.locator('.ai-conclusion-summary')).toContainText('main väntar i ett HTTP-anrop');
        await expect(f.getByRole('combobox', { name: 'Rapportspråk' })).toHaveValue('sv');
        await expect(f.locator('.thread-focus-card')).toHaveCount(0);
    } finally { held.release(); }
});

test('changing snapshot while a stack loads keeps the new snapshot selected', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentSeries'); const f = widget(page);
    const held = await holdFirstCall(page);
    try {
        await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
        await held.ready;
        await f.getByRole('combobox', { name: 'Snapshot', exact: true }).selectOption('1');
        await expect(f.locator('.snapshot-context')).toContainText('Viewing snapshot 2');
        held.release(); await delivered(page, 2);
        await expect(f.locator('.snapshot-context')).toContainText('Viewing snapshot 2');
        await expect(f.locator('.thread-focus-card')).toHaveCount(0);
    } finally { held.release(); }
});

test('late navigation errors do not disturb a newer selection', async ({ page }) => {
    await page.goto(host.url + '?case=noFindings'); const f = widget(page);
    const held = await holdFirstCall(page, 'Delayed old error');
    try {
        await f.getByRole('button', { name: 'Inspect thread: worker-2', exact: true }).click();
        await held.ready;
        await f.getByRole('button', { name: 'Inspect thread: worker-3', exact: true }).click();
        await expect(f.locator('.thread-focus-card h2')).toHaveText('worker-3');
        held.release(); await delivered(page, 2);
        await expect(f.locator('.thread-focus-card h2')).toHaveText('worker-3');
        await expect(f.getByText('Delayed old error')).toHaveCount(0);
    } finally { held.release(); }
});

test('a cache miss during comparison paging preserves the requested view, page and language', async ({ page }) => {
    await page.goto(host.url + '?case=assessmentSeries'); const f = widget(page);
    await page.evaluate(async () => {
        const data = await (await fetch('/data?case=assessmentSeries')).json();
        const result = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name: 'render_thread_report', arguments: {
            reportId: data.structuredContent.reportId, view: 'comparison', language: 'sv', offset: 0, limit: 1 } }) })).json();
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
    });
    await expect(f.getByRole('heading', { name: 'Jämför snapshots', exact: true })).toBeVisible();
    let missed = false;
    await page.route('**/tool', async route => {
        const call = route.request().postDataJSON();
        if (!missed && call.name === 'render_thread_report' && call.arguments.offset === 1) {
            missed = true;
            await route.fulfill({ json: { isError: true, content: [{ type: 'text', text: 'SNAPSHOTS_NOT_CACHED: Analyze the requested page again with offset/limit.' }] } });
        } else await route.continue();
    });
    await f.getByRole('button', { name: 'Nästa snapshots', exact: true }).click();
    await expect(f.getByRole('button', { name: 'Föregående snapshots', exact: true })).toBeVisible();
    await expect(f.getByRole('heading', { name: 'Jämför snapshots', exact: true })).toBeVisible();
    await expect(f.getByRole('combobox', { name: 'Rapportspråk', exact: true })).toHaveValue('sv');
    const calls = await page.evaluate(() => window.completedCalls);
    expect(calls.map(c => c.name)).toEqual(['render_thread_report', 'analyze_thread_dumps', 'render_thread_report']);
    expect(calls.at(-1).arguments).toMatchObject({ view: 'comparison', language: 'sv', offset: 1, limit: 1 });
});

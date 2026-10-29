import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const fixture = fileURLToPath(new URL('./fixtures/http-client-selection.txt', import.meta.url));
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true, capturePath: fixture }); await mkdir(previews, { recursive: true }); });
test.afterAll(async () => host?.close());

async function selectHttp(page, language = 'en') {
    await page.goto(host.url + '?case=noFindings&native&mode=fullscreen&theme=' + (language === 'sv' ? 'light' : 'dark'));
    const f = page.frameLocator('iframe');
    await expect(f.locator('.thread-inventory')).toBeVisible();
    await page.evaluate(async language => {
        const initial = await (await fetch('/data?case=noFindings')).json();
        const sourceKeys = initial._meta.jvmscopeReport.snapshots.items[0].threadInventory.items.filter(t => t.name.startsWith('HttpClient-')).map(t => t.sourceKey);
        const result = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name: 'render_thread_details', arguments: {
            reportId: initial.structuredContent.reportId, snapshotIndex: 0, sourceKeys, language,
            conclusion: { summary: language === 'sv' ? 'Fyra selektortrådar visar samma stackramar; arbetstråden visar en annan stack. Detta kopplar dem inte till mains anrop.' : 'Four selector threads show the same frames; the worker has a different stack. This does not link them to main’s request.',
                nextCheck: language === 'sv' ? 'Jämför anropsloggar med fler dumpar.' : 'Correlate request logs with more captures.' }
        } }) })).json();
        if (result.isError) throw new Error(JSON.stringify(result));
        window.httpResult = result;
        document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result }, '*');
    }, language);
    return f;
}

test('five requested HTTP threads share an overview while each original stays independently inspectable', async ({ page }) => {
    const f = await selectHttp(page);
    await expect(f.locator('.stack-group')).toHaveCount(2);
    await expect(f.locator('.stack-member')).toHaveCount(5);
    await expect(f.locator('.thread-focus-card:visible')).toHaveCount(1);
    await expect(f.locator('.thread-metrics-note')).toHaveCount(1);
    await expect(f.locator('h1')).toHaveText('HTTP client threads · Snapshot 1');
    await expect(f.locator('.stack-group').first()).toContainText('4 threads');
    await expect(f.locator('.group-qualification')).toContainText('do not establish a shared request or lock');
    const before = host.calls.length;
    for (let i = 1; i <= 4; i++) {
        const member = f.getByRole('button', { name: `HttpClient-${i}-SelectorManager`, exact: true });
        await member.focus(); await page.keyboard.press('Enter');
        const card = f.locator('.thread-focus-card:visible');
        await expect(card.locator('h2')).toHaveText(`HttpClient-${i}-SelectorManager`);
        await expect(card.locator('.evidence')).toContainText(`<0x${i.toString(16).padStart(16, '0')}>`);
        await expect(member).toHaveAttribute('aria-pressed', 'true');
    }
    await f.getByRole('button', { name: 'HttpClient-1-Worker-0', exact: true }).click();
    await expect(f.locator('.thread-focus-card:visible .evidence')).toContainText('SynchronousQueue.poll');
    await expect(f.locator('.ai-conclusion-summary')).toContainText('Four selector threads');
    expect(host.calls.length).toBe(before, 'switching preverified originals does not reread or reparse the capture');
    await f.locator('.surface-back').click(); await f.locator('.open-analysis').click();
    await expect(f.locator('.thread-focus-card:visible h2')).toHaveText('HttpClient-1-Worker-0');
    await f.getByRole('combobox', { name: 'Report language' }).selectOption('sv');
    await expect(f.locator('.thread-focus-card:visible h2')).toHaveText('HttpClient-1-Worker-0');
    await expect(f.locator('h1')).toHaveText('HTTP-klienttrådar · Snapshot 1');
});

test('grouped evidence stays readable at panel and phone widths with no page overflow', async ({ page }) => {
    for (const [width, language] of [[735, 'en'], [390, 'sv']]) {
        await page.setViewportSize({ width, height: 1100 });
        const f = await selectHttp(page, language);
        await expect(f.locator('.stack-group')).toHaveCount(2);
        await expect(f.locator('.thread-focus-card:visible .evidence')).toBeVisible();
        if (width === 735) expect(await f.locator('.thread-focus-card:visible .evidence').evaluate(n => n.getBoundingClientRect().top)).toBeLessThan(1000);
        expect(await f.locator('body').evaluate(n => n.scrollWidth > n.clientWidth + 1)).toBe(false);
        await f.locator('.stack-group').first().locator('summary').click();
        await expect(f.locator('.shared-frames')).toBeVisible();
        await expect(f.locator('.shared-frames')).toContainText('HttpClientImpl$SelectorManager.run');
        await f.locator('.stack-group').first().locator('summary').click();
        await page.screenshot({ path: previews + `http-threads-${language}-${width}.png`, fullPage: true });
    }
});

for (const language of ['en', 'sv']) {
    test(`scripted four-turn ${language} conversation preserves overview, main and HTTP evidence in separate panels`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(host.url + '/conversation?theme=' + (language === 'sv' ? 'light' : 'dark'));
        // This scenario exercises the MCP/UI contract with fixed assessments. It is
        // not a fresh model run; the independent 0.5.1 recordings have separate tests.
        const turns = language === 'en' ? [
            ['Analyze this dump.', 'main waits in an HTTP call; this snapshot does not establish how long it has waited.', 'Compare another capture and request timings.'],
            ['Show main’s stack and explain its wait.', 'main is parked through CompletableFuture.get inside HttpClientImpl.send at StatusClient.java:152.', 'Check the request timeout and timing logs.'],
            ['Show the HTTP client stacks and what they establish.', 'Four selector threads share frames; a worker has a different stack. This does not identify which client owns main’s request.', 'Correlate request identity with another capture.'],
        ] : [
            ['Analysera dumpen.', 'main väntar i ett HTTP-anrop; denna snapshot visar inte hur länge väntan har pågått.', 'Jämför en ny dump och anropets tidsuppgifter.'],
            ['Visa mains stack och förklara väntan.', 'main är parkerad via CompletableFuture.get i HttpClientImpl.send vid StatusClient.java:152.', 'Kontrollera anropets timeout och tidsloggar.'],
            ['Visa HTTP-klienternas stackar och vad de visar.', 'Fyra selektortrådar har samma stackramar; en arbetstråd har en annan stack. Det identifierar inte klienten för mains anrop.', 'Koppla anropets identitet till en ny dump.'],
        ];
        for (const [index, [prompt, summary, nextCheck]] of turns.entries()) {
            await page.evaluate(async ({ index, prompt, summary, nextCheck, language }) => {
                const initial = await (await fetch('/data?case=noFindings')).json();
                const rows = initial._meta.jvmscopeReport.snapshots.items[0].threadInventory.items;
                const args = { reportId: initial.structuredContent.reportId, snapshotIndex: 0, language };
                if (index) args.sourceKeys = rows.filter(t => index === 1 ? t.name === 'main' : t.name.startsWith('HttpClient-')).map(t => t.sourceKey);
                const call = async (name, arguments_) => {
                    const result = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name, arguments: arguments_ }) })).json();
                    if (result.isError) throw new Error(JSON.stringify(result)); return result;
                };
                if (index) await call('inspect_thread_details', args);
                const result = await call(index ? 'render_thread_details' : 'render_thread_report', { ...args, conclusion: { summary, nextCheck } });
                window.chatMessage('user', prompt);
                window.presentReport(result, ['Overview', 'main', 'HTTP clients'][index]);
                window.chatMessage('assistant', result.structuredContent.chatAnswer.text);
            }, { index, prompt, summary, nextCheck, language });
        }
        const overview = page.frameLocator('iframe[title="Overview"]'), main = page.frameLocator('iframe[title="main"]'), http = page.frameLocator('iframe[title="HTTP clients"]');
        await expect(page.locator('iframe')).toHaveCount(3);
        await expect(http.locator('.ai-conclusion-summary')).toHaveText(turns[2][1]);
        await expect(http.locator('.stack-member')).toHaveCount(5);
        await http.getByRole('button', { name: 'HttpClient-4-SelectorManager', exact: true }).click();
        await expect(http.locator('.thread-focus-card:visible .evidence')).toContainText('<0x0000000000000004>');
        const before = host.calls.length;
        await page.evaluate(language => {
            window.chatMessage('user', language === 'sv' ? 'Vad ska jag samla in härnäst?' : 'What should I collect next?');
            window.chatMessage('assistant', language === 'sv' ? 'Samla fler tidsstämplade dumpar och korrelera dem med anropets identitet och tidsloggar.' : 'Collect more timestamped dumps and correlate them with request identity and timing logs.');
        }, language);
        await expect(page.locator('iframe')).toHaveCount(3);
        await expect(page.locator('.assistant')).toHaveCount(4);
        expect(host.calls.length).toBe(before, 'text-only collection advice leaves existing report state alone');
        await page.getByRole('tab', { name: 'Overview', exact: true }).click();
        await expect(overview.locator('.ai-conclusion-summary')).toHaveText(turns[0][1]);
        await page.getByRole('tab', { name: 'main', exact: true }).click();
        await expect(main.locator('.ai-conclusion-summary')).toHaveText(turns[1][1]);
        await expect(main.locator('.evidence')).toContainText('StatusClient.java:152');
        await page.getByRole('tab', { name: 'HTTP clients', exact: true }).click();
        await expect(http.locator('.thread-focus-card:visible h2')).toHaveText('HttpClient-4-SelectorManager');
        await http.locator('.surface-back').click(); await http.locator('.open-analysis').click();
        await expect(http.locator('.ai-conclusion-summary')).toHaveText(turns[2][1]);
        await expect(http.locator('.thread-focus-card:visible .evidence')).toContainText('<0x0000000000000004>');
        await expect.poll(async () => {
            const height = await http.locator('body').evaluate(n => n.getBoundingClientRect().height);
            const frame = await page.locator('iframe[title="HTTP clients"]').boundingBox();
            return frame.height >= height - 1;
        }, { message: 'The host frame must grow to fit the reopened report, including the original stack' }).toBe(true);
        await expect(http.locator('.stack-group').first()).toBeInViewport();
        await page.screenshot({ path: previews + `four-turn-${language}.png`, fullPage: true });
        await http.locator('.thread-focus-card:visible .evidence').scrollIntoViewIfNeeded();
        // Scrollbar/border rounding can clip a fraction of a CSS pixel.
        await expect(http.locator('.thread-focus-card:visible .evidence')).toBeInViewport({ ratio: 0.99 });
        await page.screenshot({ path: previews + `four-turn-source-${language}.png`, fullPage: true });
        await http.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true }).click();
        await expect(http.locator('.ai-conclusion-summary')).toHaveText(turns[0][1]);
        await http.getByRole('button', { name: language === 'sv' ? 'Granska stack' : 'Inspect stack', exact: true }).click();
        await expect(http.locator('.ai-conclusion-summary')).toHaveText(turns[1][1]);
        await expect(http.locator('.evidence')).toContainText('StatusClient.java:152');
    });
}

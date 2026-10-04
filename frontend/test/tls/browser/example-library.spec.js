import { test, expect } from './fixtures.js';
import { THREAD_EXAMPLES, TLS_EXAMPLES } from '../../../assets/javautils/example-catalog.js';
import { readFileSync } from 'node:fs';
import { analyzeThreadDump } from '../../../assets/javautils/tda/parser.js';
import { analyzeTlsLog } from '../../../assets/javautils/tls-parser.js';

test('TDA real CPU example links four snapshots, measured hot activity and the original stack', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#chooseExampleBtn').click();
    await page.locator('[data-example-id="tda-cpu-history"]').click();
    await expect(page.locator('#dumpSelect option')).toHaveCount(4);
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await page.locator('#cpuTimelineSearch').fill('example-cpu-hot-worker');
    await expect(page.locator('#cpuTimelineChart [role="button"]')).toHaveCount(3);
    await page.locator('#cpuTimelineChart [role="button"]').last().click();
    await expect(page.locator('#dumpSelect')).toHaveValue('3');
    await page.locator('#searchInput').fill('example-cpu-hot-worker');
    await expect(page.locator('#threadTableBody tr')).toHaveCount(1);
    await expect(page.locator('#threadTableBody')).toContainText('CPU hot');
    await page.locator('#threadTableBody .thread-cell-name').click();
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('ThreadLibraryScenarios.computePrimes');
    await expect(page.locator('.thread-details-comparison')).toContainText('Snapshot 3 → 4');
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history.locator('dt:has-text("Occurrences") + dd')).toHaveText('4');
    await expect(history).toContainText('Observed 3/4');
});

test('TDA real virtual workers retain their carrier and unavailable CPU facts', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#chooseExampleBtn').click();
    await page.locator('[data-example-id="tda-virtual-workers"]').click();
    await page.locator('#searchInput').fill('example-virtual-');
    await expect(page.locator('#threadTableBody tr')).toHaveCount(5);
    await expect(page.locator('#threadTableBody')).not.toContainText('CPU hot');
    await expect(page.locator('#cpuTimelineChart svg')).toHaveCount(0);
    await page.locator('#threadTableBody .thread-cell-name').filter({ hasText: 'example-virtual-cpu-hot-worker' }).click();
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('example-virtual-cpu-hot-worker');
    await expect(page.locator('#threadModal .thread-details-code')).not.toContainText('"virtual":');
    await page.getByRole('button', { name: 'Original JSON', exact: true }).click();
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('"virtual": true');
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('"carrier"');
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU total' })).toContainText('—');
    await page.keyboard.press('Escape');
    await page.locator('#searchInput').fill('');
    await page.locator('#onlyCarrierToggle').check();
    await expect(page.locator('#threadTableBody tr')).toHaveCount(1);
    await expect(page.locator('#threadTableBody')).toContainText('ForkJoinPool');
});

for (const analyzer of ['tda', 'tls']) {
    const samples = analyzer === 'tda' ? THREAD_EXAMPLES : TLS_EXAMPLES;
    test(`${analyzer.toUpperCase()} example library searches and filters without replacing the capture`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        const requests = [];
        page.on('request', request => { if (/\.(txt|json)(\?|$)/.test(request.url())) requests.push(request.url()); });
        const opener = page.getByRole('button', { name: 'Browse examples', exact: true });
        await opener.click();
        const modal = page.locator('#exampleModal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('#exampleSearch')).toBeFocused();
        await expect(modal.locator('.example-card:visible')).toHaveCount(samples.length);
        await expect(modal.locator('.modal-footer')).toBeInViewport();
        await modal.screenshot({ path: `../.run/examples/${analyzer}-${test.info().project.name}.png` });
        await modal.getByRole('combobox', { name: 'Java version / format' }).selectOption('Java 27');
        await expect(modal.locator('.example-card:visible')).toHaveCount(samples.filter(sample => sample.version === 'Java 27').length);
        await modal.locator('#exampleSearch').fill('   Java   27  ');
        await expect(modal.locator('.example-card:visible').first()).toBeVisible();
        await modal.locator('#exampleSearch').fill('<img src=x> [.*]');
        await expect(modal.locator('.example-empty')).toBeVisible();
        await expect(modal.locator('img')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(opener).toBeFocused();
        await expect(page.locator('#fileName')).toHaveText('No file loaded');
        expect(requests).toEqual([]);
        await page.locator('#chooseExampleBtn').click();
        await expect(modal.locator('#exampleSearch')).toHaveValue('');
        await expect(modal.locator('.example-card:visible')).toHaveCount(samples.length);
        await modal.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(page.locator('#chooseExampleBtn')).toBeFocused();
    });

    test(`${analyzer.toUpperCase()} loads every named example from a packaged server file`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        for (const sample of samples) {
            await page.locator('#chooseExampleBtn').click();
            const response = page.waitForResponse(response => /\.(txt|json)(\?|$)/.test(response.url()));
            await page.locator(`[data-example-id="${sample.id}"]`).click();
            const fetched = await response;
            expect(fetched.status(), sample.id).toBe(200);
            expect(fetched.request().method()).toBe('GET');
            // API bytes avoid DevTools' text-decoding fallback for files without a charset.
            const raw = await page.request.get(fetched.url());
            expect(await raw.body()).toEqual(readFileSync(new URL(sample.url)));
            await expect(page.locator('#exampleModal')).toBeHidden();
            if (analyzer === 'tda') {
                const result = analyzeThreadDump(readFileSync(new URL(sample.url), 'utf8'));
                const threads = result.snapshots[0].parsedThreads.length;
                await expect(page.locator('#rowCount')).toHaveText(`1–${Math.min(threads, 50)} of ${threads} threads`);
                await expect(page.locator('#dumpSelect option')).toHaveCount(result.snapshots.length > 1 ? result.snapshots.length : 0);
                if (sample.id === 'tda-partial') {
                    await expect(page.locator('#inputFeedbackModal')).toBeVisible();
                    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
                }
                if (sample.id === 'tda-deadlock') await expect(page.locator('#deadlockPanel')).toBeVisible();
            } else {
                const count = analyzeTlsLog(readFileSync(new URL(sample.url), 'utf8')).interactions.length;
                await expect(page.locator('#rowCount')).toHaveText(`${count} / ${count} interactions`);
                await expect(page.locator('#fileName')).toHaveText(sample.filename);
            }
            await expect(page.locator('#analyzerStart')).toBeHidden();
        }
    });

    test(`${analyzer.toUpperCase()} keeps the current capture when an example download fails`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        await page.locator('#loadSampleBtn').click();
        await expect(page.locator('#rowCount')).toHaveText(analyzer === 'tda' ? '1–50 of 67 threads' : '35 / 35 interactions');
        const name = await page.locator('#fileName').textContent();
        const rows = await page.locator('#rowCount').textContent();
        const pattern = analyzer === 'tda' ? '**/*tda-deadlock*.txt' : '**/*tls-timeout*.txt';
        for (const response of [{ status: 503, body: 'unavailable' },
            { status: 200, contentType: 'text/html', body: '<html>missing file</html>' },
            { status: 200, contentType: 'text/plain', body: 'This is not a diagnostic capture.' }]) {
            await page.route(pattern, route => route.fulfill(response));
            await page.locator('#chooseExampleBtn').click();
            await page.locator(`[data-example-id="${analyzer === 'tda' ? 'tda-deadlock' : 'tls-timeout'}"]`).click();
            const feedback = page.locator(analyzer === 'tda' ? '#inputFeedbackModal' : '#errorState');
            await expect(feedback).toBeVisible();
            await expect(feedback).toContainText(/Could not load example|Invalid thread dump/);
            await expect(page.locator('#fileName')).toHaveText(name);
            await expect(page.locator('#rowCount')).toHaveText(rows);
            await expect(page.locator('#loadingState')).toBeHidden();
            if (analyzer === 'tda') await feedback.getByRole('button', { name: 'Close', exact: true }).click();
            await page.unroute(pattern);
        }
    });

    test(`${analyzer.toUpperCase()} Clear cancels a delayed example and prevents it restoring the capture`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        await page.locator('#loadSampleBtn').click();
        await expect(page.locator('#analyzerStart')).toBeHidden();
        const id = analyzer === 'tda' ? 'tda-deadlock' : 'tls-timeout';
        let delayed;
        const pattern = analyzer === 'tda' ? '**/*tda-deadlock*.txt' : '**/*tls-timeout*.txt';
        await page.route(pattern, route => { delayed = route; });
        await page.locator('#chooseExampleBtn').click();
        const request = page.waitForRequest(request => request.url().includes(id) && request.url().endsWith('.txt'));
        await page.locator(`[data-example-id="${id}"]`).click();
        await request;
        await page.locator('#clearBtn').click();
        await expect(page.locator('#analyzerStart')).toBeVisible();
        await delayed.fulfill({ status: 200, body: readFileSync(new URL(samples.find(sample => sample.id === id).url), 'utf8') }).catch(() => {});
        // Exercise the real UI after the old request is released, without timer-based assertions.
        await page.locator('#loadSampleBtn').click();
        await expect(page.locator('#rowCount')).toHaveText(analyzer === 'tda' ? '1–50 of 67 threads' : '35 / 35 interactions');
        await expect(page.locator('#errorState')).toBeHidden();
    });
}

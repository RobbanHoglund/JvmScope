import { test, expect } from './fixtures.js';

const dump = number => `2026-10-03 12:00:0${number}\nFull thread dump OpenJDK 64-Bit Server VM (27 mixed mode):\n\n"welcome-worker" #7 prio=5 os_prio=0 cpu=${number * 100}.00ms elapsed=${number * 10}.00s tid=0x00000007 nid=7 runnable\n   java.lang.Thread.State: RUNNABLE\n        at example.Worker.run(Worker.java:7)`;
const source = (text, name = 'welcome.txt') => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
async function drop(page, selector, texts) {
    const transfer = await page.evaluateHandle(texts => {
        const value = new DataTransfer();
        texts.forEach((text, index) => value.items.add(new File([text], `drop-${index}.txt`, { type: 'text/plain' })));
        return value;
    }, texts);
    try {
        await page.locator(selector).dispatchEvent('dragenter', { dataTransfer: transfer });
        await expect(page.locator(selector)).toHaveClass(/is-dragging/);
        await page.locator(selector).dispatchEvent('drop', { dataTransfer: transfer });
        await expect(page.locator(selector)).not.toHaveClass(/is-dragging/);
    } finally { await transfer.dispose(); }
}

test('TDA starts with guidance, accepts multiple dropped dumps, and keeps the session when filters match nothing', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    const start = page.locator('#analyzerStart');
    await expect(start).toBeVisible();
    await expect(start).toContainText('Nothing is uploaded');
    for (const selector of ['#tableContainer', '#metaBar', '.tda-filter-row', '.session-input-mode', '#clearBtn', '#openRawDumpBtn']) await expect(page.locator(selector)).toBeHidden();
    const chooser = page.waitForEvent('filechooser');
    await start.getByRole('button', { name: 'Choose dump files' }).click();
    await (await chooser).setFiles([]);
    await expect(start).toBeVisible();
    await drop(page, '#analyzerStart', [dump(1), dump(2)]);
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await expect(start).toBeHidden();
    await expect(page.locator('#tableContainer')).toBeVisible();
    await page.locator('#searchInput').fill('no-such-welcome-thread');
    await expect(page.locator('#threadEmptyState')).toBeVisible();
    await expect(start).toBeHidden();
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#clearThreadFiltersBtn').click();
    await expect(page.locator('#threadTableBody tr')).toHaveCount(1);
    await expect(page.locator('#searchInput')).toBeFocused();
    await page.locator('#clearBtn').click();
    await expect(start).toBeVisible();
    await expect(start.getByRole('button', { name: 'Choose dump files' })).toBeFocused();
    await expect(page.locator('#threadStateChartPanel')).toBeHidden();
    await page.screenshot({ path: `../.run/start-views/tda-${test.info().project.name}.png`, fullPage: true });
});

test('TDA start actions preserve paste, invalid-input recovery and keyboard sample loading', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles(source('This is not a JVM dump.'));
    await expect(page.locator('#inputFeedbackModal')).toBeVisible();
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await page.evaluate(text => navigator.clipboard.writeText(text), dump(1));
    await page.locator('#analyzerStart').getByRole('button', { name: 'Paste dump' }).click();
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await page.locator('#fileInput').setInputFiles(source('Still not a dump.', 'invalid.txt'));
    await expect(page.locator('#inputFeedbackModal')).toContainText('kept');
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('#tableContainer')).toBeVisible();
    await expect(page.locator('#analyzerStart')).toBeHidden();
    await page.locator('#clearBtn').click();
    await page.locator('#analyzerStart').getByRole('button', { name: 'Try sample' }).press('Enter');
    await expect(page.locator('#rowCount')).toHaveText('1–50 of 67 threads');
    await expect(page.locator('#analyzerStart')).toBeHidden();
    await expect(page.locator('#searchInput')).toBeFocused();
});

test('TLS hides the empty inspector, keeps filtered captures, and restores its start panel on Clear', async ({ page }) => {
    await page.reload();
    const start = page.locator('#analyzerStart');
    for (const selector of ['.tls-workspace', '.tls-filter-row', '#metaBar', '#tlsInspector']) await expect(page.locator(selector)).toBeHidden();
    await expect(start).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await start.getByRole('button', { name: 'Choose log file' }).click();
    await (await chooser).setFiles([]);
    await start.getByRole('button', { name: 'Try sample' }).press('Enter');
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await expect(page.locator('#tlsInspector')).toHaveAttribute('data-selected-id', '35');
    await expect(start).toBeHidden();
    await page.locator('#searchInput').fill('no-such-welcome-host');
    await expect(page.locator('#emptyState')).toContainText('No interactions match');
    await expect(page.locator('.tls-workspace')).toBeVisible();
    await expect(start).toBeHidden();
    await page.locator('#tlsClearFilters').click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await page.locator('#clearBtn').click();
    await expect(start).toBeVisible();
    await expect(start.getByRole('button', { name: 'Choose log file' })).toBeFocused();
    await page.screenshot({ path: `../.run/start-views/tls-${test.info().project.name}.png`, fullPage: true });
    await drop(page, '#analyzerStart', ['javax.net.ssl|DEBUG|A|worker|2026-10-03 12:00:00.000 UTC|X.java:1|Fatal (HANDSHAKE_FAILURE): test']);
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    await expect(start).toBeHidden();
});

test('TLS unsupported input stays visible with guidance and can recover using the sample', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles(source('ordinary application text'));
    await expect(page.locator('#emptyState')).toContainText('No TLS interactions detected');
    await expect(page.locator('#errorState')).toBeVisible();
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await expect(page.locator('#errorState')).toBeHidden();
});

test('pending first input can be cancelled from the start view without a late capture appearing', async ({ page, appUrl }) => {
    for (const analyzer of ['tda', 'tls']) {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        await page.evaluate(() => {
            File.prototype.text = () => new Promise(resolve => { window.finishWelcomeRead = resolve; });
        });
        await page.locator('#fileInput').setInputFiles(source(dump(1)));
        await expect(page.locator('#loadingState')).toBeVisible();
        await expect(page.locator('#analyzerStart')).toBeVisible();
        await page.locator('#clearBtn').click();
        await expect(page.locator('#loadingState')).toBeHidden();
        await page.evaluate(text => window.finishWelcomeRead(text), dump(1));
        await expect(page.locator('#fileName')).toHaveText('No file loaded');
        await expect(page.locator('#analyzerStart')).toBeVisible();
        await expect(page.locator('#tableContainer')).toBeHidden();
    }
});

test('all shipped pages expose consistent navigation and correct home/active links', async ({ page, appUrl }) => {
    const slim = test.info().project.metadata.slim;
    const paths = slim ? ['/jvmscope/tda.html', '/jvmscope/tls.html'] : ['/', '/utils.html', '/jvmscope/tda.html', '/jvmscope/tls.html'];
    for (const path of paths) {
        await page.goto(`${appUrl}${path}`);
        const nav = page.getByRole('navigation', { name: 'Analysis tools' });
        await expect(nav).toBeVisible();
        await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
        await expect(nav.getByRole('link')).toHaveCount(slim ? 2 : 3);
        await expect(page.locator('a[href*="dockerutils"]')).toHaveCount(0);
        const bounds = await nav.boundingBox();
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (path === '/' || path === '/utils.html') {
            await expect(page.locator('.utility-card')).toHaveCount(2);
            await expect(page.locator('.hero-badge')).toHaveText('2 tools available');
        }
    }
    const nav = page.getByRole('navigation', { name: 'Analysis tools' });
    await nav.getByRole('link', { name: 'Thread dumps', exact: true }).click();
    await expect(page).toHaveTitle('JvmScope · Java Thread Dump Analyzer');
    await page.getByRole('navigation', { name: 'Analysis tools' }).getByRole('link', { name: 'TLS log analyzer', exact: true }).click();
    await expect(page).toHaveTitle('JvmScope · Java TLS Log Analyzer');
});

test('removed Docker pages, workers and registry API are unavailable', async ({ page, appUrl }) => {
    for (const path of ['/dockerutils/index.html', '/assets/dockerutils/main.js',
        '/assets/dockerutils/worker.js', '/api/dockerutils/registry-archive']) {
        expect((await page.request.get(`${appUrl}${path}`)).status(), path).toBe(404);
        expect((await page.request.head(`${appUrl}${path}`)).status(), path).toBe(404);
    }
    const response = await page.request.post(`${appUrl}/api/dockerutils/registry-archive`, {
        data: { imageReference: 'unapproved.example/demo:latest', platform: 'linux/amd64' },
    });
    expect([404, 405]).toContain(response.status());
    // A failed request to a removed tool must not break the analyzers.
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await expect(page).toHaveTitle('JvmScope · Java Thread Dump Analyzer');
    await page.getByRole('navigation', { name: 'Analysis tools' })
        .getByRole('link', { name: 'TLS log analyzer', exact: true }).click();
    await expect(page).toHaveTitle('JvmScope · Java TLS Log Analyzer');
});

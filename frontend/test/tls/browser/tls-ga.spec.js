import { test, expect } from './fixtures.js';

const log = (message, clock = '10:00:00.000 UTC') => `javax.net.ssl|DEBUG|A|worker|2026-10-02 ${clock}|X.java:1|${message}`;
const upload = (page, text) => page.locator('#fileInput').setInputFiles({ name: 'ga-trace.log', mimeType: 'text/plain', buffer: Buffer.from(text) });

test('uses its Java TLS identity across the app, guide, favicon and both launch pages', async ({ page, appUrl }) => {
    await expect(page).toHaveTitle('JvmScope · Java TLS Log Analyzer');
    await expect(page.getByRole('heading', { name: 'JvmScope · Java TLS Log Analyzer', exact: true })).toBeVisible();
    const mark = page.locator('.tls-brand-mark');
    expect(await mark.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    if (icon.startsWith('data:')) expect(icon).toMatch(/^data:image\/svg\+xml/);
    else expect((await page.request.get(new URL(icon, appUrl).href)).ok()).toBe(true);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'JvmScope · Java TLS Log Analyzer · Guide', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const path of test.info().project.metadata.slim ? ['/', '/jvmscope/tda.html'] : ['/', '/utils.html']) {
        await page.goto(`${appUrl}${path}`);
        if (test.info().project.metadata.slim) {
            const navigation = page.getByRole('navigation', { name: 'Analysis tools' });
            await expect(navigation).toBeVisible();
            await navigation.getByRole('link', { name: 'TLS log analyzer', exact: true }).click();
            await expect(page).toHaveTitle('JvmScope · Java TLS Log Analyzer');
            continue;
        }
        const link = page.getByRole('link', { name: /JvmScope · Java TLS Log Analyzer/ });
        await expect(link).toBeVisible();
        expect(await link.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
        await link.click();
        await expect(page).toHaveTitle('JvmScope · Java TLS Log Analyzer');
    }
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await page.getByRole('button', { name: 'Select interaction 7', exact: true }).click();
    await page.screenshot({ path: `../.run/${test.info().project.metadata.slim ? 'slim-ui' : 'tls-ga'}/branding-${test.info().project.name}.png`, fullPage: true });
});

test('keyboard sorting exposes its direction and resets correctly when another capture is loaded', async ({ page }) => {
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    const id = page.locator('th[data-key="id"]');
    await id.getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(id).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('#tlsTableBody tr').first()).toHaveAttribute('data-id', '1');
    await page.keyboard.press('Space');
    await expect(id).toHaveAttribute('aria-sort', 'descending');
    await expect(page.locator('#tlsTableBody tr').first()).toHaveAttribute('data-id', '35');
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await expect(id).toHaveAttribute('aria-sort', 'none');
    await expect(page.locator('th[data-key="startTs"]')).toHaveAttribute('aria-sort', 'descending');
    await page.locator('#tlsInvestigateColumns').click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsRawPanel')).toHaveAttribute('tabindex', '0');
});

test('truncated fatal-alert evidence drives the row, failure facet, inspector and full details consistently', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const text = [log('Produced ClientHello handshake message'), log('Consuming server Finished handshake message'),
        log('Produced client Finished handshake message'), log('Received alert message ('),
        '"Alert": {', '"level": "fatal",', '"description": "certificate_required"', '}'].join('\n');
    await upload(page, text);
    await expect(page.locator('#tlsTableBody')).toContainText('failure');
    await expect(page.locator('#tlsInspector')).toContainText('certificate required');
    await expect(page.locator('.tls-event-failure')).toContainText('Fatal alert: certificate_required');
    await expect(page.locator('.tls-event-failure')).toContainText('after completion');
    await page.locator('#tlsFailureFacet > summary').click();
    await page.locator('#tlsFailureGroups button').click();
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    await page.locator('.tls-event-failure').getByRole('button').click();
    expect(await page.locator('#tlsInspector .rawline').allTextContents()).toEqual(text.split('\n'));
    await page.getByRole('button', { name: 'Full details', exact: true }).click();
    await expect(page.locator('#tlsModal')).toContainText('Received fatal alert: certificate_required');
});

test('reversed and incomplete clocks are excluded from periods without hiding evidence or changing outcomes', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    for (const clock of ['09:59:59.000 UTC', '10:00:01.000 CST']) {
        await upload(page, [log('Produced ClientHello handshake message'), log('Consuming server Finished handshake message', clock),
            log('Produced client Finished handshake message', '10:00:02.000 UTC')].join('\n'));
        await expect(page.locator('#tlsTimelineEmpty')).toBeVisible();
        await expect(page.locator('#tlsInspector')).toContainText('Finished exchange observed');
        await expect(page.locator('.tls-inspector-facts')).toContainText('Observed span Not captured');
        await expect(page.locator('.tls-coverage')).toContainText('period filtering unavailable');
        await page.locator('#tlsPeriodMenu > summary').click();
        await expect(page.locator('#tlsUntimed')).toHaveText('Without time: 1');
        await page.locator('#tlsUntimed').click();
        await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    }
});

test('loading and investigating a capture fetches only its same-origin static worker, with no upload or telemetry', async ({ page, appUrl }) => {
    const requests = [];
    page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
    await upload(page, log('Fatal (INTERNAL_ERROR): local-only evidence'));
    await page.locator('#tlsInvestigateColumns').click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsInspector .rawline')).toHaveCount(1);
    await page.locator('#tlsCertificatesTab').click();
    await page.locator('#searchInput').fill('local-only');
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    const workerUrl = new URL(requests[0].url);
    expect(workerUrl.origin).toBe(new URL(appUrl).origin);
    expect(workerUrl.pathname).toMatch(/^\/assets\/tls-analysis-worker-[^/]+\.js$/);
    expect(workerUrl.search).toBe('');
});

test('a dense capture remains searchable and retains exact evidence for a selected interaction', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const count = 2000;
    const text = Array.from({ length: count }, (_, index) => [
        log(`Produced ClientHello handshake message · capture-${index}`),
        log('Consuming server Finished handshake message'),
        log('Produced client Finished handshake message'),
    ].join('\n')).join('\n');
    const start = performance.now();
    await upload(page, text);
    await expect(page.locator('#rowCount')).toHaveText(`1–200 of ${count} / ${count} interactions`);
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(200);
    test.info().annotations.push({ type: 'measurement', description: `6000 records / ${Buffer.byteLength(text)} bytes: load to ready ${Math.round(performance.now() - start)} ms` });
    for (let pageIndex = 1; pageIndex < count / 200; pageIndex++) await page.locator('#tlsNextPage').click();
    await expect(page.locator('#tlsPageLabel')).toHaveText('Page 10 of 10');
    await page.getByRole('button', { name: `Select interaction ${count}`, exact: true }).click();
    await page.locator('#tlsRawTab').click();
    expect(await page.locator('#tlsInspector .rawline').allTextContents()).toEqual(text.split('\n').slice(-3));
    await page.locator('#searchInput').fill('no-such-host');
    await expect(page.locator('#rowCount')).toHaveText(`0 / ${count} interactions`);
    await expect(page.locator('#tlsInspector')).toContainText('Select an interaction');
    await page.locator('#clearBtn').click();
    await expect(page.locator('#rowCount')).toHaveText('0 / 0 interactions');
});

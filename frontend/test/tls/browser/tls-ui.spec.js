import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const fixturePath = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const rows = page => page.locator('#tlsTableBody tr');
const row = (page, id) => page.locator(`#tlsTableBody tr[data-id="${id}"]`);
const cells = (page, column) => rows(page).locator(`td:nth-child(${column})`);
const details = page => page.locator('#tlsModal');
const explanation = page => page.locator('#issueModal');
const clipboardText = page => page.evaluate(async () => (await navigator.clipboard.readText()).replaceAll('\r\n', '\n'));

async function setFilter(page, id, checked) {
    const input = page.locator(`#${id}`);
    // Click the label to exercise the same filter interaction as the user.
    if (await input.isChecked() !== checked) await page.locator('label').filter({ has: input }).click();
    if (checked) await expect(input).toBeChecked();
    else await expect(input).not.toBeChecked();
}

async function upload(page, text, name = 'fixture.log') {
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#fileName')).toHaveText(name);
}

async function sample(page) {
    await page.getByRole('button', { name: /Full sample/ }).click();
    await expect(rows(page)).toHaveCount(35);
}

const jsse = (message, { tid = 'A', time = '12:00:00.000', thread = 'worker' } = {}) =>
    `javax.net.ssl|DEBUG|${tid}|${thread}|2026-09-08 ${time} UTC|TransportContext.java:1|${message}`;

test('keeps controls and row actions reachable with a long filename and a wide table', async ({ page }) => {
    const name = `${'long-capture-name-'.repeat(30)}.log`;
    await upload(page, jsse('Fatal (HANDSHAKE_FAILURE): layout check'), name);
    await expect(page.locator('#fileName')).toHaveAttribute('title', name);
    const viewport = page.viewportSize();
    const brand = await page.locator('.tls-brand').boundingBox();
    const actions = await page.getByRole('group', { name: 'TLS log actions' }).boundingBox();
    expect(brand.x + brand.width).toBeLessThanOrEqual(actions.x);
    for (const selector of ['.tls-header', '.tls-table-toolbar', '#tlsTableScroll', '#refreshBtn', '#howToUseBtn']) {
        const box = await page.locator(selector).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'All columns', exact: true }).click();
    const scroll = page.locator('#tlsTableScroll');
    expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const actionBox = await row(page, 1).getByRole('button', { name: 'Details', exact: true }).boundingBox();
    const scrollBox = await scroll.boundingBox();
    expect(actionBox.x).toBeGreaterThanOrEqual(scrollBox.x);
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(scrollBox.x + scrollBox.width);
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /HANDSHAKE|FAILURE/ })).toBeVisible();
    const modalBox = await page.locator('#tlsModal .modal-dialog').boundingBox();
    expect(modalBox.y).toBeGreaterThanOrEqual(0);
    expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(viewport.height);
    const summaryBox = await page.locator('#tlsModalBody .pr-sticky').boundingBox();
    const evidenceBox = await page.locator('#tlsModalBody .pr-details-grid > div').nth(1).boundingBox();
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(evidenceBox.x);
    await page.keyboard.press('Escape');
    // Visible native checkboxes must also work without the pointer.
    await page.locator('#onlyFailuresToggle').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#onlyFailuresToggle')).toBeChecked();
    await expect(rows(page)).toHaveCount(1);
});

test('opens the separate guide, keeps its footer reachable and restores focus on every close path', async ({ page }) => {
    const help = page.getByRole('button', { name: 'Help', exact: true });
    const dialog = page.getByRole('dialog', { name: 'JvmScope · Java TLS Log Analyzer · Guide', exact: true });
    for (const closeAction of ['header', 'footer', 'backdrop', 'Escape']) {
        await help.click();
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-hidden', 'false');
        await expect(dialog.getByRole('heading', { name: 'Expected input and interpretation' })).toBeVisible();
        const box = await dialog.locator('.modal-dialog').boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
        await dialog.getByRole('heading', { name: 'Full sample coverage' }).scrollIntoViewIfNeeded();
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        if (closeAction === 'header') await dialog.getByRole('button', { name: 'Close TLS analyzer guide' }).click();
        else if (closeAction === 'footer') await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        else if (closeAction === 'backdrop') await dialog.locator('[data-close="help"]').click({ position: { x: 5, y: 5 } });
        else await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#howToUseModal')).toHaveAttribute('aria-hidden', 'true');
        await expect(help).toBeFocused();
    }
});

test('resets table scrolling on a new capture and distinguishes no matches from no data', async ({ page }) => {
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await sample(page);
    // Expanded capture analysis can use page scrolling on a laptop. Its footer
    // and the larger table with analysis collapsed must both remain reachable.
    await page.locator('.hint-muted').scrollIntoViewIfNeeded();
    await expect(page.locator('.hint-muted')).toBeInViewport();
    await page.getByRole('button', { name: 'All columns', exact: true }).click();
    const scroll = page.locator('#tlsTableScroll');
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = el.scrollHeight; });
    expect(await scroll.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    expect(await scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await upload(page, jsse('Fatal (HANDSHAKE_FAILURE): new capture'));
    expect(await scroll.evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual([0, 0]);
    await expect(page.locator('#emptyState')).toBeHidden();
    await page.getByRole('searchbox', { name: 'Search' }).fill('no such host');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#emptyState')).toContainText('No interactions match your filters');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await expect(page.locator('#errorState')).toBeHidden();
});

test('combines search, outcome, warnings and direction filters and resets them on Clear', async ({ page }) => {
    await sample(page);
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await setFilter(page, 'onlyFailuresToggle', true);
    await expect(rows(page)).toHaveCount(24);
    await expect(cells(page, 2)).toHaveText(Array(24).fill('failure'));
    await page.getByRole('button', { name: 'Inbound', exact: true }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 19)).toBeVisible();
    await setFilter(page, 'onlyWarningsToggle', true);
    await page.getByRole('searchbox', { name: 'Search' }).fill('ACCESS_DENIED');
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search' }).fill('missing-host');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#rowCount')).toHaveText('0 / 35 interactions');
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await setFilter(page, 'onlySuccessToggle', true);
    await expect(page.locator('#onlyFailuresToggle')).not.toBeChecked();
    await expect(rows(page)).toHaveCount(0); // Successful inbound rows have no warnings.
    await setFilter(page, 'onlyWarningsToggle', false);
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(rows(page)).toHaveCount(9);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#rowCount')).toHaveText('0 / 0 interactions');
    await expect(page.locator('#fileName')).toHaveText('No file loaded');
    await expect(page.locator('#onlySuccessToggle')).not.toBeChecked();
    await sample(page);
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('sorts numeric and text fields, including equal and missing timestamps', async ({ page }) => {
    const text = [
        jsse('peer host: zeta.example', { tid: 'A' }),
        jsse('Fatal (HANDSHAKE_FAILURE): zeta', { tid: 'A' }),
        jsse('peer host: alpha.example', { tid: 'B' }),
        jsse('Fatal (HANDSHAKE_FAILURE): alpha', { tid: 'B' }),
        jsse('peer host: beta.example', { tid: 'C' }).replace(' UTC|', ' IST|'),
        jsse('Fatal (HANDSHAKE_FAILURE): unknown clock', { tid: 'C' }).replace(' UTC|', ' IST|'),
    ].join('\n');
    await upload(page, text);
    // Current parser sentinel places an unknown start first in descending order.
    await expect(cells(page, 1)).toHaveText(['3', '1', '2']);
    const startHeader = page.locator('th[data-key="startTs"]');
    if (await startHeader.isVisible()) {
        await startHeader.click();
        await expect(cells(page, 1)).toHaveText(['1', '2', '3']);
    }
    await page.locator('th[data-key="id"]').click();
    await expect(cells(page, 1)).toHaveText(['1', '2', '3']);
    await page.locator('th[data-key="id"]').click();
    await expect(cells(page, 1)).toHaveText(['3', '2', '1']);
    await page.locator('th[data-key="peerHost"]').click();
    await expect(cells(page, 5)).toHaveText(['alpha.example', 'beta.example', 'zeta.example']);
    await page.locator('th[data-key="peerHost"]').click();
    await expect(cells(page, 5)).toHaveText(['zeta.example', 'beta.example', 'alpha.example']);
    await sample(page);
    await expect(cells(page, 1)).toHaveText(Array.from({ length: 35 }, (_, index) => String(35 - index)));
});

test('loads an actual captured file and copies its detail summary and unchanged raw records', async ({ page }) => {
    const path = fixturePath('runtime/jdk25-tlsv1.3-mutual-client.txt');
    const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    await page.locator('#fileInput').setInputFiles(path);
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 1)).toContainText('success');
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(details(page)).toBeVisible();
    await expect(details(page)).toContainText('CN=localhost, O=TLS regression sample');
    await expect(details(page)).toContainText('TLS_AES_256_GCM_SHA384');
    await details(page).getByRole('button', { name: /Copy raw/ }).click();
    const rawLines = await details(page).locator('.rawline').allTextContents();
    const copiedRaw = rawLines.join('\n');
    expect(raw).toContain(copiedRaw);
    await expect.poll(() => clipboardText(page)).toBe(copiedRaw);
    await details(page).getByRole('button', { name: /Copy summary/ }).click();
    await expect.poll(async () => (await clipboardText(page)).startsWith('=== TLS Interaction Summary ===\n')).toBe(true);
    const summary = await clipboardText(page);
    expect(summary).toContain('Outcome: SUCCESS\n');
    expect(summary).toContain('Direction: outbound\n');
    expect(summary).toContain('TLS version: TLSv1.3\n');
    expect(summary).toContain('Client certificate: CN=localhost, O=TLS regression sample\n');
    expect(summary).toContain('Certificate authorities:\n  - CN=localhost, O=TLS regression sample\n');
    expect(summary).toContain(`=== Raw Lines ===\n${copiedRaw}\n`);
    await page.keyboard.press('Escape');
    await expect(details(page)).not.toBeVisible();
});

for (const [name, key, endpoint] of [
    ['jdk25-tlsv1.3-required-client-auth-server.txt', 'certificate_required', 'The local JVM required a client certificate'],
    ['jdk25-tlsv1.3-required-client-auth-client.txt', 'certificate_required', 'The remote peer required a client certificate'],
]) {
    test(`explains the correct alert origin from ${name}`, async ({ page }) => {
        await page.locator('#fileInput').setInputFiles(fixturePath(`runtime/${name}`));
        await expect(rows(page)).toHaveCount(1);
        await row(page, 1).locator('.explain-btn').click();
        await expect(explanation(page)).toBeVisible();
        await expect(explanation(page)).toContainText(`Explain issues: ${key.replaceAll('_', ' ')}`);
        await expect(explanation(page)).toContainText(endpoint);
        await expect(explanation(page)).not.toContainText('{AlertEndpoint}');
        await explanation(page).getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(explanation(page)).not.toBeVisible();
    });
}

test('treats hostile log text as text in table, tooltip, details and unmatched explanation', async ({ page }) => {
    const payload = '<img src=x onerror="window.tlsInjected=true"> & \'quoted\'';
    const text = [
        jsse('Produced client Certificate message (', { thread: payload }),
        `"subject": "CN=${payload}"`, ')',
        jsse(`Fatal (INTERNAL_ERROR): ${payload}`, { thread: payload }),
    ].join('\n');
    await upload(page, text, '<unsafe>.log');
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 1).locator('img')).toHaveCount(0);
    const certificateCell = row(page, 1).locator('[data-tooltip-title="Client certificate selected"]');
    if (await certificateCell.isVisible()) {
        await certificateCell.hover();
        await expect(page.locator('#richTooltip')).toContainText(payload);
        await expect(page.locator('#richTooltip img')).toHaveCount(0);
        await page.keyboard.press('Escape');
    }
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(details(page)).toContainText(payload);
    await expect(details(page).locator('img')).toHaveCount(0);
    await expect(details(page).locator('mark')).toContainText('Fatal (INTERNAL_ERROR):');
    await page.keyboard.press('Escape');
    await row(page, 1).locator('.explain-btn').click();
    await expect(explanation(page)).toContainText('local JSSE endpoint aborted TLS');
    await expect(explanation(page).locator('img')).toHaveCount(0);
    await page.locator('#issueModalClose2').click();
    // This deliberately unknown reason exercises the UI fallback independently
    // of the known catalogue. It also checks escaping of the data-issue attribute.
    const transport = jsse(`SSLHandshakeException: ${payload}`);
    await upload(page, transport);
    await row(page, 1).locator('.explain-btn').click();
    await expect(explanation(page)).toContainText('No explanation found yet for:');
    await expect(explanation(page)).toContainText(payload);
    await expect(explanation(page)).toContainText('Use Details to inspect the surrounding log messages');
    await expect(explanation(page).locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.tlsInjected)).toBeUndefined();
});

for (const modernApi of ['rejects', 'is unavailable']) {
    test(`uses the real clipboard fallback for raw and summary when the modern API ${modernApi}`, async ({ page }) => {
        const raw = jsse('Fatal (HANDSHAKE_FAILURE): fallback copy åäö & "quoted"');
        await upload(page, raw);
        await page.evaluate(mode => {
            // Retain a bound native reader to inspect the actual OS clipboard
            // even when the application's modern clipboard API is absent.
            window.readClipboardForTest = navigator.clipboard.readText.bind(navigator.clipboard);
            if (mode === 'rejects') {
                Object.defineProperty(navigator.clipboard, 'writeText', {
                    value: async () => { throw new Error('Clipboard write denied for this test'); },
                });
            } else {
                Object.defineProperty(navigator, 'clipboard', { value: undefined });
            }
            window.copyFallbackCalls = [];
            const nativeCopy = document.execCommand.bind(document);
            document.execCommand = (...args) => {
                if (args[0] === 'copy') window.copyFallbackCalls.push(document.activeElement.closest('dialog')?.id);
                return nativeCopy(...args);
            };
        }, modernApi);
        const copiedText = () => page.evaluate(async () => (await window.readClipboardForTest()).replaceAll('\r\n', '\n'));
        await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
        await details(page).getByRole('button', { name: /Copy raw/ }).click();
        await expect.poll(copiedText).toBe(raw);
        await expect(page.locator('#tlsModalCopyBtn')).toHaveText('Copied ✅');
        await expect(page.locator('textarea')).toHaveCount(0);
        await details(page).getByRole('button', { name: /Copy summary/ }).click();
        await expect.poll(async () => (await copiedText()).startsWith('=== TLS Interaction Summary ===\n')).toBe(true);
        expect(await copiedText()).toContain(`=== Raw Lines ===\n${raw}\n`);
        await expect(page.locator('#copySummaryBtn')).toHaveText('Copied ✅');
        expect(await page.evaluate(() => window.copyFallbackCalls)).toEqual(['tlsModal', 'tlsModal']);
        await expect(page.locator('textarea')).toHaveCount(0);
        await expect(details(page)).toBeVisible();
    });
}

for (const failure of ['returns false', 'throws']) {
    test(`reports failure, removes the fallback and allows retry when legacy copy ${failure}`, async ({ page }) => {
        const raw = jsse('Fatal (HANDSHAKE_FAILURE): retry copy');
        await upload(page, raw);
        await page.evaluate(mode => {
            window.nativeCopyForTest = document.execCommand.bind(document);
            Object.defineProperty(navigator.clipboard, 'writeText', {
                value: async () => { throw new Error('Modern clipboard denied'); },
            });
            document.execCommand = () => {
                if (mode === 'throws') throw new Error('Legacy clipboard denied');
                return false;
            };
        }, failure);
        await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
        for (const selector of ['#tlsModalCopyBtn', '#copySummaryBtn']) {
            const button = page.locator(selector);
            await button.click();
            await expect(button).toHaveText('Copy failed');
            await expect(page.locator('textarea')).toHaveCount(0);
            await expect(details(page)).toBeVisible();
            await expect(button).toBeEnabled();
        }
        await page.evaluate(() => { document.execCommand = window.nativeCopyForTest; });
        await page.locator('#tlsModalCopyBtn').click();
        await expect.poll(() => clipboardText(page)).toBe(raw);
        await expect(page.locator('#tlsModalCopyBtn')).toHaveText('Copied ✅');
        await expect(page.locator('textarea')).toHaveCount(0);
    });
}

test('waits for a pending clipboard write before reporting success', async ({ page }) => {
    await upload(page, jsse('Fatal (HANDSHAKE_FAILURE): pending copy'));
    await page.evaluate(() => {
        const nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        window.copyWriteCount = 0;
        Object.defineProperty(navigator.clipboard, 'writeText', {
            value: text => {
                window.copyWriteCount++;
                return new Promise((resolve, reject) => {
                    window.finishClipboardWrite = () => nativeWrite(text).then(resolve, reject);
                });
            },
        });
    });
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    const button = page.locator('#tlsModalCopyBtn');
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toContainText('Copy raw');
    expect(await page.evaluate(() => window.copyWriteCount)).toBe(1);
    await page.evaluate(() => window.finishClipboardWrite());
    await expect(button).toHaveText('Copied ✅');
    await expect.poll(() => clipboardText(page)).toBe(jsse('Fatal (HANDSHAKE_FAILURE): pending copy'));
    await expect(button).toBeEnabled();
});

test('a delayed copy result cannot change the controls for another interaction', async ({ page }) => {
    const first = jsse('Fatal (HANDSHAKE_FAILURE): first interaction', { tid: 'A' });
    const second = jsse('Fatal (HANDSHAKE_FAILURE): second interaction', { tid: 'B' });
    await upload(page, `${first}\n${second}`);
    await page.evaluate(() => {
        const nativeWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        Object.defineProperty(navigator.clipboard, 'writeText', {
            value: text => new Promise((resolve, reject) => {
                window.finishClipboardWrite = () => nativeWrite(text).then(resolve, reject);
            }),
        });
    });
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    const button = page.locator('#tlsModalCopyBtn');
    await button.click();
    await expect(button).toBeDisabled();
    await page.keyboard.press('Escape');
    await row(page, 2).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(details(page)).toContainText('second interaction');
    await expect(button).toBeEnabled();
    await page.evaluate(() => window.finishClipboardWrite());
    await expect.poll(() => clipboardText(page)).toBe(first);
    await expect(button).toContainText('Copy raw');
    await expect(button).toBeEnabled();
});

test('exposes the opened issue dialog to assistive technology', async ({ page }) => {
    await upload(page, jsse('Fatal (CERTIFICATE_REQUIRED): Empty client certificate chain'));
    const opener = row(page, 1).locator('.explain-btn');
    for (const closeAction of ['header', 'footer', 'backdrop', 'Escape']) {
        await opener.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog', { name: 'Explain issues: certificate required', exact: true })).toBeVisible();
        await expect(explanation(page)).toHaveAttribute('aria-hidden', 'false');
        if (closeAction === 'Escape') await page.keyboard.press('Escape');
        else if (closeAction === 'header') await page.locator('#issueModalClose').click();
        else if (closeAction === 'footer') await page.locator('#issueModalClose2').click();
        else await explanation(page).locator('[data-close="issue"]').click({ position: { x: 5, y: 5 } });
        await expect(explanation(page)).toBeHidden();
        await expect(explanation(page)).toHaveAttribute('aria-hidden', 'true');
        await expect(explanation(page)).not.toHaveAttribute('open');
        await expect(opener).toBeFocused();
    }
});

test('loads a dropped file and reports unsupported input without stale rows', async ({ page }) => {
    await sample(page);
    const text = readFileSync(fixturePath('runtime/jdk8u252-tlsv1.2-mutual-client.txt'), 'utf8');
    const transfer = await page.evaluateHandle(raw => {
        const data = new DataTransfer();
        data.items.add(new File([raw], 'dropped.log', { type: 'text/plain' }));
        return data;
    }, text);
    try { await page.locator('#tableContainer').dispatchEvent('drop', { dataTransfer: transfer }); }
    finally { await transfer.dispose(); }
    await expect(page.locator('#fileName')).toHaveText('dropped.log');
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 1)).toContainText('success');
    await expect(page.locator('#dropOverlay')).not.toBeVisible();
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await upload(page, 'ordinary application log');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#errorState')).toContainText('No recognizable SunJSSE handshake');
    await expect(page.locator('#emptyState')).toContainText('No TLS interactions detected');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#errorState')).not.toBeVisible();
});

test('distinguishes incomplete evidence and later transport errors in details', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles(fixturePath('truncated-server-finished.txt'));
    await expect(row(page, 1)).toContainText('Not captured');
    await expect(row(page, 1).locator('.explain-btn')).toBeDisabled();
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(details(page)).toContainText('no final outcome was captured');
    await page.keyboard.press('Escape');
    await upload(page, [
        jsse('Produced ClientHello handshake message'),
        jsse('Consuming server Finished handshake message'),
        jsse('Produced client Finished handshake message'),
        jsse('java.net.SocketException: Connection reset'),
    ].join('\n'));
    await expect(row(page, 1)).toContainText('success');
    await row(page, 1).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(details(page)).toContainText('Diagnostics after the observed Finished exchange');
    await expect(details(page)).toContainText('java.net.SocketException: Connection reset');
    await expect(details(page)).not.toContainText('Failure reason');
});

test('supports keyboard dialogs and a tooltip inside the current viewport', async ({ page }) => {
    await sample(page);
    const button = row(page, 5).getByRole('button', { name: 'Details', exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(details(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details(page)).not.toBeVisible();
    await expect(button).toBeFocused();
    const explainButton = row(page, 5).locator('.explain-btn');
    await explainButton.focus();
    await page.keyboard.press('Enter');
    await expect(explanation(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(explanation(page)).not.toBeVisible();
    await expect(explainButton).toBeFocused();
    const tooltipTarget = row(page, 5).locator('[data-tooltip-title="Peer host"]');
    await tooltipTarget.hover();
    const tooltip = page.locator('#richTooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Peer host');
    await expect(tooltip).toContainText('10.0.0.12');
    const bounds = await tooltip.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await expect(tooltip).not.toBeVisible();
});

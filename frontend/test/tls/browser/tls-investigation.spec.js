import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { analyzeTlsLog } from '../../../assets/javautils/tls-parser.js';
import { buildComprehensiveTlsSampleLog } from '../../../assets/javautils/tls-sample.js';
import { tlsObservedSequence } from '../../../assets/javautils/tls-sequence-model.js';

const inspector = page => page.locator('#tlsInspector');
const select = (page, id) => page.getByRole('button', { name: `Select interaction ${id}`, exact: true }).click();
const upload = (page, text) => page.locator('#fileInput').setInputFiles({ name: 'trace.log', mimeType: 'text/plain', buffer: Buffer.from(text) });
async function sample(page) {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await page.getByRole('button', { name: /Full sample/ }).click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
}

test('opens the linked investigation workspace by default with usable desktop panes', async ({ page }) => {
    await page.reload();
    await expect(page.locator('#tlsInvestigateColumns')).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector(page)).toBeHidden();
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await page.getByRole('button', { name: /Full sample/ }).click();
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '35');
    await expect(page.locator('#tlsTable th:visible')).toHaveCount(5);
    // Match the larger badge text seen with a browser minimum font size.
    await page.addStyleTag({ content: '#tlsTable .status-badge { font-size: 14px; }' });
    for (const mode of ['tlsInvestigateColumns', 'tlsOverviewColumns', 'tlsAllColumns', 'tlsInvestigateColumns']) {
        await page.locator(`#${mode}`).click();
        const badges = await page.locator('#tlsTableBody .status-badge').evaluateAll(elements => elements.map(badge => {
            const cell = badge.closest('td');
            return { outcome: badge.textContent, right: badge.getBoundingClientRect().right,
                availableRight: cell.getBoundingClientRect().right - parseFloat(getComputedStyle(cell).paddingRight) };
        }));
        expect(new Set(badges.map(badge => badge.outcome))).toEqual(new Set(['success', 'failure', 'Not captured']));
        for (const badge of badges) expect(badge.right, `${mode}: ${badge.outcome} fits with cell padding`).toBeLessThanOrEqual(badge.availableRight);
    }
    await select(page, 7);
    await expect(page.locator('tr[data-id="7"]')).toHaveClass(/tls-selected-row/);
    await expect(page.getByRole('button', { name: 'Select interaction 7', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(inspector(page).locator('.tls-event-hint')).toHaveCount(2);
    await select(page, 35);
    await expect(page.locator('.tls-selected-row')).toHaveAttribute('data-id', '35');
    const geometry = await page.evaluate(() => {
        const box = id => document.getElementById(id).getBoundingClientRect().toJSON();
        return { table: box('tlsTableScroll'), inspector: box('tlsInspector'), workspace: document.querySelector('.tls-workspace').getBoundingClientRect().toJSON(),
            pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(geometry.table.height).toBeGreaterThan(160);
    expect(geometry.inspector.x).toBeGreaterThan(geometry.table.x + geometry.table.width);
    expect(geometry.inspector.height).toBeGreaterThanOrEqual(340);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
    await select(page, 29);
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '29');
    await page.screenshot({ path: `../.run/tls-investigation/default-${test.info().project.name}.png`, fullPage: true });
});

test('narrow previews keep both TLS panes reachable without horizontal page scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.reload();
    await page.getByRole('button', { name: /Full sample/ }).click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await select(page, 29);
    await expect(page.locator('tr[data-id="29"] .status-badge')).toHaveText('Not captured');
    await expect(inspector(page).locator('.tls-inspector-facts')).toContainText('Outcome not captured');
    const geometry = await page.evaluate(() => {
        const box = id => document.getElementById(id).getBoundingClientRect().toJSON();
        return { table: box('tableContainer'), inspector: box('tlsInspector'),
            pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
            badgeHeight: document.querySelector('tr[data-id="29"] .status-badge').getBoundingClientRect().height };
    });
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.inspector.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.inspector.y).toBeGreaterThanOrEqual(geometry.table.bottom);
    expect(geometry.badgeHeight).toBeLessThan(45);
    await page.locator('#tlsRawTab').click();
    await expect(inspector(page).locator('.rawline')).toHaveCount(4);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '29');
    const wide = await page.evaluate(() => ({
        inspector: document.getElementById('tlsInspector').getBoundingClientRect().toJSON(),
        table: document.getElementById('tableContainer').getBoundingClientRect().toJSON(),
    }));
    expect(wide.inspector.x).toBeGreaterThanOrEqual(wide.table.right);
    await inspector(page).getByRole('button', { name: 'Full details', exact: true }).click();
    await expect(page.locator('#tlsModalBody')).toContainText('no final success or failure was captured');
});

test('row selection, keyboard navigation and table modes preserve the same interaction', async ({ page }) => {
    await sample(page);
    await select(page, 18);
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '18');
    await page.getByRole('button', { name: 'Select interaction 18', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '17');
    await expect(page.getByRole('button', { name: 'Select interaction 17', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Select interaction 23', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '22');
    await select(page, 17);
    await inspector(page).getByRole('button', { name: 'Previous interaction', exact: true }).click();
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '18');
    await page.locator('#tlsAllColumns').click();
    await expect(inspector(page)).toBeHidden();
    await expect(page.locator('#tlsTable th:visible')).toHaveCount(15);
    await page.locator('#tlsInvestigateColumns').click();
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '18');
    await expect(inspector(page)).toBeVisible();
    await inspector(page).getByRole('button', { name: 'Full details', exact: true }).click();
    await expect(page.locator('#tlsModalTitle')).toContainText('#18');
    await page.keyboard.press('Escape');
    await expect(inspector(page).getByRole('button', { name: 'Full details', exact: true })).toBeFocused();
});

test('events jump to exact source lines, and raw copy retains full evidence through time filtering', async ({ page }) => {
    await sample(page);
    const it = analyzeTlsLog(buildComprehensiveTlsSampleLog()).interactions.find(item => item.id === 18);
    await select(page, 18);
    await page.locator('#tlsPeriodMenu > summary').click();
    await page.locator('#tlsTimeFrom').fill('2026-08-31T08:01:08.05');
    await page.locator('#tlsTimeTo').fill('2026-08-31T08:01:08.09');
    await page.locator('#tlsTimeApply').click();
    await expect(page.locator('#rowCount')).toHaveText('2 / 35 interactions');
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '18');
    const event = tlsObservedSequence(it).at(-1);
    await inspector(page).getByRole('button', { name: `Show source line ${event.sourceLine}`, exact: true }).click();
    await expect(page.locator('#tlsRawTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tls-source-row.is-evidence .rawline')).toHaveText(it.rawLines[event.rawIndex]);
    await expect(page.locator('.tls-source-row.is-evidence')).toBeFocused();
    expect(await inspector(page).locator('.rawline').allTextContents()).toEqual(it.rawLines);
    await inspector(page).getByRole('button', { name: 'Copy raw', exact: true }).click();
    await expect(inspector(page).getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(it.rawLines.join('\n'));
    await page.locator('#tlsPeriodMenu > summary').click();
    await page.locator('#tlsTimeClear').click();
    await page.locator('#searchInput').fill('no-such-endpoint');
    await expect(page.locator('#rowCount')).toHaveText('0 / 35 interactions');
    await expect(inspector(page)).toContainText('Select an interaction');
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '');
    await page.locator('#clearBtn').click();
    await expect(inspector(page)).toHaveAttribute('data-selected-id', '');
});

test('real mutual TLS exposes certificate facts, source evidence and accessible tab navigation', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const text = readFileSync(new URL('../fixtures/runtime/jdk25-tlsv1.3-mutual-client.txt', import.meta.url), 'utf8');
    await upload(page, text);
    await expect(inspector(page)).toContainText('Finished exchange observed');
    await expect(inspector(page).locator('.tls-event-list')).toContainText('CertificateRequest');
    await page.locator('#tlsSequenceTab').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tlsCertificatesTab')).toBeFocused();
    await expect(page.locator('#tlsCertificatesPanel')).toContainText('localhost');
    await page.keyboard.press('End');
    await expect(page.locator('#tlsRawTab')).toBeFocused();
    const it = analyzeTlsLog(text).interactions[0];
    expect(await inspector(page).locator('.rawline').allTextContents()).toEqual(it.rawLines);
    await page.keyboard.press('Home');
    await expect(page.locator('#tlsSequenceTab')).toBeFocused();
    await page.screenshot({ path: `../.run/tls-investigation/mutual-${test.info().project.name}.png`, fullPage: true });
});

test('unknown and ambiguous captures stay explicit, and hostile diagnostics remain text', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const log = 'javax.net.ssl|DEBUG|A|worker|2026-09-08 12:00:00.000 CST|X.java:1|Produced ClientHello handshake message';
    await upload(page, log);
    await expect(inspector(page)).toContainText('No final outcome captured');
    await expect(inspector(page).locator('.tls-inspector-facts')).toContainText('Outcome not captured');
    await expect(inspector(page).locator('.tls-verdict p')).toContainText('no final success or failure was captured');
    await expect(inspector(page)).toContainText('Finished exchange: not captured');
    await expect(inspector(page)).toContainText('No clock');
    await upload(page, 'a, WRITE: TLSv1.2 Handshake, length = 1\n*** ClientHello, TLSv1.2\nb, READ: TLSv1.2 Handshake, length = 1\n*** ServerHello, TLSv1.2\n*** Finished');
    await expect(inspector(page)).toContainText('Grouping uncertain');
    await expect(inspector(page).locator('.tls-inspector-facts')).toContainText('Direction uncertain');
    await expect(inspector(page).locator('.tls-verdict p')).toContainText('Legacy handshake bodies lack connection IDs');
    await expect(inspector(page).locator('.tls-event')).toHaveCount(0);
    await upload(page, 'javax.net.ssl|ERROR|A|worker|2026-09-08 12:00:00.000 UTC|X.java:1|Fatal (INTERNAL_ERROR): <img src=x onerror="window.tlsUnsafe=true">');
    await expect(inspector(page)).toContainText('<img');
    await page.locator('#tlsRawTab').click();
    await expect(inspector(page).locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.tlsUnsafe)).toBeUndefined();
});

for (const format of ['compact', 'expanded']) test(`${format} unresolved TLS grouping explains persistent uncertainty and preserves evidence`, async ({ page }) => {
    const record = (message, tid = 'A') => format === 'compact'
        ? `javax.net.ssl|DEBUG|${tid}|worker|2026-10-04 12:00:00.000 UTC|Handshake.java:1|${message}`
        : `{\n"logger": "javax.net.ssl",\n"thread id": "${tid}",\n"thread name": "worker",\n"time": "2026-10-04 12:00:00.000 UTC",\n"message": "${message}"\n}`;
    const exchange = ['Produced ClientHello handshake message', 'Consuming ServerHello handshake message',
        'Produced client Finished handshake message', 'Consuming server Finished handshake message'];
    const text = [record(exchange[0]), ...exchange.map(message => record(message)),
        ...exchange.map(message => record(message)), ...exchange.map(message => record(message, 'B'))].join('\n');
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await upload(page, text);
    await expect(page.locator('#rowCount')).toHaveText('4 / 4 interactions');
    await select(page, 3);
    await expect(inspector(page).locator('.tls-inspector-facts')).toContainText('Grouping uncertain');
    await expect(inspector(page).locator('.tls-inspector-facts')).toContainText('Direction uncertain');
    await expect(inspector(page).locator('.tls-verdict p')).toContainText('new ClientHello');
    await expect(inspector(page).locator('.tls-verdict p')).toContainText('rest of this log');
    await page.locator('#tlsAllColumns').click();
    const row = page.locator('tr[data-id="3"]');
    await expect(row.locator('.status-badge')).toHaveText('Uncertain');
    await expect(row.locator('.tls-direction-badge')).toContainText('Direction uncertain');
    await expect(row.locator('.warning-count')).toHaveAttribute('data-tooltip-body', /new ClientHello/);
    // Missing-host filters retain their null identity despite the explanatory label.
    await row.locator('[data-name-field="hosts"]').click();
    await expect(page.locator('#rowCount')).toHaveText('4 / 4 interactions');
    await select(page, 3);
    await row.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#tlsModalBody')).toContainText('rest of this log');
    await expect(page.locator('#tlsModalBody')).toContainText('Not attributable');
    await page.locator('#copySummaryBtn').click();
    await expect(page.locator('#copySummaryBtn')).toContainText('Copied');
    const summary = await page.evaluate(() => navigator.clipboard.readText());
    expect(summary).toContain('Outcome: UNKNOWN\n');
    expect(summary).toContain('Outcome explanation:');
    expect(summary).toContain('rest of this log');
    const parsed = analyzeTlsLog(text).interactions[2];
    expect(summary).toContain(parsed.rawLines.join('\n'));
    await page.keyboard.press('Escape');
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#rowCount')).toHaveText('1 / 4 interactions');
    await expect(page.locator('#tlsTableBody tr')).toHaveAttribute('data-id', '4');
    await expect(page.locator('#tlsTableBody .status-badge')).toHaveText('success');
});

test('inspector clipboard fallback is truthful and delayed copy cannot affect a new selection', async ({ page }) => {
    await sample(page);
    await select(page, 18);
    await page.locator('#tlsRawTab').click();
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('unavailable')); });
    await inspector(page).getByRole('button', { name: 'Copy raw', exact: true }).click();
    await expect(inspector(page).getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await select(page, 19);
    await page.locator('#tlsRawTab').click();
    await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise(resolve => { window.finishInspectorCopy = resolve; }); });
    await inspector(page).getByRole('button', { name: 'Copy raw', exact: true }).click();
    await expect(inspector(page).getByRole('button', { name: 'Copy raw', exact: true })).toBeDisabled();
    await select(page, 18);
    await page.locator('#tlsRawTab').click();
    await page.evaluate(() => window.finishInspectorCopy());
    await expect(inspector(page).getByRole('button', { name: 'Copy raw', exact: true })).toBeEnabled();
    await page.evaluate(() => {
        navigator.clipboard.writeText = () => Promise.reject(new Error('unavailable'));
        document.execCommand = () => false;
    });
    await inspector(page).getByRole('button', { name: 'Copy raw', exact: true }).click();
    await expect(inspector(page).getByRole('button', { name: 'Copy failed — retry', exact: true })).toBeVisible();
});

import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const fixture = name => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
async function upload(page, text, name) {
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#fileName')).toHaveText(name);
}
const log = message => `javax.net.ssl|DEBUG|A|main|2026-10-14 12:00:00.000 UTC|X.java:1|${message}`;

test('TLS recovered timeouts and server certificate hints keep correct outcomes in filters and copied summaries', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await upload(page, fixture('review/jdk17-recovered-read-timeout.txt'), 'recovered.txt');
    await expect(page.locator('#tlsTableBody .status-badge')).toHaveText('success');
    await expect(page.locator('#tlsInspector')).toContainText('Finished exchange observed');
    await page.locator('#onlyFailuresToggle').check();
    await expect(page.locator('#rowCount')).toHaveText('0 / 1 interactions');
    await page.locator('#onlyFailuresToggle').uncheck();
    await page.getByRole('button', { name: 'Select interaction 1', exact: true }).click();
    await page.getByRole('button', { name: 'Full details', exact: true }).click();
    await page.getByRole('button', { name: 'Copy summary', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Outcome: SUCCESS');
    await page.keyboard.press('Escape');
    await upload(page, fixture('runtime/jdk21-tlsv1.3-success-server.txt'), 'server.txt');
    await page.getByRole('button', { name: 'Full details', exact: true }).click();
    await page.getByRole('button', { name: 'Copy summary', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('CertificateSelectionHint');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('Outcome: SUCCESS');
    expect(text).toContain('Direction: inbound');
    expect(text).not.toContain('ClientCertSelectionFailed');
});

test('TLS 1.3 warning-level OCSP errors retain severity, exact category, origin and raw level throughout the view', async ({ page }) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const text = ['Produced ClientHello handshake message', 'Negotiated protocol version: TLSv1.3',
        'Consuming server Finished handshake message', 'Produced client Finished handshake message', 'Received alert message ('].map(log)
        .concat(['"Alert": {', '"level": "warning",', '"description": "bad_certificate_status_response"', '}', ')']).join('\n');
    await upload(page, text, 'ocsp.txt');
    await expect(page.locator('#tlsTableBody .status-badge')).toHaveText('failure');
    await expect(page.locator('#tlsInspector')).toContainText('bad certificate status response');
    await expect(page.locator('.tls-event-failure')).toContainText('reported level: warning');
    await page.locator('#tlsFailureFacet > summary').click();
    await page.locator('#tlsFailureGroups button[data-key="bad_certificate_status_response"]').click();
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Full details', exact: true }).click();
    await expect(page.locator('#tlsModal')).toContainText('Received TLS 1.3 error alert: bad_certificate_status_response (reported level: warning)');
});

test('TLS laptop starts compact, keeps at least six complete rows, and remembers the disclosure choice', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate(() => localStorage.removeItem('jvmscope.tls.analysis-expanded'));
    await page.reload();
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    const panel = page.locator('#tlsAnalysis');
    await expect(panel).not.toHaveAttribute('open', '');
    const completeRows = await page.evaluate(() => {
        const viewport = document.getElementById('tlsTableScroll').getBoundingClientRect();
        const header = document.querySelector('#tlsTable thead').getBoundingClientRect();
        return [...document.querySelectorAll('#tlsTableBody tr')].filter(row => {
            const box = row.getBoundingClientRect();
            return box.top >= header.bottom && box.bottom <= viewport.bottom;
        }).length;
    });
    expect(completeRows).toBeGreaterThanOrEqual(6);
    await panel.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('open', '');
    await page.reload();
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await expect(panel).toHaveAttribute('open', '');
    await panel.locator(':scope > summary').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await expect(panel).not.toHaveAttribute('open', '');
    await expect(page.getByRole('checkbox', { name: 'Highlights (32)', exact: true })).toBeVisible();
    await page.screenshot({ path: `../.run/tls-review/compact-${test.info().project.name}.png` });
});

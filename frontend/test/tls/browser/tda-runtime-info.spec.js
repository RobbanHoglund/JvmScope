import { test, expect } from './fixtures.js';
import { readFile } from 'node:fs/promises';
const capture = major => readFile(new URL(`../../tda/fixtures/runtime/jdk${major}-thread-print.txt`, import.meta.url), 'utf8');

for (const [major, build, vendor] of [[26, '26.0.2.1+1', 'Temurin-26.0.2.1+1'], [27, '27+35-FR', 'Corretto-27.0.0.35.1']]) {
    test(`TDA Browse examples loads the real Java ${major} runtime-header sequence`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/tda.html`);
        await page.getByRole('button', { name: 'Browse examples', exact: true }).click();
        await page.locator('#exampleVersion').selectOption(`Java ${major}`);
        await page.locator('#exampleSearch').fill('runtime version');
        const card = page.locator(`[data-example-id="tda-java${major}-runtime"]`);
        await expect(card).toBeVisible();
        await expect(page.locator('.example-card:visible')).toHaveCount(1);
        await expect(card).toContainText('3 snapshots');
        const fetched = page.waitForResponse(response => response.url().includes(`java${major}-runtime-version`) && response.url().endsWith('.txt'));
        await card.click();
        const response = await fetched;
        expect(response.status()).toBe(200);
        expect(await response.text()).toBe(await readFile(new URL(`../../../../testdata/thread-dumps/java${major}-runtime-version.txt`, import.meta.url), 'utf8'));
        await expect(page.locator('#exampleModal')).not.toBeVisible();
        await expect(page.locator('#dumpSelect option')).toHaveCount(3);
        const info = page.locator('#runtimeInfo');
        await expect(info.locator('summary')).toHaveText(`Java runtime · ${build}`);
        await info.locator('summary').click();
        await expect(info.locator('dl')).toContainText(vendor);
        await page.locator('#dumpSelect').selectOption('2');
        await expect(info.locator('summary')).toHaveText(`Java runtime · ${build}`);
        await expect(page.locator('#errorState')).toBeHidden();
    });
}

test('TDA JDK runtime metadata follows selected snapshots, survives filtering and clears with the capture', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#sessionInputMode').selectOption('replace', { force: true });
    const first = await capture(26), second = await capture(27);
    await page.locator('#fileInput').setInputFiles({ name: 'jdk-runtime-series.txt', mimeType: 'text/plain', buffer: Buffer.from(first + '\n' + second) });
    const info = page.locator('#runtimeInfo');
    await expect(info).toBeVisible(); await expect(info.locator('summary')).toHaveText('Java runtime · 26.0.2.1+1-7');
    await info.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(info.locator('dl')).toContainText('26.0.2.1+1');
    await page.locator('#searchInput').fill('sample-owner');
    await expect(info.locator('details')).toHaveAttribute('open', '');
    await page.locator('#dumpSelect').selectOption('1');
    await expect(info.locator('summary')).toHaveText('Java runtime · 27+35-2325');
    await info.locator('summary').click();
    await expect(info.locator('dl')).toContainText('27.0+35');
    await expect(info).not.toContainText('26.0.2.1');
    expect(await page.locator('body').evaluate(n => n.scrollWidth > n.clientWidth + 1)).toBe(false);
    await page.locator('#clearBtn').click(); await expect(info).toBeHidden();
    await page.locator('#fileInput').setInputFiles({ name: 'headerless.txt', mimeType: 'text/plain', buffer: Buffer.from(second.slice(second.indexOf('"sample-owner"'))) });
    await expect(page.locator('#threadTableBody')).toContainText('sample-owner'); await expect(info).toBeHidden();
});

test('TDA metadata renders untrusted runtime text literally', async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    const text = (await capture(27)).replace('OpenJDK Runtime Environment', '<img src=x onerror=alert(1)>');
    await page.locator('#fileInput').setInputFiles({ name: 'literal-header.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    const info = page.locator('#runtimeInfo'); await expect(info).toBeVisible(); await info.locator('summary').click();
    await expect(info.locator('dd')).toContainText(['27.0+35', '27+35-2325', '<img src=x onerror=alert(1)>', 'OpenJDK 64-Bit Server VM', '27+35-2325', 'interpreted mode, sharing']);
    await expect(info.locator('img,script')).toHaveCount(0);
});

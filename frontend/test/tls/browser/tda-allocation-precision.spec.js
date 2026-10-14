import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';
const fixture = name => fileURLToPath(new URL(`../../tda/fixtures/ga-regressions/${name}`, import.meta.url));
test('TDA real rounded allocation counters show a range without a false hot diagnosis', async ({page, appUrl}) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles(['allocation-before.txt', 'allocation-after.txt'].map(fixture));
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#dumpSelect').selectOption('1');
    const row = page.locator('#threadTableBody tr').filter({hasText:'audit-allocation-boundary'});
    const rate = row.locator('td').nth(11);
    await expect(rate).toContainText('–');
    expect(await rate.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(row).not.toContainText('846.28');
    await expect(row).not.toContainText('ALLOCATION HOT');
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.locator('#threadModal')).toContainText('Rounded JVM counters');
    await expect(page.locator('#threadModal')).not.toContainText('Measured 846.28');
    await expect(page.locator('#threadModal')).toContainText('101G');
});

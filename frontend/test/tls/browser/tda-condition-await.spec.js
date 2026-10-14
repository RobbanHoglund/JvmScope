import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';
for(const file of ['carrier-classic.txt','carrier-json.json'])test(`TDA uninterruptible Condition wait is explained specifically for ${file}`,async({page,appUrl})=>{
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles(fileURLToPath(new URL(`../../tda/fixtures/ga-regressions/${file}`,import.meta.url)));
    await page.locator('#threadTableBody tr').filter({hasText:'audit-uninterruptible-condition'}).getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.getByRole('tabpanel',{name:'Overview'}).locator('.thread-details-kicker')).toHaveText('Condition await');
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('awaitUninterruptibly');
});

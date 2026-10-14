import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';
test('TDA actual virtual deadlock has no false No, while JVM-confirmed deadlocks stay confirmed',async({page,appUrl})=>{
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles(fileURLToPath(new URL('../../tda/fixtures/ga-regressions/coverage.json',import.meta.url)));
    for(const name of ['audit-virtual-deadlock-a','audit-virtual-deadlock-b']){
        await page.locator('#threadTableBody tr').filter({hasText:name}).getByRole('button',{name:'Details',exact:true}).click();
        const fact=page.locator('#threadModalSummary .thread-details-chip').filter({hasText:'Deadlock'});
        await expect(fact).toHaveText(/Deadlock\s+Not confirmed by source/);
        await page.locator('#threadModalClose2').click();
    }
    await page.locator('#clearBtn').click();
    await page.locator('#loadSampleBtn').click();
    await page.locator('#onlyDeadlockedToggle').check();
    await page.locator('#threadTableBody tr').first().getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.locator('#threadModalSummary .thread-details-chip').filter({hasText:'Deadlock'})).toHaveText(/Deadlock\s+Confirmed/);
});

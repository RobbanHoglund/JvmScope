import {fileURLToPath} from 'node:url';
import {test,expect} from './fixtures.js';
test('TDA reports observed counts and missing synchronizer coverage for a real owner',async({page,appUrl})=>{
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    const files=['coverage-default.txt','coverage-with-locks.txt','coverage.json'];
    await page.locator('#fileInput').setInputFiles(files.map(name=>fileURLToPath(new URL(`../../tda/fixtures/ga-regressions/${name}`,import.meta.url))));
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    const locksHeader=page.getByRole('columnheader',{name:'Locks observed',exact:true});
    expect(await locksHeader.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
    for(const [index,count,coverage] of [[0,0,'Ownable synchronizers not reported'],[1,1,'Ownable synchronizers reported'],[2,0,'Ownable synchronizers not reported']]){
        await page.locator('#dumpSelect').selectOption(String(index));
        await page.locator('#threadTableBody tr').filter({hasText:'audit-ownable-owner'}).getByRole('button',{name:'Details',exact:true}).click();
        await expect(page.locator('#threadModalSummary')).toContainText(`Locks observed ${count}`);
        await page.getByRole('tab',{name:'Locks',exact:true}).click();
        await expect(page.locator('#threadModal .thread-details-sidebar')).toContainText(coverage);
        await expect(page.locator('#threadModal .thread-details-sidebar')).toContainText('not total ownership');
        await page.locator('#threadModalClose2').click();
    }
});

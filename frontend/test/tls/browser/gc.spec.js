import {test,expect} from './fixtures.js';

test('GC analyzer loads real samples through production routes and keeps evidence local',async({page,appUrl},info)=>{
    const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method(),body:r.postData()}));
    await page.goto(appUrl+'/jvmscope/gc.html');
    for(const [id,name] of [['g1','G1'],['legacy','Parallel'],['zgc','ZGC'],['shenandoah','Shenandoah'],['serial','Serial'],['parallel','Parallel'],['cms','CMS']]){
        await page.locator('#gcExample').selectOption(id);await page.locator('#gcSample').click();
        await expect(page.locator('#gcMetadata')).toContainText(name);
        await expect(page.locator('#gcTimeline .gc-mark').first()).toBeVisible();
        await expect(page.locator('#gcError')).toBeHidden();
    }
    const sentinel='PRIVATE_GC_SENTINEL',text=`[1.000s][info][gc] GC(0) Pause Young (${sentinel}) 20M->4M(32M) 250ms`;
    await page.locator('#gcFile').setInputFiles({name:'private.log',mimeType:'text/plain',buffer:Buffer.from(text)});
    await expect(page.locator('#gcRaw')).toHaveText(text);
    await expect(page.locator('#gcEventFindings')).toContainText('Pause exceeds your budget');
    await expect(page.locator('#gcSource')).toBeHidden();
    expect(requests.every(r=>r.method==='GET'&&r.body===null&&new URL(r.url).origin===new URL(appUrl).origin)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(sentinel);
    expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(sentinel);
    await page.getByRole('link',{name:'GC guide',exact:true}).click();
    await expect(page).toHaveURL(new RegExp('/knowledge/gc-memory.html'));
    await expect(page.getByText('Read the three GC timeline tracks independently')).toBeVisible();
});

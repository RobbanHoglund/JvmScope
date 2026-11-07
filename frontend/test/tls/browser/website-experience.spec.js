import { test, expect } from './fixtures.js';
import { blockingDump } from '../../tda/blocking-fixture.js';

const bg = {light:'rgb(246, 248, 251)',dark:'rgb(14, 17, 22)'};
async function palette(page, theme) {
    await expect(page.locator('html')).toHaveAttribute('data-site-theme',theme);
    for (const surface of ['html','body']) {
        expect(await page.locator(surface).evaluate(el=>getComputedStyle(el).backgroundColor),surface).toBe(bg[theme]);
    }
}
for (const theme of ['light','dark']) {
    test(`Pages website journey keeps ${theme} across home, tools and documentation`, async ({browser,appUrl},info) => {
        const context = await browser.newContext({colorScheme:theme,viewport:info.project.use.viewport});
        const page = await context.newPage(); const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(appUrl+'/'); await palette(page,theme);
        await expect(page.getByLabel('Website theme')).toHaveValue('system');
        await page.screenshot({path:info.outputPath(`home-${theme}.png`),fullPage:true});
        for (const [tool,path,active] of [['Thread dumps','tda','Thread dumps'],['TLS log analyzer','tls','TLS log analyzer'],['Garbage collection','gc','Garbage collection']]) {
            await page.getByRole('navigation',{name:'Analysis tools'}).getByRole('link',{name:tool,exact:true}).click();
            await expect(page).toHaveURL(appUrl+`/jvmscope/${path}.html`); await palette(page,theme);
            await expect(page.locator('.tool-nav a[aria-current=page]')).toHaveText(active);
            await page.screenshot({path:info.outputPath(`${path}-start-${theme}.png`),fullPage:true});
            if(path==='gc') {
                await page.locator('#gcSample').click();
                await expect(page.locator('#gcTimeline svg')).toBeVisible();
            } else {
                await page.locator('#loadSampleBtn').click();
                await expect(page.locator('#fileName')).not.toHaveText('No file loaded');
                if(path==='tda') {
                    await expect(page.locator('#statsSummary')).toContainText('67');
                    await page.locator('#threadTableBody .thread-cell-name').first().click();
                    await expect(page.locator('#threadModal')).toBeVisible();
                    await page.screenshot({path:info.outputPath(`tda-stack-${theme}.png`)});
                    await page.keyboard.press('Escape');
                } else {
                    await expect(page.locator('#tlsTable tbody tr').first()).toBeVisible();
                    // Measure actual foreground and surface, not just the theme attribute.
                    const cell=page.locator('#tlsTable tbody tr td').first();
                    const colors=await cell.evaluate(el=>({color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
                    if(theme==='light') expect(colors.color).toBe('rgb(25, 41, 59)');
                }
            }
            await page.screenshot({path:info.outputPath(`${path}-loaded-${theme}.png`)});
            await page.locator('.tool-nav-home').click();
            await palette(page,theme);
        }
        await page.getByRole('link',{name:'Explore knowledge base →'}).click();
        await expect(page.locator('#knowledgeRoot h1')).toBeVisible(); await palette(page,theme);
        await page.locator('.tool-nav-home').click();
        for(const [label,heading] of [['Features, supported inputs and walkthroughs →','Java thread dump analysis.'],['TLS formats, evidence and limitations →','Follow the handshake.'],['GC formats, collectors and limitations →','See the pauses.']]) {
            await page.getByRole('link',{name:label,exact:true}).click(); await palette(page,theme);
            await expect(page.getByRole('heading',{level:1})).toContainText(heading);
            await page.locator('.tool-nav-home').click();
        }
        expect(errors).toEqual([]); await context.close();
    });
}
test('Pages website explicit theme overrides system, persists across navigation and reacts to system changes', async ({browser,appUrl})=>{
    const context=await browser.newContext({colorScheme:'light'}); const page=await context.newPage();
    await page.goto(appUrl+'/'); await palette(page,'light');
    await page.getByLabel('Website theme').selectOption('dark'); await palette(page,'dark');
    await page.getByRole('navigation').getByRole('link',{name:'Garbage collection',exact:true}).click();await palette(page,'dark');
    await page.reload();await palette(page,'dark');await expect(page.getByLabel('Website theme')).toHaveValue('dark');
    await page.getByLabel('Website theme').selectOption('system');await palette(page,'light');
    await page.emulateMedia({colorScheme:'dark'});await palette(page,'dark');
    await page.getByLabel('Website theme').selectOption('light');await palette(page,'light');
    await page.getByRole('navigation').getByRole('link',{name:'Thread dumps',exact:true}).click();await palette(page,'light');
    await context.close();
});
for(const width of [320,390,768]) {
    test(`Pages website navigation and documents fit ${width}px with and without JavaScript`,async ({browser,appUrl},info)=>{
        for(const javaScriptEnabled of [true,false]) {
            const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled,colorScheme:'light'}); const page=await context.newPage();
            for(const path of ['/','/java-thread-dump-analyzer.html','/java-tls-log-analyzer.html','/java-gc-log-analyzer.html','/guides/analyze-java-thread-dump.html']) {
                await page.goto(appUrl+path);
                expect(await page.locator('html').evaluate(el=>el.scrollWidth<=innerWidth),path).toBe(true);
                await expect(page.getByRole('navigation',{name:'Analysis tools'})).toBeVisible();
                await expect(page.getByRole('heading',{level:1})).toBeVisible();
                if(path==='/')await page.screenshot({path:info.outputPath(`home-${width}-${javaScriptEnabled}.png`),fullPage:true});
            }
            await context.close();
        }
    });
}
test('Pages theme still works when preference storage is unavailable',async({browser,appUrl})=>{
    const context=await browser.newContext({colorScheme:'light'});await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked');}});});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(appUrl+'/');await palette(page,'light');await page.getByLabel('Website theme').selectOption('dark');await palette(page,'dark');expect(errors).toEqual([]);await context.close();
});

// Scope knowledge styles with a page attribute. A body:has(#knowledgeRoot)
// ancestor selector made each large analyzer update repeatedly scan the tree.
test('Pages website stays responsive after a 400-thread capture in either theme',async({browser,appUrl})=>{
    const context=await browser.newContext({colorScheme:'light'});const page=await context.newPage();
    const entries=Array.from({length:400},(_,i)=>({id:i+1,held:[`0x${(i+1).toString(16)}`],...(i?{wait:`0x${i.toString(16)}`}:{})}));
    for(const theme of ['light','dark']) {
        await page.goto(appUrl+'/jvmscope/tda.html');
        await page.getByLabel('Website theme').selectOption(theme);
        await page.locator('#fileInput').setInputFiles({name:'large-chain.txt',mimeType:'text/plain',buffer:Buffer.from(blockingDump(0,entries))});
        await expect(page.locator('#rowCount')).toContainText('400 threads');
        await page.locator('#clearBtn').click();
        await expect(page.locator('#analyzerStart')).toBeVisible();
        await expect(page.locator('#fileName')).toHaveText('No file loaded');
    }
    await context.close();
});

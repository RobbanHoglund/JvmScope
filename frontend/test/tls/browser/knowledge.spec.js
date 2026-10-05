import { test, expect } from './fixtures.js';
import { ARTICLES } from '../../../assets/javautils/knowledge/data.js';

test('knowledge home, local filters, version comparison and direct articles work without sending search data',async({page,context,appUrl},info)=>{
    const requests=[];
    context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),body:r.postData(),method:r.method()});});
    await page.goto(appUrl+'/');
    await expect(page.locator('a[href$="jvmscope/tda.html"]').last()).toBeVisible();
    await page.getByRole('link',{name:/Explore eight Java knowledge articles/}).click();
    await expect(page).toHaveURL(appUrl+'/knowledge/index.html');
    await expect(page.locator('#knowledgeCount')).toHaveText('8 articles');
    await page.screenshot({path:info.outputPath('knowledge-index.png'),fullPage:true});
    await page.locator('#knowledgeSearch').fill('PRIVATE_SEARCH_SENTINEL');
    await expect(page.locator('#knowledgeCount')).toHaveText('0 articles');
    await page.locator('#knowledgeSearch').fill('pinning');
    await page.locator('#knowledgeVersion').selectOption('17');
    await expect(page.locator('#knowledgeArticles')).not.toContainText('Virtual threads, carriers and pinning');
    await page.locator('#knowledgeVersion').selectOption('27');
    await page.locator('#knowledgeTopic').selectOption('threads');
    await expect(page.locator('#knowledgeArticles a')).toHaveCount(1);
    await page.locator('#compareFrom').selectOption('24');
    await page.locator('#compareTo').selectOption('27');
    await expect(page.locator('#knowledgeComparison')).toContainText('Experimental; disabled by default');
    await expect(page.locator('#knowledgeComparison')).toContainText('Product; enabled by default');
    await page.locator('#compareFrom').selectOption('27');
    await expect(page.locator('#knowledgeComparison')).toContainText('does not mean the releases are equivalent');
    await page.locator('#knowledgeArticles a').click();
    await expect(page.locator('#knowledgeRoot h1')).toHaveText('Virtual threads, carriers and pinning');
    await page.reload();
    await expect(page.locator('#knowledgeRoot')).toContainText('Last source verification: 2026-10-05');
    await page.getByRole('link',{name:'← Knowledge base',exact:true}).click();
    for(const article of ARTICLES) {
        await page.goto(`${appUrl}/knowledge/${article.id}.html`);
        await expect(page.locator('#knowledgeRoot h1')).toHaveText(article.title);
        await expect(page.locator('#knowledgeRoot')).toContainText('A. Documented JVM capabilities');
        await expect(page.locator('#knowledgeRoot')).toContainText('B. What the selected collection actually contains');
        await expect(page.locator('#knowledgeRoot')).toContainText('C. What JvmScope has verified');
        await expect(page.locator('#knowledgeRoot')).toContainText('Primary sources');
        await page.locator('#articleVersion').selectOption('7');
        await expect(page.locator('#articleCoverage')).toContainText('3 TDA cases and 36 TLS cases');
        await page.locator('#knowledgeFormat').selectOption('json');
        await expect(page.locator('#formatEvidence')).toContainText('No CPU/allocation counters');
    }
    expect(requests.every(r=>new URL(r.url).origin===new URL(appUrl).origin && ['GET','HEAD'].includes(r.method) && r.body===null)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_SEARCH_SENTINEL');
    expect(await page.evaluate(()=>JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)}))).not.toContain('PRIVATE_SEARCH_SENTINEL');
});

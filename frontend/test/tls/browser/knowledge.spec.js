import { test, expect } from './fixtures.js';
import { ARTICLES, VERIFIED_DATE } from '../../../assets/javautils/knowledge/data.js';
import { renderBlock, sourceLinks } from '../../../assets/javautils/knowledge/view.js';

test('knowledge body search opens the matching section, navigates highlights and retains no search text in requests or storage',async({page,context,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/index.html?java=25`);
    const requests=[];context.on('request',r=>requests.push({url:r.url(),body:r.postData()}));
    await page.getByRole('searchbox',{name:'Search articles',exact:true}).fill('overwrite');
    const result=page.locator('.knowledge-card').filter({hasText:'Collect the right thread dump'});
    await expect(result.locator('.knowledge-excerpt')).toContainText('Check your actual configuration');
    await expect(result.locator('.knowledge-excerpt mark')).toContainText('overwrite');
    await result.click();
    await expect(page).toHaveURL(/thread-dumps\.html\?java=25#find=overwrite&section=check$/);
    await expect(page.getByRole('searchbox',{name:'Search this article',exact:true})).toHaveValue('overwrite');
    await expect(page.locator('#check mark.knowledge-current-match')).toBeInViewport();
    await page.getByRole('link',{name:'← Knowledge base',exact:true}).click();
    await expect(page.locator('#knowledgeSearch')).toHaveValue('overwrite');
    await expect(page.locator('#knowledgeVersion')).toHaveValue('25');
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    expect(new URL(page.url()).hash).toBe('');
    await page.reload();
    await expect(page.locator('#knowledgeSearch')).toHaveValue('');
    await expect(page.locator('#knowledgeCount')).toHaveText('8 articles');
    await page.locator('#knowledgeSearch').fill('overwrite');
    await page.getByRole('link',{name:/Collect the right thread dump/}).click();
    await page.getByRole('searchbox',{name:'Search this article',exact:true}).fill('CPU');
    expect(new URL(page.url()).hash).toBe('');
    const matches=page.locator('mark[data-article-match]');
    expect(await matches.count()).toBeGreaterThan(2);
    await expect(page.locator('#articleSearchCount')).toContainText('1 of');
    await page.getByRole('button',{name:'Next article match',exact:true}).click();
    await expect(page.locator('#articleSearchCount')).toContainText('2 of');
    await page.getByRole('searchbox',{name:'Search this article',exact:true}).press('Shift+Enter');
    await expect(page.locator('#articleSearchCount')).toContainText('1 of');
    await page.getByRole('searchbox',{name:'Search this article',exact:true}).press('Shift+Enter');
    await expect(page.locator('#articleSearchCount')).toContainText(`${await matches.count()} of`);
    await page.keyboard.press('Control+f');
    await expect(page.getByRole('searchbox',{name:'Search this article',exact:true})).toBeFocused();
    await page.locator('#articleSearch').fill('PRIVATE_ARTICLE_SEARCH_SENTINEL');
    await expect(page.locator('#articleSearchCount')).toHaveText('No matches');
    await expect(page.locator('#articleSearchNext')).toBeDisabled();
    await page.locator('#articleSearch').press('Escape');
    await expect(matches).toHaveCount(0);
    await expect(page.locator('#articleSearch')).toHaveValue('');
    expect(new URL(page.url()).hash).toBe('');
    expect(JSON.stringify(requests)).not.toContain('overwrite');
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_ARTICLE_SEARCH_SENTINEL');
    expect(requests.every(r=>new URL(r.url).origin===new URL(appUrl).origin&&!r.body)).toBe(true);
    expect(await page.evaluate(()=>JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)}))).not.toMatch(/overwrite|PRIVATE_ARTICLE_SEARCH_SENTINEL/);
});

test('knowledge article search survives dynamic content and preserves original code, anchors and hostile text safely',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/thread-dumps.html?java=25`);
    const code=await page.locator('#check pre').allTextContents();
    await page.locator('#articleSearch').fill('jcmd');
    expect(await page.locator('#check pre').allTextContents()).toEqual(code);
    await page.locator('#articleSearch').fill('formatVersion');
    await page.locator('#knowledgeFormat').selectOption('json');
    await page.locator('#articleVersion').selectOption('27');
    await expect(page.locator('#formatEvidence mark')).toContainText('formatVersion');
    await page.locator('#knowledgeFormat').selectOption('plain');
    await expect(page.locator('#formatEvidence mark')).toHaveCount(0);
    await expect(page.locator('#articleSearch')).toHaveValue('formatVersion');
    await page.locator('#articleSearch').fill('a');
    expect(await page.locator('mark[data-article-match]').count()).toBeLessThanOrEqual(500);
    await page.locator('#articleSearch').fill('<img src="https://evil.invalid/x" onerror="window.KB_SEARCH_ATTACK=true">');
    await expect(page.locator('#knowledgeRoot img, #knowledgeRoot script')).toHaveCount(0);
    expect(await page.evaluate(()=>window.KB_SEARCH_ATTACK)).toBeUndefined();
    await page.getByRole('button',{name:'Clear search',exact:true}).click();
    expect(await page.locator('#check pre').allTextContents()).toEqual(code);
    await page.getByRole('link',{name:'Inspect',exact:true}).click();
    await expect(page.locator('#check')).toBeInViewport();
    await expect(page.locator('mark[data-article-match]')).toHaveCount(0);
});

test('knowledge home, local filters, version comparison and direct articles work without sending search data',async({page,context,appUrl},info)=>{
    const requests=[];
    context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push({url:r.url(),body:r.postData(),method:r.method()});});
    await page.goto(appUrl+'/');
    await expect(page.getByRole('heading',{name:'Analyze Java thread dumps and TLS logs.',exact:true})).toBeVisible();
    await expect(page.locator('.privacy')).toContainText('Analyzed locally in your browser. Nothing uploaded.');
    await expect(page.locator('a[href$="jvmscope/tda.html"]').last()).toBeVisible();
    const privacy=await page.locator('.privacy').boundingBox(),tool=await page.locator('a[href$="jvmscope/tda.html"]').last().boundingBox();
    expect(privacy.y+privacy.height).toBeLessThan(tool.y);
    const knowledgeCard=page.locator('section[aria-label="Java Knowledge Base"] a');
    await expect(knowledgeCard).toHaveCount(1);
    await knowledgeCard.focus();
    await page.keyboard.press('Enter');
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
    const virtualArticle=page.getByRole('link',{name:/Virtual threads, carriers and pinning/});
    await expect(virtualArticle).toBeVisible();
    await page.locator('#compareFrom').selectOption('24');
    await page.locator('#compareTo').selectOption('27');
    await expect(page.locator('#knowledgeComparison')).toContainText('Experimental; disabled by default');
    await expect(page.locator('#knowledgeComparison')).toContainText('Product; enabled by default');
    await page.locator('#compareFrom').selectOption('27');
    await expect(page.locator('#knowledgeComparison')).toContainText('does not mean the releases are equivalent');
    await virtualArticle.click();
    await expect(page.locator('#knowledgeRoot h1')).toHaveText('Virtual threads, carriers and pinning');
    await page.reload();
    await expect(page.locator('#knowledgeRoot')).toContainText(`Last source verification: ${VERIFIED_DATE}`);
    await page.getByRole('link',{name:'← Knowledge base',exact:true}).click();
    for(const article of ARTICLES) {
        await page.goto(`${appUrl}/knowledge/${article.id}.html`);
        await expect(page.locator('#knowledgeRoot h1')).toHaveText(article.title);
        const icon=await page.locator('link[rel="icon"]').getAttribute('href');
        const iconUrl=new URL(icon,page.url());
        expect(iconUrl.href.startsWith(`${appUrl}/assets/`)).toBe(true);
        const iconResponse=await page.request.get(iconUrl.href);
        expect(iconResponse.status()).toBe(200);
        expect(iconResponse.headers()['content-type']).toContain('image/svg+xml');
        await expect(page.locator('#knowledgeRoot')).toContainText('A. Documented JVM capabilities');
        await expect(page.locator('#knowledgeRoot')).toContainText(article.collection?'B. What the selected collection actually contains':'B. Evidence needed for this question');
        await expect(page.locator('#knowledgeRoot')).toContainText(article.collection?'C. What JvmScope has verified':'C. Where JvmScope can help');
        await expect(page.locator('#knowledgeRoot')).toContainText('Primary sources');
        await page.locator('#articleVersion').selectOption('7');
        if(article.collection){
            await expect(page.locator('#articleCoverage')).toContainText('3 TDA cases and 36 TLS cases');
            await page.locator('#knowledgeFormat').selectOption('json');
            await expect(page.locator('#formatEvidence')).toContainText('Not available in upstream Java 7');
            await expect(page.locator('#formatEvidence')).toContainText('No CPU/allocation counters');
            const link=await page.locator('#articleCoverage a').getAttribute('href');
            expect(link).toMatch(/\/blob\/[a-f0-9]{40}\/docs\/JVM-SAMPLE-RESULTS\.md$/);
        }else{
            await expect(page.locator('#knowledgeFormat')).toHaveCount(0);
            await expect(page.locator('#articleCoverage')).toHaveCount(0);
            await expect(page.locator('#measurementContext')).toContainText('capture counts do not validate');
        }
    }
    expect(requests.every(r=>new URL(r.url).origin===new URL(appUrl).origin && ['GET','HEAD'].includes(r.method) && r.body===null)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_SEARCH_SENTINEL');
    expect(await page.evaluate(()=>JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)}))).not.toContain('PRIVATE_SEARCH_SENTINEL');
});

test('knowledge collection guidance follows version changes without inventing availability or counters',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/thread-dumps.html?java=17`);
    await page.locator('#knowledgeFormat').selectOption('json');
    await expect(page.locator('#formatEvidence')).toContainText('Not available in upstream Java 17');
    await expect(page.locator('#knowledgeFormat option[value="json"]')).toContainText('unavailable in Java 17');
    for(const [version,expected] of [['19','APIs are preview'],['20','APIs are preview'],['21','limited thread evidence'],['25','Per-thread time/state and lock information'],['26','AbstractOwnableSynchronizer'],['27','formatVersion: 2']]){
        await page.locator('#articleVersion').selectOption(version);
        await expect(page.locator('#knowledgeFormat')).toHaveValue('json');
        await expect(page.locator('#formatEvidence')).toContainText(expected);
        await expect(page.locator('#formatEvidence')).toContainText('No CPU/allocation counters');
    }
    await page.locator('#knowledgeFormat').selectOption('plain');
    await expect(page.locator('#formatEvidence')).not.toContainText('formatVersion: 2');
    for(const version of ['25','26','27']){
        await page.locator('#articleVersion').selectOption(version);
        await expect(page.locator('#formatEvidence')).not.toContainText('carrier');
        if(version!=='25')await expect(page.locator('#formatEvidence')).toContainText('AbstractOwnableSynchronizer');
        await page.locator('#knowledgeFormat').selectOption('json');
        await expect(page.locator('#formatEvidence')).toContainText('Optional mounted virtual-thread carrier identifier');
        await page.locator('#knowledgeFormat').selectOption('plain');
    }
    await page.locator('#articleVersion').selectOption('7');
    await expect(page.locator('#formatEvidence')).toContainText('Not available in upstream Java 7');
});

test('knowledge multiword search, evidence transitions and independent controls are useful and local',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/index.html?java=21`);
    await expect(page.locator('#compareFrom')).toHaveValue('21');
    await expect(page.locator('#capabilityVersion')).toHaveValue('21');
    for(const [query,title] of [['CPU allocation','CPU, elapsed and allocation'],['virtual threads Java 21','Virtual threads, carriers'],['compressed object headers','Compact headers, compressed'],['-XX:+UseCompactObjectHeaders','Compact headers, compressed'],['"-XX:+UseCompactObjectHeaders"','Compact headers, compressed'],['(-XX:-UseCompactObjectHeaders)','Compact headers, compressed']]){
        await page.locator('#knowledgeSearch').fill(query);
        await expect(page.locator('#knowledgeArticles a').first()).toContainText(title);
        expect(page.url()).not.toContain(encodeURIComponent(query));
    }
    await page.locator('#knowledgeSearch').fill('https');
    await expect(page.locator('#knowledgeCount')).toHaveText('0 articles');
    await page.locator('#compareTo').selectOption('25');
    await page.locator('#knowledgeVersion').selectOption('17');
    await expect(page.locator('#compareFrom')).toHaveValue('21');
    await expect(page.locator('#compareTo')).toHaveValue('25');
    await expect(page.locator('#capabilityVersion')).toHaveValue('21');
    for(const [from,to] of [['21','27'],['27','21']]){
        await page.locator('#compareFrom').selectOption(from);
        await page.locator('#compareTo').selectOption(to);
        await expect(page.locator('#knowledgeComparison')).toContainText('File-dump thread and lock evidence');
        await expect(page.locator('#knowledgeComparison')).toContainText('File-dump JSON identifiers and schema');
    }
    await page.locator('#compareFrom').selectOption('25');
    await page.locator('#compareTo').selectOption('26');
    await expect(page.locator('#knowledgeComparison tbody tr')).toHaveCount(1);
    await expect(page.locator('#knowledgeComparison')).toContainText('Park-blocker owner evidence added');
});

test('knowledge Java 7 and 8 class-pointer guidance remains distinct in articles and both upgrade directions',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/object-headers.html?java=7`);
    const capability=page.locator('#articleCapabilities tbody tr').filter({hasText:'UseCompressedClassPointers option'});
    await expect(capability).toContainText('Separate option unavailable in checked upstream Java 7');
    await expect(capability.locator('a[href*="/openjdk/jdk7u/blob/jdk7u80-b15/"]')).toHaveCount(1);
    await page.locator('#articleVersion').selectOption('8');
    await expect(capability).toContainText('Configuration-dependent option');
    await expect(capability).not.toContainText('Separate option unavailable');
    await expect(capability.locator('a[href*="/openjdk/jdk8u/blob/jdk8-b132/"]')).toHaveCount(1);
    await page.goto(`${appUrl}/knowledge/index.html`);
    for(const [from,to] of [['7','8'],['8','7']]){
        await page.locator('#compareFrom').selectOption(from);
        await page.locator('#compareTo').selectOption(to);
        const row=page.locator('#knowledgeComparison tbody tr').filter({hasText:'UseCompressedClassPointers option'});
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('Separate option unavailable');
        await expect(row).toContainText('Configuration-dependent option');
    }
});

test('knowledge practical articles expose safe examples and direct section anchors without tuning certification',async({page,appUrl},info)=>{
    for(const id of ['thread-dumps','object-headers']){
        await page.goto(`${appUrl}/knowledge/${id}.html?java=27`);
        await expect(page.getByRole('navigation',{name:'Article sections'})).toBeInViewport();
        expect(await page.evaluate(()=>document.querySelector('.knowledge-contents').compareDocumentPosition(document.querySelector('#articleCapabilities')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
        await page.goto(`${appUrl}/knowledge/${id}.html?java=27#check`);
        await expect(page.locator('#check')).toBeInViewport();
        await expect(page.locator('#check pre code').first()).toContainText('jcmd PID');
        await expect(page.locator('#knowledgeRoot')).toContainText('Illustrative');
        await page.reload();
        await expect(page.locator('#check')).toBeInViewport();
        await page.getByRole('link',{name:'Mechanism',exact:true}).click();
        await expect(page).toHaveURL(`${appUrl}/knowledge/${id}.html?java=27#does`);
        await page.screenshot({path:info.outputPath(`knowledge-${id}.png`),fullPage:true});
    }
    await expect(page.locator('#knowledgeRoot')).toContainText('Same aligned size');
    await expect(page.locator('#articleCapabilities')).toContainText('Obsolete; option ignored');
    await expect(page.locator('#knowledgeRoot')).toContainText('Neither measures aligned object size');
    await expect(page.locator('#knowledgeFormat')).toHaveCount(0);
});

test('knowledge hostile teaching text is literal and cannot execute or fetch external resources',async({page,context,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/object-headers.html`);
    const requests=[];
    context.on('request',r=>requests.push(r.url()));
    const hostile='<img src="https://evil.invalid/image" onerror="window.KB_ATTACK=true"><script>window.KB_ATTACK=true</script>';
    const blocks=[{type:'paragraph',text:hostile},{type:'list',items:[hostile]},{type:'code',text:hostile,caption:hostile},{type:'callout',text:hostile,title:hostile},{type:'table',caption:hostile,headers:[hostile],rows:[[hostile]]}];
    const html=blocks.map(renderBlock).join('')+sourceLinks(['javascript:alert(1)','https://evil.invalid/source']);
    await page.locator('#knowledgeRoot').evaluate((root,html)=>{root.innerHTML=html;},html);
    await expect(page.locator('#knowledgeRoot img, #knowledgeRoot script, #knowledgeRoot a')).toHaveCount(0);
    await expect(page.locator('#knowledgeRoot')).toContainText('<script>window.KB_ATTACK=true</script>');
    expect(await page.evaluate(()=>window.KB_ATTACK)).toBeUndefined();
    expect(requests).toEqual([]);
});

test('knowledge compares the G1 default transition in 26 to 27 with its source and qualifications',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/index.html`);
    await page.locator('#compareFrom').selectOption('26');
    await page.locator('#compareTo').selectOption('27');
    const row=page.locator('#knowledgeComparison tbody tr').filter({hasText:'G1 default collector'});
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Default on specified server configurations');
    await expect(row).toContainText('Default in all environments');
    await expect(row).toContainText('Explicit collector flags still override');
    await expect(row.locator('a[href="https://openjdk.org/jeps/523"]')).toHaveCount(1);
    await page.goto(`${appUrl}/knowledge/gc-memory.html?java=27`);
    await expect(page.locator('#articleCapabilities')).toContainText('Default in all environments');
    await expect(page.locator('#knowledgeRoot')).toContainText('JEP 523 makes G1 the upstream HotSpot default');
});

test('knowledge retains the selected Java version in article navigation, reload and return without sharing search text',async({page,appUrl})=>{
    await page.goto(`${appUrl}/knowledge/index.html`);
    await page.locator('#knowledgeVersion').selectOption('17');
    await page.locator('#knowledgeSearch').fill('PRIVATE_NAVIGATION_SENTINEL');
    expect(page.url()).not.toContain('PRIVATE_NAVIGATION_SENTINEL');
    await page.locator('#knowledgeSearch').fill('');
    const link=page.getByRole('link',{name:/Collect the right thread dump/});
    await expect(link).toHaveAttribute('href','./thread-dumps.html?java=17');
    await link.click();
    await expect(page.locator('#articleVersion')).toHaveValue('17');
    await page.reload();
    await expect(page.locator('#articleVersion')).toHaveValue('17');
    await page.locator('#articleVersion').selectOption('7');
    await expect(page).toHaveURL(`${appUrl}/knowledge/thread-dumps.html?java=7`);
    await page.reload();
    await expect(page.locator('#articleVersion')).toHaveValue('7');
    await page.getByRole('link',{name:'← Knowledge base',exact:true}).click();
    await expect(page.locator('#knowledgeVersion')).toHaveValue('7');
    await page.reload();
    await expect(page.locator('#knowledgeVersion')).toHaveValue('7');
    await page.locator('#knowledgeVersion').selectOption('');
    await expect(page).toHaveURL(`${appUrl}/knowledge/index.html`);
    await expect(page.getByRole('link',{name:/Collect the right thread dump/})).toHaveAttribute('href','./thread-dumps.html');
    await page.goto(`${appUrl}/knowledge/thread-dumps.html?java=${encodeURIComponent('<script>bad</script>')}`);
    await expect(page.locator('#articleVersion')).toHaveValue('27');
    await expect(page.locator('#knowledgeBack')).toHaveAttribute('href','./index.html');
});

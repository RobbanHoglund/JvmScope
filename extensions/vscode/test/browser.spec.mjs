import {test as base, expect} from '../../../frontend/node_modules/@playwright/test/index.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import webview from '../src/webview.cjs';
import protocol from '../src/protocol.cjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const media=resolve(root,'extensions/vscode/media');
const capture=relative=>readFile(resolve(root,relative),'utf8');
const test=base.extend({
    host: async({page},use)=>{
        const pages=JSON.parse(await readFile(resolve(media,'pages.json'),'utf8'));
        let origin, clipboard='', sourceError='', nextNavigation=0; const messages=[];
        const server=createServer(async(req,res)=>{
            try {
                const url=new URL(req.url,origin);
                if(url.pathname==='/view') {
                    const route=url.searchParams.get('page')||'/jvmscope/tda.html';
                    const {name}=webview.resolveRoute(route,pages);
                    const html=webview.renderWebview(await readFile(resolve(media,name),'utf8'),{page:name,route,pages,cspSource:origin,resourceUri:name=>origin+'/'+name});
                    res.setHeader('Content-Type','text/html');res.end(html);
                }else{
                    const name=decodeURIComponent(url.pathname.slice(1));
                    if(!name.startsWith('assets/')||name.includes('..'))throw new Error('Not an asset');
                    res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.txt':'text/plain','.png':'image/png','.woff2':'font/woff2'})[extname(name)]||'application/octet-stream');
                    res.end(await readFile(resolve(media,name)));
                }
            }catch{res.statusCode=404;res.end('Not found');}
        });
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
        const errors=[],violations=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.exposeFunction('testHostMessage',async message=>{
            messages.push(message);
            if(message.type==='request') {
                let value=true;
                if(message.action==='paste')value=clipboard;
                if(message.action==='copy')clipboard=message.text;
                if(message.action==='chooseFiles')value=null;
                let error=message.action==='openSource'?sourceError:undefined;
                try {
                    protocol.validateRequest(message);
                    if(message.action==='navigate')webview.resolveRoute(message.route,pages);
                } catch(cause) { error=cause.message; }
                await page.evaluate(({message,value,error})=>window.postMessage({channel:'jvmscope',version:1,type:'response',id:message.id,value,error},'*'),{message,value,error});
            }
        });
        await page.exposeFunction('testCspViolation',value=>violations.push(value));
        await page.addInitScript(()=>{
            window.acquireVsCodeApi=()=>({postMessage:message=>window.testHostMessage(message)});
            document.addEventListener('securitypolicyviolation',event=>window.testCspViolation(`${event.violatedDirective}: ${event.blockedURI}`));
        });
        await use({page,origin,messages,clipboard:()=>clipboard,rejectSource:message=>{sourceError=message;},open:async name=>{
            const previous=messages.filter(m=>m.type==='ready').length;
            await page.goto(`${origin}/view?page=${encodeURIComponent(name)}`);
            await expect.poll(()=>messages.filter(m=>m.type==='ready').length).toBeGreaterThan(previous);
        },navigation:async(action,key='',offset=0,revision=messages.findLast(m=>m.type==='navigationState')?.revision)=>{
            const id=`nav:${++nextNavigation}`;
            await page.evaluate(message=>window.postMessage(message,'*'),{channel:'jvmscope',version:1,type:'navigationRequest',id,revision,action,key,offset});
            await expect.poll(()=>messages.find(m=>m.type==='navigationResult'&&m.id===id)).toBeTruthy();
            return messages.find(m=>m.type==='navigationResult'&&m.id===id);
        },load:async sources=>{
            const id='test:'+Math.random();
            await page.evaluate(({sources,id})=>window.postMessage({channel:'jvmscope',version:1,type:'load',id,sources},'*'),{sources,id});
            await expect.poll(()=>messages.find(m=>m.type==='loaded'&&m.id===id),{timeout:20000}).toBeTruthy();
            const response=messages.find(m=>m.type==='loaded'&&m.id===id);
            expect(response.error).toBeUndefined();return response.value;
        }});
        await new Promise(resolve=>server.close(resolve));
        expect(errors).toEqual([]);expect(violations).toEqual([]);
    },
});

test('VS Code TDA uses inline workers, keeps allocation qualifications and opens exact native evidence',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await expect(host.page.locator('.analyzer-start-privacy')).toHaveText('Analyzed locally in VS Code. Nothing is uploaded.');
    const sources=await Promise.all(['allocation-before.txt','allocation-after.txt'].map(async name=>({name,text:await capture('frontend/test/tda/fixtures/ga-regressions/'+name)})));
    const result=await host.load(sources);expect(result.snapshots).toBe(2);
    await host.page.locator('#dumpSelect').selectOption('1');
    const row=host.page.locator('#threadTableBody tr').filter({hasText:'audit-allocation-boundary'});
    await expect(row).not.toContainText('ALLOCATION HOT');await expect(row.locator('td').nth(11)).toContainText('–');
    await host.page.locator('#openRawDumpBtn').click();
    await expect(host.page.getByRole('dialog',{name:'Raw dump evidence',exact:true})).toBeVisible();
    await expect(host.page.getByRole('button',{name:'Show the canonical raw dump',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(host.messages.some(m=>m.action==='openRaw')).toBe(false);
    await host.page.getByRole('button',{name:'Open complete raw dump in text editor',exact:true}).click();
    await expect.poll(()=>host.messages.find(m=>m.action==='openRaw')).toBeTruthy();
    expect(host.messages.find(m=>m.action==='openRaw').text).toBe(sources[1].text.trimEnd());
    await host.page.getByRole('button',{name:'Close raw dump evidence workspace',exact:true}).click();
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await host.page.locator('#threadModalCopyBtn').click();
    await expect.poll(()=>host.clipboard()).toContain('audit-allocation-boundary');
    await host.page.locator('#threadModalClose2').click();
    await host.page.locator('#clearBtn').click();await expect(host.page.locator('#threadTableBody tr')).toHaveCount(0);
    expect(host.messages.some(m=>m.action==='clearRaw')).toBe(true);
});

test('TDA overview separates CPU coverage from zero and leads to scoped thread evidence',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    const priority=host.page.locator('.tda-priority');
    await expect(priority).toContainText('Confirmed Java deadlock');
    await expect(priority).toContainText('2 JVM-reported cycles · 5 mapped thread blocks');
    await expect(host.page.locator('.tda-snapshot-metrics')).toContainText('Unavailable');
    await host.page.locator('.tda-snapshot-details summary').click();
    await expect(host.page.locator('.tda-snapshot-details')).toContainText('No preceding snapshot');
    await host.page.locator('#onlyBlockedToggle').check();
    await priority.getByRole('button',{name:'Inspect 5 threads',exact:true}).click();
    await expect(host.page.locator('#onlyBlockedToggle')).toBeChecked();
    await expect(host.page.locator('#threadTableBody tr')).toHaveCount(5);
    await expect(host.page.locator('#focusFilterBar')).toBeVisible();
    await host.page.locator('#clearFocusFilterBtn').click();
    await expect(host.page.locator('#threadTableBody tr')).toHaveCount(8);
    await host.page.locator('#nextDumpBtn').click();
    await expect(host.page.locator('.tda-snapshot-details')).toContainText('Reliable rates for');
    await expect(host.page.locator('.tda-snapshot-metrics')).not.toContainText('Unavailable');
});

test('deadlock cycle lists the closing owner relationship and opens mapped evidence',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await host.page.locator('#deadlockPanel .deadlock-panel-summary').click();
    const cycle=host.page.getByRole('region',{name:'Deadlock cycle 1',exact:true});
    await expect(cycle.locator('.relationship-figure')).toBeVisible();
    await expect(cycle.locator('.relationship-edge')).toHaveCount(4);
    await expect(cycle.locator('.relationship-edge.is-closing')).toHaveCount(1);
    await expect(cycle.locator('.tda-cycle-edge')).toHaveCount(2);
    const first=await cycle.locator('.tda-cycle-thread strong').first().textContent();
    await expect(cycle.locator('.tda-cycle-owner strong').last()).toHaveText(first);
    await cycle.getByRole('button',{name:'Inspect cycle',exact:true}).click();
    await expect(host.page.locator('#deadlockedThreadsModal')).toBeVisible();
    await host.page.keyboard.press('Escape');
    await cycle.locator('.relationship-thread-btn').first().click();
    await expect(host.page.locator('#threadModalTitle')).toHaveText(first);
});

test('TDA inline dependency diagrams fit host themes and keep their labels clear of nodes',async({host},testInfo)=>{
    const {page}=host;
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'classic-sequence.txt',text:await capture('testdata/jvm-samples/gh-37180401747-1-bisheng-25-all/classic-sequence.txt')}]);
    for(const selector of ['.deadlock-panel-summary','.class-initialization-panel-summary','.contention-panel-summary'])await page.locator(selector).click();
    for(const width of [1366,600]) {
        await page.setViewportSize({width,height:1000});
        for(const theme of Object.keys(themePalettes)) {
            await applyTheme(page,theme);
            for(const panel of ['#deadlockPanel','#classInitializationPanel','#contentionPanel']) {
                const graph=page.locator(`${panel} .relationship-figure`).first();
                await expect(graph).toBeVisible();
                await expectReadable(graph.locator('.relationship-node-name').first());
                await expect.poll(()=>graph.evaluate(el=>{
                    const nodes=[...el.querySelectorAll('[data-rel-node]')].map(n=>n.getBoundingClientRect());
                    const labels=[...el.querySelectorAll('.relationship-edge text')].map(n=>n.getBoundingClientRect());
                    const overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
                    const bounds=el.getBoundingClientRect();
                    return nodes.some((a,i)=>nodes.some((b,j)=>i!==j&&overlaps(a,b)))
                        ||labels.some(a=>nodes.some(b=>overlaps(a,b)))
                        ||[...nodes,...labels].some(a=>a.left<bounds.left||a.right>bounds.right);
                })).toBe(false);
                for(const edge of await graph.locator('.relationship-edge').all()) {
                    await expect(edge.locator('path')).toHaveAttribute('marker-end',/url\(#rel-/);
                }
                await graph.screenshot({path:testInfo.outputPath(`${panel.slice(1)}-${width}-${theme}.png`)});
            }
            expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
    }
    const thread=page.locator('#deadlockPanel .relationship-thread-btn').first();
    await thread.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#threadModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(thread).toBeFocused();
    const origin=page.locator('#contentionPanel .relationship-contention-card .contention-graph-btn').first();
    await origin.click();
    await expect(page.locator('#dependencyGraphDetails')).toHaveAttribute('open','');
    await page.locator('#contentionGraphReturn').click();
    await expect(origin).toBeFocused();
});

test('TDA unresolved participants show reported dependencies without invented cycle closure',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'unmapped.txt',text:await capture('frontend/test/tda/fixtures/unmapped-deadlock-participants.txt')}]);
    await host.page.locator('.deadlock-panel-summary').click();
    const panel=host.page.locator('#deadlockPanel');
    await expect(panel.locator('.relationship-figure')).toHaveCount(2);
    await expect(panel.locator('.relationship-edge.is-closing')).toHaveCount(0);
    await expect(panel.locator('.relationship-thread-btn')).toHaveCount(0);
    await expect(panel).toContainText('no return path is assumed');
});

test('TDA analysis columns keep evidence reachable and preserve sort when switching columns',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await host.page.setViewportSize({width:600,height:900});
    const table=host.page.locator('#threadTable');
    await expect(table.locator('th[data-key="cpuMs"]')).toBeHidden();
    await expect(table.locator('th[data-key="cpuRatePercent"]')).toBeVisible();
    const row=table.locator('tbody tr').first();
    const before=await row.getAttribute('data-source-key');
    await expect(row.getByRole('button',{name:'Details',exact:true})).toBeVisible();
    expect(await table.evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(600);
    await host.page.locator('#threadColumns').selectOption('all');
    await expect(table.locator('th[data-key="cpuMs"]')).toBeVisible();
    expect(await row.getAttribute('data-source-key')).toBe(before);
    const controlsX=(await host.page.locator('#threadColumns').boundingBox()).x;
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await expect(host.page.locator('#threadModal')).toBeVisible();
    await host.page.keyboard.press('Escape');
    expect((await host.page.locator('#threadColumns').boundingBox()).x).toBe(controlsX);
    await host.page.locator('#threadColumns').selectOption('analysis');
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await expect(host.page.locator('#threadModal')).toBeVisible();
});

test('TDA overview fits the viewport without brand overlap and expanded evidence spans the grid',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    for(const width of [1560,1366,780,600]) {
        await host.page.setViewportSize({width,height:900});
        const boxes=await host.page.locator('.analyzer-brand').evaluate(el=>{
            const a=el.querySelector('h1').getBoundingClientRect(),b=el.querySelector('.analyzer-file-name').getBoundingClientRect();
            return {overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,overflow:document.documentElement.scrollWidth>innerWidth};
        });
        expect(boxes).toEqual({overlap:false,overflow:false});
        expect((await host.page.locator('.tda-priority').boundingBox()).y).toBeLessThan(650);
    }
    await host.page.setViewportSize({width:1366,height:900});
    await host.page.locator('#deadlockPanel .deadlock-panel-summary').click();
    const [panel,grid]=await Promise.all([host.page.locator('#deadlockPanel').boundingBox(),host.page.locator('.tda-secondary-panels').boundingBox()]);
    expect(Math.abs(panel.width-grid.width)).toBeLessThan(2);
    await host.page.locator('#deadlockPanel .deadlock-panel-summary').click();
    await expect(host.page.locator('.tda-priority .smart-analysis-focus-btn')).toBeVisible();
});

test('CPU comparison exposes interval scope, durations and an explicit selection reset',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await host.page.locator('#jumpToCpu').click();
    await expect(host.page.locator('#cpuTimelineSummary')).toContainText('no preceding CPU interval');
    const rows=host.page.locator('.tda-cpu-ranking tbody tr');
    await expect(rows).toHaveCount(10);
    await expect(rows.first().locator('td').nth(1)).toHaveText('— unavailable');
    const thread=host.page.locator('.cpu-timeline-legend-item').first();
    await thread.click();
    await expect(thread).toHaveAttribute('aria-pressed','true');
    await expect(host.page.locator('#cpuTimelineSelection')).toContainText('Peak interval');
    await expect(host.page.locator('#cpuTimelineSelection')).toContainText('Rate basis:');
    await host.page.locator('#cpuTimelineClear').click();
    await expect(thread).toHaveAttribute('aria-pressed','false');
    await expect(host.page.locator('.cpu-timeline-series.is-muted')).toHaveCount(0);
    // Select the series before clicking an overlapping point, as a user would.
    await thread.click();
    await host.page.locator('#cpuTimelineChart .cpu-timeline-series.is-highlighted .cpu-timeline-point').first().click();
    await expect(host.page.locator('#dumpSelect')).toHaveValue('1');
    await expect(host.page.locator('#cpuTimelineSelection')).toContainText('Selected interval D1→D2');
    await expect(rows.first().locator('td').nth(1)).toContainText('%');
});

const rawThreadName='waiter<script>window.rawInjected=1</script>';
const rawEvidence=`2026-10-16 12:00:00
Full thread dump OpenJDK 64-Bit Server VM (25+35 mixed mode, sharing):

"holder" #1 prio=5 os_prio=0 tid=0x00000001 nid=0x1 runnable
   java.lang.Thread.State: RUNNABLE
        at example.Holder.run(Holder.java:10)
        - locked <0x000000aa> (a java.lang.Object)

"${rawThreadName}" #2 prio=5 os_prio=0 tid=0x00000002 nid=0x2 waiting for monitor entry
   java.lang.Thread.State: BLOCKED (on object monitor)
        at example.Waiter.run(Waiter.java:20)
        - waiting to lock <0x000000aa> (a java.lang.Object)`;

test('VS Code new raw evidence defaults to Exact before Annotated despite legacy preferences',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.evaluate(()=>localStorage.setItem('tda.rawDumpWorkspace.v1',JSON.stringify({
        mode:'annotated',wrap:true,lineNumbers:false,filter:'blocked',
    })));
    await host.load([{name:'before.txt',text:rawEvidence},{name:'after.txt',text:rawEvidence.replaceAll('holder','second-holder')}]);
    await host.page.locator('#openRawDumpBtn').click();
    const raw=host.page.getByRole('dialog',{name:'Raw dump evidence',exact:true});
    const modes=raw.getByRole('group',{name:'Evidence display'}).getByRole('button');
    await expect(modes).toHaveText(['Exact','Annotated']);
    await expect(modes.nth(0)).toHaveAttribute('aria-pressed','true');
    await expect(modes.nth(1)).toHaveAttribute('aria-pressed','false');
    await expect(raw.locator('.raw-workspace-page')).toHaveClass(/is-wrapped/);
    await expect(raw.locator('.raw-workspace-page')).toHaveClass(/hide-line-numbers/);
    await expect(raw.locator('.raw-workspace-outline')).toBeHidden();
    expect((await raw.locator('.raw-workspace-line-content').allTextContents())
        .map(line=>line===' '?'':line).join('\n')).toBe(rawEvidence);
    await modes.nth(0).focus();
    await host.page.keyboard.press('Tab');
    await expect(modes.nth(1)).toBeFocused();
    await host.page.keyboard.press('Space');
    await expect(modes.nth(1)).toHaveAttribute('aria-pressed','true');
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(1);
    await raw.getByRole('button',{name:'Close raw dump evidence workspace',exact:true}).click();
    await host.page.locator('#openRawDumpBtn').click();
    await expect(modes.nth(1)).toHaveAttribute('aria-pressed','true'); // Resume the current workspace.
    await raw.getByRole('button',{name:'Close raw dump evidence workspace',exact:true}).click();
    await host.page.locator('#nextDumpBtn').click();
    await host.page.locator('#openRawDumpBtn').click();
    await expect(modes.nth(0)).toHaveAttribute('aria-pressed','true'); // A new snapshot starts in Exact.
    await expect(raw).toContainText('second-holder');
});

test('raw evidence labels counts by threads and exposes only settings for the current mode',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'evidence.txt',text:rawEvidence}]);
    await host.page.locator('#openRawDumpBtn').click();
    const raw=host.page.locator('#rawDumpDialog');
    await raw.getByRole('button',{name:'Display settings',exact:true}).click();
    await expect(raw.getByRole('checkbox',{name:'Show outline',exact:true})).toBeHidden();
    await expect(raw.getByRole('checkbox',{name:'Wrap long lines',exact:true})).toBeVisible();
    await expect(raw.locator('.raw-workspace-scope')).toContainText('complete snapshot');
    await raw.getByRole('button',{name:'Show structured evidence',exact:true}).click();
    await raw.getByRole('button',{name:'Display settings',exact:true}).click();
    await expect(raw.getByRole('checkbox',{name:'Show outline',exact:true})).toBeVisible();
    await raw.getByRole('button',{name:'Display settings',exact:true}).click();
    await expect(raw.locator('.raw-workspace-counts')).toHaveText(/2Snapshot threads0Deadlocked threads/);
    const candidates=raw.getByRole('button',{name:'Filter: Investigation candidates',exact:true});
    await expect(candidates).toContainText('2');
    await candidates.click();
    await expect(raw.locator('.raw-workspace-scope')).toContainText('not confirmed faults');
    const holders=raw.getByRole('button',{name:'Filter: Lock holders',exact:true});
    await expect(holders).toBeHidden();
    await raw.locator('.raw-workspace-more-filters > summary').click();
    await holders.click();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(1);
    await expect(raw.locator('.raw-workspace-more-filters')).toHaveAttribute('open','');
    await raw.getByRole('button',{name:'Copy complete canonical raw dump',exact:true}).click();
    await expect.poll(()=>host.clipboard()).toBe(rawEvidence);
});

test('VS Code raw dump keeps structured evidence, search, details, graph navigation and exact native copy',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'raw-evidence.txt',text:rawEvidence}]);
    await host.page.locator('#openRawDumpBtn').click();
    const raw=host.page.getByRole('dialog',{name:'Raw dump evidence',exact:true});
    await raw.getByRole('button',{name:'Show structured evidence',exact:true}).click();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(2);
    expect(host.messages.some(m=>m.action==='openRaw')).toBe(false);
    expect(host.page.context().pages()).toHaveLength(1);
    expect(await host.page.evaluate(()=>window.rawInjected)).toBeUndefined();
    await expect(raw.locator('script')).toHaveCount(0);
    await raw.getByRole('button',{name:'Filter: BLOCKED threads',exact:true}).click();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(1);
    await raw.getByRole('button',{name:`Go to ${rawThreadName}`,exact:true}).click();
    await expect(raw.locator('.raw-workspace-inspector')).toContainText('Lines 9–12');
    const search=raw.getByRole('searchbox',{name:'Search raw dump evidence'});
    await search.fill('Waiter.java:20');
    await expect(raw.locator('.raw-workspace-match.is-active')).toBeVisible();
    const details=raw.getByRole('button',{name:`Open details for ${rawThreadName}`,exact:true});
    await details.click();
    await expect(host.page.locator('#threadModal')).toBeVisible();
    await expect(host.page.locator('#threadModalTitle')).toHaveText(rawThreadName);
    await host.page.keyboard.press('Escape');
    await expect(details).toBeFocused();
    await expect(search).toHaveValue('Waiter.java:20');
    await raw.getByRole('button',{name:`Reveal ${rawThreadName} in dependency graph`,exact:true}).click();
    await expect(raw).toBeHidden();
    await expect(host.page.locator('#dependencyGraphPanel')).toBeVisible();
    await host.page.getByRole('button',{name:'← Back to raw dump',exact:true}).click();
    await expect(raw).toBeVisible();
    await expect(search).toHaveValue('Waiter.java:20');
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(1);
    await raw.getByRole('button',{name:'Show the canonical raw dump',exact:true}).click();
    const exact=await raw.locator('.raw-workspace-line-content').allTextContents();
    expect(exact.map(line=>line===' '?'':line).join('\n')).toBe(rawEvidence);
    await raw.getByRole('button',{name:'Copy complete canonical raw dump',exact:true}).click();
    await expect.poll(()=>host.clipboard()).toBe(rawEvidence);
    await raw.getByRole('button',{name:'Open complete raw dump in text editor',exact:true}).click();
    await expect.poll(()=>host.messages.find(m=>m.action==='openRaw')?.text).toBe(rawEvidence);
    const cleared=host.messages.filter(m=>m.action==='clearRaw').length;
    await raw.getByRole('button',{name:'Close raw dump evidence workspace',exact:true}).click();
    await expect(raw).toBeHidden();
    expect(host.messages.filter(m=>m.action==='clearRaw')).toHaveLength(cleared);
    await expect(host.page.locator('#openRawDumpBtn')).toBeFocused();
    await expect(host.page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
});

test('TDA triage, cycle evidence and selected CPU threads stay readable across host themes',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await host.page.locator('#deadlockPanel .deadlock-panel-summary').click();
    await host.page.locator('#jumpToCpu').click();
    const selected=host.page.locator('.cpu-timeline-legend-item').first();
    await selected.click();
    for(const width of [1366,600]) {
        await host.page.setViewportSize({width,height:900});
        for(const theme of Object.keys(themePalettes)) {
            await applyTheme(host.page,theme);
            for(const selector of ['.tda-priority h2','.tda-snapshot-metrics strong','.relationship-node-name','.relationship-node-detail','.relationship-legend','.tda-table-scope','.tda-cpu-ranking caption','#cpuTimelineSelection']) {
                await expectReadable(host.page.locator(selector).first());
            }
            await expect(selected).toHaveAttribute('aria-pressed','true');
            await selected.hover();
            await expectReadable(selected);
            expect(await host.page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
    }
});
test('TDA recurring stacks and dependency map fit narrow editors across host themes',async({host},testInfo)=>{
    await host.open('/jvmscope/tda.html');
    const {page}=host;
    await page.locator('#loadSampleBtn').click();
    for(const width of [1366,600]) {
        await page.setViewportSize({width,height:1000});
        for(const theme of Object.keys(themePalettes)) {
            await applyTheme(page,theme);
            await page.locator('#jumpToClusters').click();
            const card=page.locator('.runnable-cluster-card').first();
            for(const selector of ['.runnable-cluster-card-title','.runnable-cluster-card-signature','.runnable-cluster-stat strong','.runnable-cluster-trend-badge']) {
                await expectReadable(card.locator(selector).first());
            }
            await page.locator('#runnableClusterPanel').screenshot({path:testInfo.outputPath(`clusters-${width}-${theme}.png`)});
            await card.locator('summary').first().click();
            await expectReadable(card.locator('.runnable-cluster-explanation'));
            expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
            await card.locator('summary').first().click();
            await page.locator('#jumpToGraph').click();
            await expectReadable(page.locator('#dependencyGraphMetrics .dependency-graph-stat-group').first());
            await expectReadable(page.locator('#dependencyGraphDensity'));
            await expect(page.locator('.dependency-graph-edge-hold.is-confirmed-deadlock').first()).toHaveCSS('stroke-dasharray','5px, 3px');
            expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
            await expect.poll(()=>page.locator('#dependencyGraphSvg').evaluate(svg=>{
                const nodes=[...svg.querySelectorAll('.dependency-graph-node-lock')];
                return nodes.some(node=>{
                    const label=node.querySelector('.dependency-graph-node-label').getBoundingClientRect();
                    return label.width>0 && nodes.some(other=>{
                        if(other===node)return false;
                        const core=other.querySelector('.dependency-graph-node-core').getBoundingClientRect();
                        return label.left<core.right && label.right>core.left && label.top<core.bottom && label.bottom>core.top;
                    });
                });
            })).toBe(false);
            await page.locator('#dependencyGraphPanel').screenshot({path:testInfo.outputPath(`graph-${width}-${theme}.png`)});
        }
    }
});

test('VS Code raw evidence retires on snapshot navigation, successful replacement and Clear',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'before.txt',text:rawEvidence},{name:'after.txt',text:rawEvidence.replaceAll('holder','second-holder')}]);
    const raw=host.page.locator('#rawDumpDialog');
    await host.page.locator('#openRawDumpBtn').click();
    await expect(raw).toContainText('Snapshot 1 of 2');
    const files=(await host.navigation('children')).value.items;
    const snapshot=(await host.navigation('children',files[1].key)).value.items[0];
    expect((await host.navigation('select',snapshot.key)).value).toBe(true);
    await expect(raw).toHaveCount(0);
    await host.page.locator('#openRawDumpBtn').click();
    await expect(raw).toContainText('Snapshot 2 of 2');
    await host.load([{name:'invalid.txt',text:'not a thread dump'}]);
    await host.page.locator('#inputFeedbackModal').getByRole('button',{name:'Close',exact:true}).click();
    await expect(raw).toBeVisible();
    await expect(raw).toContainText('Snapshot 2 of 2');
    await raw.getByRole('button',{name:'Show structured evidence',exact:true}).click();
    await raw.getByRole('button',{name:'Open details for second-holder',exact:true}).click();
    await host.load([{name:'replacement.txt',text:rawEvidence.replaceAll('holder','new-holder')}]);
    await expect(raw).toHaveCount(0);
    await expect(host.page.locator('#threadModal')).toBeHidden();
    await host.page.locator('#openRawDumpBtn').click();
    await expect(raw).toContainText('new-holder');
    await raw.getByRole('button',{name:'Close raw dump evidence workspace',exact:true}).click();
    await host.page.locator('#clearBtn').click();
    await expect(raw).toHaveCount(0);
    await expect(host.page.locator('#openRawDumpBtn')).toBeHidden();
});

test('VS Code TLS analyzes real JSSE input and uses native copy without network upload',async({host})=>{
    await host.open('/jvmscope/tls.html');
    await expect(host.page.locator('.analyzer-start-privacy')).toHaveText('Analyzed locally in VS Code. Nothing is uploaded.');
    const source={name:'TLS sample.log',text:await capture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt')};
    const result=await host.load([source]);expect(result.interactions).toBeGreaterThan(0);
    await expect(host.page.locator('#fileName')).toHaveText(source.name);
    await host.page.locator('#tlsInspector [data-action="full"]').click();
    await host.page.locator('#tlsModalCopyBtn').click();
    await expect.poll(()=>host.clipboard()).not.toBe('');
    expect(host.messages.filter(m=>m.type==='request').every(m=>['copy','syncSources'].includes(m.action))).toBe(true);
});

test('VS Code TDA links the selected snapshot to original file lines and reports stale sources in the dialog',async({host})=>{
    await host.open('/jvmscope/tda.html');
    const dump=(await capture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt')).trim();
    const text='\n\n'+dump+'\n\n'+dump;
    const sourceId='11111111-1111-1111-1111-111111111111';
    await host.load([{name:'same.txt',text,hostSourceId:sourceId}]);
    await host.page.locator('#dumpSelect').selectOption('1');
    const row=host.page.locator('#threadTableBody tr').filter({hasText:'Virtual thread #26'});
    await row.getByRole('button',{name:'Details',exact:true}).click();
    const button=host.page.locator('#threadModalSourceBtn');
    await button.click();
    await expect.poll(()=>host.messages.find(m=>m.action==='openSource')).toBeTruthy();
    const location=host.messages.find(m=>m.action==='openSource');
    const lines=text.split('\n');
    expect(location.sourceId).toBe(sourceId);
    expect(location.startLine).toBeGreaterThan(dump.split('\n').length);
    expect(lines[location.startLine-1]).toContain('Mounted virtual thread #26');
    host.rejectSource('The source has changed since analysis. Analyze the file again.');
    await button.click();
    await expect(host.page.locator('#threadModal .host-source-status')).toContainText('changed since analysis');
    await host.page.locator('#threadModalClose2').click();
    await host.page.locator('#clearBtn').click();
    await expect.poll(()=>host.messages.filter(m=>m.action==='syncSources').at(-1)?.sourceIds).toEqual([]);
    await host.page.locator('#loadSampleBtn').click();
    await host.page.locator('#threadTableBody tr').first().getByRole('button',{name:'Details',exact:true}).click();
    await expect(button).toBeHidden();
});

test('VS Code TLS sequence and raw lines navigate original physical source coordinates',async({host})=>{
    await host.open('/jvmscope/tls.html');
    const text=await capture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt');
    const sourceId='22222222-2222-2222-2222-222222222222';
    await host.load([{name:'tls.log',text,hostSourceId:sourceId}]);
    const event=host.page.locator('#tlsInspector [data-event]').first();
    const line=Number((await event.textContent()).match(/\d+/)[0]);
    await event.click();
    await expect.poll(()=>host.messages.find(m=>m.action==='openSource')?.startLine).toBe(line);
    expect(host.messages.find(m=>m.action==='openSource').sourceId).toBe(sourceId);
    await host.page.locator('#tlsRawTab').click();
    const raw=host.page.locator('.tls-source-number[data-source-line]').first();
    const rawLine=Number(await raw.getAttribute('data-source-line'));
    await expect(raw.locator('..')).toContainText(text.replaceAll('\r\n','\n').split('\n')[rawLine-1]);
    await raw.click();
    await expect.poll(()=>host.messages.filter(m=>m.action==='openSource').at(-1)?.startLine).toBe(rawLine);
    await host.page.locator('#clearBtn').click();
    await expect.poll(()=>host.messages.filter(m=>m.action==='syncSources').at(-1)?.sourceIds).toEqual([]);
});

test('VS Code rejects invalid input once and preserves a valid session on an invalid replacement',async({host})=>{
    await host.open('/jvmscope/tda.html');
    const invalid={name:'unsupported.log',text:'This file is not a thread dump.'};
    expect((await host.load([invalid])).snapshots).toBe(0);
    await host.page.locator('#inputFeedbackModal').getByRole('button',{name:'Close',exact:true}).click();
    await expect(host.page.locator('#errorState')).toContainText('No supported thread headers');
    await expect(host.page.locator('#errorState')).toContainText('unsupported.log');
    await expect(host.page.locator('#sessionInputStatus')).toBeHidden();
    await expect(host.page.locator('#threadTableBody tr')).toHaveCount(0);
    const valid={name:'carrier.txt',text:await capture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt')};
    const loaded=await host.load([valid]);expect(loaded.snapshots).toBe(1);
    await expect(host.page.locator('#errorState')).toBeHidden();
    expect((await host.load([invalid])).threads).toBe(loaded.threads);
    await host.page.locator('#inputFeedbackModal').getByRole('button',{name:'Close',exact:true}).click();
    await expect(host.page.locator('#fileName')).toHaveText(valid.name);
    await expect(host.page.locator('#sessionInputStatus')).toContainText('The current session was kept');
    await expect(host.page.locator('#sessionInputStatus')).toContainText('No supported thread headers');
    await expect(host.page.locator('#errorState')).toBeHidden();
});

for(const analyzer of ['tda','tls'])test(`VS Code ${analyzer} keeps capture actions and help without website navigation`,async({host},testInfo)=>{
    await host.page.setViewportSize({width:900,height:800});
    await host.open(`/jvmscope/${analyzer}.html`);
    await expect(host.page.getByRole('navigation',{name:'Analysis tools'})).toHaveCount(0);
    await expect(host.page.locator('label[for="fileInput"]')).toBeVisible();
    await expect(host.page.locator('#loadSampleBtn')).toBeVisible();
    if(analyzer==='tda')await expect(host.page.locator('#pasteClipboardBtn')).toBeVisible();
    await host.page.locator('#howToUseBtn').click();
    await expect(host.page.locator('#howToUseModal')).toBeVisible();
    await host.page.keyboard.press('Escape');
    await expect(host.page.locator('#howToUseModal')).toBeHidden();
    await applyTheme(host.page,'vscode-dark');
    await host.page.screenshot({path:testInfo.outputPath('empty-analyzer.png')});
    await host.page.locator('#loadSampleBtn').click();
    const rows=host.page.locator(analyzer==='tda'?'#threadTableBody tr':'#tlsTableBody tr');
    await expect(rows.first()).toBeVisible();
    await host.page.locator('label[for="fileInput"]').click();
    await expect.poll(()=>host.messages.some(m=>m.action==='chooseFiles')).toBe(true);
    await expect(rows.first()).toBeVisible();
    const width=await host.page.evaluate(()=>document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(900);
});

test('VS Code previews findings and exports Markdown, HTML and graph PNG through the native save bridge',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.load([{name:'carrier.txt',text:await capture('frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt')}]);
    await host.page.locator('#dependencyGraphDetails > summary').click();
    await host.page.locator('#blockingPatternSelect').selectOption({label:'Dependencies on Virtual thread #26 · peak 1 · recurrence 0'});
    await host.page.locator('#dependencyGraphExport').click();
    await expect.poll(()=>host.messages.find(m=>m.action==='save'&&m.name.endsWith('.png'))).toBeTruthy();
    const png=Buffer.from(host.messages.find(m=>m.action==='save'&&m.name.endsWith('.png')).base64,'base64');
    expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBeGreaterThan(0);
    expect(png.readUInt32BE(20)).toBeGreaterThan(0);
    await host.page.locator('#addBlockingReport').click();
    await host.page.getByRole('button',{name:'Preview report',exact:true}).click();
    await expect(host.page.frameLocator('#reportPreview iframe').locator('body')).toContainText('Dependencies on Virtual thread #26');
    await host.page.locator('#reportPreview input[type=checkbox]').check();
    for(const [format,extension] of [['Markdown','.md'],['HTML','.html']]) {
        await host.page.getByRole('button',{name:'Export '+format,exact:true}).click();
        await expect.poll(()=>host.messages.find(m=>m.action==='save'&&m.name.endsWith(extension))).toBeTruthy();
        const report=Buffer.from(host.messages.find(m=>m.action==='save'&&m.name.endsWith(extension)).base64,'base64').toString('utf8');
        expect(report).toContain('Dependencies on Virtual thread');
        expect(report).not.toContain('Dependencies on ForkJoinPool-1-worker-1');
    }
});

const themePalettes={
    'vscode-dark': {bg:'#1e1e1e',fg:'#d4d4d4',surface:'#252526',muted:'#aaaaaa',border:'#454545',link:'#75beff',selection:'#094771',selected:'#ffffff',error:'#f48771',warning:'#cca700',success:'#73c991'},
    'vscode-light': {bg:'#ffffff',fg:'#333333',surface:'#f3f3f3',muted:'#616161',border:'#767676',link:'#005fb8',selection:'#0060c0',selected:'#ffffff',error:'#b5200d',warning:'#795e00',success:'#176f2c'},
    'vscode-high-contrast': {bg:'#000000',fg:'#ffffff',surface:'#000000',muted:'#ffffff',border:'#ffffff',link:'#21a6ff',selection:'#000000',selected:'#ffffff',error:'#ff6373',warning:'#ffdf00',success:'#89d185'},
    'vscode-high-contrast-light': {bg:'#ffffff',fg:'#000000',surface:'#ffffff',muted:'#292929',border:'#292929',link:'#0f4a85',selection:'#0f4a85',selected:'#ffffff',error:'#b5200d',warning:'#795e00',success:'#176f2c'},
};
async function applyTheme(page,name) {
    await page.evaluate(({name,p})=>{
        document.body.classList.remove('vscode-dark','vscode-light','vscode-high-contrast','vscode-high-contrast-light');
        document.body.classList.add(name);
        const values={'editor-background':p.bg,'editor-foreground':p.fg,'sideBar-background':p.surface,'editorWidget-background':p.surface,'descriptionForeground':p.muted,'panel-border':p.border,'contrastBorder':p.border,'textLink-foreground':p.link,'focusBorder':p.link,'input-background':p.bg,'input-foreground':p.fg,'button-secondaryBackground':p.surface,'button-secondaryForeground':p.fg,'list-activeSelectionBackground':p.selection,'list-activeSelectionForeground':p.selected,'errorForeground':p.error,'editorWarning-foreground':p.warning,'testing-iconPassed':p.success,'editor-findMatchHighlightBackground':p.surface};
        for(const [key,value] of Object.entries(values))document.documentElement.style.setProperty('--vscode-'+key,value);
    },{name,p:themePalettes[name]});
    await expect.poll(()=>page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(name.includes('light')?'rgb(255, 255, 255)':name==='vscode-dark'?'rgb(30, 30, 30)':'rgb(0, 0, 0)');
}
async function expectReadable(locator) {
    await expect.poll(()=>locator.evaluate(el=>{
        const rgb=value=>{
            const channels=value.match(/[\d.]+/g).slice(0,3).map(Number);
            return value.startsWith('color(srgb ') ? channels.map(v=>v*255) : channels;
        };
        const luminance=value=>rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        let parent=el,bg;
        while(parent){bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}
        const a=luminance(getComputedStyle(el).color),b=luminance(bg);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    })).toBeGreaterThanOrEqual(4.5);
}
test('VS Code raw evidence follows live themes and fits a narrow analysis tab',async({host},testInfo)=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await expect(host.page.locator('#openRawDumpBtn')).toBeEnabled();
    await host.page.locator('#openRawDumpBtn').click();
    const raw=host.page.locator('#rawDumpDialog');
    await raw.getByRole('button',{name:'Show structured evidence',exact:true}).click();
    await raw.locator('.raw-workspace-thread-title').first().click();
    await raw.locator('.raw-workspace-disclosure').first().click();
    for(const width of [1366,600]) {
        await host.page.setViewportSize({width,height:900});
        for(const theme of Object.keys(themePalettes)) {
            await applyTheme(host.page,theme);
            await expect(raw).toBeVisible();
            await expect(raw.locator('.raw-workspace-inspector')).toBeVisible();
            for(const selector of ['h1','.raw-workspace-meta','.raw-workspace-thread-title h2','.raw-workspace-state','.raw-workspace-filter','.raw-workspace-search-count','.raw-workspace-line-content']) {
                const item=raw.locator(selector).first();
                try { await expectReadable(item); }
                catch(error) {
                    const colors=await item.evaluate(el=>({color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));
                    throw new Error(`${theme}, ${width}px, ${selector}: ${JSON.stringify(colors)}`,{cause:error});
                }
            }
            await raw.getByRole('searchbox',{name:'Search raw dump evidence'}).focus();
            await host.page.keyboard.press('Tab');
            expect(await raw.evaluate(el=>getComputedStyle(el.ownerDocument.activeElement).outlineStyle)).toBe('solid');
            const geometry=await raw.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,
                layoutWidth:el.querySelector('.raw-workspace-layout').clientWidth,layoutScroll:el.querySelector('.raw-workspace-layout').scrollWidth}));
            expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
            expect(geometry.layoutScroll).toBeLessThanOrEqual(geometry.layoutWidth);
            const title=await raw.locator('.raw-workspace-thread-title').first().boundingBox();
            const actions=await raw.locator('.raw-workspace-thread-actions').first().boundingBox();
            expect(actions.x>=title.x+title.width || actions.y>=title.y+title.height).toBe(true);
            await host.page.screenshot({path:testInfo.outputPath(`raw-${width}-${theme}.png`)});
            // Selection must keep its own foreground/background pair on hover.
            await raw.getByRole('button',{name:'Show structured evidence',exact:true}).hover();
            await expectReadable(raw.locator('.raw-workspace-mode.is-active'));
            await raw.getByRole('button',{name:'Filter: Everything',exact:true}).hover();
            await expectReadable(raw.locator('.raw-workspace-filter.is-active'));
            await raw.getByRole('button',{name:'Show the canonical raw dump',exact:true}).click();
            await expect(raw.locator('.raw-workspace-outline')).toBeHidden();
            await expect(raw.locator('.raw-workspace-inspector')).toBeHidden();
            await expectReadable(raw.locator('.raw-workspace-mode.is-active'));
            const firstLine=raw.locator('.raw-workspace-line').first();
            await firstLine.hover();
            await expectReadable(firstLine.locator('.raw-workspace-line-content'));
            await expectReadable(firstLine.locator('.raw-workspace-line-number'));
            await raw.getByRole('searchbox',{name:'Search raw dump evidence'}).hover();
            await expectReadable(firstLine.locator('.raw-workspace-line-number'));
            await expectReadable(raw.locator('.raw-workspace-mode.is-active'));
            expect(await raw.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
            await host.page.screenshot({path:testInfo.outputPath(`raw-exact-${width}-${theme}.png`)});
            await raw.getByRole('button',{name:'Show structured evidence',exact:true}).click();
        }
    }
});

test('VS Code TLS separator is visible across themes and keeps the loaded capture when resized',async({host})=>{
    await host.page.setViewportSize({width:1600,height:900});
    await host.open('/jvmscope/tls.html');
    await host.page.locator('#loadSampleBtn').click();
    const divider=host.page.getByRole('separator',{name:'TLS interactions'});
    await expect(divider).toBeVisible();
    for(const theme of Object.keys(themePalettes)) {
        await applyTheme(host.page,theme);
        await expectReadable(divider);
        await divider.focus();
        await host.page.keyboard.press('ArrowRight');
        expect(await divider.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
        await expect(host.page.locator('#tlsInspector')).toHaveAttribute('data-selected-id','35');
        await expect(host.page.locator('#tlsTableBody tr')).toHaveCount(35);
        expect(await host.page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1600);
    }
    await host.page.setViewportSize({width:600,height:900});
    await expect(divider).toBeHidden();
    await expect(host.page.locator('#tlsInspector')).toBeVisible();
});

for(const analyzer of ['tda','tls'])test(`VS Code ${analyzer} follows live themes and fits a narrow editor`,async({host},testInfo)=>{
    await host.page.setViewportSize({width:600,height:900});
    await host.open(`/jvmscope/${analyzer}.html`);
    await applyTheme(host.page,'vscode-light');
    await expectReadable(host.page.locator('.analyzer-start h2'));
    const text=await capture(analyzer==='tda'?'frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt':'frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt');
    await host.load([{name:'theme-test.txt',text,hostSourceId:'33333333-3333-3333-3333-333333333333'}]);
    const rows=host.page.locator(analyzer==='tda'?'#threadTableBody tr':'#tlsTableBody tr');
    const count=await rows.count();expect(count).toBeGreaterThan(0);
    for(const theme of Object.keys(themePalettes)) {
        await applyTheme(host.page,theme);
        await expect(rows).toHaveCount(count);
        expect(await host.page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);
        await expectReadable(host.page.locator('#fileName'));
        await host.page.keyboard.press('Tab');
        await host.page.locator('#clearBtn').focus();
        expect(await host.page.locator('#clearBtn').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('solid');
        if(analyzer==='tda') {
            await rows.first().getByRole('button',{name:'Details',exact:true}).click();
            await expectReadable(host.page.locator('#threadModalSourceBtn'));
            const evidence=await host.page.locator('.thread-details-evidence').boundingBox();
            expect(evidence.width).toBeGreaterThan(500);
            await host.page.screenshot({path:testInfo.outputPath(`${theme}.png`)});
            await host.page.locator('#threadModalClose2').click();
        }else {
            await expectReadable(host.page.locator('.tls-event-title').first());
            for(const selector of ['.tls-grouping-note','.tls-sequence-note','.tls-coverage','.tls-event-clock time','.tls-event-flow','.tls-row-context']) {
                const text=host.page.locator(selector).first();
                await expectReadable(text);
                expect(await text.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
            }
            const actions=host.page.locator('.tls-file-actions');
            expect(await actions.locator('label[for="fileInput"]').evaluate(el=>getComputedStyle(el).backgroundColor))
                .toBe(await actions.locator('#howToUseBtn').evaluate(el=>getComputedStyle(el).backgroundColor));
            const clock=await host.page.locator('.tls-event-clock time').first().boundingBox();
            const content=await host.page.locator('.tls-event-content').first().boundingBox();
            expect(clock.x+clock.width).toBeLessThanOrEqual(content.x);
            const guidance=host.page.locator('.tls-possible-explanation');
            if(!await guidance.evaluate(el=>el.open))await guidance.locator('summary').click();
            await expect(guidance.getByRole('heading',{name:'Meaning',exact:true})).toBeVisible();
            for(const block of await guidance.locator('.tls-explanation-section :is(h3,p,li)').all())await expectReadable(block);
            expect(await guidance.evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(await guidance.evaluate(el=>el.clientWidth));
            await guidance.locator('summary').evaluate(el=>el.scrollIntoView({block:'start'}));
            await host.page.screenshot({path:testInfo.outputPath(`${theme}.png`)});
        }
    }
});


test('sidebar selects the exact thread snapshot despite duplicate names and active filters, and revokes old keys',async({host})=>{
    await host.open('/jvmscope/tda.html');
    const sources=await Promise.all(['allocation-before.txt','allocation-after.txt'].map(async name=>({name:'dump.txt',text:await capture('frontend/test/tda/fixtures/ga-regressions/'+name)})));
    await host.load(sources);
    const revision=host.messages.findLast(m=>m.type==='navigationState').revision;
    const files=(await host.navigation('children')).value.items;
    expect(files.map(x=>x.label)).toEqual(['dump.txt','dump.txt']);
    const snapshot=(await host.navigation('children',files[1].key)).value.items[0];
    const threads=(await host.navigation('children',snapshot.key)).value.items;
    const thread=threads.find(x=>x.label==='audit-allocation-boundary');
    await host.page.locator('#dumpSelect').selectOption('0');
    await host.page.locator('#searchInput').fill('does-not-match-any-thread');
    await expect(host.page.locator('#threadTableBody tr')).toHaveCount(0);
    expect((await host.navigation('select',thread.key)).value).toBe(true);
    await expect(host.page.locator('#dumpSelect')).toHaveValue('1');
    await expect(host.page.locator('#threadModal')).toBeVisible();
    await expect(host.page.locator('#threadModalTitle')).toContainText(thread.label);
    await host.page.locator('#threadModalCopyBtn').click();
    await expect.poll(()=>host.clipboard()).toContain('allocated=101G');
    // Selecting another snapshot closes the previous thread dialog.
    expect((await host.navigation('select','snapshot:0')).value).toBe(true);
    await expect(host.page.locator('#threadModal')).toBeHidden();
    await expect(host.page.locator('#dumpSelect')).toHaveValue('0');
    await host.load([{name:'invalid.txt',text:'This is not a Java thread dump.'}]);
    expect(host.messages.findLast(m=>m.type==='navigationState').revision).toBe(revision);
    await host.page.locator('#inputFeedbackModal').getByRole('button',{name:'Close',exact:true}).click();
    await host.load([sources[0]]);
    expect((await host.navigation('select',thread.key,0,revision)).error).toContain('analysis changed');
    const current=host.messages.findLast(m=>m.type==='navigationState').revision;
    await host.page.locator('#clearBtn').click();
    await expect.poll(()=>host.messages.findLast(m=>m.type==='navigationState').count).toBe(0);
    expect((await host.navigation('select','snapshot:0',0,current)).error).toContain('analysis changed');
});

test('sidebar reveals hidden TLS interactions and exact events in the visible inspector',async({host},testInfo)=>{
    await host.open('/jvmscope/tls.html');
    await host.load([{name:'runtime.log',text:await capture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt')}]);
    const file=(await host.navigation('children')).value.items[0];
    const interaction=(await host.navigation('children',file.key)).value.items[0];
    const events=(await host.navigation('children',interaction.key)).value.items;
    expect(events.length).toBeGreaterThan(1);
    await host.page.locator('#tlsOverviewColumns').click();
    await host.page.locator('#searchInput').fill('does-not-match-any-interaction');
    await expect(host.page.locator('#tlsTableBody tr')).toHaveCount(0);
    const event=events.at(-1);
    expect((await host.navigation('select',event.key)).value).toBe(true);
    await expect(host.page.locator('#tlsInvestigateColumns')).toHaveAttribute('aria-pressed','true');
    await expect(host.page.locator('#searchInput')).toHaveValue('');
    const selected=host.page.locator('.tls-event[aria-current="true"]');
    await expect(selected).toBeVisible();
    await expect(selected).toContainText(event.label.split(' · ').slice(1).join(' · '));
    await expect(selected.locator('button')).toBeFocused();
    await expect(selected.locator('button')).toHaveText('L'+event.description.replace('Source line ','')+' ↗');
    await host.page.screenshot({path:testInfo.outputPath('sidebar-event-selection.png')});
    // Navigation also dismisses a blocking raw-evidence modal.
    await host.page.locator('#tlsInspector [data-action="full"]').click();
    expect((await host.navigation('select',events[0].key)).value).toBe(true);
    await expect(host.page.locator('#tlsModal')).toBeHidden();
    await expect(host.page.locator('.tls-event[aria-current="true"]')).toHaveCount(1);
    const revision=host.messages.findLast(m=>m.type==='navigationState').revision;
    await host.page.locator('#clearBtn').click();
    expect((await host.navigation('select',event.key,0,revision)).error).toContain('analysis changed');
});

test('sidebar metadata is also published for bundled examples and keeps uncertain TLS events empty',async({host})=>{
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await expect.poll(()=>host.messages.findLast(m=>m.type==='navigationState')?.count).toBeGreaterThan(0);
    expect((await host.navigation('children')).value.items[0].kind).toBe('file');
    await host.open('/jvmscope/tls.html');
    await host.load([{name:'uncertain.log',text:'first, WRITE: TLSv1.2 Handshake, length = 10\n*** ClientHello, TLSv1.2\nsecond, READ: TLSv1.2 Handshake, length = 10\n*** ServerHello, TLSv1.2\n*** Finished'}]);
    const interaction=(await host.navigation('children','file:0')).value.items[0];
    expect(interaction.description).toContain('uncertain');
    expect((await host.navigation('children',interaction.key)).value).toEqual({total:0,items:[]});
    expect((await host.navigation('select',interaction.key)).value).toBe(true);
    await expect(host.page.locator('.tls-no-events')).toBeVisible();
});

test('TLS capture replacement and clear retire open evidence and diagnostic dialogs',async({host})=>{
    await host.open('/jvmscope/tls.html');
    const source={name:'first.log',text:await capture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt')};
    await host.load([source]);
    await host.page.locator('#tlsInspector [data-action="full"]').click();
    await expect(host.page.locator('#tlsModal')).toBeVisible();
    await host.load([{name:'second.log',text:await capture('frontend/test/tls/fixtures/runtime/jdk26-tlsv1.3-success-client.txt')}]);
    await expect(host.page.locator('#fileName')).toHaveText('second.log');
    await expect(host.page.locator('#tlsModal')).toBeHidden();
    await expect(host.page.locator('#tlsModalBody')).toBeEmpty();
    expect(await host.page.locator('#tlsModalCopyBtn').evaluate(el=>el.onclick)).toBeNull();
    await host.page.locator('#tlsInspector [data-action="full"]').click();
    await host.page.locator('#clearBtn').dispatchEvent('click');
    await expect(host.page.locator('#tlsModal')).toBeHidden();
    await expect(host.page.locator('#tlsModalBody')).toBeEmpty();
    await host.load([source]);
    await host.page.locator('#tlsAllColumns').click();
    await host.page.locator('#tlsTableBody .explain-btn').first().click();
    await expect(host.page.locator('#issueModal')).toBeVisible();
    await host.load([{...source,name:'third.log'}]);
    await expect(host.page.locator('#issueModal')).toBeHidden();
    await expect(host.page.locator('#issueModalBody')).toBeEmpty();
});

test('bundled knowledge articles use their packaged route and preserve Java version links',async({host})=>{
    await host.open('/knowledge/index.html');
    await host.page.locator('#knowledgeVersion').selectOption('21');
    await host.page.locator('.knowledge-card').filter({hasText:'Collect the right thread dump'}).first().click();
    await expect.poll(()=>host.messages.findLast(m=>m.action==='navigate')?.route).toBe('/knowledge/thread-dumps.html?java=21');
    await host.open('/knowledge/thread-dumps.html?java=21');
    await expect(host.page.locator('#articleIntro h1')).toHaveText('Collect the right thread dump');
    await expect(host.page.locator('#articleVersion')).toHaveValue('21');
    await host.page.locator('#articleVersion').selectOption('25');
    await host.page.locator('#relatedGuides a[href*="thread-counters"]').click();
    await expect.poll(()=>host.messages.findLast(m=>m.action==='navigate')?.route).toBe('/knowledge/thread-counters.html?java=25');
    await host.page.locator('#knowledgeBack').click();
    await expect.poll(()=>host.messages.findLast(m=>m.action==='navigate')?.route).toBe('/knowledge/index.html?java=25');
    await host.open('/knowledge/thread-counters.html?java=21#find=CPU&section=check');
    await expect(host.page.locator('#articleIntro h1')).toHaveText('CPU, elapsed and allocation: evidence and limits');
    await expect(host.page.locator('#articleVersion')).toHaveValue('21');
    await expect(host.page.locator('#articleSearch')).toHaveValue('CPU');
    expect(await host.page.locator('mark[data-article-match]').count()).toBeGreaterThan(0);
    await host.page.locator('#articleSearchClear').click();
    await expect(host.page.locator('mark[data-article-match]')).toHaveCount(0);
    await host.page.locator('#knowledgeBack').click();
    const back=host.messages.findLast(m=>m.action==='navigate')?.route;
    expect(back).toBe('/knowledge/index.html?java=21#find=CPU&section=articleIntro');
    await host.open(back);
    await expect(host.page.locator('#knowledgeSearch')).toHaveValue('CPU');
    await expect(host.page.locator('#knowledgeVersion')).toHaveValue('21');
    await host.page.locator('#knowledgeSearchClear').click();
    await expect(host.page.locator('.knowledge-card')).toHaveCount(8);
    for(const href of await host.page.locator('.knowledge-card').evaluateAll(links=>links.map(a=>a.getAttribute('href')))) {
        await host.open('/knowledge/'+href.slice(2));
        await expect(host.page.locator('#articleIntro h1')).toBeVisible();
        await expect(host.page.locator('#articleVersion')).toHaveValue('21');
    }
    await host.open('/knowledge/index.html');
    const longQuery=Array(128).fill('cpu').join(' ');
    await host.page.locator('#knowledgeSearch').fill(longQuery);
    await host.page.locator('.knowledge-card').first().click();
    const route=host.messages.findLast(m=>m.action==='navigate').route;
    expect(route.length).toBeGreaterThan(500);
    // Requests above are checked by the real host validator, including their size.
    await expect(host.page.locator('#hostError')).toHaveCount(0);
    protocol.validateRequest({channel:'jvmscope',version:1,type:'request',id:'web:1',action:'navigate',route});
    await host.open(route);
    await expect(host.page.locator('#articleSearch')).toHaveValue(longQuery);
});

test('home and knowledge surfaces remain readable across host themes',async({host},testInfo)=>{
    await host.page.setViewportSize({width:600,height:900});
    for(const name of ['index.html','knowledge/thread-dumps.html']) {
        await host.open('/'+name);
        for(const theme of Object.keys(themePalettes)) {
            await applyTheme(host.page,theme);
            await expectReadable(host.page.locator('h1'));
            const surfaces=host.page.locator(name==='index.html'?'.hero, .utility-card a, .knowledge a':'.knowledge-find, .knowledge-callout');
            for(const surface of await surfaces.all()) {
                // Solid host palette surfaces make the contrast calculation meaningful;
                // the old dark gradients remained behind light-theme foregrounds.
                expect(await surface.evaluate(el=>getComputedStyle(el).backgroundImage)).toBe('none');
                await expectReadable(surface);
            }
            if(name==='index.html')await expect(host.page.locator('.privacy strong')).toHaveText('Analyzed locally in VS Code. Nothing is uploaded.');
            await host.page.screenshot({path:testInfo.outputPath(name.replaceAll('/','-')+'-'+theme+'.png')});
        }
    }
});

test('knowledge filters and articles fit narrow VS Code editor splits',async({host},testInfo)=>{
    const pages=JSON.parse(await readFile(resolve(media,'pages.json'),'utf8')).filter(name=>name.startsWith('knowledge/'));
    for(const width of [600,360]) {
        await host.page.setViewportSize({width,height:900});
        for(const name of pages) {
            await host.open('/'+name+'?java=21');
            expect(await host.page.evaluate(()=>document.documentElement.scrollWidth),name).toBeLessThanOrEqual(width);
        }
        await host.open('/knowledge/index.html');
        await host.page.locator('#knowledgeVersion').selectOption('21');
        await host.page.locator('#knowledgeTopic').selectOption('threads');
        await host.page.locator('#knowledgeSearch').fill('dump');
        await expect(host.page.locator('.knowledge-card').first()).toBeVisible();
        await host.page.screenshot({path:testInfo.outputPath(`knowledge-${width}.png`)});
    }
});


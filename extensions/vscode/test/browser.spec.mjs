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
    await expect.poll(()=>host.messages.find(m=>m.action==='openRaw')).toBeTruthy();
    expect(host.messages.find(m=>m.action==='openRaw').text).toBe(sources[1].text.trimEnd());
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await host.page.locator('#threadModalCopyBtn').click();
    await expect.poll(()=>host.clipboard()).toContain('audit-allocation-boundary');
    await host.page.locator('#threadModalClose2').click();
    await host.page.locator('#clearBtn').click();await expect(host.page.locator('#threadTableBody tr')).toHaveCount(0);
    expect(host.messages.some(m=>m.action==='clearRaw')).toBe(true);
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

test('VS Code bundled examples, navigation and native picker remain usable at narrow editor widths',async({host})=>{
    await host.page.setViewportSize({width:900,height:800});
    await host.open('/jvmscope/tda.html');
    await host.page.locator('#loadSampleBtn').click();
    await expect(host.page.locator('#threadTableBody tr').first()).toBeVisible();
    await host.page.getByRole('link',{name:'TLS log analyzer',exact:true}).click();
    await expect.poll(()=>host.messages.find(m=>m.action==='navigate')?.route).toBe('/jvmscope/tls.html');
    await host.page.locator('#fileInput').dispatchEvent('click');
    await expect.poll(()=>host.messages.some(m=>m.action==='chooseFiles')).toBe(true);
    await expect(host.page.locator('#threadTableBody tr').first()).toBeVisible();
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
        const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
        const luminance=value=>rgb(value).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        let parent=el,bg;
        while(parent){bg=getComputedStyle(parent).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;parent=parent.parentElement;}
        const a=luminance(getComputedStyle(el).color),b=luminance(bg);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    })).toBeGreaterThanOrEqual(4.5);
}
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


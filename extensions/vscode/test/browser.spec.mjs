import {test as base, expect} from '../../../frontend/node_modules/@playwright/test/index.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import webview from '../src/webview.cjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const media=resolve(root,'extensions/vscode/media');
const capture=relative=>readFile(resolve(root,relative),'utf8');
const test=base.extend({
    host: async({page},use)=>{
        const pages=JSON.parse(await readFile(resolve(media,'pages.json'),'utf8'));
        let origin, clipboard=''; const messages=[];
        const server=createServer(async(req,res)=>{
            try {
                const url=new URL(req.url,origin);
                if(url.pathname==='/view') {
                    const route=url.searchParams.get('page')||'/jvmscope/tda.html';
                    const {name}=webview.resolveRoute(route,pages);
                    const html=webview.renderWebview(await readFile(resolve(media,name),'utf8'),{page:name,pages,cspSource:origin,resourceUri:name=>origin+'/'+name});
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
                await page.evaluate(({message,value})=>window.postMessage({channel:'jvmscope',version:1,type:'response',id:message.id,value},'*'),{message,value});
            }
        });
        await page.exposeFunction('testCspViolation',value=>violations.push(value));
        await page.addInitScript(()=>{
            window.acquireVsCodeApi=()=>({postMessage:message=>window.testHostMessage(message)});
            document.addEventListener('securitypolicyviolation',event=>window.testCspViolation(`${event.violatedDirective}: ${event.blockedURI}`));
        });
        await use({page,origin,messages,clipboard:()=>clipboard,open:async name=>{
            await page.goto(`${origin}/view?page=${encodeURIComponent(name)}`);
            await expect.poll(()=>messages.filter(m=>m.type==='ready').length).toBeGreaterThan(0);
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
    const source={name:'TLS sample.log',text:await capture('frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt')};
    const result=await host.load([source]);expect(result.interactions).toBeGreaterThan(0);
    await expect(host.page.locator('#fileName')).toHaveText(source.name);
    await host.page.locator('#tlsInspector [data-action="full"]').click();
    await host.page.locator('#tlsModalCopyBtn').click();
    await expect.poll(()=>host.clipboard()).not.toBe('');
    expect(host.messages.filter(m=>m.type==='request').every(m=>['copy'].includes(m.action))).toBe(true);
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

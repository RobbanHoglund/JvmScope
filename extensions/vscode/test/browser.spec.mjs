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

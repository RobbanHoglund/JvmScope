import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect } from './fixtures.js';
import { pagesOutput } from '../../../../scripts/build-pages.mjs';
import { resolve } from 'node:path';

// These assertions deliberately require a strict static host, not Vite's preview.
test.beforeEach(async ({}, info) => test.skip(!info.project.metadata.pages, 'Pages hosting boundary only'));
const dump = n => `2026-10-04 12:00:0${n}\nFull thread dump OpenJDK 64-Bit Server VM (27 mixed mode):\n\n"PRIVATE_CONTENT_SENTINEL_TDA" #7 prio=5 os_prio=0 cpu=${n*100}.00ms elapsed=${n}.00s tid=0x00000007 nid=7 runnable\n   java.lang.Thread.State: RUNNABLE\n        at example.PrivateWorker.run(Worker.java:7)`;

test('Pages root, direct links, navigation, reload and module workers use the project prefix', async ({ page, appUrl }) => {
    await page.goto(appUrl+'/');
    await expect(page.getByRole('heading', {name:'Follow the evidence.'})).toBeVisible();
    await page.locator('a.tool:not(.tls)').click();
    await expect(page).toHaveURL(appUrl+'/jvmscope/tda.html');
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#rowCount')).toContainText('67 threads');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(false);
    await page.reload();
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await page.getByRole('link', {name:'TLS log analyzer',exact:true}).click();
    await expect(page).toHaveURL(appUrl+'/jvmscope/tls.html');
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#rowCount')).toHaveText('35 / 35 interactions');
    await page.reload();
    await expect(page.locator('#analyzerStart')).toBeVisible();
    await page.getByRole('link', {name:'Thread dumps',exact:true}).click();
    await expect(page).toHaveURL(appUrl+'/jvmscope/tda.html');
    await page.goto(appUrl+'/');
    await page.locator('a.tool.tls').click();
    await expect(page).toHaveURL(appUrl+'/jvmscope/tls.html');
});

test('Pages local files, clipboard and raw popup keep analysis content out of HTTP and storage', async ({ page, context, appUrl }) => {
    const requests=[], failures=[], errors=[];
    context.on('request', request => requests.push({method:request.method(), url:request.url(), headers:request.headers(), body:request.postData()}));
    context.on('requestfailed', request => failures.push(request.url()));
    const watch = surface => {
        surface.on('pageerror',error => errors.push(error.message));
        surface.on('console',message => { if (message.type()==='error') errors.push(message.text()); });
    };
    watch(page);
    context.on('page',watch);
    await page.goto(appUrl+'/jvmscope/tda.html');
    await page.locator('#fileInput').setInputFiles({name:'PRIVATE_CONTENT_SENTINEL_TDA.txt',mimeType:'text/plain',buffer:Buffer.from(dump(1))});
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await page.evaluate(text => navigator.clipboard.writeText(text),dump(2));
    await page.locator('#pasteClipboardBtn').click();
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#threadTableBody .thread-cell-name').click();
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('PRIVATE_CONTENT_SENTINEL_TDA');
    await page.keyboard.press('Escape');
    const popup=context.waitForEvent('page');
    await page.locator('#openRawDumpBtn').click();
    const raw=await popup;
    await expect(raw.locator('body')).toContainText('PRIVATE_CONTENT_SENTINEL_TDA');
    await raw.close();
    const storage = () => page.evaluate(() => JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)}));
    expect(await storage()).not.toContain('PRIVATE_CONTENT_SENTINEL');
    await page.goto(appUrl+'/jvmscope/tls.html');
    const tls='javax.net.ssl|ERROR|01|main|2026-10-04 12:00:00.000 UTC|TransportContext.java:1|Fatal (HANDSHAKE_FAILURE): PRIVATE_CONTENT_SENTINEL_TLS';
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await page.locator('#fileInput').setInputFiles({name:'PRIVATE_CONTENT_SENTINEL_TLS.log',mimeType:'text/plain',buffer:Buffer.from(tls)});
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsInspector')).toContainText('PRIVATE_CONTENT_SENTINEL_TLS');
    expect(await storage()).not.toContain('PRIVATE_CONTENT_SENTINEL');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(r => ['GET','HEAD'].includes(r.method) && r.body===null)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_CONTENT_SENTINEL');
    expect(requests.every(r => new URL(r.url).origin===new URL(appUrl).origin)).toBe(true);
    expect(requests.some(r => r.url.includes('/js/worker-analysis-worker-'))).toBe(true);
    expect(requests.some(r => r.url.includes('/tls-analysis-worker-'))).toBe(true);
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
});

test('Pages graph export produces a PNG locally', async ({ page, appUrl }, info) => {
    await page.goto(appUrl+'/jvmscope/tda.html');
    await page.locator('#loadSampleBtn').click();
    await expect(page.locator('#rowCount')).toContainText('67 threads');
    await page.locator('#dependencyGraphDetails > summary').click();
    await expect(page.locator('#dependencyGraphExport')).toBeEnabled();
    const pending=page.waitForEvent('download');
    await page.locator('#dependencyGraphExport').click();
    const download=await pending;
    const filename=info.outputPath('dependency-graph.png');
    await download.saveAs(filename);
    const bytes=readFileSync(filename);
    expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBeGreaterThan(1000);
    await page.screenshot({path:info.outputPath('graph-export.png'),fullPage:true});
});

test('Pages delivers every manifest file byte-exactly via GET and HEAD and rejects server-only paths', async ({ page, appUrl }) => {
    const manifest=JSON.parse(readFileSync(resolve(pagesOutput,'manifest.json')));
    const types={html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',txt:'text/plain',md:'text/plain',svg:'image/svg+xml'};
    for (const file of [...manifest.files,{path:'manifest.json'}]) {
        const response=await page.request.get(appUrl+'/'+file.path);
        expect(response.status(),file.path).toBe(200);
        const content=await response.body();
        if (file.sha256) {
            expect(createHash('sha256').update(content).digest('hex')).toBe(file.sha256);
            expect(content.length).toBe(file.bytes);
        }
        const type=types[file.path.split('.').at(-1)];
        if (type) expect(response.headers()['content-type']).toContain(type);
        const head=await page.request.head(appUrl+'/'+file.path);
        expect(head.status()).toBe(200);
        expect(head.headers()['content-length']).toBe(String(content.length));
        expect((await head.body()).length).toBe(0);
    }
    for (const path of ['/health','/utils.html','/javautils/tda.html','/jvmscope/TDA.html','/not-a-page','/assets/private.txt']) {
        expect((await page.request.get(appUrl+path)).status(),path).toBe(404);
    }
});

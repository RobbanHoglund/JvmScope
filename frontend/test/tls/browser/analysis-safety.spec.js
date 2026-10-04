import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
test.use({ trace: 'off' });

const record = message => `javax.net.ssl|DEBUG|A|worker|2026-10-04 12:00:00.000 UTC|Handshake.java:1|${message}`;
const client = record('Produced ClientHello handshake message');
const server = record('Consuming ServerHello handshake message');
const produced = record('Produced client Finished handshake message');
const consumed = record('Consuming server Finished handshake message');
const upload = (page,text,name='safety.log') => page.locator('#fileInput').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});

test('TLS contradictory grouping remains unknown in the worker, filters and inspector with source evidence retained', async ({page}) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await upload(page,[client,client,server,server,produced,consumed].join('\n'));
    await expect(page.locator('#rowCount')).toHaveText('2 / 2 interactions');
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await expect(page.locator('#errorState')).toContainText('connection identity is ambiguous');
    await expect(page.locator('#tlsInspector')).toContainText('Grouping uncertain');
    await expect(page.locator('#tlsInspector')).toContainText('observation group');
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(0);
    await page.locator('#onlySuccessToggle').uncheck();
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsRawPanel')).toContainText('Produced client Finished');
});

test('TDA real short captures use elapsed timing and show the interval qualification', async ({page,appUrl}) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await upload(page,readFileSync(new URL('../../tda/fixtures/cpu-precision-sequence.txt',import.meta.url),'utf8'),'cpu-precision.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#dumpSelect').selectOption('1');
    const row=page.locator('#threadTableBody tr').filter({hasText:'audit-cpu-worker'});
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.locator('#threadModal')).toContainText('Thread elapsed counters');
    await expect(page.locator('#threadModal')).toContainText('Approximate interval');
    await expect(page.locator('#threadModal')).toContainText('±10 ms');
});

test('TLS Clear and newer inputs terminate a real worker and ignore late completion', async ({page}) => {
    await page.addInitScript(() => {
        const NativeWorker=window.Worker;
        window.tlsWorkerRuns=[];
        window.Worker=class extends NativeWorker {
            constructor(url,options){super(url,options);this.stats={stopped:false};window.tlsWorkerRuns.push(this.stats);}
            postMessage(data){this.delayed=setTimeout(()=>{if(!this.stats.stopped)super.postMessage(data);},400);}
            terminate(){this.stats.stopped=true;clearTimeout(this.delayed);super.terminate();}
        };
    });
    await page.reload();
    await upload(page,[client,server,produced,consumed].join('\n'),'cancel-me.log');
    await expect.poll(()=>page.evaluate(()=>window.tlsWorkerRuns.length)).toBe(1);
    await page.getByRole('button',{name:'Clear',exact:true}).click();
    await expect(page.locator('#fileName')).toHaveText('No file loaded');
    expect(await page.evaluate(()=>window.tlsWorkerRuns[0].stopped)).toBe(true);
    await upload(page,[client,server,produced,consumed].join('\n'),'older.log');
    await expect.poll(()=>page.evaluate(()=>window.tlsWorkerRuns.length)).toBe(2);
    await upload(page,[client,record('Received fatal alert: protocol_version')].join('\n'),'newer.log');
    await expect(page.locator('#fileName')).toHaveText('newer.log');
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(1);
    expect(await page.evaluate(()=>window.tlsWorkerRuns.every(run=>run.stopped))).toBe(true);
});

test('large TLS capture keeps analysis off the UI thread and limits rendered rows without trimming evidence', async ({page}) => {
    test.setTimeout(60_000);
    const padding='safe controlled padding '.repeat(2200);
    const text=Array.from({length:501},()=>[client,padding,server,produced,consumed].join('\n')).join('\n');
    const path=test.info().outputPath('large-tls.log');
    await writeFile(path,text);
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await page.evaluate(()=>{
        window.tlsLongTasks=[];
        new PerformanceObserver(list=>window.tlsLongTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});
    });
    await page.locator('#fileInput').setInputFiles(path);
    await expect(page.locator('#rowCount')).toHaveText('1–200 of 501 / 501 interactions',{timeout:50_000});
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(200);
    await page.locator('#tlsNextPage').click();
    await expect(page.locator('#rowCount')).toHaveText('201–400 of 501 / 501 interactions');
    await page.getByRole('button',{name:'Select interaction 201',exact:true}).click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsRawPanel')).toContainText(padding.slice(0,500));
    await page.getByRole('button',{name:'Previous interaction',exact:true}).click();
    await expect(page.locator('#tlsPageLabel')).toHaveText('Page 1 of 3');
    await expect(page.locator('#tlsInspector')).toContainText('Interaction #200');
    await page.getByRole('button',{name:'Next interaction',exact:true}).click();
    await expect(page.locator('#tlsPageLabel')).toHaveText('Page 2 of 3');
    await expect(page.locator('#tlsInspector')).toContainText('Interaction #201');
    await page.locator('#searchInput').fill('no-matching-host');
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(0);
    await page.locator('#searchInput').fill('');
    await expect(page.locator('#tlsPageLabel')).toHaveText('Page 1 of 3');
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
    expect(Math.max(0,...await page.evaluate(()=>window.tlsLongTasks)), 'No one-second UI task in this controlled ~25 MiB capture').toBeLessThan(1000);
});

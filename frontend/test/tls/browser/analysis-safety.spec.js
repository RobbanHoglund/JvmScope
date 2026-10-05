import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { elapsedSnapshot, elapsedRegressionSnapshots } from '../../tda/elapsed-regression-fixture.js';
import { blockingSequence } from '../../tda/blocking-fixture.js';

test('TDA blocking progression preserves focus and snapshot-local evidence through navigation', async ({page, appUrl}) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await upload(page, blockingSequence.join('\n'), 'incident.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    await page.locator('#dependencyGraphDetails > summary').click();
    const select = page.locator('#blockingPatternSelect');
    await select.selectOption({label: 'Dependencies on worker-1 · peak 3 · recurrence 1'});
    const selected = await select.inputValue();
    await expect(page.locator('#blockingPatternView')).toContainText('#1: 1 unique');
    await page.locator('[data-blocking-snapshot="1"]').click();
    await expect(select).toHaveValue(selected);
    await expect(page.locator('#blockingPatternView')).toContainText('newly observed');
    await expect(page.locator('#dependencyGraphSvg .dependency-graph-node-thread')).toHaveCount(4);
    await page.locator('[data-blocking-thread]').first().click();
    await expect(page.locator('#threadModal')).toContainText('worker-1');
    await page.locator('#threadModal').getByRole('button', {name:'Close',exact:true}).click();
    await page.locator('[data-blocking-snapshot="2"]').click();
    await expect(select).toHaveValue(selected);
    await expect(page.locator('#dependencyGraphSvg .dependency-graph-node-thread')).toHaveCount(0);
    await expect(page.locator('#blockingPatternView')).toContainText('does not establish that the problem was resolved');
    await select.selectOption('');
    await expect(page.locator('#dependencyGraphSvg .dependency-graph-node-thread')).not.toHaveCount(0);
});

test('TDA selected findings export locally with immutable origin, notes and safe preview',async({page,appUrl})=>{
    const external=[];
    page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(new URL(appUrl).origin))external.push(r.url());});
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await upload(page,blockingSequence.join('\n'),'original-incident.txt');
    await page.locator('#dependencyGraphDetails > summary').click();
    await page.locator('#blockingPatternSelect').selectOption({label:'Dependencies on worker-1 · peak 3 · recurrence 1'});
    await page.locator('#addBlockingReport').click();
    await expect(page.locator('#reportFindings article')).toHaveCount(1);
    await page.getByRole('textbox',{name:'Notes for finding 1'}).fill('<img src="https://evil.invalid/leak" onerror="alert(1)"> ![x](https://evil.invalid)');
    await page.locator('[data-blocking-snapshot="1"]').click();
    await page.locator('#addBlockingReport').click();
    await expect(page.locator('#reportFindings article')).toHaveCount(2);
    await page.locator('#reportFindings article').last().getByRole('button',{name:'Move up',exact:true}).click();
    await page.locator('#sessionInputMode').selectOption('replace');
    await upload(page,elapsedSnapshot(0,100,'100.000'),'replacement.txt');
    await page.getByRole('button',{name:'Preview report',exact:true}).click();
    await expect(page.locator('#reportPreview')).toBeVisible();
    const frame=page.frameLocator('#reportPreview iframe');
    await expect(frame.locator('body')).toContainText('original-incident.txt');
    await expect(frame.locator('body')).not.toContainText('replacement.txt');
    await expect(frame.locator('body')).toContainText('<img src=');
    await expect(frame.locator('img')).toHaveCount(2);
    await expect(page.getByRole('button',{name:'Export HTML',exact:true})).toBeDisabled();
    await page.locator('#reportPreview input[type=checkbox]').check();
    const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export HTML',exact:true}).click();
    const download=await downloaded;expect(download.suggestedFilename()).toBe('jvmscope-findings.html');
    expect(external).toEqual([]);
    await page.getByRole('button',{name:'Close preview',exact:true}).click();
    await page.locator('#reportFindings article').first().getByRole('button',{name:'Remove',exact:true}).click();
    await expect(page.locator('#reportFindings article')).toHaveCount(1);
});
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

test('TLS an unfinished boundary stays unknown even when a ServerHello record is missing', async ({page}) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    await upload(page,[client,client,server,produced,consumed].join('\n'));
    await expect(page.locator('#rowCount')).toHaveText('2 / 2 interactions');
    await expect(page.locator('#errorState')).toContainText('connection identity is ambiguous');
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await expect(page.locator('#tlsInspector')).toContainText('Grouping uncertain');
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(0);
    await page.locator('#onlySuccessToggle').uncheck();
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsRawPanel')).toContainText('Consuming server Finished');
    await upload(page,[client,record('Consuming HelloRetryRequest handshake message'),client,server,produced,consumed].join('\n'));
    await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
    await expect(page.locator('#errorState')).not.toBeVisible();
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(1);
});

test('TLS conflicting endpoint roles stay unknown in the worker, statistics, filter and inspector', async ({page}) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    for (const messages of [
        ['Produced client Finished handshake message', 'Consuming client Finished handshake message'],
        ['Produced ClientHello handshake message', 'Consuming HelloRetryRequest handshake message',
            'Consuming ClientHello handshake message', 'Produced client Finished handshake message', 'Consuming server Finished handshake message'],
    ]) {
        const name = `roles-${messages.length}.log`;
        await upload(page, messages.map(record).join('\n'), name);
        // Counts are identical in both negative cases; wait for this capture's
        // committed worker result rather than observing the previous capture.
        await expect(page.locator('#fileName')).toHaveText(name);
        await expect(page.locator('#rowCount')).toHaveText('1 / 1 interactions');
        await expect(page.locator('#statsSummary .metric-success .value')).toHaveText('0');
        await expect(page.locator('#statsSummary')).toContainText('Unknown 1');
        await page.getByRole('button', { name: 'Select interaction 1', exact: true }).click();
        await expect(page.locator('#tlsInspector')).toContainText('Grouping uncertain');
        await expect(page.locator('#tlsInspector')).toContainText('endpoint roles conflict');
        await page.locator('#onlySuccessToggle').check();
        await expect(page.locator('#tlsTableBody tr')).toHaveCount(0);
        await page.locator('#onlySuccessToggle').uncheck();
        await page.getByRole('button', { name: 'Select interaction 1', exact: true }).click();
        await page.locator('#tlsRawTab').click();
        await expect(page.locator('#tlsRawPanel')).toContainText(messages[0]);
        await expect(page.locator('#tlsRawPanel')).toContainText(messages.at(-1));
    }
    await upload(page, [produced, consumed].join('\n'), 'compatible-partial.log');
    await expect(page.locator('#fileName')).toHaveText('compatible-partial.log');
    await expect(page.locator('#statsSummary .metric-success .value')).toHaveText('1');
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(1);
});

test('TDA elapsed regression across files cannot enter measured charts or thread comparisons', async ({page, appUrl}) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles(elapsedRegressionSnapshots.map((text, i) => ({
        name: `elapsed-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(text),
    })));
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(page.locator('.cpu-timeline-card')).not.toBeVisible();
    await page.locator('#dumpSelect').selectOption('1');
    await page.locator('#threadTableBody tr').getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#threadModal')).toContainText('Thread elapsed counter decreased');
    await expect(page.locator('#threadModal')).toContainText('continuity is uncertain');
    await expect(page.locator('#threadModal')).not.toContainText('70.0%');
    await page.locator('#threadModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#sessionInputMode').selectOption('replace');
    await upload(page, [elapsedSnapshot(0, 100, '100.000'), elapsedSnapshot(1, 800, '101.000', 1000000)].join('\n'), 'valid-elapsed.txt');
    await expect(page.locator('#cpuTimelineLegend')).toContainText('Peak 70.0%');
    await expect(page.locator('#cpuTimelineChart .cpu-timeline-point')).toHaveCount(1);
});

test('TDA jcmd process prefixes prevent CPU correlation across known and unknown PID boundaries', async ({page, appUrl}) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    const snapshots = ['1234', null, '5678'].map((pid, index) => `${pid ? `${pid}:\n` : ''}${elapsedSnapshot(index, 100 + 700 * index, `${100 + index}.000`, 1000 + 999000 * index)}`);
    await page.locator('#fileInput').setInputFiles(snapshots.map((text, i) => ({ name: `process-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from(text) })));
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    await page.locator('#dumpSelect').selectOption('2');
    await page.locator('#threadTableBody tr').getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#threadModal')).not.toContainText('70.0%');
    await page.locator('#threadModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#sessionInputMode').selectOption('replace');
    await upload(page, `${snapshots[0]}\n${snapshots[2]}`, 'different-processes.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(page.locator('.cpu-timeline-card')).not.toBeVisible();
});

test('TDA coarse CPU estimates never enter the measured chart or its peak ranking', async ({page,appUrl}) => {
    const dump = (second,cpu,elapsed='') => `2026-10-04 12:00:0${second}\nFull thread dump OpenJDK 64-Bit Server VM:\n\n"mixed-clock-worker" #11 prio=5 os_prio=0 cpu=${cpu}ms ${elapsed ? `elapsed=${elapsed}s ` : ''}tid=0x11 nid=0x65 runnable [0x1100]\n   java.lang.Thread.State: RUNNABLE\n    at example.Work.run(Work.java:1)\n\nJNI global refs: 1\n`;
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await upload(page,[dump(0,100),dump(1,1600)].join('\n'),'coarse.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(page.locator('.cpu-timeline-card')).not.toBeVisible();
    await page.locator('#dumpSelect').selectOption('1');
    await page.locator('#threadTableBody tr').getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.locator('#threadModal')).toContainText('≈ 150.0%');
    await page.locator('#threadModal').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('#sessionInputMode').selectOption('replace');
    await upload(page,[dump(0,100),dump(1,1600),dump(2,1900,'2.000'),dump(3,2400,'3.000'),dump(4,2700,'30.000')].join('\n'),'mixed.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(5);
    await expect(page.locator('#cpuTimelineLegend')).toContainText('Peak 50.0%');
    const point = page.locator('#cpuTimelineChart .cpu-timeline-point');
    await expect(point).toHaveCount(1);
    await expect(point).toHaveAttribute('data-timeline-dump-index','3');
    // Scrolling can trigger a resize/redraw of the SVG. Scroll its stable
    // container, then resolve the current point for the keyboard assertion.
    await page.locator('#cpuTimelineChart').scrollIntoViewIfNeeded();
    await expect(point).toBeInViewport();
    // Scroll deliberately dismisses tooltips. Finish that viewport transition
    // before focusing the endpoint, as a keyboard user does after navigation.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await point.evaluate(element => element.focus({ preventScroll: true }));
    await expect(point).toBeFocused();
    // Let any pending mouse-leave timer expire; it must not hide new focus.
    await page.waitForTimeout(180);
    await expect(page.locator('#appTooltip')).toBeVisible();
    await expect(page.locator('#appTooltip')).toContainText('MEASURED INTERVAL');
    await expect(page.locator('#appTooltip')).toContainText('50.0%');
    await expect(page.locator('#appTooltip')).toContainText('Time uncertainty');
});

test('TLS legacy unfinished boundary stays unknown in the worker, success filter and raw inspector', async ({page}) => {
    await page.locator('#tlsInvestigateColumns').dispatchEvent('click');
    const hello = ['*** ClientHello, TLSv1.2', 'worker, WRITE: TLSv1.2 Handshake, length = 123'];
    const end = ['worker, READ: TLSv1.2 Handshake, length = 456', '*** ServerHello, TLSv1.2',
        'worker, WRITE: TLSv1.2 Change Cipher Spec, length = 1', '*** Finished',
        'worker, READ: TLSv1.2 Handshake, length = 42', '*** Finished'];
    await upload(page,[...hello,...hello,...end].join('\n'),'legacy-overlap.log');
    await expect(page.locator('#rowCount')).toHaveText('2 / 2 interactions');
    await expect(page.locator('#errorState')).toContainText('legacy handshake bodies cannot be assigned reliably');
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await expect(page.locator('#tlsInspector')).toContainText('Grouping uncertain');
    await expect(page.locator('#tlsInspector')).toContainText('No single-connection sequence is inferred');
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(0);
    await page.locator('#onlySuccessToggle').uncheck();
    await page.getByRole('button',{name:'Select interaction 2',exact:true}).click();
    await page.locator('#tlsRawTab').click();
    await expect(page.locator('#tlsRawPanel')).toContainText('*** Finished');
    await expect(page.locator('#tlsRawPanel')).toContainText('worker, READ: TLSv1.2 Handshake');
    await upload(page,[...hello,...end,...hello,...end].join('\n'),'legacy-sequential.log');
    await expect(page.locator('#rowCount')).toHaveText('2 / 2 interactions');
    await expect(page.locator('#errorState')).not.toBeVisible();
    await page.locator('#onlySuccessToggle').check();
    await expect(page.locator('#tlsTableBody tr')).toHaveCount(2);
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

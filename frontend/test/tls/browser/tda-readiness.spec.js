import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { largeThreadDump } from '../../tda/large-dump-fixture.js';

const fixture = name => fileURLToPath(new URL(`../../tda/fixtures/${name}`, import.meta.url));
const workerUrl = /\/assets\/js\/worker-analysis-worker-[^/]+\.js$/;
async function load(page, name) {
    await page.locator('#fileInput').setInputFiles(fixture(name));
    await expect(page.locator('#loadingState')).not.toBeVisible();
}
async function sample(page) {
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#rowCount')).toHaveText('1–50 of 67 threads');
}
test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    // This suite explicitly tests replacement; the selector becomes visible after loading.
    await page.locator('#sessionInputMode').selectOption('replace', { force: true });
});

test('TDA partial snapshots cannot claim fading, growth or exact missing counts', async ({ page }) => {
    await load(page, 'partial-thread-snapshot.txt');
    await expect(page.locator('#errorState')).toContainText('could not be parsed');
    await expect(page.getByRole('alertdialog', { name: 'Thread dump loaded with warnings' })).toBeVisible();
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#nextDumpBtn').click();
    await expect(page.locator('#dumpDeltaSummary')).toContainText('Ended ?');
    const panel = page.locator('#runnableClusterPanelBody');
    await panel.locator('.runnable-cluster-panel-summary').click();
    await expect(panel.locator('.runnable-cluster-trend-badge').first()).toHaveText('Unavailable');
    await panel.locator('.runnable-cluster-card-summary').first().click();
    const lastCount = panel.locator('.runnable-cluster-timeline-value').last();
    await expect(lastCount).toHaveText('≥1');
    await expect(panel.locator('[data-trend="fading"], [data-trend="growing"]')).toHaveCount(0);
    await page.locator('#runnableGrowingOnlyToggle').check();
    await expect(panel.locator('.runnable-cluster-card')).toHaveCount(0);
    await page.locator('#runnableGrowingOnlyToggle').uncheck();
    await page.locator('#runnablePersistentOnlyToggle').check();
    await expect(panel.locator('.runnable-cluster-card')).toHaveCount(0);
});

test('TDA history does not bridge a changed JVM process through a classic dump', async ({ page }) => {
    const plain = readFileSync(fixture('runtime/jdk25-dump-to-file.txt'), 'utf8');
    const classic = readFileSync(fixture('runtime/jdk25-thread-print.txt'), 'utf8');
    const raw = [plain.replace(/^\d+/, '100'), classic, plain.replace(/^\d+/, '200')].join('\n');
    await page.locator('#fileInput').setInputFiles({ name: 'mixed-processes.txt', mimeType: 'text/plain', buffer: Buffer.from(raw) });
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await page.locator('#dumpSelect').selectOption('2');
    await page.locator('#threadTableBody tr').filter({ hasText: 'sample-waiter' }).getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(panel).toContainText('Observed 1/1');
    await expect(panel).not.toContainText('Observed 3/3');
    await expect(panel).toContainText('At least two exact adjacent snapshot occurrences');
});

test('TDA adding valid input to an existing partial session does not reopen the previous warning', async ({ page }) => {
    await load(page, 'partial-thread-snapshot.txt');
    await expect(page.getByRole('alertdialog', { name: 'Thread dump loaded with warnings' })).toBeVisible();
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#sessionInputMode').selectOption('append');
    await load(page, 'runtime/jdk27-thread-print.txt');
    await expect(page.locator('#sessionInputStatus')).toContainText('snapshot added');
    await expect(page.locator('#inputFeedbackModal')).not.toBeVisible();
    await expect(page.locator('#errorState')).toBeVisible();
});

for (const version of [26, 27]) test(`TDA JDK ${version} file dumps retain reported parking owners in the UI`, async ({ page }) => {
    await load(page, `runtime/jdk${version}-dump-to-file.json`);
    await expect(page.locator('#rowCount')).toHaveText('1–6 of 6 threads');
    await page.locator('#threadTableBody tr').filter({ hasText: 'sample-sync-waiter' }).getByRole('button', { name: 'Details', exact: true }).click();
    await page.getByRole('tab', { name: 'Locks', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Locks', exact: true });
    await expect(panel).toContainText('ReentrantLock$NonfairSync');
    await expect(panel).toContainText('Reported owner: #');
    await expect(panel).toContainText("at this thread's observation");
});

test('TDA Clear and a replacement capture cancel a running worker', async ({ page }) => {
    // Keep a real worker pending deterministically, independently of machine speed.
    await page.route(workerUrl, route => route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => {};' }));
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await expect(page.locator('#loadingState')).toBeVisible();
    await page.locator('#clearBtn').click();
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#rowCount')).toHaveText('0 threads');
    await expect(page.locator('#fileName')).toHaveText('No file loaded');
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await expect(page.locator('#loadingState')).toBeVisible();
    await page.unroute(workerUrl);
    await load(page, 'runtime/jdk25-dump-to-file.json');
    await expect(page.locator('#rowCount')).toHaveText('1–4 of 4 threads');
    await expect(page.locator('#fileName')).toHaveText('jdk25-dump-to-file.json');
});

test('TDA worker loading failures are visible and allow recovery', async ({ page }) => {
    await page.route(workerUrl, route => route.abort());
    await page.getByRole('button', { name: 'Sample', exact: true }).click();
    await expect(page.locator('#errorState')).toContainText('analysis failed unexpectedly');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#rowCount')).toHaveText('0 threads');
    await page.unroute(workerUrl);
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await sample(page);
    await expect(page.locator('#errorState')).not.toBeVisible();
});

test('TDA CPU profile and chart navigation retain measurements and snapshot selection', async ({ page }) => {
    await sample(page);
    await page.locator('#nextDumpBtn').click();
    const cpuValues = await page.locator('#threadTableBody tr td:nth-child(9)').allTextContents();
    await page.locator('#cpuThresholdProfile').selectOption('sensitive');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#dumpSelect')).toHaveValue('1');
    expect(await page.locator('#threadTableBody tr td:nth-child(9)').allTextContents()).toEqual(cpuValues);
    await expect(page).toHaveURL(/cpuProfile=sensitive/);
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(page.locator('#cpuTimelineChart svg')).toBeVisible();
    await page.locator('#cpuTimelineSearch').fill('no-such-thread-name');
    await expect(page.locator('#cpuTimelineSummary')).toContainText('No measured CPU series match');
    await page.locator('#cpuTimelineSearch').fill('');
    const point = page.locator('#cpuTimelineChart [role="button"]').last();
    await expect(point).toBeVisible();
    await point.click();
    await expect(page.locator('#dumpSelect')).toHaveValue('2');
});

test('TDA dependency graph search, keyboard selection, focus and PNG export work after worker transfer', async ({ page }) => {
    await sample(page);
    await page.locator('#dependencyGraphDetails > summary').click();
    await page.locator('#dependencyGraphViewMode').selectOption('dependency');
    await page.locator('#dependencyGraphScope').selectOption('deadlock');
    await expect(page.locator('#dependencyGraphSvg .dependency-graph-node')).toHaveCount(5);
    await page.locator('#dependencyGraphSearch').fill('deadlock');
    await expect(page.locator('#dependencyGraphSearchCount')).toContainText('5 matches');
    await page.locator('#dependencyGraphSearch').fill('');
    // Select through the graph's real keyboard handler. Animated SVG group
    // bounds can overlap labels and vary between rendering platforms.
    const firstNode = page.locator('#dependencyGraphSvg .dependency-graph-node').first();
    await firstNode.focus();
    await firstNode.press('Enter');
    await expect(page.locator('#dependencyGraphInspector')).toBeVisible();
    await page.locator('#dependencyGraphFocusSelected').click();
    await expect(page.locator('#dependencyGraphFocusBar')).toBeVisible();
    await page.locator('#dependencyGraphFocusClear').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('#dependencyGraphExport').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/^thread-dependency-.*\.png$/);
    expect(await download.failure()).toBeNull();
});

test('TDA JSON and untrusted names replace successfully while invalid input keeps the valid session', async ({ page }) => {
    await load(page, 'runtime/jdk25-dump-to-file.json');
    await expect(page.locator('#rowCount')).toHaveText('1–4 of 4 threads');
    await load(page, 'malicious-html-content.txt');
    await expect(page.locator('#threadTableBody')).toContainText('<img src=x');
    await expect(page.locator('#threadTableBody script, #threadTableBody img, #threadTableBody iframe')).toHaveCount(0);
    await page.locator('#fileInput').setInputFiles({ name: 'unrelated.txt', mimeType: 'text/plain', buffer: Buffer.from('Unrelated log entries') });
    await expect(page.locator('#sessionInputStatus')).toContainText('No supported thread headers');
    await expect(page.locator('#sessionInputStatus')).toContainText('current session was kept');
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await expect(page.locator('#threadTableBody')).toContainText('<img src=x');
    await expect(page.getByRole('alertdialog', { name: 'Invalid thread dump', exact: true })).toBeVisible();
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await sample(page);
    await expect(page.locator('#errorState')).not.toBeVisible();
});

test('TDA clipboard and drop input use the same worker analysis path', async ({ page }) => {
    const text = largeThreadDump(1);
    await page.evaluate(text => navigator.clipboard.writeText(text), text);
    await page.locator('#pasteClipboardBtn').click();
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#fileName')).toHaveText('Clipboard input');
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await page.evaluate(text => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(new File([text], 'dropped-thread-dump.txt', { type: 'text/plain' }));
        document.getElementById('tableContainer').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    }, text);
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#fileName')).toHaveText('dropped-thread-dump.txt');
    await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
});

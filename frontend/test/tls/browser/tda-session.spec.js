import { test, expect } from './fixtures.js';

const workerUrl = /\/assets\/js\/worker-analysis-worker-[^/]+\.js$/;
function dump(number) {
    return `2026-10-03 12:00:0${number}\nFull thread dump OpenJDK 64-Bit Server VM (27 mixed mode):\n\n"cpu-worker" #7 prio=5 os_prio=0 cpu=${number * 100}.00ms elapsed=${number}.00s tid=0x00000007 nid=7 runnable\n   java.lang.Thread.State: RUNNABLE\n        at example.Snapshot${number}.run(Worker.java:7)`;
}
const file = (number, name = `dump-${number}.txt`) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(dump(number)) });
async function snapshots(page, count) {
    if (count > 1) await expect(page.locator('#dumpSelect option')).toHaveCount(count);
    else await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    await expect(page.locator('#sessionInputStatus')).toContainText(`${count} in this session`);
    await expect(page.locator('#loadingState')).not.toBeVisible();
}
async function pasteEvent(page, texts) {
    await page.evaluate(texts => {
        for (const text of texts) {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', text);
            document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
        }
    }, texts);
}
test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await expect(page.locator('#sessionInputMode')).toHaveValue('append');
    await page.locator('#fileInput').setInputFiles(file(1));
    await snapshots(page, 1);
});

test('TDA files, Paste, Ctrl+V and multi-file drop extend one session and its timeline/history', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles([file(2), file(3)]);
    await snapshots(page, 3);
    await expect(page.locator('#dumpSelect')).toHaveValue('1');
    await expect(page.locator('#dumpSelect option').last()).toContainText('dump-3.txt');
    await page.evaluate(text => navigator.clipboard.writeText(text), dump(4));
    await page.locator('#pasteClipboardBtn').click();
    await snapshots(page, 4);
    await page.evaluate(text => navigator.clipboard.writeText(text), dump(5));
    await page.keyboard.press('Control+V');
    await snapshots(page, 5);
    await page.evaluate(texts => {
        const dataTransfer = new DataTransfer();
        texts.forEach((text, index) => dataTransfer.items.add(new File([text], `dropped-${index + 6}.txt`, { type: 'text/plain' })));
        document.getElementById('tableContainer').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
    }, [dump(6), dump(7)]);
    await snapshots(page, 7);
    await expect(page.locator('#fileName')).toHaveText('7 snapshots · 7 sources');
    await page.locator('#dumpSelect').selectOption('6');
    await page.locator('#cpuThresholdProfile').selectOption('sensitive');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#dumpSelect option')).toHaveCount(7);
    await expect(page.locator('#dumpSelect')).toHaveValue('6');
    await page.locator('#threadStateChartPanel details > summary').first().click();
    await expect(page.locator('#cpuTimelineChart svg')).toBeVisible();
    await expect(page.locator('#cpuTimelineChart [role="button"]')).toHaveCount(6);
    await page.locator('#cpuTimelineChart [role="button"]').first().click();
    await expect(page.locator('#dumpSelect')).toHaveValue('1');
    await page.locator('#dumpSelect').selectOption('6');
    await page.locator('#threadTableBody .thread-cell-name').click();
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('Snapshot7.run');
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history.locator('dt:has-text("Occurrences") + dd')).toHaveText('7');
    await expect(history).toContainText('Observed 6/7');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('TDA mixed text/JSON sources keep exact source evidence and a malformed batch item is isolated', async ({ page }) => {
    const json = { threadDump: { processId: '777', time: '2026-10-03T12:00:03Z', runtimeVersion: '27',
        threadContainers: [{ container: '<root>', threads: [{ tid: '7', name: 'json-worker', stack: ['example.JsonWorker.run(Worker.java:3)'] }] }] } };
    await page.locator('#fileInput').setInputFiles([
        { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('Unrelated log entries') },
        file(2),
        { name: 'capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) },
    ]);
    await snapshots(page, 3);
    await expect(page.locator('#sessionInputStatus')).toContainText('bad.txt');
    await expect(page.locator('#errorState')).not.toBeVisible();
    const warning = page.getByRole('alertdialog', { name: 'Thread dump loaded with warnings', exact: true });
    await expect(warning).toContainText('bad.txt');
    await expect(warning).toContainText('2 snapshots added. The session now contains 3 snapshots.');
    await warning.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#dumpSelect').selectOption('2');
    await expect(page.locator('#threadTableBody')).toContainText('json-worker');
    const opened = page.waitForEvent('popup');
    await page.locator('#openRawDumpBtn').click();
    const raw = await opened;
    await expect(raw.locator('.raw-workspace-meta')).toContainText('Source: capture.json');
    await expect(raw.locator('body')).toContainText('JsonWorker.run');
    await page.locator('#fileInput').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"threadDump":') });
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#sessionInputStatus')).toContainText('current session was kept');
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    expect(raw.isClosed()).toBe(false);
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#sessionInputMode').selectOption('replace');
    await page.locator('#fileInput').setInputFiles({ name: 'bad-replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('not a dump') });
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    expect(raw.isClosed()).toBe(false);
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#fileInput').setInputFiles(file(4));
    await snapshots(page, 1);
    await expect.poll(() => raw.isClosed()).toBe(true);
    await expect(page.locator('#fileName')).toHaveText('dump-4.txt');
});

test('TDA quick consecutive pastes are queued and both extend the session', async ({ page }) => {
    await page.route(workerUrl, async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\nconst sessionHandler = self.onmessage; self.onmessage = event => setTimeout(() => sessionHandler(event), 150);` });
    });
    await pasteEvent(page, [dump(2), dump(3)]);
    await snapshots(page, 3);
    await expect(page.locator('#dumpSelect')).toHaveValue('2');
    await expect(page.locator('#dumpSelect option')).toContainText(['12:00:01', '12:00:02', '12:00:03']);
    await page.locator('#threadTableBody .thread-cell-name').click();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    const history = page.getByRole('tabpanel', { name: 'History', exact: true });
    await expect(history.locator('dt:has-text("Occurrences") + dd')).toHaveText('3');
    await expect(history).toContainText('Observed 2/3');
});

test('TDA invalid input messages preserve the session, escape names and close through every dialog path', async ({ page }) => {
    for (const closeAction of ['header', 'footer', 'backdrop', 'Escape']) {
        await page.locator('#fileInput').setInputFiles({ name: '<img src=x onerror=alert(1)>.txt', mimeType: 'text/plain', buffer: Buffer.from('unrelated log entries') });
        const dialog = page.getByRole('alertdialog', { name: 'Invalid thread dump', exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-hidden', 'false');
        await expect(dialog).toContainText('<img src=x onerror=alert(1)>.txt');
        await expect(dialog).toContainText('The current session was kept. No new snapshots were added.');
        await expect(dialog.locator('img, script, iframe')).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Close input message' })).toBeFocused();
        const box = await dialog.locator('.modal-dialog').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
        if (closeAction === 'header') await dialog.getByRole('button', { name: 'Close input message' }).click();
        else if (closeAction === 'footer') await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        else if (closeAction === 'backdrop') await dialog.locator('[data-close="input-feedback"]').click({ position: { x: 4, y: 4 } });
        else await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(page.locator('#inputFeedbackModal')).toHaveAttribute('aria-hidden', 'true');
        await expect(page.locator('#fileName')).toHaveText('dump-1.txt');
        await expect(page.locator('#rowCount')).toHaveText('1–1 of 1 threads');
    }
});

test('TDA an empty file names the problem and Choose dumps recovers through the real file chooser', async ({ page }) => {
    await page.locator('#clearBtn').click();
    await page.locator('#fileInput').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') });
    const dialog = page.getByRole('alertdialog', { name: 'Empty thread dump', exact: true });
    await expect(dialog).toContainText('empty.txt');
    await expect(dialog).toContainText('No snapshots were loaded.');
    const opened = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Choose dumps', exact: true }).click();
    const chooser = await opened;
    await chooser.setFiles(file(2));
    await snapshots(page, 1);
    await expect(page.locator('#fileName')).toHaveText('dump-2.txt');
    await expect(page.locator('#inputFeedbackModal')).not.toBeVisible();
    await expect(page.locator('#errorState')).not.toBeVisible();
});

test('TDA clipboard messages distinguish missing text from browser access failure and restore Paste focus', async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const paste = page.locator('#pasteClipboardBtn');
    await paste.click();
    const info = page.getByRole('dialog', { name: 'Clipboard is empty', exact: true });
    await expect(info).toHaveAttribute('data-severity', 'info');
    await expect(info).toContainText('The current session was kept.');
    await expect(info.locator('#inputFeedbackSourceDetails')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await expect(paste).toBeFocused();
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'readText', { configurable: true,
        value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }));
    await paste.click();
    const warning = page.getByRole('alertdialog', { name: 'Could not read clipboard', exact: true });
    await expect(warning).toHaveAttribute('data-severity', 'warning');
    await expect(warning).toContainText('Ctrl+V');
    await warning.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(paste).toBeFocused();
    await expect(page.locator('#fileName')).toHaveText('dump-1.txt');
});

test('TDA late invalid reads cannot show stale dialogs after Clear', async ({ page }) => {
    await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () {
            return this.name === 'late-invalid.txt' ? new Promise(resolve => { window.releaseInvalidRead = () => resolve('not a dump'); }) : original.call(this);
        };
    });
    await page.locator('#fileInput').setInputFiles(file(2, 'late-invalid.txt'));
    await expect(page.locator('#loadingState')).toBeVisible();
    await page.locator('#clearBtn').click();
    await page.locator('#fileInput').setInputFiles(file(3));
    await snapshots(page, 1);
    await page.evaluate(async () => { window.releaseInvalidRead(); await new Promise(resolve => setTimeout(resolve, 0)); });
    await expect(page.locator('#inputFeedbackModal')).not.toBeVisible();
    await expect(page.locator('#fileName')).toHaveText('dump-3.txt');
});

test('TDA Clear cancels a pending file read and queued paste without blocking a new session', async ({ page }) => {
    await page.evaluate(text => {
        const original = File.prototype.text;
        File.prototype.text = function () {
            return this.name === 'slow.txt' ? new Promise(resolve => { window.releaseSessionRead = () => resolve(text); }) : original.call(this);
        };
    }, dump(2));
    await page.locator('#fileInput').setInputFiles(file(2, 'slow.txt'));
    await pasteEvent(page, [dump(3)]);
    await expect(page.locator('#loadingState')).toBeVisible();
    await page.locator('#clearBtn').click();
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#rowCount')).toHaveText('0 threads');
    await page.locator('#fileInput').setInputFiles(file(4));
    await snapshots(page, 1);
    await page.evaluate(async () => {
        window.releaseSessionRead();
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    await expect(page.locator('#fileName')).toHaveText('dump-4.txt');
    await expect(page.locator('#dumpSelect option')).toHaveCount(0);
    await expect(page.locator('#sessionInputStatus')).toContainText('1 in this session');
});

test('TDA worker failure and unreadable files retain the session and allow a later valid addition', async ({ page }) => {
    await page.route(workerUrl, route => route.abort());
    await page.locator('#fileInput').setInputFiles(file(2));
    await expect(page.locator('#errorState')).toContainText('analysis failed unexpectedly');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#fileName')).toHaveText('dump-1.txt');
    await expect(page.getByRole('alertdialog', { name: 'Thread dump analysis failed', exact: true })).toBeVisible();
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.unroute(workerUrl);
    await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = function () { return this.name === 'unreadable.txt' ? Promise.reject(new Error('unreadable')) : original.call(this); };
    });
    await page.locator('#fileInput').setInputFiles([file(2, 'unreadable.txt'), file(3)]);
    await snapshots(page, 2);
    await expect(page.locator('#sessionInputStatus')).toContainText('unreadable.txt could not be read');
    await expect(page.locator('#errorState')).not.toBeVisible();
    await expect(page.locator('#dumpSelect option')).toContainText(['12:00:01', '12:00:03']);
    await expect(page.getByRole('alertdialog', { name: 'Thread dump loaded with warnings', exact: true })).toContainText('unreadable.txt');
});

test('TDA failed CPU profile changes keep the committed profile, URL and complete multi-source session', async ({ page }) => {
    await page.locator('#fileInput').setInputFiles(file(2));
    await snapshots(page, 2);
    const cpu = await page.locator('#threadTableBody td:nth-child(9)').allTextContents();
    await page.route(workerUrl, route => route.abort());
    await page.locator('#cpuThresholdProfile').selectOption('sensitive');
    await expect(page.locator('#errorState')).toContainText('analysis failed unexpectedly');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#cpuThresholdProfile')).toHaveValue('balanced');
    expect(new URL(page.url()).searchParams.has('cpuProfile')).toBe(false);
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    expect(await page.locator('#threadTableBody td:nth-child(9)').allTextContents()).toEqual(cpu);
    await page.locator('#inputFeedbackModal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.unroute(workerUrl);
    await page.locator('#cpuThresholdProfile').selectOption('sensitive');
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#cpuThresholdProfile')).toHaveValue('sensitive');
    await expect(page).toHaveURL(/cpuProfile=sensitive/);
    await expect(page.locator('#errorState')).not.toBeVisible();
    await page.locator('#fileInput').setInputFiles(file(3));
    await snapshots(page, 3);
});

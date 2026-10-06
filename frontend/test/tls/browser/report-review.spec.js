import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { blockingSequence } from '../../tda/blocking-fixture.js';

test('TDA selected findings export presents readable evidence and preserves closed metadata in print', async ({ page, appUrl }, info) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#fileInput').setInputFiles({ name:'readable-report.txt', mimeType:'text/plain', buffer:Buffer.from(blockingSequence.join('\n')) });
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    await page.locator('#dependencyGraphDetails > summary').click();
    await page.locator('#blockingPatternSelect').selectOption({label:'Dependencies on worker-1 · peak 3 · recurrence 1'});
    await page.locator('#addBlockingReport').click();
    await expect(page.locator('#reportFindings article')).toHaveCount(1);
    await page.getByRole('button',{name:'Preview report',exact:true}).click();
    const frame=page.frameLocator('#reportPreview iframe');
    await expect(frame.getByRole('heading',{name:'Observation',exact:true})).toBeVisible();
    await expect(frame.getByRole('heading',{name:'Uncertainty / conflicting evidence',exact:true})).toBeVisible();
    await expect(frame.locator('.field').first()).toContainText('readable-report.txt');
    await expect(frame.getByRole('heading',{name:'Raw references (snapshot-local lines)',exact:true})).toBeVisible();
    await expect(frame.locator('.metadata')).not.toHaveAttribute('open');
    await expect(frame.locator('.metadata pre').first()).not.toBeVisible();
    await frame.locator('.metadata > summary').click();
    await expect(frame.locator('.metadata pre').first()).toContainText('readable-report.txt');
    await expect(frame.locator('.metadata pre').first()).toContainText('inputSha256');
    await frame.locator('.metadata > summary').click();
    await page.emulateMedia({media:'print'});
    await expect(frame.locator('.metadata pre').first()).toBeVisible();
    await page.emulateMedia({media:'screen'});
    await expect(frame.locator('.metadata pre').first()).not.toBeVisible();
    await frame.locator('body').evaluate(body=>body.ownerDocument.defaultView.scrollTo(0,0));
    await page.screenshot({path:info.outputPath('report-readable-preview.png')});
});

for (const [extension, label] of [['html', 'HTML'], ['md', 'Markdown']]) {
    test(`TDA report review rejects a late real finding until the updated ${label} selection is reviewed`, async ({ page, appUrl }) => {
        await page.addInitScript(() => {
            const original = crypto.subtle.digest.bind(crypto.subtle);
            crypto.subtle.digest = function (...args) {
                const result = original(...args);
                if (!window.holdNextDigest) return result;
                window.holdNextDigest = false;
                const gate = new Promise(resolve => { window.releaseReportDigest = resolve; });
                return gate.then(() => result);
            };
        });
        await page.goto(`${appUrl}/jvmscope/tda.html`);
        await page.locator('#fileInput').setInputFiles({ name: 'review-incident.txt', mimeType: 'text/plain', buffer: Buffer.from(blockingSequence.join('\n')) });
        await expect(page.locator('#dumpSelect option')).toHaveCount(3);
        await page.locator('#dependencyGraphDetails > summary').click();
        await page.locator('#blockingPatternSelect').selectOption({ label: 'Dependencies on worker-1 · peak 3 · recurrence 1' });
        await page.locator('#addBlockingReport').click();
        await expect(page.locator('#reportFindings article')).toHaveCount(1);
        await page.getByRole('textbox', { name: 'Notes for finding 1' }).fill('REVIEWED_FIRST_NOTE');
        await page.locator('[data-blocking-snapshot="1"]').click();
        await page.evaluate(() => { window.holdNextDigest = true; });
        await page.locator('#addBlockingReport').click();
        await page.waitForFunction(() => typeof window.releaseReportDigest === 'function');
        await page.getByRole('button', { name: 'Preview report', exact: true }).click();
        const ack = page.locator('#reportPreview input[type=checkbox]');
        await ack.check();
        const before = await page.locator('#reportPreview iframe').getAttribute('srcdoc');
        expect(before).toContain('1 selected findings');
        await page.evaluate(() => window.releaseReportDigest());
        await expect(page.locator('#reportFindings article')).toHaveCount(2);
        await expect(ack).not.toBeChecked();
        await expect(page.locator('#reportPreview [role=status]')).toContainText('The report changed');
        const exportButton = page.getByRole('button', { name: `Export ${label}`, exact: true });
        await expect(exportButton).toBeDisabled();
        const updated = await page.locator('#reportPreview iframe').getAttribute('srcdoc');
        expect(updated).not.toBe(before);
        expect(updated).toContain('2 selected findings');
        // The handler itself also rejects an unapproved export, even if a
        // stale UI projection erroneously enables its button.
        await page.evaluate(() => {
            window.reportBlobCalls = 0;
            const original = URL.createObjectURL.bind(URL);
            URL.createObjectURL = blob => { window.reportBlobCalls++; return original(blob); };
        });
        await exportButton.evaluate(button => { button.disabled = false; button.dispatchEvent(new Event('click')); button.disabled = true; });
        expect(await page.evaluate(() => window.reportBlobCalls)).toBe(0);
        await ack.check();
        const pending = page.waitForEvent('download');
        await exportButton.click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe(`jvmscope-findings.${extension}`);
        const exported = await readFile(await download.path(), 'utf8');
        if (extension === 'html') expect(exported).toBe(updated);
        else {
            expect(exported).toContain('2 selected findings');
            expect(exported).toContain('REVIEWED\\_FIRST\\_NOTE');
            expect(exported).toContain('## 2. Dependencies on worker-1');
        }
    });
}

// Exercise every report mutation against the real DOM/controller module.
// Source modules are served only to this isolated test page, without rewriting
// imports or adding a production route. The tests above use the built app.
const sourceFiles = new Map(['findings-report-view.js', 'findings-report.js', 'tda/ui-safety.js']
    .map(name => [name, new URL(`../../../assets/javautils/${name}`, import.meta.url)]));
async function reportHarness(page, appUrl) {
    await page.route('**/__report-review.html', route => route.fulfill({ contentType: 'text/html', body:
        '<div id="host"></div><script type="module">import {createFindingsReportView} from "./__report/findings-report-view.js"; window.reportView=createFindingsReportView(document.getElementById("host"));</script>' }));
    await page.route('**/__report/**', route => {
        const name = new URL(route.request().url()).pathname.split('/__report/')[1];
        return sourceFiles.has(name) ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(sourceFiles.get(name), 'utf8') }) : route.abort();
    });
    await page.goto(`${appUrl}/__report-review.html`);
    await page.waitForFunction(() => Boolean(window.reportView));
    await page.evaluate(() => {
        const finding = title => ({ id: title, title, scope: 'Synthetic selected snapshot', context: { datasetRevision: 1 }, version: 'test', observations: [], derivation: 'test', uncertainty: 'test', nextCheck: 'test', notes: '' });
        window.reportSource = finding('A first');
        window.reportView.add(window.reportSource);
        window.reportView.add(finding('B second'));
    });
}
for (const mutation of ['notes', 'reorder', 'remove', 'remove-last', 'clear']) {
    test(`TDA report review invalidates both export formats after ${mutation}`, async ({ page, appUrl }) => {
        await reportHarness(page, appUrl);
        await page.getByRole('button', { name: 'Preview report', exact: true }).click();
        const ack = page.locator('#reportPreview input[type=checkbox]');
        await ack.check();
        if (mutation === 'notes') await page.locator('#reportFindings textarea').first().evaluate(node => { node.value = 'CHANGED_NOTE'; node.dispatchEvent(new Event('input')); });
        if (mutation === 'reorder') await page.locator('#reportFindings article').last().getByRole('button', { name: 'Move up', exact: true, includeHidden: true }).dispatchEvent('click');
        if (mutation === 'remove') await page.locator('#reportFindings article').last().getByRole('button', { name: 'Remove', exact: true, includeHidden: true }).dispatchEvent('click');
        if (mutation === 'remove-last') {
            for (let i = 0; i < 2; i++) await page.locator('#reportFindings article').first().getByRole('button', { name: 'Remove', exact: true, includeHidden: true }).dispatchEvent('click');
        }
        if (mutation === 'clear') await page.evaluate(() => window.reportView.clear());
        await expect(ack).not.toBeChecked();
        for (const name of ['Export HTML', 'Export Markdown']) await expect(page.getByRole('button', { name, exact: true, includeHidden: true })).toBeDisabled();
        if (mutation !== 'clear') {
            await expect(page.locator('#reportPreview [role=status]')).toContainText('The report changed');
            const updated = await page.locator('#reportPreview iframe').getAttribute('srcdoc');
            if (mutation === 'notes') expect(updated).toContain('CHANGED_NOTE');
            if (mutation === 'reorder') expect(updated).toContain('<h2>1. B second</h2>');
            if (mutation === 'remove') expect(updated).toContain('1 selected findings');
            if (mutation === 'remove-last') {
                expect(updated).toContain('0 selected findings');
                await ack.check();
                for (const name of ['Export HTML', 'Export Markdown']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
                return;
            }
            await ack.check();
            const pending = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Export HTML', exact: true }).click();
            expect(await readFile(await (await pending).path(), 'utf8')).toBe(updated);
        } else {
            expect(await page.locator('#reportPreview iframe').getAttribute('srcdoc')).toBeNull();
            await expect(page.locator('#reportPreview')).not.toBeVisible();
        }
    });
}
test('TDA report review owns its findings instead of adopting later caller mutations', async ({ page, appUrl }) => {
    await reportHarness(page, appUrl);
    await page.evaluate(() => { window.reportSource.title = 'UNREVIEWED_CALLER_CHANGE'; window.reportSource.notes = 'SECRET_CALLER_CHANGE'; });
    await page.getByRole('button', { name: 'Preview report', exact: true }).click();
    const preview = await page.locator('#reportPreview iframe').getAttribute('srcdoc');
    expect(preview).toContain('A first');
    expect(preview).not.toContain('CALLER_CHANGE');
});

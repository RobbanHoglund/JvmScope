import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); await mkdir(previews, { recursive: true }); });
test.afterAll(async () => host?.close());

for (const language of ['en', 'sv']) {
    test(`recorded ${language} diagnosis after a manual stack click presents a new focused assessment and preserves the parent across restart`, async ({ page }) => {
        const trial = JSON.parse(await readFile(new URL(`./fixtures/thread-followup-${language}.json`, import.meta.url), 'utf8'));
        await page.setViewportSize({ width: 1440, height: 1200 });
        await page.goto(host.url + '/conversation?theme=' + (language === 'sv' ? 'light' : 'dark'));
        await page.evaluate(async ({ trial, language }) => {
            const seed = await (await fetch('/data?case=noFindings')).json();
            const call = async (name, arguments_) => {
                const result = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name, arguments: arguments_ }) })).json();
                if (result.isError) throw new Error(JSON.stringify(result)); return result;
            };
            // A fresh analysis has no preseeded focused assessment from the host fixtures.
            const analysis = (await call('analyze_thread_dumps', { paths: seed._meta.jvmscopeReport.sources.map(s => s.path) })).structuredContent;
            window.flow = { analysis, call };
            const shown = await call('render_thread_report', { reportId: analysis.reportId, reportContext: analysis.reportContext,
                snapshotIndex: 0, language, conclusion: trial.turns[0].conclusion });
            window.chatMessage('user', trial.turns[0].prompt); window.presentReport(shown, 'Overview');
            window.chatMessage('assistant', trial.turns[0].chatAnswer);
        }, { trial, language });
        const original = page.frameLocator('iframe[title="Overview"]');
        await expect(original.locator('.ai-conclusion-summary')).toHaveText(trial.turns[0].conclusion.summary);
        await original.getByRole('button', { name: language === 'sv' ? 'Granska stack' : 'Inspect stack', exact: true }).click();
        await expect(original.locator('.focus-evidence-only')).toHaveText(language === 'sv' ? 'Stackunderlag' : 'Stack evidence');
        await expect(original.locator('.ai-conclusion')).toHaveCount(0);
        await expect(original.locator('.evidence')).toContainText('StatusClient.java:152');

        const before = host.calls.length;
        await page.evaluate(async ({ trial, language }) => {
            const { analysis, call } = window.flow;
            const main = analysis.snapshots.items[0].threadInventory.items.find(t => t.name === 'main');
            const result = await call('render_thread_details', { reportId: analysis.reportId, reportContext: analysis.reportContext,
                snapshotIndex: 0, sourceKeys: [main.sourceKey], language, conclusion: trial.turns[1].conclusion });
            window.chatMessage('user', trial.turns[1].prompt); window.presentReport(result, 'main · Snapshot 1');
            window.chatMessage('assistant', trial.turns[1].chatAnswer);
        }, { trial, language });
        expect(host.calls.slice(before).map(c => c.name)).toEqual(['render_thread_details'], 'Already verified evidence needs no repeated inspection or general overview');
        const focused = page.frameLocator('iframe[title="main · Snapshot 1"]');
        await expect(focused.locator('h1')).toHaveText('main · Snapshot 1');
        await expect(focused.locator('.ai-conclusion-summary')).toHaveText(trial.turns[1].conclusion.summary);
        await expect(focused.locator('.focus-evidence-only')).toHaveCount(0);
        await expect(focused.locator('.evidence')).toContainText('StatusClient.java:152');
        expect(await focused.locator('.evidence').evaluate(n => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1);
        expect(await focused.locator('.ai-conclusion').evaluate(n => n.getBoundingClientRect().top)).toBeLessThan(
            await focused.locator('.evidence').evaluate(n => n.getBoundingClientRect().top));
        await expect(page.locator('.assistant').nth(1)).toHaveText(trial.turns[1].chatAnswer);
        await expect.poll(async () => {
            const body = await focused.locator('body').evaluate(n => n.getBoundingClientRect().height);
            return (await page.locator('iframe[title="main · Snapshot 1"]').boundingBox()).height >= body - 1;
        }).toBe(true);
        await page.screenshot({ path: previews + `focused-diagnosis-${language}.png`, fullPage: true });

        const afterPresentation = host.calls.length;
        await page.evaluate(turn => { window.chatMessage('user', turn.prompt); window.chatMessage('assistant', turn.chatAnswer); }, trial.turns[2]);
        expect(host.calls.length).toBe(afterPresentation);
        await expect(page.locator('iframe')).toHaveCount(2, 'Procedural advice leaves the current reports alone');
        await expect(focused.locator('.ai-conclusion-summary')).toHaveText(trial.turns[1].conclusion.summary);
        await page.getByRole('tab', { name: 'Overview', exact: true }).click();
        await expect(original.locator('.ai-conclusion')).toHaveCount(0, 'An earlier evidence-only view is not claimed to be updated by chat');
        await page.getByRole('tab', { name: 'main · Snapshot 1', exact: true }).click();
        await page.evaluate(async () => { const response = await fetch('/restart', { method: 'POST' }); if (!response.ok) throw new Error('Restart failed'); });
        await focused.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true }).click();
        await expect(focused.locator('.ai-conclusion-summary')).toHaveText(trial.turns[0].conclusion.summary);
        await focused.getByRole('button', { name: language === 'sv' ? 'Granska tråd: worker-2' : 'Inspect thread: worker-2', exact: true }).click();
        await expect(focused.locator('.ai-conclusion')).toHaveCount(0);
        await expect(focused.locator('.thread-focus-card h2')).toHaveText('worker-2');
        await focused.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true }).click();
        await expect(focused.locator('.ai-conclusion-summary')).toHaveText(trial.turns[0].conclusion.summary);
    });
}

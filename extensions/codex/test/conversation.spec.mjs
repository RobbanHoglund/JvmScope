import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startHost } from './ui-host.mjs';
let host;
test.beforeAll(async () => { test.setTimeout(120_000); host = await startHost({ conclusionOnly: true }); });
test.afterAll(async () => host?.close());

for (const language of ['sv', 'en']) {
    test(`recorded ${language} conversation keeps substantive chat answers and independent report panels`, async ({ page }) => {
        const trial = JSON.parse(await readFile(new URL(`./fixtures/conversation-${language}.json`, import.meta.url), 'utf8'));
        const theme = language === 'sv' ? 'dark' : 'light';
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.goto(host.url + '/conversation?theme=' + theme);
        for (const [index, turn] of trial.turns.entries()) {
            await page.evaluate(async ({ index, turn, language }) => {
                const initial = await (await fetch('/data?case=noFindings')).json();
                const snapshot = initial._meta.jvmscopeReport.snapshots.items[0];
                const main = snapshot.threadInventory.items.find(t => t.name === 'main');
                const args = { reportId: initial.structuredContent.reportId, snapshotIndex: snapshot.index, language, conclusion: turn.conclusion };
                if (index === 1) args.sourceKeys = [main.sourceKey];
                const result = await (await fetch('/tool', { method: 'POST', body: JSON.stringify({ name: turn.tool, arguments: args }) })).json();
                if (result.isError || !result.structuredContent.chatAnswer) throw new Error(JSON.stringify(result));
                window.chatMessage('user', turn.prompt);
                window.presentReport(result, index ? 'main · snapshot 1' : 'Thread analysis');
                // Actual independent model replies, not a generic report acknowledgment.
                window.chatMessage('assistant', turn.chatAnswer);
            }, { index, turn, language });
        }
        const first = page.frameLocator('iframe[title="Thread analysis"]'), focus = page.frameLocator('iframe[title="main · snapshot 1"]');
        await expect(page.locator('iframe')).toHaveCount(2);
        await expect(page.locator('.assistant')).toHaveCount(2);
        await expect(page.locator('.assistant').last()).toHaveText(trial.turns[1].chatAnswer);
        await expect(page.locator('.assistant').last()).toContainText('CompletableFuture.get');
        await expect(focus.locator('.ai-conclusion-summary')).toHaveText(trial.turns[1].conclusion.summary);
        await expect(focus.locator('.evidence')).toBeVisible();
        await expect(focus.locator('.evidence')).toContainText('StatusClient.java:152');
        await expect(focus.locator('.thread-rates')).toHaveCount(0);
        await expect(focus.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true })).toBeVisible();
        await expect(focus.getByRole('button', { name: language === 'sv' ? 'Visa kompakt vy' : 'Compact view', exact: true })).toBeVisible();
        expect(await focus.locator('.evidence').evaluate(n => n.getBoundingClientRect().top)).toBeLessThan(850);
        expect(await focus.locator('body').evaluate(b => b.scrollWidth > b.clientWidth + 1)).toBe(false);
        const previews = fileURLToPath(new URL('../../../build/codex-previews/', import.meta.url));
        await mkdir(previews, { recursive: true });
        await page.screenshot({ path: previews + `conversation-${language}-${theme}.png`, fullPage: true });
        // Returning to the older report must not show the follow-up's selected-thread assessment.
        await page.getByRole('tab', { name: 'Thread analysis', exact: true }).click();
        await expect(first.locator('.ai-conclusion-summary')).toHaveText(trial.turns[0].conclusion.summary);
        await expect(first.locator('.thread-inventory')).toBeVisible();
        await page.getByRole('tab', { name: 'main · snapshot 1', exact: true }).click();
        await focus.getByRole('button', { name: language === 'sv' ? 'Alla trådar · snapshot 1' : 'All threads · snapshot 1', exact: true }).click();
        await expect(focus.locator('.thread-inventory')).toBeVisible();
        await focus.getByRole('button', { name: language === 'sv' ? 'Granska tråd: main' : 'Inspect thread: main', exact: true }).click();
        await expect(focus.locator('.ai-conclusion-summary')).toHaveText(trial.turns[1].conclusion.summary);
        await expect(focus.locator('.evidence')).toBeVisible();
        await focus.getByRole('button', { name: language === 'sv' ? 'Visa kompakt vy' : 'Compact view', exact: true }).click();
        await expect(focus.locator('.compact-selection')).toHaveText('main');
        await expect(focus.locator('.ai-conclusion-summary')).toHaveText(trial.turns[1].conclusion.summary);
        await focus.locator('.open-analysis').click();
        await expect(focus.locator('.evidence')).toBeVisible();
        await page.getByRole('tab', { name: 'Thread analysis', exact: true }).click();
        await expect(first.locator('.ai-conclusion-summary')).toHaveText(trial.turns[0].conclusion.summary);
    });
}

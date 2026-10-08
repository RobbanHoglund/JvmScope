import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures.js';

const waiter = 'waiter<script>window.rawInjected=1</script>';
const source = `2026-10-02 12:00:00
Full thread dump OpenJDK 64-Bit Server VM (27+35 mixed mode, sharing):

"holder" #1 prio=5 os_prio=0 tid=0x00000001 nid=0x1 runnable
   java.lang.Thread.State: RUNNABLE
        at example.Holder.run(Holder.java:10)
        - locked <0x000000aa> (a java.lang.Object)

"${waiter}" #2 prio=5 os_prio=0 tid=0x00000002 nid=0x2 waiting for monitor entry
   java.lang.Thread.State: BLOCKED (on object monitor)
        at example.Waiter.run(Waiter.java:20)
        - waiting to lock <0x000000aa> (a java.lang.Object)`;

async function load(page, text = source) {
    await page.locator('#fileInput').setInputFiles({ name: 'raw-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await expect(page.locator('#openRawDumpBtn')).toBeEnabled();
}

async function openRaw(page) {
    const opened = page.waitForEvent('popup');
    await page.locator('#openRawDumpBtn').click();
    const raw = await opened;
    const errors = [];
    raw.on('pageerror', error => errors.push(error.message));
    raw.on('close', () => expect(errors, 'No unhandled raw-tab errors').toEqual([]));
    await expect(raw).toHaveTitle(/Raw dump evidence - Snapshot/);
    await expect(raw.locator('body')).toHaveClass(/raw-workspace-page/);
    return raw;
}

test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#sessionInputMode').selectOption('replace', { force: true });
    await load(page);
});

test('TDA raw evidence opens a reusable tab with exact text, copy, search and filters', async ({ page, context }) => {
    const raw = await openRaw(page);
    await expect(page.locator('#rawDumpDialog, #rawDumpFrame')).toHaveCount(0);
    expect(await raw.evaluate(() => window.opener)).toBeNull();
    expect(await raw.evaluate(() => document.compatMode)).toBe('CSS1Compat');
    await expect(raw.locator('script')).toHaveCount(0);
    expect(await raw.evaluate(() => window.rawInjected)).toBeUndefined();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(2);

    // The parent stays usable, and its table filter does not hide raw evidence.
    await page.locator('#onlyBlockedToggle').check();
    await expect(page.locator('#threadTableBody tr')).toHaveCount(1);
    await page.locator('#openRawDumpBtn').click();
    expect(context.pages()).toHaveLength(2);
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(2);
    await raw.getByRole('button', { name: 'Filter: BLOCKED threads', exact: true }).click();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(1);
    await raw.getByRole('button', { name: `Go to ${waiter}`, exact: true }).click();
    await expect(raw.locator('.raw-workspace-inspector')).toContainText('Lines 9–12');
    await raw.getByRole('searchbox', { name: 'Search raw dump evidence' }).fill('Waiter.java:20');
    await expect(raw.locator('.raw-workspace-match')).toHaveCount(1);
    await expect(raw.locator('.raw-workspace-match')).toBeVisible();
    const filteredPrint = await raw.evaluate(() => {
        window.dispatchEvent(new Event('beforeprint'));
        const text = document.querySelector('.raw-workspace-print-source').textContent;
        window.dispatchEvent(new Event('afterprint'));
        return text;
    });
    expect(filteredPrint).toContain('Waiter.java:20');
    expect(filteredPrint).not.toContain('Holder.java:10');
    await raw.getByRole('button', { name: 'Show the canonical raw dump', exact: true }).click();
    await expect(raw.locator('.raw-workspace-exact .raw-workspace-line')).toHaveCount(source.split('\n').length);
    await raw.getByRole('button', { name: 'Copy complete canonical raw dump', exact: true }).click();
    await expect(raw.getByRole('button', { name: 'Copy complete canonical raw dump', exact: true })).toHaveText('Copied');
    // The Windows system clipboard exposes CRLF even when writeText receives LF.
    const copied = await raw.evaluate(() => navigator.clipboard.readText());
    expect(copied.replaceAll('\r\n', '\n')).toBe(source);
    // A successful close can remove the target before the click protocol settles.
    await raw.getByRole('button', { name: 'Close raw dump evidence workspace', exact: true }).click().catch(error => {
        if (!raw.isClosed() || !error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    await expect.poll(() => raw.isClosed()).toBe(true);
    await expect(page.locator('#openRawDumpBtn')).toBeFocused();
});

test('TDA large raw captures build visible lines while searching, copying and printing the full source', async ({ page }) => {
    const lines = ['2026-10-07 12:00:00', 'Full thread dump OpenJDK 64-Bit Server VM (27+35 mixed mode, sharing):', ''];
    for (let index = 0; index < 300; index++) {
        lines.push(`"worker-${String(index).padStart(3, '0')}" #${index + 1} prio=5 os_prio=0 tid=0x${(index + 1).toString(16)} nid=0x${(index + 1).toString(16)} runnable`,
            '   java.lang.Thread.State: RUNNABLE');
        for (let frame = 0; frame < 24; frame++) lines.push(`        at example.Work.run(Work.java:${frame})`);
        if (index === 299) lines.push('        at example.UniqueTail.run(UniqueTail.java:9999)');
        lines.push('');
    }
    lines.pop(); // The snapshot's canonical source excludes trailing separator lines.
    const largeSource = lines.join('\n');
    await load(page, largeSource);
    const raw = await openRaw(page);
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(300);
    await expect(raw.locator('.raw-workspace-line')).toHaveCount(0);
    await raw.getByRole('button', { name: 'Expand worker-000', exact: true }).click();
    await expect(raw.locator('.raw-workspace-line').first()).toBeVisible();
    await raw.getByRole('button', { name: 'Collapse worker-000', exact: true }).click();
    await expect(raw.locator('.raw-workspace-line')).toHaveCount(0);

    const search = raw.getByRole('searchbox', { name: 'Search raw dump evidence' });
    await search.fill('UniqueTail.java:9999');
    await expect(raw.locator('.raw-workspace-match.is-active')).toBeVisible();
    await expect(raw.getByRole('button', { name: 'Collapse worker-299', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await raw.getByRole('button', { name: 'Show the canonical raw dump', exact: true }).click();
    await raw.getByRole('button', { name: 'Next search match', exact: true }).click();
    await expect(raw.locator('.raw-workspace-match.is-active')).toBeVisible();
    await expect.poll(() => raw.locator('.raw-workspace-line').count()).toBeLessThan(1000);

    await search.fill('example.Work.run');
    await expect(raw.locator('.raw-workspace-search-count')).toHaveText('1 / 7200');
    await raw.getByRole('button', { name: 'Previous search match', exact: true }).click();
    await expect(raw.locator('.raw-workspace-search-count')).toHaveText('7200 / 7200');
    await expect(raw.locator('.raw-workspace-match.is-active')).toBeVisible();
    await expect.poll(() => raw.locator('.raw-workspace-match').count()).toBeLessThan(502);
    await search.fill('');
    await expect(raw.locator('.raw-workspace-match')).toHaveCount(0);
    await raw.locator('.raw-workspace-evidence').evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(raw.locator(`.raw-workspace-line[data-line-number="${lines.length}"]`)).toBeVisible();

    await raw.getByRole('button', { name: 'Display settings', exact: true }).click();
    await raw.getByRole('checkbox', { name: 'Wrap long lines', exact: true }).check();
    await search.fill('UniqueTail.java:9999');
    await expect(raw.locator('.raw-workspace-match.is-active')).toBeVisible();
    await raw.getByRole('button', { name: 'Copy complete canonical raw dump', exact: true }).click();
    await expect(raw.getByRole('button', { name: 'Copy complete canonical raw dump', exact: true })).toHaveText('Copied');
    expect((await raw.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(largeSource);
    const printed = await raw.evaluate(() => {
        window.dispatchEvent(new Event('beforeprint'));
        const text = document.querySelector('.raw-workspace-print-source').textContent;
        window.dispatchEvent(new Event('afterprint'));
        return text;
    });
    expect(printed).toBe(largeSource);
    await expect(raw.locator('.raw-workspace-print-source')).toHaveCount(0);
    await raw.close();
});

test('TDA raw-tab details and thread/lock graph links return to the same evidence tab', async ({ page }) => {
    const raw = await openRaw(page);
    const details = raw.getByRole('button', { name: 'Open details for holder', exact: true });
    await details.click();
    await expect(page.locator('#threadModal')).toBeVisible();
    await expect(page.locator('#threadModalTitle')).toContainText('holder');
    await expect(page.locator('#threadModal .thread-details-sidebar')).toContainText('JVM ID #1');
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('example.Holder.run');
    await page.keyboard.press('Escape');
    await expect(details).toBeFocused();
    await raw.getByRole('button', { name: 'Reveal holder in dependency graph', exact: true }).click();
    await expect(page.locator('#dependencyGraphDetails')).toHaveAttribute('open', '');
    await expect(page.locator('#dependencyGraphInspector')).toContainText('holder');
    await page.locator('#rawDumpReturn').click();
    await expect(raw.getByRole('button', { name: 'Reveal holder in dependency graph', exact: true })).toBeFocused();
    await raw.getByRole('button', { name: 'Go to holder', exact: true }).click();
    await raw.locator('.raw-workspace-inspector').getByRole('button', { name: 'Inspect 0x000000aa', exact: true }).click();
    await raw.getByRole('button', { name: 'Reveal lock dependency neighborhood', exact: true }).click();
    await expect(page.locator('#dependencyGraphInspector')).toContainText('0x000000aa');
    await page.locator('#rawDumpReturn').click();
    await expect(raw.getByRole('button', { name: 'Reveal lock dependency neighborhood', exact: true })).toBeFocused();
    await raw.close();
    await expect(page.locator('#rawDumpReturn')).toBeHidden();
});

test('TDA raw tab can be closed natively and reopened with display preferences', async ({ page }) => {
    const first = await openRaw(page);
    await first.getByRole('button', { name: 'Show the canonical raw dump', exact: true }).click();
    await first.close();
    const second = await openRaw(page);
    await expect(second.getByRole('button', { name: 'Show the canonical raw dump', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await second.getByRole('searchbox', { name: 'Search raw dump evidence' }).fill('holder');
    await second.keyboard.press('Escape');
    await expect(second.getByRole('searchbox', { name: 'Search raw dump evidence' })).toHaveValue('');
    expect(second.isClosed()).toBe(false);
    // Closing on keydown can remove the target before Playwright sends keyup.
    await second.keyboard.press('Escape').catch(error => {
        if (!second.isClosed() || !error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    await expect.poll(() => second.isClosed()).toBe(true);
    const third = await openRaw(page);
    await expect(third.locator('.raw-workspace-exact')).toBeVisible();
});

test('TDA snapshot changes, replacement captures, Clear and parent reload invalidate raw tabs', async ({ page }) => {
    const samples = fileURLToPath(new URL('../../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url));
    await page.locator('#fileInput').setInputFiles(samples);
    await expect(page.locator('#dumpSelect option')).toHaveCount(3);
    const first = await openRaw(page);
    await page.locator('#nextDumpBtn').click();
    await expect.poll(() => first.isClosed()).toBe(true);
    const second = await openRaw(page);
    await expect(second).toHaveTitle('Raw dump evidence - Snapshot 2');
    await load(page);
    await expect.poll(() => second.isClosed()).toBe(true);
    const third = await openRaw(page);
    await page.locator('#clearBtn').click();
    await expect.poll(() => third.isClosed()).toBe(true);
    await expect(page.locator('#openRawDumpBtn')).toBeDisabled();
    await load(page);
    const fourth = await openRaw(page);
    await page.reload();
    await expect.poll(() => fourth.isClosed()).toBe(true);
});

test('TDA no longer owns a raw tab after the user navigates it to another origin', async ({ page }) => {
    const navigated = await openRaw(page);
    const destination = 'https://raw-tab-destination.test/';
    await navigated.route(destination, route => route.fulfill({
        contentType: 'text/html', body: '<!doctype html><title>New destination</title><h1>New destination</h1>',
    }));
    await navigated.goto(destination);
    await expect(navigated.getByRole('heading', { name: 'New destination', exact: true })).toBeVisible();
    const replacement = await openRaw(page);
    await page.locator('#clearBtn').click();
    await expect.poll(() => replacement.isClosed()).toBe(true);
    expect(navigated.isClosed()).toBe(false);
    await expect(navigated).toHaveURL(destination);
});

test('TDA blocked raw tabs show recovery guidance without replacing parse diagnostics', async ({ page }) => {
    const diagnostics = await page.locator('#errorState').textContent();
    await page.evaluate(() => { window.savedOpen = window.open; window.open = () => null; });
    await page.locator('#openRawDumpBtn').click();
    await expect(page.locator('#rawDumpStatus')).toContainText('Allow this site to open a new tab');
    await expect(page.locator('#errorState')).toHaveText(diagnostics);
    await page.evaluate(() => { window.open = window.savedOpen; delete window.savedOpen; });
    const raw = await openRaw(page);
    await expect(page.locator('#rawDumpStatus')).toBeHidden();
    await expect(raw.locator('.raw-workspace-thread-block')).toHaveCount(2);
});

test('TDA pending clipboard writes settle safely after raw-tab close or navigation', async ({ page, appUrl }) => {
    for (const action of ['close', 'navigate']) {
        await page.evaluate(() => {
            const open = window.open;
            window.open = (...args) => {
                const tab = open(...args);
                tab.navigator.clipboard.writeText = () => new Promise(resolve => { window.finishRawCopy = resolve; });
                window.open = open;
                return tab;
            };
        });
        const raw = await openRaw(page);
        await raw.getByRole('button', { name: 'Copy complete canonical raw dump', exact: true }).click();
        if (action === 'close') await raw.close();
        else await raw.goto(`${appUrl}/jvmscope/tls.html`);
        await page.evaluate(async () => {
            window.finishRawCopy();
            delete window.finishRawCopy;
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        await expect(page.locator('#openRawDumpBtn')).toBeEnabled();
    }
});

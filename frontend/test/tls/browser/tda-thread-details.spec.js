import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { parseThreadDump } from '../../../assets/javautils/tda/parser.js';

const threadBlock = [
    '"review-worker" #7 [77] daemon prio=5 os_prio=0 cpu=12.50ms elapsed=10.00s tid=0x00000007 nid=77 waiting for monitor entry',
    '   java.lang.Thread.State: BLOCKED (on object monitor)',
    '        at java.base@27/java.lang.Object.wait0(Native Method)',
    '        at org.springframework.web.Handler.dispatch(Handler.java:12)',
    ...Array.from({ length: 90 }, (_, index) => `        at example.service.component.with.a.long.namespace.OrderService.processRequestWithDetailedArguments(example.module@27/OrderServiceWithALongName.java:${index + 1})`),
    '        - waiting to lock <0x000000aa> (a java.lang.Object)',
    '        - locked <0x000000bb> (a java.lang.Object)',
].join('\n');

async function loadText(page, text) {
    await page.locator('#fileInput').setInputFiles({ name: 'thread-details.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#loadingState')).not.toBeVisible();
}

async function openDetails(page, name = 'review-worker') {
    const row = page.locator('#threadTableBody tr').filter({ hasText: name });
    await row.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#threadModal')).toBeVisible();
}

test.beforeEach(async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/tda.html`);
    await page.locator('#sessionInputMode').selectOption('replace', { force: true });
    await loadText(page, `Full thread dump OpenJDK 64-Bit Server VM (27+35 mixed mode, sharing):\n\n${threadBlock}`);
});

test('TDA thread details keep facts on the left and the complete raw dump visible beside every tab', async ({ page }) => {
    await openDetails(page);
    const sidebar = page.locator('#threadModal .thread-details-sidebar');
    const evidence = page.locator('#threadModal .thread-details-evidence');
    const code = evidence.locator('pre');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('#threadModalSummary')).toContainText('JVM ID #7');
    await expect(sidebar.getByRole('heading', { name: 'Core facts', exact: true })).toBeVisible();
    await expect(evidence.getByRole('heading', { name: 'Thread dump', exact: true })).toBeVisible();
    expect(await code.textContent()).toBe(threadBlock);
    const left = await sidebar.boundingBox();
    const center = await evidence.boundingBox();
    expect(center.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
    expect(Math.abs(left.y - center.y)).toBeLessThan(1);
    expect(left.width).toBeGreaterThanOrEqual(320);
    expect(center.width).toBeGreaterThan(650);
    expect(center.x + center.width).toBeLessThanOrEqual(page.viewportSize().width);
    await expect(page.getByRole('tab', { name: 'Stack trace', exact: true })).toHaveCount(0);
    for (const name of ['Overview', 'Locks', 'History']) {
        await sidebar.getByRole('tab', { name, exact: true }).click();
        await expect(sidebar.getByRole('tabpanel')).toHaveCount(1);
        await expect(code).toBeVisible();
        expect(await code.textContent()).toBe(threadBlock);
    }
    await sidebar.getByRole('tab', { name: 'Locks', exact: true }).click();
    await expect(sidebar).toContainText('0x000000aa');
    await expect(sidebar).toContainText('0x000000bb');
    await page.locator('#threadModalCopyBtn').click();
    await expect(page.locator('#threadModalCopyBtn')).toHaveText('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.replaceAll('\r\n', '\n')).toBe(threadBlock);
    await page.keyboard.press('Escape');
    await expect(page.locator('#threadModal')).not.toBeVisible();
    await expect(page.locator('#threadTableBody .details-btn').first()).toBeFocused();
});

test('TDA left details and central dump scroll independently and preserve raw scroll across tab changes', async ({ page }) => {
    await openDetails(page);
    const raw = page.locator('#threadModal .thread-details-code');
    const panel = page.getByRole('tabpanel', { name: 'Overview', exact: true });
    await raw.evaluate(node => { node.scrollTop = 500; node.scrollLeft = 160; });
    const before = await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }));
    expect(before.x).toBeGreaterThan(0);
    expect(before.y).toBeGreaterThan(0);
    expect(await panel.evaluate(node => node.scrollTop)).toBe(0);
    await panel.evaluate(node => { node.scrollTop = 200; });
    expect(await panel.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(before);
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Locks', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel', { name: 'Locks', exact: true })).toBeVisible();
    expect(await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(before);
    const dialog = await page.locator('#threadModal').boundingBox();
    expect(dialog.y).toBeGreaterThanOrEqual(0);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(await page.locator('#threadModal').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    await page.locator('#threadOriginalView').click();
    await raw.evaluate(node => { node.scrollTop = 900; node.scrollLeft = 80; });
    const originalPosition = await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }));
    await page.locator('#threadStackView').click();
    expect(await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(before);
    await page.locator('#threadOriginalView').click();
    expect(await raw.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual(originalPosition);
});

test('TDA actual Java 27 JSON opens a colored readable stack while Original JSON and copying retain source', async ({ page }) => {
    const source = readFileSync(new URL('../../tda/fixtures/runtime/jdk27-mounted-virtual.json', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const thread = parseThreadDump(source).find(item => item.threadName === 'sample-virtual-mounted');
    const original = source.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n');
    await loadText(page, source);
    await openDetails(page, thread.threadName);
    const code = page.locator('#threadStackCode');
    const search = page.locator('#threadStackSearch');
    const colors = page.locator('#threadStackColors');
    const stackButton = page.getByRole('button', { name: 'Stack', exact: true });
    const originalButton = page.getByRole('button', { name: 'Original JSON', exact: true });
    await expect(stackButton).toHaveAttribute('aria-pressed', 'true');
    await expect(originalButton).toHaveAttribute('aria-pressed', 'false');
    await expect(code).toContainText('"sample-virtual-mounted" #30 virtual');
    await expect(code).toContainText('java.lang.Thread.State: RUNNABLE');
    await expect(code).not.toContainText('"stack":');
    await expect(code.locator('.is-frame')).toHaveCount(3);
    await expect(code.locator('.is-jvm')).toHaveCount(2);
    await expect(code.locator('.is-other')).toHaveCount(1);
    const colorOf = node => getComputedStyle(node).color;
    expect(await code.locator('.is-jvm').first().evaluate(colorOf)).not.toBe(await code.locator('.is-other').evaluate(colorOf));
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU total' })).toHaveText('CPU total —');
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('Control+f');
    await expect(search).toBeFocused();
    await search.fill('"carrier"');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('No matches');
    await originalButton.focus();
    await originalButton.press('Space');
    await expect(originalButton).toHaveAttribute('aria-pressed', 'true');
    await expect(code).toHaveAttribute('aria-label', 'Original JSON thread dump');
    expect(await code.textContent()).toBe(original);
    await expect(search).toHaveValue('"carrier"');
    await expect(search).toHaveAttribute('aria-label', 'Search original json');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 1 matches');
    await expect(code.locator('.is-jvm, .is-other, .is-frame, .is-header')).toHaveCount(0);
    await expect(colors).toBeDisabled();
    await expect(page.locator('.thread-stack-legend')).not.toBeVisible();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    expect(await code.textContent()).toBe(original);
    await expect(originalButton).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#threadModalCopyBtn').click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(original);
    await stackButton.click();
    await expect(search).toHaveValue('"carrier"');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('No matches');
    await expect(colors).toBeEnabled();
    await expect(colors).toBeChecked();
    await expect(page.locator('.thread-stack-legend')).toBeVisible();
    await page.locator('#threadModalCopyBtn').click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(original);
    await page.locator('#threadModalClose2').click();
    await openDetails(page, 'ForkJoinPool-1-worker-1');
    await expect(search).toHaveValue('');
    await expect(stackButton).toHaveAttribute('aria-pressed', 'true');
    await expect(code).not.toContainText('"sample-virtual-mounted"');
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('Control+f');
    await expect(search).toBeFocused();
});

test('TDA actual Java 21 plain file dump has a readable colored stack and an exact whitespace-preserving Original', async ({ page }) => {
    const source = readFileSync(new URL('../../tda/fixtures/runtime/jdk21-dump-to-file.txt', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const [thread] = parseThreadDump(source);
    const original = source.split('\n').slice(thread.rawStartLine - 1, thread.rawEndLine).join('\n');
    await loadText(page, source);
    await openDetails(page, 'sample-owner');
    const code = page.locator('#threadStackCode');
    await expect(code).toContainText('"sample-owner" #22');
    await expect(code).toContainText('    at java.base/java.lang.Thread.sleep0(Native Method)');
    await expect(code.locator('.is-jvm')).toHaveCount(3);
    await expect(code).not.toContainText('java.lang.Thread.State:');
    await expect(code).not.toContainText('cpu=');
    await page.locator('#threadOriginalView').click();
    await expect(page.locator('#threadOriginalView')).toHaveText('Original');
    expect(await code.textContent()).toBe(original);
    expect(original).toMatch(/^#22 "sample-owner"\n {6}java\.base/);
    expect(original.endsWith('\n')).toBe(true);
    await page.locator('#threadModalCopyBtn').click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(original);
    await expect(page.locator('#threadStackColors')).toBeDisabled();
    await page.locator('#threadStackView').click();
    await expect(code).toContainText('    at FormatRegressionSample.reenter');
    await expect(page.locator('#threadStackColors')).toBeEnabled();
});

test('TDA minified JSON with hostile evidence stays inert and retains its exact ID and Original in both views', async ({ page }) => {
    const name = ' <img src=x onerror=alert(1)> "hostile-json" ';
    const source = JSON.stringify({ threadDump: { threadContainers: [{ threads: [{
        tid: '9007199254740993', name, stack: ['example.<script>alert(1)</script>.run(Unknown Source)'],
    }] }] } });
    await loadText(page, source);
    await openDetails(page, 'hostile-json');
    const code = page.locator('#threadStackCode');
    expect((await code.textContent()).split('\n')[0]).toBe(`${JSON.stringify(name)} #9007199254740993`);
    await expect(code).not.toContainText('java.lang.Thread.State:');
    await page.locator('#threadStackSearch').fill('<script>');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 1 matches');
    await expect(page.locator('#threadModal script, #threadModal img, #threadModal iframe')).toHaveCount(0);
    await page.locator('#threadOriginalView').click();
    expect(await code.textContent()).toBe(source);
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 1 matches');
    await expect(page.locator('#threadModal script, #threadModal img, #threadModal iframe')).toHaveCount(0);
    await page.locator('#threadModalCopyBtn').click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(source);
});

test('TDA thread selection replaces both panels and literal untrusted text stays inert', async ({ page }) => {
    await openDetails(page);
    await page.keyboard.press('Escape');
    const fixture = fileURLToPath(new URL('../../tda/fixtures/malicious-html-content.txt', import.meta.url));
    await page.locator('#fileInput').setInputFiles(fixture);
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await page.locator('#threadTableBody .thread-cell-name').first().click();
    await expect(page.locator('#threadModalTitle')).toContainText('<img src=x');
    await expect(page.locator('#threadModal .thread-details-code')).toContainText("<script>alert('stack')</script>");
    await expect(page.locator('#threadModal .thread-details-code')).not.toContainText('review-worker');
    await expect(page.locator('#threadModal script, #threadModal img, #threadModal iframe')).toHaveCount(0);
    await page.locator('#threadStackSearch').fill('<script>');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 1 matches');
    await expect(page.locator('#threadModal script, #threadModal img, #threadModal iframe')).toHaveCount(0);
    await expect(page.locator('#threadModalSummary')).toContainText('JVM ID #66');
    await page.getByRole('tab', { name: 'Locks', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Locks', exact: true })).toContainText('<img src=x');
});

test('TDA stack colors and search preserve exact evidence, support keyboard navigation and reset for a new thread', async ({ page }) => {
    await openDetails(page);
    const code = page.locator('#threadModal .thread-details-code');
    const colors = page.locator('#threadStackColors');
    const jvm = code.locator('.is-jvm').first();
    const app = code.locator('.is-other').first();
    const colorOf = node => getComputedStyle(node).color;
    expect(await jvm.evaluate(colorOf)).not.toBe(await app.evaluate(colorOf));
    await colors.uncheck();
    expect(await jvm.evaluate(colorOf)).toBe(await app.evaluate(colorOf));
    await colors.check();
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('Control+f');
    const search = page.getByRole('searchbox', { name: 'Search this stack' });
    await expect(search).toBeFocused();
    await search.fill('OrderService.processRequest');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 90 matches');
    expect(await code.textContent()).toBe(threadBlock);
    await search.press('Enter');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('2 / 90 matches');
    await search.press('Shift+Enter');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('1 / 90 matches');
    await page.locator('#threadStackPrevious').click();
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('90 / 90 matches');
    await expect(code.locator('.thread-stack-match.is-current')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Locks', exact: true }).click();
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('90 / 90 matches');
    await page.locator('#threadModalCopyBtn').click();
    expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(threadBlock);
    await search.fill('not-in-this-stack');
    await expect(page.locator('#threadStackSearchStatus')).toHaveText('No matches');
    await expect(page.locator('#threadStackNext')).toBeDisabled();
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(page.locator('#threadModal')).toBeVisible();
    await search.press('Escape');
    await expect(page.locator('#threadModal')).not.toBeVisible();
    await openDetails(page);
    await expect(search).toHaveValue('');
    await expect(colors).toBeChecked();
    expect(await code.textContent()).toBe(threadBlock);
});

test('TDA details identify independent snapshot sources and qualify rounded CPU deltas', async ({ page }) => {
    const dump = (time, cpu, elapsed) => `${time}\nFull thread dump OpenJDK 64-Bit Server VM (27 mixed mode):\n\n"io-worker" #7 prio=5 os_prio=0 cpu=${cpu}ms elapsed=${elapsed}s tid=0x00000007 nid=7 runnable\n   java.lang.Thread.State: RUNNABLE\n        at sun.nio.ch.Net.poll(Native Method)\n        at org.postgresql.PGStream.receive(PGStream.java:7)`;
    await loadText(page, dump('2026-10-03 12:00:01', 1784.47, 1951.29));
    await page.locator('#sessionInputMode').selectOption('append');
    await page.locator('#fileInput').setInputFiles({ name: '<second>.txt', mimeType: 'text/plain', buffer: Buffer.from(dump('2026-10-03 12:00:11', 1848.15, 1961.29)) });
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await openDetails(page, 'io-worker');
    await expect(page.locator('#threadModalContext')).toContainText('Snapshot 2 of 2');
    await expect(page.locator('#threadModalContext')).toContainText('12:00:11');
    await expect(page.locator('#threadModalContext')).toContainText('Source: <second>.txt');
    await expect(page.locator('#threadModal script, #threadModal img')).toHaveCount(0);
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU delta' })).toHaveText('CPU delta 63.68 ms');
    await expect(page.locator('.thread-details-comparison')).toContainText('Snapshot 1 → 2');
    await expect(page.locator('.thread-details-comparison')).toContainText('10.00 s · Thread elapsed counters');
    await expect(page.locator('.thread-details-comparison')).toContainText('±10 ms');
    await expect(page.getByRole('tabpanel', { name: 'Overview', exact: true })).toContainText('No diagnostic rule matched');
    await expect(page.getByRole('tabpanel', { name: 'Overview', exact: true })).toContainText('does not establish that the thread is problem-free');
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'Locks held' })).toHaveCount(0);
});

test('TDA JSON missing counters and class-initialization details remain available beside the dump', async ({ page }) => {
    const fixture = name => fileURLToPath(new URL(`../../tda/fixtures/${name}`, import.meta.url));
    await page.locator('#fileInput').setInputFiles(fixture('runtime/jdk27-dump-to-file.json'));
    await expect(page.locator('#loadingState')).not.toBeVisible();
    await openDetails(page, 'sample-sync-waiter');
    await expect(page.locator('#threadModal .thread-details-code')).toContainText('sample-sync-waiter');
    await expect(page.locator('.thread-details-fact').filter({ hasText: 'CPU total' })).toContainText('—');
    await page.getByRole('tab', { name: 'Locks', exact: true }).click();
    await expect(page.getByRole('tabpanel', { name: 'Locks', exact: true })).toContainText('Reported owner: #');
    await expect(page.locator('#threadModal .thread-details-code')).toBeVisible();
    await page.keyboard.press('Escape');
    const classInit = readFileSync(fixture('class-initialization-stall.txt'), 'utf8').replaceAll(
        'example.MapMetadataHandler',
        'example.an.application.namespace.with.a.long.package.path.MetadataInitializationHandler',
    );
    await loadText(page, classInit);
    await page.locator('#threadTableBody .details-btn').first().click();
    await expect(page.locator('#threadModal .class-initialization-details-card')).toBeAttached();
    const information = page.getByRole('tabpanel', { name: 'Overview', exact: true });
    expect(await information.evaluate(node => node.scrollWidth - node.clientWidth), 'Long class names wrap within the information panel').toBeLessThanOrEqual(1);
    await expect(page.locator('#threadModal .thread-details-code')).toBeVisible();
    await page.locator('#threadModalClose2').click();
    await expect(page.locator('#threadModal')).not.toBeVisible();
});

test('TDA thread rows open Details from cells, badges and empty space with mouse and keyboard', async ({ page }) => {
    const row = page.locator('#threadTableBody tr').first();
    await expect(row).toHaveAttribute('aria-label', 'Open details for review-worker');
    expect(await row.evaluate(node => getComputedStyle(node).cursor)).toBe('pointer');
    for (const target of [row.locator('.thread-cell-name'), row.locator('.tda-state-badge'), row.locator('.badge-locks'), row.locator('td').nth(8)]) {
        await target.click();
        await expect(page.locator('#threadModalTitle')).toHaveText('review-worker');
        expect(await page.locator('#threadModal .thread-details-code').textContent()).toBe(threadBlock);
        await page.keyboard.press('Escape');
        await expect(row).toBeFocused();
    }
    await row.locator('td').nth(1).click({ position: { x: 2, y: 2 } });
    await expect(page.locator('#threadModal')).toBeVisible();
    await page.keyboard.press('Escape');
    const button = row.getByRole('button', { name: 'Details', exact: true });
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(row).toBeFocused();
    for (const key of ['Enter', 'Space']) {
        await page.keyboard.press(key);
        await expect(page.locator('#threadModalTitle')).toHaveText('review-worker');
        await page.keyboard.press('Escape');
        await expect(row).toBeFocused();
        expect(await row.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    }
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#threadModal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await row.locator('.thread-cell-name').click({ modifiers: ['Shift'] });
    await expect(page.locator('#threadModal')).not.toBeVisible();
    await button.click({ modifiers: ['Shift'] });
    await expect(page.locator('#threadModalTitle')).toHaveText('review-worker');
});

test('TDA thread row text can be selected without opening Details', async ({ page }) => {
    const name = page.locator('#threadTableBody .thread-cell-name').first();
    const bounds = await name.boundingBox();
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection().toString())).toContain('review-worker');
    await expect(page.locator('#threadModal')).not.toBeVisible();
    // Explicit Details remains available even while text is selected.
    await page.locator('#threadTableBody .details-btn').first().click();
    await expect(page.locator('#threadModalTitle')).toHaveText('review-worker');
});

test('TDA row activation follows exact thread identity after paging, sorting, filtering and snapshot changes', async ({ page }) => {
    const snapshots = [1, 2].map(snapshot => {
        const blocks = Array.from({ length: 55 }, (_, index) => {
            const id = index + 1;
            const name = id === 2 || id === 54 ? 'same-name' : `worker-${String(id).padStart(2, '0')}`;
            return [
                `"${name}" #${id} [${id}] prio=5 os_prio=0 cpu=${id * snapshot}.00ms elapsed=10.00s tid=0x${id.toString(16)} nid=${id} waiting on condition`,
                `   java.lang.Thread.State: ${id % 2 ? 'WAITING (parking)' : 'BLOCKED (on object monitor)'}`,
                `        at example.Snapshot${snapshot}.run(Worker.java:${id})`,
            ].join('\n');
        });
        return `2026-10-02 12:00:0${snapshot}\nFull thread dump OpenJDK 64-Bit Server VM (27+35 mixed mode, sharing):\n\n${blocks.join('\n\n')}`;
    });
    await loadText(page, snapshots.join('\n\n'));
    const rows = page.locator('#threadTableBody tr');
    await expect(page.locator('#dumpSelect option')).toHaveCount(2);
    const inspectRow = async (row, snapshot) => {
        const id = (await row.locator('td').nth(13).textContent()).trim();
        const name = await row.locator('.thread-cell-name').textContent();
        await row.locator('td').first().click();
        await expect(page.locator('#threadModalTitle')).toHaveText(name);
        await expect(page.locator('#threadModalSummary')).toContainText(`JVM ID #${id}`);
        await expect(page.locator('#threadModal .thread-details-code')).toContainText(`example.Snapshot${snapshot}.run(Worker.java:${id})`);
        await page.keyboard.press('Escape');
        await expect(row).toBeFocused();
    };
    await expect(rows).toHaveCount(50);
    await inspectRow(rows.filter({ has: page.locator('.thread-cell-name', { hasText: /^same-name$/ }) }), 1);
    await page.locator('#pager button[data-page="2"]').first().click();
    await expect(rows).toHaveCount(5);
    await inspectRow(rows.filter({ has: page.locator('.thread-cell-name', { hasText: /^same-name$/ }) }), 1);
    await page.locator('#threadTable th[data-key="threadName"]').click();
    await expect(rows).toHaveCount(50);
    await inspectRow(rows.first(), 1);
    await inspectRow(rows.nth(1), 1);
    await page.locator('#onlyBlockedToggle').check();
    await expect(rows).toHaveCount(27);
    await inspectRow(rows.last(), 1);
    await page.locator('#nextDumpBtn').click();
    await expect(page.locator('#dumpSelect')).toHaveValue('1');
    await inspectRow(rows.first(), 2);
    await page.locator('#clearBtn').click();
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#threadModal')).not.toBeVisible();
});

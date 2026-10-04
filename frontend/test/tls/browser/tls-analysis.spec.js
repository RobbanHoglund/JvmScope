import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { analyzeTlsLog } from '../../../assets/javautils/tls-parser.js';
import { buildComprehensiveTlsSampleLog } from '../../../assets/javautils/tls-sample.js';
import { createTlsFilters, prepareTlsAnalysis, selectTlsEntries } from '../../../assets/javautils/tls-analysis-model.js';

test.use({ timezoneId: 'Europe/Stockholm' });

const rows = page => page.locator('#tlsTableBody tr');
const row = (page, id) => page.locator(`#tlsTableBody tr[data-id="${id}"]`);
const sample = async page => {
    await page.getByRole('button', { name: 'Full sample', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
};
async function upload(page, text, name = 'analysis.log') {
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    await expect(page.locator('#fileName')).toHaveText(name);
}
async function period(page, start = '2026-08-31T08:01:08.05', end = '2026-08-31T08:01:08.09') {
    await page.locator('#tlsTimeFrom').fill(start);
    await page.locator('#tlsTimeTo').fill(end);
    await page.getByRole('button', { name: 'Apply period', exact: true }).click();
}

test('exact UTC periods include overlaps, preserve complete evidence and distinguish zoom from filtering', async ({ page }) => {
    await sample(page);
    const axis = await page.locator('#tlsTimelineAxis').innerText();
    const parsed = await page.locator('#lastUpdated').innerText();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
    await expect(page.locator('#tlsActiveFilters')).toBeEmpty();
    expect(await page.locator('#tlsTimelineAxis').innerText()).not.toBe(axis);
    await page.getByRole('button', { name: 'Full range', exact: true }).click();
    expect(await page.locator('#tlsTimelineAxis').innerText()).toBe(axis);
    await period(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(row(page, 18)).toBeVisible();
    await expect(row(page, 19)).toBeVisible();
    await expect(page.locator('#tlsSelectionSummary')).toHaveText('Selection: 1 success · 1 failure · 0 unknown');
    await expect(page.locator('#tlsTimelineNote')).toContainText('2 shown');
    await row(page, 18).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#tlsModalBody')).toContainText('08:01:08.200');
    await expect(page.locator('#tlsModalTitle')).toContainText('SUCCESS');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Zoom to selection', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#tlsTimelineAxis')).toContainText('08:01:08.050');
    await expect(page.locator('#tlsTimelineNote')).toContainText('2 shown · 0 starts in view');
    await page.getByRole('button', { name: 'Full range', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole('button', { name: 'Clear period', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
    await expect(page.locator('#lastUpdated')).toHaveText(parsed);
    await page.screenshot({ path: `../.run/tls-analysis/timeline-${test.info().project.name}.png` });
});

test('pointer selection and panning use the same period selector as keyboard inputs', async ({ page }) => {
    await sample(page);
    const box = await page.locator('#tlsTimeline').boundingBox();
    await page.mouse.move(box.x + box.width * .25, box.y + 45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .7, box.y + 45, { steps: 5 });
    await page.mouse.up();
    const start = Date.parse(`${await page.locator('#tlsTimeFrom').inputValue()}Z`);
    const end = Date.parse(`${await page.locator('#tlsTimeTo').inputValue()}Z`);
    const entries = prepareTlsAnalysis(analyzeTlsLog(buildComprehensiveTlsSampleLog()).interactions);
    const expected = selectTlsEntries(entries, { ...createTlsFilters(), range: { start, end } });
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(35);
    await expect(rows(page)).toHaveCount(expected.length);
    expect((await rows(page).evaluateAll(elements => elements.map(el => Number(el.dataset.id)))).sort((a,b) => a-b))
        .toEqual(expected.map(e => e.interaction.id).sort((a,b) => a-b));
    await page.getByRole('button', { name: 'Zoom to selection', exact: true }).click();
    const axis = await page.locator('#tlsTimelineAxis').innerText();
    await page.getByRole('button', { name: 'Earlier period', exact: true }).click();
    expect(await page.locator('#tlsTimelineAxis').innerText()).not.toBe(axis);
    await expect(rows(page)).toHaveCount(expected.length);
    await page.getByRole('button', { name: /Remove Period:/ }).click();
    await expect(rows(page)).toHaveCount(35);
});

test('searchable multi-host and SNI facets combine, preserve alternatives and remove individual chips', async ({ page }) => {
    await sample(page);
    await page.locator('#tlsHostFacet summary').click();
    await page.getByRole('searchbox', { name: 'Find host', exact: true }).fill('API.EXAMPLE');
    const hosts = page.locator('#tlsHostOptions');
    await expect(hosts.locator('label')).toHaveCount(1);
    await hosts.locator('input').check();
    await expect(rows(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tlsHostFacet summary')).toBeFocused();
    await page.locator('#tlsSniFacet summary').click();
    await page.getByRole('searchbox', { name: 'Find SNI', exact: true }).fill('not captured');
    await page.locator('#tlsSniOptions input').check();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#emptyState')).toContainText('No interactions match');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove SNI: Unknown / not captured', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.locator('#tlsHostFacet summary').click();
    await page.getByRole('searchbox', { name: 'Find host', exact: true }).fill('');
    await hosts.locator('label').filter({ hasText: 'Unknown / not captured' }).locator('input').check();
    await expect(rows(page)).toHaveCount(5);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Remove Host: api.example.com', exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
    await expect(page.locator('#tlsActiveFilters')).toBeEmpty();
});

test('table names and failure categories share selection counts and never count highlights as failures', async ({ page }) => {
    await sample(page);
    await row(page, 1).getByRole('button', { name: 'Filter host: api.example.com', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#tlsAnalysisCount')).toHaveText('2 / 35 selected');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.locator('#tlsFailureFacet summary').click();
    const group = page.locator('#tlsFailureGroups button[data-key="certificate_unknown"]');
    await group.click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#tlsSelectionSummary')).toHaveText('Selection: 0 success · 2 failure · 0 unknown');
    await expect(page.locator('#rowCount')).toHaveText('2 / 35 interactions');
    await expect(group).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#onlySuccessToggle').check();
    await expect(rows(page)).toHaveCount(0);
    await expect(group).toContainText('0');
    await page.getByRole('button', { name: 'Remove Outcome: success', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.locator('#tlsFailureFacet summary').click();
    await group.click();
    await expect(rows(page)).toHaveCount(35);
});

test('keeps timeline labels readable on wide desktops and prevents accidental control text selection', async ({ page }) => {
    await sample(page);
    for (const width of [1366, 1440, 2547]) {
        await page.setViewportSize({ width, height: 900 });
        const scale = page.locator('#tlsTimelineScale');
        await expect(scale).toHaveText('Up to 2 starts per interval');
        await expect(page.locator('#tlsTimeline text')).toHaveCount(0);
        const label = await scale.boundingBox(), chart = await page.locator('#tlsTimeline').boundingBox();
        expect(label.y + label.height).toBeLessThanOrEqual(chart.y);
        expect(label.x).toBeGreaterThanOrEqual(chart.x);
        expect(label.x + label.width).toBeLessThanOrEqual(chart.x + chart.width);
        expect(await scale.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13);
        for (const selector of ['.tls-header', '#tlsAnalysis', '#tableContainer']) {
            const bounds = await page.locator(selector).boundingBox();
            expect(bounds.x).toBeCloseTo(28, 0);
            expect(bounds.width).toBeCloseTo(width - 56, 0);
            expect(bounds.x + bounds.width).toBeCloseTo(width - 28, 0);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const selector of ['#tlsFailureFacet summary', '#tlsOverviewColumns', '.tls-table-heading h2']) {
        expect(await page.locator(selector).evaluate(element => getComputedStyle(element).userSelect)).toBe('none');
    }
    await page.screenshot({ path: '../.run/tls-polish/desktop-wide.png', fullPage: true });
});

test('searches failure categories without a crowded strip and keeps their menu open during keyboard selection', async ({ page }) => {
    await sample(page);
    await expect(page.locator('#tlsFailureGroups')).toBeHidden();
    await page.locator('#tlsFailureFacet summary').click();
    await page.getByRole('searchbox', { name: 'Find failure category', exact: true }).fill('CERTIFICATE UNKNOWN');
    const choices = page.locator('#tlsFailureGroups button');
    await expect(choices).toHaveCount(1);
    await choices.focus();
    await page.keyboard.press('Space');
    await expect(choices).toBeFocused();
    await expect(page.locator('#tlsFailureFacet')).toHaveAttribute('open', '');
    await expect(rows(page)).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('#tlsFailureGroups')).toBeHidden();
    await expect(page.locator('#tlsFailureFacet summary')).toBeFocused();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
    await page.locator('#tlsFailureFacet summary').click();
    await page.getByRole('searchbox', { name: 'Find failure category', exact: true }).fill('unmatched-category');
    await expect(page.locator('#tlsFailureGroups')).toContainText('No matching categories');
    await page.keyboard.press('Escape');
});

test('overview and all columns change presentation while preserving selection, ordering and complete details', async ({ page }) => {
    await sample(page);
    await period(page);
    const before = await rows(page).first().getAttribute('data-id');
    await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const headers = page.locator('#tlsTable thead th:visible');
    await expect(headers).toHaveCount(10);
    await expect(page.locator('th[data-key="certificateAuthoritiesText"]')).toBeHidden();
    await page.getByRole('button', { name: 'All columns', exact: true }).click();
    await expect(headers).toHaveCount(15);
    await expect(page.locator('th[data-key="certificateAuthoritiesText"]')).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toHaveAttribute('data-id', before);
    await expect(page.locator('#tlsActiveFilters')).toContainText('Period:');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(headers).toHaveCount(10);
    for (const key of ['startTs', 'durationMs', 'warnCount']) {
        const header = await page.locator(`th[data-key="${key}"]`).boundingBox();
        expect(header.x + header.width).toBeLessThanOrEqual(page.viewportSize().width - 28);
    }
    await row(page, 18).getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('#tlsModalBody')).toContainText('Certificate authorities');
    expect(await page.locator('#tlsModalBody .rawline').first().evaluate(element => getComputedStyle(element).userSelect)).not.toBe('none');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(rows(page)).toHaveCount(35);
    await page.screenshot({ path: `../.run/tls-polish/overview-${test.info().project.name}.png`, fullPage: true });
});

test('missing timestamps are explicit and selection state resets for the next capture and Clear', async ({ page }) => {
    await sample(page);
    await period(page);
    const legacy = readFileSync(new URL('../fixtures/runtime/jdk8u252-tlsv1.2-success-client.txt', import.meta.url), 'utf8');
    await upload(page, legacy, 'legacy.log');
    await expect(page.locator('#tlsActiveFilters')).toBeEmpty();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('#tlsTimelineEmpty')).toContainText('No reliable timestamps');
    await expect(page.locator('#tlsTimeApply')).toBeDisabled();
    await expect(page.locator('#tlsZoomIn')).toBeDisabled();
    await page.getByRole('button', { name: 'Without time: 1', exact: true }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('#tlsUntimed')).toHaveAttribute('aria-pressed', 'true');
    await sample(page);
    await expect(page.locator('#tlsActiveFilters')).toBeEmpty();
    await expect(page.locator('#tlsUntimed')).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.locator('#tlsAnalysis')).toBeHidden();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#tlsActiveFilters')).toBeEmpty();
    await expect(page.locator('#tlsTimeFrom')).toHaveValue('');
});

test('invalid ranges report errors without changing the selected period; analysis can collapse for more table space', async ({ page }) => {
    await sample(page);
    await period(page);
    await period(page, '2026-08-31T08:01:08.09', '2026-08-31T08:01:08.05');
    await expect(page.locator('#tlsTimeError')).toContainText('To must be later');
    await expect(rows(page)).toHaveCount(2);
    const before = await page.locator('#tlsTableScroll').boundingBox();
    await page.locator('#tlsAnalysis > summary').click();
    await expect(page.locator('#tlsTimeline')).not.toBeVisible();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Remove Period:/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    const after = await page.locator('#tlsTableScroll').boundingBox();
    expect(after.height).toBeGreaterThan(before.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('untrusted host names, filter labels and category evidence remain text', async ({ page }) => {
    const hostile = 'evil<img/src=x/onerror=window.__tlsInjected=1>.example';
    await upload(page, `javax.net.ssl|ERROR|01|worker|2026-09-08 12:00:00.000 UTC|TransportContext.java:1|Fatal (HANDSHAKE_FAILURE): peer host: ${hostile}`);
    await page.locator('#tlsHostFacet summary').click();
    await expect(page.locator('#tlsHostOptions')).toContainText(hostile.toLowerCase());
    await page.locator('#tlsHostOptions input').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tlsActiveFilters')).toContainText(hostile.toLowerCase());
    await expect(page.locator('#tlsAnalysis img, #tlsActiveFilters img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__tlsInjected)).toBeUndefined();
});

test('mixed valid and ambiguous clocks remain visible and UTC inputs work independently of the browser timezone', async ({ page }) => {
    const log = [
        'javax.net.ssl|ERROR|A|known|2026-09-08 12:00:00.000 GMT|TransportContext.java:1|Fatal (HANDSHAKE_FAILURE): timed',
        'javax.net.ssl|ERROR|B|unknown|2026-09-08 12:00:00.000 CST|TransportContext.java:1|Fatal (HANDSHAKE_FAILURE): ambiguous clock',
    ].join('\n');
    await upload(page, log);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('#tlsTimelineNote')).toContainText('2 shown · 1 starts in view · 1 without time');
    await period(page, '2026-09-08T12:00', '2026-09-08T12:00:01');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator('#tlsTimelineNote')).toContainText('1 without time (excluded from this period)');
    await page.getByRole('button', { name: 'Without time: 1', exact: true }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 2)).toBeVisible();
    await expect(page.locator('#tlsActiveFilters')).not.toContainText('Period:');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(rows(page)).toHaveCount(2);
});

test('unapplied UTC edits survive other filter changes and keyboard category toggles retain focus', async ({ page }) => {
    await sample(page);
    await period(page);
    await page.locator('#tlsTimeTo').fill('2026-08-31T08:01:09');
    await page.locator('#onlyFailuresToggle').check();
    await expect(page.locator('#tlsTimeTo')).toHaveValue('2026-08-31T08:01:09');
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Apply period', exact: true }).click();
    await expect(page.locator('#tlsActiveFilters')).toContainText('08:01:09.000');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.locator('#tlsFailureFacet summary').click();
    const category = page.locator('#tlsFailureGroups button[data-key="certificate_unknown"]');
    await category.focus();
    await page.keyboard.press('Space');
    await expect(category).toBeFocused();
    await expect(rows(page)).toHaveCount(2);
    await page.keyboard.press('Space');
    await expect(category).toBeFocused();
    await expect(rows(page)).toHaveCount(35);
});

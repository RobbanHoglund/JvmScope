import { test, expect } from './fixtures.js';

async function expectGuideControlsWithinViewport(dialog, page) {
    const viewport = page.viewportSize();
    for (const selector of ['.help-modal-dialog', '.modal-header', '.help-search-toolbar', '#howToUseModalClose', '.modal-footer button']) {
        const box = await dialog.locator(selector).boundingBox();
        expect(box, selector).not.toBeNull();
        expect(box.x, selector).toBeGreaterThanOrEqual(0);
        expect(box.y, selector).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
    }
    const body = await dialog.locator('.modal-body').boundingBox();
    const search = await dialog.locator('.help-search-toolbar').boundingBox();
    const footer = await dialog.locator('.modal-footer').boundingBox();
    expect(body.y).toBeGreaterThanOrEqual(search.y + search.height - 1);
    expect(body.y + body.height).toBeLessThanOrEqual(footer.y + 1);
}

for (const analyzer of ['tda', 'tls']) {
    test(`${analyzer.toUpperCase()} guide search filters complete topics, highlights text and preserves the capture`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        await page.locator('#loadSampleBtn').click();
        await expect(page.locator('#rowCount')).toHaveText(analyzer === 'tda' ? '1–50 of 67 threads' : '35 / 35 interactions');
        const captureName = await page.locator('#fileName').textContent();
        const rowCount = await page.locator('#rowCount').textContent();
        const requests = [];
        page.on('request', request => requests.push(request.url()));
        const help = page.getByRole('button', { name: 'Help', exact: true });
        await help.click();
        const dialog = page.locator('#howToUseModal');
        const input = dialog.getByRole('searchbox', { name: 'Search guide', exact: true });
        await expect(input).toBeVisible();
        await input.fill('   JaVa    27  ');
        await expect(dialog.locator('[data-help-search-empty]')).toBeHidden();
        await expect(dialog.locator('mark[data-help-match]').first()).toBeVisible();
        expect(await dialog.locator('.help-search-topic[hidden]').count()).toBeGreaterThan(0);
        const topic = analyzer === 'tda' ? dialog.locator('#guide-input-formats') : dialog.getByRole('heading', { name: 'Expected input and interpretation' });
        await expect(topic).toBeVisible();
        if (analyzer === 'tda') {
            await expect(dialog.locator('.docs-nav a[href="#guide-scenarios"]')).toBeHidden();
        }
        await dialog.locator('.docs-nav a[href="#guide-input-formats"]').click();
        await expect(input).toBeInViewport();
        await expectGuideControlsWithinViewport(dialog, page);
        await dialog.screenshot({ path: `../.run/help-search/${analyzer}-${test.info().project.name}.png` });
        // Literal special characters must not become regular expressions or HTML.
        await input.fill('<img src=x onerror=alert(1)> [.*]');
        await expect(dialog.locator('[data-help-search-empty]')).toBeVisible();
        await expect(dialog.locator('#guideSearchCount')).toHaveText(/0 of \d+ topics match/);
        await expect(dialog.locator('img[src="x"]')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
        await expect(input).toBeFocused();
        await expect(input).toHaveValue('');
        await expect(dialog.locator('mark[data-help-match]')).toHaveCount(0);
        await expect(dialog.locator('.help-search-topic[hidden]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(help).toBeFocused();
        await expect(page.locator('#fileName')).toHaveText(captureName);
        await expect(page.locator('#rowCount')).toHaveText(rowCount);
        expect(requests).toEqual([]);
    });

    test(`${analyzer.toUpperCase()} guide search restores original content and starts fresh when reopened`, async ({ page, appUrl }) => {
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
        await page.locator('#howToUseBtn').press('Enter');
        const dialog = page.locator('#howToUseModal');
        const topics = dialog.locator('.help-search-topic, .help-quickstart');
        const original = await topics.allTextContents();
        const input = dialog.getByRole('searchbox', { name: 'Search guide', exact: true });
        for (const query of [analyzer === 'tda' ? 'deadlock' : 'certificate', '   ', 'no-such-guide-topic', 'java']) {
            await input.fill(query);
            expect(await topics.allTextContents()).toEqual(original);
        }
        await dialog.locator('#howToUseModalClose').click();
        await expect(page.locator('#howToUseBtn')).toBeFocused();
        await page.locator('#howToUseBtn').click();
        await expect(input).toHaveValue('');
        await expect(dialog.locator('[data-help-search-empty]')).toBeHidden();
        await expect(dialog.locator('mark[data-help-match]')).toHaveCount(0);
        expect(await topics.allTextContents()).toEqual(original);
        await expect(dialog.getByRole('button', { name: 'Clear search', exact: true })).toBeDisabled();
        const footer = dialog.locator('.modal-footer button');
        await expectGuideControlsWithinViewport(dialog, page);
        await footer.click();
        await expect(page.locator('#howToUseBtn')).toBeFocused();
    });

    test(`${analyzer.toUpperCase()} guide keeps controls visible on a short desktop and every topic reachable`, async ({ page, appUrl }) => {
        await page.setViewportSize({ width: 1280, height: 640 });
        await page.goto(`${appUrl}/jvmscope/${analyzer}.html?cpuProfile=sensitive`);
        await page.locator('#howToUseBtn').click();
        const dialog = page.locator('#howToUseModal');
        const url = page.url();
        const links = dialog.locator('.docs-nav a');
        expect(await links.count()).toBeGreaterThan(5);
        for (const link of await links.all()) {
            const href = await link.getAttribute('href');
            await link.click();
            await expect(dialog.locator(href)).toBeInViewport();
            await expectGuideControlsWithinViewport(dialog, page);
            expect(page.url()).toBe(url);
        }
        await dialog.locator('.docs-nav a[href="#guide-input-formats"]').click();
        const contrast = await dialog.locator('.docs-content a').evaluate(link => {
            const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
            const luminance = channels => channels.map(c => {
                const s = c / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            }).reduce((total, c, i) => total + c * [0.2126, 0.7152, 0.0722][i], 0);
            const foreground = luminance(rgb(getComputedStyle(link).color));
            const background = luminance(rgb(getComputedStyle(link.closest('.docs-card')).backgroundColor));
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        expect(await dialog.locator('.modal-body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
        const input = dialog.locator('[data-help-search]');
        await input.fill('no-such-guide-topic');
        await expect(dialog.locator('.docs-layout')).toBeHidden();
        await expectGuideControlsWithinViewport(dialog, page);
        await input.fill('');
        await expect.poll(() => dialog.locator('.docs-nav').evaluate(nav => nav.scrollTop)).toBe(0);
        await dialog.locator('.modal-body').evaluate(body => { body.scrollTop = 0; });
        await dialog.screenshot({ path: `../.run/help-search/${analyzer}-short-${test.info().project.name}.png` });
        await dialog.locator('.modal-footer button').click();
        await expect(dialog).toBeHidden();
        await expect(page.locator('#howToUseBtn')).toBeFocused();
    });
}

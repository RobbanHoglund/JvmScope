import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

for (const analyzer of ['tda', 'tls']) test(`${analyzer} keeps long capture names readable outside VS Code`, async ({ page, appUrl }) => {
    await page.goto(`${appUrl}/jvmscope/${analyzer}.html`);
    const name = `production-${'unbrokenfilename'.repeat(10)}.${analyzer === 'tda' ? 'json' : 'log'}`;
    const fixture = analyzer === 'tda' ? '../../tda/fixtures/runtime/jdk27-dump-to-file.json' : '../fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt';
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'text/plain', buffer: readFileSync(new URL(fixture, import.meta.url)) });
    await expect(page.locator('#fileName')).toHaveText(name);
    for (const width of [1920, 1366, 600, 420]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(await page.locator('#fileName').evaluate(el => {
            const box = el.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(el);
            return box.top >= document.querySelector('.header-top').getBoundingClientRect().bottom
                && [...range.getClientRects()].every(r => r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1)
                && box.right <= innerWidth;
        })).toBe(true);
    }
});

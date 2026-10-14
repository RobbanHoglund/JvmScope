import { defineConfig } from '../../../frontend/node_modules/@playwright/test/index.mjs';
export default defineConfig({
    testDir: '.', testMatch: 'browser.spec.mjs', timeout: 30_000, workers: 1, reporter: 'list',
    outputDir: '../../../.run/vscode-browser',
    use: { headless: true, viewport: { width: 1366, height: 768 }, screenshot: 'only-on-failure',
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] } : {} },
});

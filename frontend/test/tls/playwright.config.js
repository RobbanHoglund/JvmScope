import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    testDir: './browser',
    outputDir: fileURLToPath(new URL('../../../.run/tls-ui/', import.meta.url)),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 20_000,
    reporter: 'list',
    use: {
        browserName: 'chromium',
        headless: true,
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']} : {},
        permissions: ['clipboard-read', 'clipboard-write'],
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
        { name: 'laptop', use: { viewport: { width: 1366, height: 768 } } },
    ],
});

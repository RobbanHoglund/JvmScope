import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: '*.spec.mjs', workers: 1, timeout: 30000,
    outputDir: '../../../build/codex-ui-tests', reporter: 'list',
    use: { headless: true, viewport: { width: 1060, height: 1000 },
        launchOptions: process.env.JVMSCOPE_CHROMIUM ? { executablePath: process.env.JVMSCOPE_CHROMIUM } : {} } });

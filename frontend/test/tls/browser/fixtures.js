import { test as base, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { startSlimServer } from '../../../../scripts/slim/server-process.mjs';
import { startPagesServer } from '../../../../scripts/preview-pages.mjs';
import { pagesOutput, verifyPagesArtifact } from '../../../../scripts/build-pages.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const test = base.extend({
    appUrl: [async ({}, use, workerInfo) => {
        // Exercise the production bundle on an isolated loopback server. Never
        // reuse or stop the user's running app, or reserve its fixed ports.
        if (workerInfo.project.metadata.pages) {
            verifyPagesArtifact();
            const { base } = JSON.parse(readFileSync(resolve(pagesOutput, 'build-info.json'), 'utf8'));
            const server = await startPagesServer(pagesOutput, { base });
            try { await use(server.url + base.slice(0,-1)); } finally { await server.stop(); }
            return;
        }
        if (workerInfo.project.metadata.slim) {
            // Only the container GA harness sets this, for its own ephemeral
            // loopback Docker port. Never accept an external application URL.
            if (process.env.SLIM_TEST_CONTAINER_URL) {
                const url = new URL(process.env.SLIM_TEST_CONTAINER_URL);
                if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
                    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
                    throw new Error('Container tests require an isolated loopback HTTP origin');
                }
                await use(url.origin);
                return;
            }
            const slim = await startSlimServer({jarPath:process.env.SLIM_TEST_JAR || undefined});
            try { await use(slim.url); } finally { await slim.stop(); }
            return;
        }
        const server = await preview({
            root: fileURLToPath(new URL('../../../', import.meta.url)),
            logLevel: 'error',
            preview: { host: '127.0.0.1', port: 0, strictPort: true },
        });
        try {
            await use(`http://127.0.0.1:${server.httpServer.address().port}`);
        } finally { await server.close(); }
    }, { scope: 'worker' }],
    page: async ({ page, appUrl }, use) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${appUrl}/jvmscope/tls.html`);
        await expect(page.getByRole('button', { name: /Full sample/ })).toBeVisible();
        // Existing table contracts are exercised in their explicit table view.
        // Investigation tests switch back to the default linked workspace.
        // Choose the suite's preferred table mode before its first capture.
        // The actual controls remain hidden in the new start view.
        await page.locator('#tlsOverviewColumns').dispatchEvent('click');
        await use(page);
        expect(errors, 'No unhandled browser errors').toEqual([]);
    },
});

export { expect };

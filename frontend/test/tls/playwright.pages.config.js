import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';
import { fileURLToPath } from 'node:url';

// A focused static-hosting boundary suite; full preview/Java regressions remain
// in Analyzer release checks. Sources use the same fixture with a strict server.
export default defineConfig({
    ...config,
    outputDir: fileURLToPath(new URL('../../../.run/pages-browser-results/',import.meta.url)),
    testMatch: ['pages-hosting.spec.js','help-search.spec.js','example-library.spec.js','tda-session.spec.js',
        'tda-raw-tab.spec.js','tda-thread-details.spec.js','tls-investigation.spec.js','analysis-safety.spec.js'],
    grep: /Pages|guide|loads every named example|real CPU example|real virtual workers|files, Paste|raw evidence opens|raw-tab details|thread details keep|actual Java 27|events jump|linked investigation|real mutual TLS|unfinished boundary|coarse CPU|endpoint roles|elapsed regression/,
    projects: config.projects.map(project => ({ ...project, name:`pages-${project.name}`, metadata:{pages:true} })),
});

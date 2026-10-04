import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    ...config,
    outputDir: fileURLToPath(new URL('../../../.run/slim-browser-results/', import.meta.url)),
    projects: config.projects.map(project => ({ ...project, name: `slim-${project.name}`, metadata: { slim: true } })),
});

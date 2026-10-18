import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../frontend/node_modules/vite/dist/node/index.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const extension = resolve(root, 'extensions/vscode');
await build({ configFile: resolve(root, 'frontend/vite.config.js'), mode: 'vscode' });
for (const name of ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']) await copyFile(resolve(root, name), resolve(extension, name));
const pages = ['index.html', 'jvmscope/tda.html', 'jvmscope/tls.html', 'jvmscope/gc.html',
    ...(await readdir(resolve(extension, 'media/knowledge'))).filter(name => name.endsWith('.html')).map(name => `knowledge/${name}`)];
await writeFile(resolve(extension, 'media/pages.json'), JSON.stringify(pages, null, 2) + '\n');
await mkdir(resolve(root, 'build/vscode'), { recursive: true });
console.log('Built offline VS Code assets for all three analyzers and the knowledge base.');

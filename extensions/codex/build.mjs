import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const output = path.join(repo, 'build/codex-marketplace');
const plugin = path.join(output, 'plugins/jvmscope');
await rm(output, { recursive: true, force: true });
await cp(path.join(here, 'plugin'), plugin, { recursive: true });
await mkdir(path.join(plugin, 'assets'), { recursive: true });
await mkdir(path.join(plugin, 'samples'), { recursive: true });
await mkdir(path.join(output, '.agents/plugins'), { recursive: true });
await cp(path.join(repo, 'extensions/vscode/icon.png'), path.join(plugin, 'assets/icon.png'));
for (const name of ['LICENSE', 'NOTICE']) await cp(path.join(repo, name), path.join(plugin, name));
await cp(path.join(here, 'README.md'), path.join(output, 'README.md'));
const pkg = JSON.parse(await readFile(path.join(here, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error('Package and manifest versions differ.');
await writeFile(path.join(output, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'jvmscope-local',
    interface: { displayName: 'JvmScope Local Plugins' }, plugins: [{ name: 'jvmscope', source: { source: 'local', path: './plugins/jvmscope' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }] }, null, 2) + '\n');
const bundled = await build({ absWorkingDir: here, entryPoints: ['src/server.mjs', 'src/worker.mjs'], outdir: path.join(plugin, 'server'),
    bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, target: 'node22', metafile: true, legalComments: 'eof' });
const ui = await build({ absWorkingDir: here, entryPoints: ['ui/view.mjs'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
const template = await readFile(path.join(here, 'ui/thread-report.html'), 'utf8');
const css = await readFile(path.join(here, 'ui/style.css'), 'utf8');
await mkdir(path.join(plugin, 'ui'), { recursive: true });
await writeFile(path.join(plugin, 'ui/thread-report.html'), template.replace('/*__STYLE__*/', () => css).replace('/*__SCRIPT__*/', () => ui.outputFiles[0].text));
const samples = [
    ['threads', 'confirmed-deadlock.txt', 'frontend/assets/javautils/samples/tda-deadlock.txt', 'Synthetic regression: JVM-reported deadlock'],
    ['threads', 'repeated-contention.txt', 'frontend/test/tda/fixtures/repeated-contention.txt', 'Synthetic regression: two-snapshot contention'],
    ['threads', 'carrier-classic.txt', 'frontend/test/tda/fixtures/ga-regressions/carrier-classic.txt', 'Runtime capture: see repository ga-regressions provenance'],
    ['tls', 'java25-client-auth.txt', 'frontend/test/tls/fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt', 'Runtime capture: Java 25 SunJSSE required-client-auth failure'],
    ...['java8-parallel', 'java27-g1', 'java27-zgc', 'java27-serial', 'java27-parallel', 'java17-shenandoah', 'java8-cms'].map(name =>
        ['gc', `${name}.log`, `testdata/gc-logs/${name}.log`, 'Runtime capture: see bundled GC README and provenance']),
];
for (const [, file, source] of samples) await cp(path.join(repo, source), path.join(plugin, 'samples', file));
for (const name of ['README.md', 'java8-provenance.json', 'java17-provenance.json', 'java27-provenance.json'])
    await cp(path.join(repo, 'testdata/gc-logs', name), path.join(plugin, 'samples', name));
await writeFile(path.join(plugin, 'samples/index.json'), JSON.stringify(samples.map(([analyzer, file, source, provenance]) => ({ analyzer, file, source, provenance })), null, 2) + '\n');
// Include licenses only for dependencies actually present in the emitted bundles.
const names = new Set(Object.keys(bundled.metafile.inputs).filter(p => p.startsWith('node_modules/')).map(p => {
    const parts = p.slice('node_modules/'.length).split('/'); return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}));
let notices = '# Bundled dependency licenses\n\n';
for (const name of [...names].sort()) {
    const dir = path.join(here, 'node_modules', name);
    const dependency = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    let license;
    for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
        try { license = await readFile(path.join(dir, candidate), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!license) throw new Error(`Missing license for bundled dependency ${name}`);
    notices += `## ${name} ${dependency.version} (${dependency.license})\n\n${license}\n\n`;
}
await writeFile(path.join(plugin, 'THIRD-PARTY-NOTICES.md'), notices);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
await writeFile(path.join(plugin, 'build-info.json'), JSON.stringify({ version: manifest.version, revision,
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim(), node: process.version }, null, 2) + '\n');
console.log(`Built local marketplace: ${output}`);

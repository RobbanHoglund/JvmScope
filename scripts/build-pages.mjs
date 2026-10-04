import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { THREAD_EXAMPLES, TLS_EXAMPLES } from '../frontend/assets/javautils/example-catalog.js';
import { projectLegalAssets, verifyProjectLegal } from './project-legal.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const pagesOutput = resolve(root, 'build/pages');
export const defaultPagesBase = '/JvmScope/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const examples = [...THREAD_EXAMPLES, ...TLS_EXAMPLES];
const approvedExamples = () => new Set(examples.map(sample => sha256(readFileSync(new URL(sample.url)))));
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

export function validatePagesBase(base) {
    if (typeof base !== 'string' || !/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base)
        || base.split('/').some(part => part === '.' || part === '..')) {
        throw new Error('Pages base must be an absolute path with a trailing slash, e.g. /JvmScope/.');
    }
    return base;
}

// Vite clears its output directory. Refuse redirection to ANY other directory,
// including the live Java package or another build inside this checkout.
export function verifyOutputLocation(output = pagesOutput) {
    const project = realpathSync(root);
    if (resolve(output) !== pagesOutput) throw new Error('Pages output must be build/pages in this checkout.');
    let ancestor = output;
    while (!existsSync(ancestor)) ancestor = dirname(ancestor);
    if (realpathSync(ancestor) !== resolve(project, relative(root, ancestor))) {
        throw new Error('Pages output must not be redirected by directory links.');
    }
}

export function scanPagesArtifact(directory, { completed = false } = {}) {
    const allowed = new Set([
        'jvmscope/tda.html', 'jvmscope/tls.html',
        'assets/js/d3.min.js', 'assets/img/java-thread-mark.svg', 'assets/img/java-tls-mark.svg',
        'assets/legal/d3-LICENSE.txt', 'assets/legal/Apache-2.0.txt',
        ...Object.keys(projectLegalAssets),
        ...(completed ? ['index.html', '.nojekyll', 'THIRD-PARTY-NOTICES.md', 'build-info.json', 'manifest.json'] : []),
    ]);
    const approved = approvedExamples();
    const foundExamples = new Set();
    const files = [];
    function visit(folder) {
        for (const name of readdirSync(folder).sort()) {
            const full = resolve(folder, name), stat = lstatSync(full);
            if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) throw new Error('Links are not allowed in a Pages artifact.');
            if (stat.isDirectory()) { visit(full); continue; }
            if (!stat.isFile()) throw new Error('Only regular files are allowed in a Pages artifact.');
            const path = relative(directory, full).split(sep).join('/');
            const bytes = readFileSync(full), digest = sha256(bytes);
            const hashed = /^(?:assets\/(?:js|css)\/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.(?:js|css)|assets\/tls-analysis-worker-[A-Za-z0-9_-]{8}\.js)$/.test(path);
            const example = /^assets\/examples\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8}\.(?:txt|json)$/.test(path);
            if (example) {
                if (!approved.has(digest)) throw new Error(`Unapproved example in Pages artifact: ${path}`);
                foundExamples.add(digest);
            }
            if (!allowed.has(path) && !hashed && !example) throw new Error(`Unexpected file in Pages artifact: ${path}`);
            files.push({ path, bytes: bytes.length, sha256: digest });
        }
    }
    visit(directory);
    for (const path of allowed) if (!files.some(file => file.path === path)) throw new Error(`Missing Pages file: ${path}`);
    verifyProjectLegal(directory);
    if (!files.some(file => /^assets\/js\/worker-analysis-worker-/.test(file.path))
        || !files.some(file => /^assets\/tls-analysis-worker-/.test(file.path))) throw new Error('Both analysis workers must be packaged.');
    if (foundExamples.size !== approved.size) throw new Error('The Pages artifact must contain every approved example.');
    return files;
}

export function renderPagesIndex(base, revision) {
    validatePagesBase(base);
    const version = /^[a-f0-9]{40}$/.test(revision) ? revision.slice(0, 7) : 'local';
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="description" content="Investigate Java thread dumps and TLS logs locally in your browser.">
<title>JvmScope · Java thread dumps and TLS logs</title>
<link rel="icon" type="image/svg+xml" href="${base}assets/img/java-thread-mark.svg">
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0e1116;color:#e2edf7}
*{box-sizing:border-box}body{margin:0;padding:64px 48px}main{max-width:1040px;margin:0 auto}
.brand{font-weight:750;font-size:24px;letter-spacing:.2px;color:#88bff1}h1{font-size:42px;line-height:1.15;margin:36px 0 16px}
p{color:#a6bacf;line-height:1.7;max-width:760px}.tools{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:40px 0 28px}
.tool{color:inherit;text-decoration:none;padding:28px;border:1px solid #394551;border-radius:14px;background:#151a22}
.tool:hover{background:#1b2531;border-color:#88bff1}.tool:focus-visible{outline:3px solid #72e0d1;outline-offset:4px}
.tool img{width:48px;height:48px}.tool h2{font-size:22px;margin:20px 0 10px}.tool p{margin:0 0 22px}.open{color:#88bff1;font-weight:650}
.tls .open{color:#72e0d1}.privacy{color:#72e0d1;font-size:14px}footer{display:flex;justify-content:space-between;border-top:1px solid #293440;margin-top:48px;padding-top:20px;font-size:13px;color:#91a4b8}
footer a{color:#b5cfe8}footer a:focus-visible{outline:2px solid #72e0d1;outline-offset:4px}
</style></head><body><main>
<div class="brand">JvmScope</div><h1>Follow the evidence.</h1>
<p>Investigate Java thread dumps and TLS logs. Follow a handshake, explore blocked threads and compare what changed between JVM snapshots.</p>
<section class="tools" aria-label="Analysis tools">
<a class="tool" href="${base}jvmscope/tda.html"><img src="${base}assets/img/java-thread-mark.svg" alt=""><h2>Thread Dump Analyzer</h2><p>Compare snapshots, inspect stacks and explore thread dependencies, deadlocks and measured CPU activity.</p><span class="open">Open thread analyzer →</span></a>
<a class="tool tls" href="${base}jvmscope/tls.html"><img src="${base}assets/img/java-tls-mark.svg" alt=""><h2>TLS Log Analyzer</h2><p>Follow handshake messages, inspect certificates and narrow a capture by time, host or diagnostic evidence.</p><span class="open">Open TLS analyzer →</span></a>
</section><p class="privacy">Your files are analyzed locally in your browser. Nothing is uploaded. Both tools include examples to explore without a private capture.</p>
<footer><span>Version ${version}</span><a href="${base}assets/legal/JvmScope-LICENSE.txt">Apache-2.0 license</a><a href="${base}THIRD-PARTY-NOTICES.md">Third-party notices</a></footer>
</main></body></html>\n`;
}

function revision() {
    const supplied = process.env.GITHUB_SHA;
    if (supplied && /^[a-f0-9]{40}$/.test(supplied)) return supplied;
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export async function buildPages(base = defaultPagesBase) {
    validatePagesBase(base);
    verifyOutputLocation();
    const require = createRequire(resolve(root, 'frontend/package.json'));
    const { build } = await import(pathToFileURL(require.resolve('vite')).href);
    await build({ configFile: resolve(root, 'frontend/vite.config.js'), mode: 'pages', base });
    const files = scanPagesArtifact(pagesOutput);
    const commit = revision();
    writeFileSync(resolve(pagesOutput, 'index.html'), renderPagesIndex(base, commit));
    writeFileSync(resolve(pagesOutput, '.nojekyll'), '');
    writeFileSync(resolve(pagesOutput, 'THIRD-PARTY-NOTICES.md'), readFileSync(resolve(root, 'THIRD-PARTY-NOTICES.md')));
    writeFileSync(resolve(pagesOutput, 'build-info.json'), JSON.stringify({ revision: commit, base, target: 'pages' }, null, 2)+'\n');
    // A manifest describes payload files; excluding itself avoids a circular hash.
    for (const path of ['index.html', '.nojekyll', 'THIRD-PARTY-NOTICES.md', 'build-info.json']) {
        const bytes = readFileSync(resolve(pagesOutput, path));
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    }
    files.sort(byPath);
    writeFileSync(resolve(pagesOutput, 'manifest.json'), JSON.stringify({ revision: commit, base, files }, null, 2)+'\n');
    const completed = verifyPagesArtifact(pagesOutput);
    console.log(`Pages artifact verified: ${completed.length} files, ${completed.reduce((n, file) => n+file.bytes, 0)} bytes, base ${base}`);
}

export function verifyPagesArtifact(directory = pagesOutput) {
    const files = scanPagesArtifact(directory, { completed: true });
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const info = JSON.parse(readFileSync(resolve(directory, 'build-info.json'), 'utf8'));
    validatePagesBase(manifest.base);
    if (!/^[a-f0-9]{40}$/.test(manifest.revision) || info.revision !== manifest.revision
        || info.base !== manifest.base || info.target !== 'pages') throw new Error('Pages build metadata does not match.');
    const payload = files.filter(file => file.path !== 'manifest.json').sort(byPath);
    if (JSON.stringify(payload) !== JSON.stringify(manifest.files)) throw new Error('Pages manifest does not match the payload.');
    for (const name of ['index.html', 'jvmscope/tda.html', 'jvmscope/tls.html']) {
        const html = readFileSync(resolve(directory, name), 'utf8');
        for (const match of html.matchAll(/(?:href|src)\s*=\s*(['"])(.*?)\1/g)) {
            const url = match[2];
            if (url.startsWith('#') || url.startsWith('data:') || /^https:\/\//.test(url)) continue;
            if (!url.startsWith(manifest.base)) throw new Error(`URL outside Pages base in ${name}`);
            if (!files.some(file => file.path === url.slice(manifest.base.length))) throw new Error(`Missing linked asset in ${name}`);
        }
    }
    return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--check') {
        const files = verifyPagesArtifact();
        console.log(`Verified ${files.length} Pages files.`);
    } else {
        if (args.length && (args.length !== 2 || args[0] !== '--base')) throw new Error('Usage: node scripts/build-pages.mjs [--base /JvmScope/]');
        await buildPages(args[1] || defaultPagesBase);
    }
}

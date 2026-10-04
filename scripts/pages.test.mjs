import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { validatePagesBase, verifyOutputLocation, renderPagesIndex, scanPagesArtifact, verifyPagesArtifact, pagesOutput } from './build-pages.mjs';
import { startPagesServer } from './preview-pages.mjs';
import { THREAD_EXAMPLES, TLS_EXAMPLES } from '../frontend/assets/javautils/example-catalog.js';
import { projectLegalFiles, verifyProjectLegal } from './project-legal.mjs';

const commit = 'a'.repeat(40), base = '/JvmScope/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function temporary(t) {
    const dir = mkdtempSync(resolve(tmpdir(), 'jvmscope-pages-'));
    t.after(() => {
        assert.ok(dir.startsWith(resolve(tmpdir()) + sep) && dir.includes('jvmscope-pages-'));
        rmSync(dir, { recursive: true, force: true });
    });
    return dir;
}
function put(dir, path, content) {
    const target = resolve(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
}
function payload(t) {
    const dir = temporary(t);
    const html = `<html><a href="${base}jvmscope/tda.html">Threads</a><script src="${base}assets/js/worker-analysis-worker-12345678.js"></script></html>`;
    for (const path of ['jvmscope/tda.html','jvmscope/tls.html']) put(dir, path, html);
    for (const path of ['assets/js/d3.min.js','assets/img/java-thread-mark.svg','assets/img/java-tls-mark.svg',
        'assets/legal/d3-LICENSE.txt','assets/legal/Apache-2.0.txt',
        'assets/js/worker-analysis-worker-12345678.js','assets/tls-analysis-worker-12345678.js']) put(dir, path, 'fixture');
    for (const file of projectLegalFiles()) put(dir, file.fileName, file.source);
    [...THREAD_EXAMPLES,...TLS_EXAMPLES].forEach((example, i) =>
        put(dir, `assets/examples/sample-${i}-12345678.txt`, readFileSync(new URL(example.url))));
    return dir;
}
function complete(dir) {
    put(dir, 'index.html', renderPagesIndex(base, commit));
    put(dir, '.nojekyll', '');
    put(dir, 'THIRD-PARTY-NOTICES.md', 'fixture notices');
    put(dir, 'build-info.json', JSON.stringify({ base, revision:commit, target:'pages' }));
    put(dir, 'manifest.json', '{}');
    const files = scanPagesArtifact(dir, { completed:true }).filter(file => file.path !== 'manifest.json')
        .sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    put(dir, 'manifest.json', JSON.stringify({ base, revision:commit, files }));
}

test('Pages base accepts project/root paths and rejects ambiguous or injected prefixes', () => {
    for (const value of ['/',base,'/nested/JvmScope/']) assert.equal(validatePagesBase(value),value);
    for (const value of [null,undefined,42,'','JvmScope/','/JvmScope','//','/./','/../','/a/../b/',
        '/%2e/','/JvmScope/?x=1','https://example.com/','/a\\b/','/a"b/']) {
        assert.throws(() => validatePagesBase(value), /absolute path/);
    }
    assert.ok(renderPagesIndex(base, '<script>').includes('Version local'));
    assert.ok(!renderPagesIndex(base, '<script>').includes('<script>'));
});

test('Pages output cannot be changed to a live runtime or another build directory', () => {
    verifyOutputLocation();
    assert.throws(() => verifyOutputLocation(resolve(pagesOutput,'../frontend')), /build\/pages/);
    assert.throws(() => verifyOutputLocation(resolve(pagesOutput,'../../slim/build/package')), /build\/pages/);
});

test('Pages and Railway keep independent output paths and base-aware tool navigation', async () => {
    const { default:config, toolNavigation } = await import('../frontend/vite.config.js');
    const pages = config({mode:'pages'}), slim = config({mode:'slim'}), preview = config({mode:'production'});
    assert.deepEqual(Object.keys(pages.build.rollupOptions.input),['tda','tls']);
    assert.deepEqual(Object.keys(slim.build.rollupOptions.input),['tda','tls']);
    assert.deepEqual(Object.keys(preview.build.rollupOptions.input),['main','utils','tda','tls']);
    assert.notEqual(pages.build.outDir,slim.build.outDir);
    assert.notEqual(pages.build.outDir,preview.build.outDir);
    assert.equal(pages.build.outDir,pagesOutput);
    for (const prefix of ['/',base]) {
        const plugin = toolNavigation({slim:true});
        plugin.configResolved({base:prefix});
        const html = plugin.transformIndexHtml.handler('<head></head><body></body>',{filename:'tda.html'});
        assert.ok(html.includes(`href="${prefix}jvmscope/tda.html" aria-current="page"`));
        assert.ok(html.includes(`href="${prefix}jvmscope/tls.html"`));
        assert.ok(!html.includes('JvmScope home'));
    }
});

test('Pages publication accepts only approved examples and the complete two-worker bundle', t => {
    const dir = payload(t);
    assert.ok(scanPagesArtifact(dir).length > 35);
    complete(dir);
    assert.ok(verifyPagesArtifact(dir).length > 40);
    put(dir, 'assets/examples/private-12345678.txt','private content');
    assert.throws(() => verifyPagesArtifact(dir), /Unapproved example/);
});

test('Publication rejects missing or replaced project licenses and stale portable notices', t => {
    const dir = payload(t);
    rmSync(resolve(dir, 'assets/legal/JvmScope-LICENSE.txt'));
    assert.throws(() => scanPagesArtifact(dir), /Missing Pages file/);
    put(dir, 'assets/legal/JvmScope-LICENSE.txt', 'Different license');
    assert.throws(() => scanPagesArtifact(dir), /legal notice differs/);
    const portable = temporary(t);
    for (const file of projectLegalFiles()) {
        const name = file.fileName.includes('LICENSE') ? 'LICENSE'
            : file.fileName.includes('THIRD-PARTY') ? 'THIRD-PARTY-NOTICES.md' : 'NOTICE';
        put(portable, name, file.source);
    }
    verifyProjectLegal(portable, {portable:true});
    put(portable, 'NOTICE', 'Stale notice');
    assert.throws(() => verifyProjectLegal(portable, {portable:true}), /legal notice differs/);
});

test('Pages verification rejects forgotten files and truncated worker/example bundles', t => {
    const unexpected = payload(t);
    put(unexpected,'secret.env','fixture secret');
    assert.throws(() => scanPagesArtifact(unexpected), /Unexpected file/);
    const missingWorker = payload(t);
    rmSync(resolve(missingWorker,'assets/tls-analysis-worker-12345678.js'));
    assert.throws(() => scanPagesArtifact(missingWorker), /Both analysis workers/);
    const missingExample = payload(t);
    rmSync(resolve(missingExample,'assets/examples/sample-0-12345678.txt'));
    assert.throws(() => scanPagesArtifact(missingExample), /every approved example/);
});

test('Pages verification detects changed payloads, duplicate manifest entries and stale metadata', t => {
    const dir = payload(t);
    complete(dir);
    put(dir, 'assets/js/d3.min.js','altered');
    assert.throws(() => verifyPagesArtifact(dir), /manifest/);
    complete(dir);
    const manifest = JSON.parse(readFileSync(resolve(dir,'manifest.json')));
    manifest.files.push(manifest.files[0]);
    put(dir,'manifest.json',JSON.stringify(manifest));
    assert.throws(() => verifyPagesArtifact(dir), /manifest/);
    complete(dir);
    put(dir,'build-info.json',JSON.stringify({base:'/Wrong/',revision:commit,target:'pages'}));
    assert.throws(() => verifyPagesArtifact(dir), /metadata/);
});

test('Pages artifacts reject filesystem links rather than publishing another file', t => {
    const dir = payload(t);
    linkSync(resolve(dir,'assets/js/d3.min.js'),resolve(dir,'assets/js/copied-12345678.js'));
    assert.throws(() => scanPagesArtifact(dir), /Links are not allowed/);
});

test('Pages verification rejects stale root-based links even when their manifest hashes match', t => {
    const dir = payload(t);
    put(dir,'jvmscope/tda.html','<html><a href="/jvmscope/tls.html">TLS</a></html>');
    complete(dir);
    assert.throws(() => verifyPagesArtifact(dir), /URL outside Pages base/);
    put(dir,'jvmscope/tda.html',`<html><script src="${base}assets/js/missing-12345678.js"></script></html>`);
    complete(dir);
    assert.throws(() => verifyPagesArtifact(dir), /Missing linked asset/);
});

test('Strict Pages delivery exercises real HTTP with exact case, MIME, HEAD and no API/fallback', async t => {
    const dir = payload(t);
    complete(dir);
    const server = await startPagesServer(dir);
    t.after(() => server.stop());
    const url = server.url + base;
    const root = await fetch(url);
    assert.equal(root.status,200);
    assert.match(root.headers.get('content-type'),/^text\/html/);
    assert.match(await root.text(),/Thread Dump Analyzer/);
    for (const path of ['jvmscope/tda.html','jvmscope/tls.html','assets/js/d3.min.js','manifest.json']) {
        const response = await fetch(url+path+'?cache=1');
        assert.equal(response.status,200);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(readFileSync(resolve(dir,path))));
        const head = await fetch(url+path,{method:'HEAD'});
        assert.equal(head.status,200);
        assert.equal(head.headers.get('content-length'),String(readFileSync(resolve(dir,path)).length));
        assert.equal((await head.arrayBuffer()).byteLength,0);
    }
    for (const path of ['/','/jvmscope/tda.html','/jvmscope/tls.html','/javautils/tda.html','/jvmscope/tda.html/extra','/health','/jvmscope/TDA.html']) {
        assert.equal((await fetch(server.url+path)).status,404);
    }
    for (const path of ['jvmscope/TDA.html','health','missing','%2e%2e%2fREADME.md','jvmscope%5ctda.html']) {
        assert.equal((await fetch(url+path)).status,404);
    }
    assert.equal((await fetch(server.url+'/jvmscope/tda.html',{method:'POST',body:'private'})).status,405);
    assert.equal((await fetch(url.replace('/JvmScope/','/jvmscope/')+'jvmscope/tda.html')).status,404);
});

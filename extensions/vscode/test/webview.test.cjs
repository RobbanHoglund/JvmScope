const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { renderWebview, resolveRoute } = require('../src/webview.cjs');
const pages = ['index.html', 'jvmscope/tda.html', 'jvmscope/tls.html', 'knowledge/index.html'];
const options = { page: 'jvmscope/tda.html', pages, cspSource: 'https://resources.example', resourceUri: name => 'https://resources.example/' + name };

test('bundled resources are rewritten; scripts receive a nonce and external capabilities stay blocked', () => {
    const html = renderWebview('<html><head></head><body><script src="../assets/js/tda.js"></script><a href="../knowledge/index.html">Help</a><a href="command:bad">Bad</a><img src="../assets/img/icon.svg"></body></html>', options);
    assert.match(html, /default-src &#39;none&#39;/);
    assert.match(html, /worker-src blob: data:/);
    assert.match(html, /<script nonce="[A-Za-z0-9+/]+" src="https:\/\/resources.example\/assets\/js\/tda.js"/);
    assert.match(html, /data-host-route="\/knowledge\/index.html"/);
    assert.doesNotMatch(html, /command:bad|unsafe-eval/);
    assert.match(html, /<base href="https:\/\/resources.example\/jvmscope\/">/);
    assert.notEqual(renderWebview('<head></head><script></script>', options), renderWebview('<head></head><script></script>', options));
});

test('navigation is limited to packaged pages, with no external origin or query injection', () => {
    assert.deepEqual(resolveRoute('/knowledge/index.html#references', pages), { name: 'knowledge/index.html', search: '', hash: '#references' });
    assert.deepEqual(resolveRoute('/knowledge/index.html?java=21#support', pages), { name: 'knowledge/index.html', search: '?java=21', hash: '#support' });
    for (const value of ['//evil.test/index.html', '/../../etc/passwd', '/assets/capture.txt', '/jvmscope/tda.html?load=file:///x', 'command:x',
        '/jvmscope/tda.html?java=21', '/knowledge/index.html?java=28', '/knowledge/index.html?java=6',
        '/knowledge/index.html?java=21&java=25', '/knowledge/index.html?java=21&load=file:///x', '/knowledge/index.html?java=21.0']) {
        assert.throws(() => resolveRoute(value, pages));
    }
    const html = renderWebview('<head></head><a href="./index.html?java=21#support">Support</a>', {
        ...options, page: 'knowledge/index.html', route: '/knowledge/index.html?java=25#find=CPU&section=check',
    });
    assert.match(html, /name="jvmscope-page" content="\/knowledge\/index.html\?java=25#find=CPU&amp;section=check"/);
    assert.match(html, /data-host-route="\/knowledge\/index.html\?java=21#support"/);
});

test('production extension has both analyzers, offline examples, legal notices and self-contained workers', () => {
    const media = path.join(__dirname, '../media');
    const list = JSON.parse(readFileSync(path.join(media, 'pages.json'), 'utf8'));
    for (const page of ['jvmscope/tda.html', 'jvmscope/tls.html', 'knowledge/index.html']) assert.ok(list.includes(page));
    for (const page of list) {
        const html = readFileSync(path.join(media, page), 'utf8');
        assert.match(html, /data-jvmscope-page=/);
        assert.doesNotMatch(html, /class="tool-nav"/, `Website navigation must be absent from ${page}`);
        const rendered = renderWebview(html, { ...options, page, pages: list });
        assert.match(rendered, /Content-Security-Policy/);
        for (const [, resource] of rendered.matchAll(/(?:src|href)="https:\/\/resources.example\/(assets\/[^"#?]+)"/g)) {
            assert.doesNotThrow(() => readFileSync(path.join(media, resource)), resource);
        }
    }
    assert.ok(readdirSync(path.join(media, 'assets/examples')).length >= 35);
    assert.ok(readFileSync(path.join(media, 'assets/legal/JvmScope-LICENSE.txt'), 'utf8').includes('Apache License'));
    const scripts = readdirSync(path.join(media, 'assets/js')).filter(name => name.endsWith('.js')).map(name => readFileSync(path.join(media, 'assets/js', name), 'utf8')).join('\n');
    assert.match(scripts, /createObjectURL/);
    assert.doesNotMatch(scripts, /new URL\(["'][^"']*worker-analysis/);
});

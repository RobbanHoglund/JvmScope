const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const root = resolve(__dirname, '../../..');

for (const version of ['2.0.0', '9.1.0']) test(`CI selects the manifest's ${version} artifact after a version bump`, t => {
    const cwd = mkdtempSync(join(tmpdir(), 'jvmscope-package-path-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    mkdirSync(join(cwd, 'extensions/vscode'), { recursive: true });
    writeFileSync(join(cwd, 'extensions/vscode/package.json'), JSON.stringify({ name: 'jvmscope', version }));
    const envFile = join(cwd, 'github-env');
    writeFileSync(envFile, 'EXISTING=value\n');
    const result = spawnSync(process.execPath, [join(root, 'scripts/vscode-package-path.cjs')], {
        cwd, env: { ...process.env, GITHUB_ENV: envFile }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(envFile, 'utf8'), `EXISTING=value\nVSCODE_VSIX=build/vscode/jvmscope-${version}.vsix\n`);
});

test('release workflow and package command do not pin a VSIX version', () => {
    const workflow = readFileSync(join(root, '.github/workflows/vscode-extension.yml'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(root, 'extensions/vscode/package.json'), 'utf8'));
    assert.doesNotMatch(workflow, /jvmscope-\d+\.\d+\.\d+[^\s]*\.vsix/);
    assert.doesNotMatch(manifest.scripts.package, /jvmscope-\d+\.\d+\.\d+[^\s]*\.vsix/);
});

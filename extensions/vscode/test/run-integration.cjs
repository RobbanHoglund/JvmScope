const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { runTests, runVSCodeCommand } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '../../..');
async function main() {
    const options = { version: process.env.VSCODE_VERSION || '1.110.0', cachePath: path.join(root, '.run/vscode-test') };
    const extensions = path.join(options.cachePath, 'extensions');
    const profile = ['--user-data-dir', path.join(options.cachePath, 'user-data'), '--extensions-dir', extensions];
    let extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsEnv = {};
    if (process.env.VSCODE_VSIX) {
        // Install the release artifact in an isolated profile. A separate empty
        // development extension hosts the tests; JvmScope must load from VSIX.
        const vsix = path.resolve(root, process.env.VSCODE_VSIX);
        const digest = createHash('sha256').update(await fs.readFile(vsix)).digest('hex');
        console.log(`Testing packaged extension ${path.basename(vsix)}; SHA-256: ${digest}`);
        await fs.rm(extensions, { recursive: true, force: true });
        const result = await runVSCodeCommand(['--install-extension', vsix, '--force', '--no-sandbox', ...profile], options);
        console.log(result.stdout);
        extensionDevelopmentPath = path.join(options.cachePath, 'harness');
        await fs.mkdir(extensionDevelopmentPath, { recursive: true });
        await fs.writeFile(path.join(extensionDevelopmentPath, 'package.json'), JSON.stringify({
            name: 'jvmscope-test-harness', publisher: 'jvmscope-tests', version: '1.0.0',
            engines: { vscode: '^1.110.0' }, main: './extension.cjs',
        }));
        await fs.writeFile(path.join(extensionDevelopmentPath, 'extension.cjs'), 'exports.activate = () => {};\n');
        extensionTestsEnv.JVMSCOPE_TEST_INSTALL_ROOT = extensions;
        extensionTestsEnv.JVMSCOPE_TEST_VERSION = require('../package.json').version;
    }
    await runTests({
        ...options, vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
        extensionDevelopmentPath, extensionTestsPath: path.join(__dirname, 'integration.cjs'), extensionTestsEnv,
        launchArgs: [...(process.env.VSCODE_VSIX ? [] : ['--disable-extensions']), '--disable-gpu', '--no-sandbox', ...profile],
    });
}
main().catch(error => { console.error(error); process.exitCode = 1; });

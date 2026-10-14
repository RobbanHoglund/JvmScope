const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '../../..');
runTests({
    version: process.env.VSCODE_VERSION || '1.110.0',
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.join(__dirname, 'integration.cjs'),
    cachePath: path.join(root, '.run/vscode-test'),
    launchArgs: ['--disable-extensions', '--disable-gpu', '--no-sandbox', '--disable-workspace-trust',
        '--user-data-dir', path.join(root, '.run/vscode-test/user-data'),
        '--extensions-dir', path.join(root, '.run/vscode-test/extensions')],
}).catch(error => { console.error(error); process.exitCode = 1; });

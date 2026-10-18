// Run from the repository root in each CI job that consumes the VSIX.
const { readFileSync, appendFileSync } = require('node:fs');
const { name, version } = JSON.parse(readFileSync('extensions/vscode/package.json', 'utf8'));
appendFileSync(process.env.GITHUB_ENV, `VSCODE_VSIX=build/vscode/${name}-${version}.vsix\n`);

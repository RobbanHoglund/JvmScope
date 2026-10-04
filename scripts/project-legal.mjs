import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const projectLegalAssets = Object.freeze({
    'assets/legal/JvmScope-LICENSE.txt': 'LICENSE',
    'assets/legal/JvmScope-NOTICE.txt': 'NOTICE',
    'assets/legal/THIRD-PARTY-NOTICES.txt': 'THIRD-PARTY-NOTICES.md',
});

export function projectLegalFiles() {
    return Object.entries(projectLegalAssets).map(([fileName, source]) => ({
        fileName, source: readFileSync(resolve(root, source)),
    }));
}

// A manifest can be internally consistent while omitting or changing a license.
// Verify the delivered notices against the source repository as well.
export function verifyProjectLegal(directory, { portable = false } = {}) {
    for (const [asset, source] of Object.entries(projectLegalAssets)) {
        const delivered = readFileSync(resolve(directory, portable ? source : asset));
        if (!delivered.equals(readFileSync(resolve(root, source)))) {
            throw new Error(`Project legal notice differs from source: ${source}`);
        }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [option, directory, ...extra] = process.argv.slice(2);
    if (option !== '--check-package' || !directory || extra.length) {
        throw new Error('Usage: node scripts/project-legal.mjs --check-package PATH');
    }
    verifyProjectLegal(resolve(directory), { portable: true });
    console.log('Portable package contains the current project license and notices.');
}

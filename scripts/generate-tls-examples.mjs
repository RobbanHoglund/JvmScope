// Rebuild the small public teaching logs from the canonical synthetic TLS scenarios.
import { mkdir, writeFile } from 'node:fs/promises';
import { buildComprehensiveTlsSampleLog } from '../frontend/assets/javautils/tls-sample.js';
import { analyzeTlsLog } from '../frontend/assets/javautils/tls-parser.js';

const directory = new URL('../frontend/assets/javautils/samples/', import.meta.url);
const text = buildComprehensiveTlsSampleLog();
const interactions = analyzeTlsLog(text).interactions;
await mkdir(directory, { recursive: true });
await writeFile(new URL('comprehensive-tls.txt', directory), text, 'utf8');
const scenarios = {
    'tls-timeout.txt': interaction => /Read timed out/.test(interaction.failureReason || ''),
    'tls-hostname-mismatch.txt': interaction => /Certificate name mismatch/.test(interaction.failureReason || ''),
    'tls-expired-certificate.txt': interaction => /certificate_expired/.test(interaction.failureReason || ''),
    'tls-alpn-mismatch.txt': interaction => /no_application_protocol/.test(interaction.failureReason || ''),
    'tls-incomplete.txt': interaction => interaction.id === 16,
};
for (const [name, select] of Object.entries(scenarios)) {
    const matches = interactions.filter(select);
    if (matches.length !== 1) throw new Error(`Expected one teaching scenario for ${name}`);
    await writeFile(new URL(name, directory), matches[0].rawLines.join('\n') + '\n', 'utf8');
}
console.log(`Generated ${Object.keys(scenarios).length + 1} synthetic TLS examples.`);

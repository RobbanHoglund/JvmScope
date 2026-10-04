// Occasional real-runtime collection. Normal CI only replays permanent fixtures.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, manifest, json, saveJson, safeFile, render, importBundle } from './jvm-samples/model.mjs';
import { discover, download, aggregate, missingReport } from './jvm-samples/discovery.mjs';
import { capture } from './jvm-samples/capture.mjs';

const [action, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Expected --option value: ${args[i]}`);
    const key = args[i].slice(2); if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${key}`);
    options[key] = args[i + 1];
}
const allowed = {
    discover: ['versions', 'vendors', 'material', 'run-id', 'commit', 'output'], download: ['plan', 'key', 'output'],
    capture: ['plan', 'key', 'java-home', 'compiler-home', 'archive-report', 'output'],
    local: ['major', 'vendor', 'java-home', 'compiler-home', 'material', 'run-id', 'commit', 'output'],
    failure: ['plan', 'key', 'reason', 'output'], aggregate: ['plan', 'output'], import: ['bundle'], render: [], check: [],
};
if (!allowed[action] || Object.keys(options).some(key => !allowed[action].includes(key))) throw new Error('Unknown command or option. See docs/JVM-SAMPLES.md.');
function need(key) { if (!options[key]) throw new Error(`Missing --${key}`); return options[key]; }
function entry() {
    const plan = json(need('plan')), item = plan.entries.find(e => e.key === need('key'));
    if (!item) throw new Error('Key is not in the capture plan'); return { plan, item };
}
if (action === 'discover') {
    const plan = await discover({ versions: options.versions, vendors: options.vendors, material: options.material,
        runId: need('run-id'), sourceCommit: need('commit') });
    saveJson(need('output'), plan);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: plan.matrix })}\nhas_jobs=${plan.matrix.length > 0}\n`);
    console.log(`Available ${plan.matrix.length}; unavailable ${plan.entries.filter(e => e.status === 'unavailable').length}; discovery errors ${plan.entries.filter(e => e.status === 'discovery-error').length}`);
} else if (action === 'download') {
    const { item } = entry(); mkdirSync(need('output'), { recursive: true });
    const { target: archive, provenance } = await download(item, resolve(options.output));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `archive=${archive}\nmajor=${item.major}\n`);
    console.log(`Recorded SHA-256 for ${item.key} ${item.package.java_version}; ${provenance.verification}`);
} else if (action === 'capture') {
    const { plan, item } = entry();
    const report = await capture({ home: need('java-home'), compiler: options['compiler-home'], output: need('output'), entry: item,
        material: plan.material, runId: plan.runId, sourceCommit: plan.sourceCommit,
        archiveReport: options['archive-report'] ? json(options['archive-report']) : null });
    if (['partial', 'capture-error'].includes(report.status)) process.exitCode = 1;
} else if (action === 'local') {
    const major = Number(need('major')), distribution = need('vendor');
    if (!manifest.versions.includes(major) || !manifest.distributions.includes(distribution)) throw new Error('Unknown local version/vendor');
    const key = `${distribution}-${major}`, runId = need('run-id'), output = resolve(need('output'));
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(runId)) throw new Error('Invalid local run ID');
    const plan = { schemaVersion: 1, runId, sourceCommit: options.commit || 'working-tree', material: options.material || 'all',
        discoveredAt: new Date().toISOString(), entries: [{ key, major, distribution, status: 'available' }] };
    saveJson(join(output, 'plan.json'), plan);
    const report = await capture({ home: need('java-home'), compiler: options['compiler-home'], output: safeFile(output, key), entry: plan.entries[0],
        material: plan.material, runId, sourceCommit: plan.sourceCommit });
    aggregate(plan, output);
    if (['partial', 'capture-error'].includes(report.status)) process.exitCode = 1;
} else if (action === 'failure') {
    const { plan, item } = entry(); saveJson(join(need('output'), 'report.json'), missingReport(plan, item, options.reason || 'JDK download or installation failed', 'capture-error'));
} else if (action === 'aggregate') {
    aggregate(json(need('plan')), resolve(need('output'))); console.log('All expected runtime attempts accounted for');
} else if (action === 'import') {
    console.log(`Imported ${importBundle(resolve(need('bundle')))} runtime reports; README and detailed results regenerated`);
} else if (action === 'render' || action === 'check') {
    const records = render(ROOT, action === 'check'); console.log(`Replayed ${records.length} runtime reports; generated documentation ${action === 'check' ? 'matches' : 'updated'}`);
} else throw new Error('Use discover, download, capture, local, failure, aggregate, import, render or check. See docs/JVM-SAMPLES.md.');

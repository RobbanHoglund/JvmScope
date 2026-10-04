// Capture complete dumps from our own two Java child processes. Never accept a target PID.
// Usage: node scripts/capture-thread-examples.mjs <jdk-home> [output-directory]
import { spawn, spawnSync } from 'node:child_process';
import { sampleEnvironment } from './sample-environment.mjs';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [jdkHome, destination, ...extra] = process.argv.slice(2);
if (!jdkHome || extra.length) throw new Error('Usage: node scripts/capture-thread-examples.mjs <jdk-home> [output-directory]');
const root = resolve(import.meta.dirname, '..');
const defaultOutput = resolve(root, 'frontend/assets/javautils/samples');
const output = destination ? resolve(destination) : defaultOutput;
const scratch = resolve(root, '.run/thread-examples', randomUUID());
mkdirSync(scratch, { recursive: true });
const executable = name => join(resolve(jdkHome), 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
function command(name, args) {
    const result = spawnSync(executable(name), args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 2_000_000, windowsHide: true, env: sampleEnvironment() });
    if (result.error || result.status !== 0) throw new Error(`${name} failed: ${result.error || result.stderr || result.stdout}`);
    return (result.stdout + result.stderr).replaceAll('\r\n', '\n');
}
const version = command('java', ['-version']).trim();
const major = Number(version.match(/version "(\d+)/)?.[1]);
if (major < 25 || !Number.isInteger(major)) throw new Error('Use JDK 25+ for the virtual/carrier JSON fields.');
if (output === defaultOutput && major !== 25) throw new Error('The library is labelled Java 25. Use JDK 25, or supply a separate output directory for another version.');
const sourcePath = 'tools/thread-dump-generator/ThreadLibraryScenarios.java';
const mainClass = 'com.robbanhoglund.jvmscope.samples.threaddump.ThreadLibraryScenarios';
command('javac', ['-encoding', 'UTF-8', '-d', scratch, resolve(root, sourcePath)]);
const javaOptions = ['-Xms16m', '-Xmx64m', '-XX:+UseSerialGC', '-XX:ActiveProcessorCount=2', '-cp', scratch, mainClass];

async function withScenario(mode, capture) {
    const child = spawn(executable('java'), [...javaOptions, mode], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: sampleEnvironment() });
    const closed = once(child, 'close');
    // Preserve the diagnostics even if startup/capture fails; these files remain ignored.
    let stdout = '', stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    try {
        await new Promise((accept, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out starting ${mode}`)), 15_000);
            const fail = error => { clearTimeout(timer); reject(error); };
            child.once('error', fail);
            child.once('exit', code => fail(new Error(`${mode} exited before readiness: ${code}`)));
            child.stdout.on('data', data => {
                stdout += data;
                if (stdout.includes(`READY ${mode} pid=${child.pid}`)) { clearTimeout(timer); accept(); }
            });
        });
        // Allow JIT warmup before collecting comparable CPU measurements.
        await delay(1_500);
        return await capture(child.pid);
    } finally {
        if (child.exitCode == null && child.signalCode == null) child.kill();
        await closed;
        writeFileSync(join(scratch, `${mode}-stdout.txt`), stdout);
        writeFileSync(join(scratch, `${mode}-stderr.txt`), stderr);
    }
}

const intervalMs = 1_500, snapshotCount = 4;
const cpu = await withScenario('cpu', async pid => {
    const dumps = [];
    for (let index = 0; index < snapshotCount; index++) {
        if (index) await delay(intervalMs);
        const observedAt = new Date().toISOString();
        const raw = command('jcmd', [String(pid), 'Thread.print', '-e', '-l']);
        if (!raw.includes('Full thread dump') || !raw.includes('"example-cpu-hot-worker"')) throw new Error('Missing real CPU workload in dump');
        writeFileSync(join(scratch, `cpu-${index + 1}.txt`), raw);
        // Add the actual collector timestamp; preserve every original dump line.
        dumps.push(`${observedAt}\n${raw.trimEnd()}\n`);
    }
    return dumps.join('\n');
});
const virtual = await withScenario('virtual', async pid => {
    const path = join(scratch, 'virtual.json');
    command('jcmd', [String(pid), 'Thread.dump_to_file', '-format=json', `"${path}"`]);
    const raw = readFileSync(path, 'utf8');
    const dump = JSON.parse(raw).threadDump;
    const threads = dump?.threadContainers?.flatMap(container => container.threads) || [];
    const examples = threads.filter(thread => thread.name.startsWith('example-virtual-'));
    const mounted = examples.find(thread => thread.name === 'example-virtual-cpu-hot-worker');
    if (examples.length !== 5 || !examples.every(thread => thread.virtual === true)
        || !mounted?.carrier || !threads.some(thread => String(thread.tid) === String(mounted.carrier))) {
        throw new Error('The JVM did not report all five virtual workers and the mounted worker/carrier pair. Nothing published.');
    }
    return raw;
});

const files = { 'tda-cpu-hot-sequence.txt': cpu, 'tda-virtual-workers.json': virtual };
for (const [name, text] of Object.entries(files)) {
    if (!text.trim() || Buffer.byteLength(text) >= 200_000) throw new Error(`Invalid example size: ${name}`);
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const provenance = {
    capturedAt: new Date().toISOString(), javaVersion: version, sourcePath,
    sourceNormalization: 'UTF-8 with LF line endings',
    sourceSha256: sha256(readFileSync(resolve(root, sourcePath), 'utf8').replaceAll('\r\n', '\n')),
    mainClass,
    javaOptions: javaOptions.slice(0, javaOptions.indexOf('-cp')),
    cpu: { command: 'jcmd <owned-child-pid> Thread.print -e -l', snapshotCount, intervalMs,
        transformation: 'Complete dumps; LF normalization and actual collector ISO timestamps added. No thread records or counters altered.' },
    virtual: { command: 'jcmd <owned-child-pid> Thread.dump_to_file -format=json <file>', snapshotCount: 1,
        transformation: 'Complete, unchanged JVM JSON output, including supporting platform threads.' },
    files: Object.entries(files).map(([name, text]) => ({ name, bytes: Buffer.byteLength(text), sha256: sha256(text) })),
};
// Publish only after both children and all capture checks succeed.
mkdirSync(output, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(output, name), text);
writeFileSync(join(output, 'thread-examples-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`Captured ${snapshotCount} CPU snapshots and five virtual workers using Java ${major} in ${output}`);
console.log(`Raw commands and child output retained in ${scratch}`);

// Usage: node scripts/capture-parser-samples.mjs <jdk-home> <output-directory> [--mounted|--json-v1]
// Captures only sample-* threads from the controlled process. Never attaches to another JVM.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sampleEnvironment } from './sample-environment.mjs';

const [jdk, output, mode] = process.argv.slice(2);
const mounted = mode === '--mounted';
const legacyJson = mode === '--json-v1';
if (!jdk || !output) throw new Error('Supply a JDK home and output directory. Requires JDK 21+.');
const executable = name => join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const directory = mkdtempSync(join(tmpdir(), 'tda-format-samples-'));
const source = resolve(import.meta.dirname, '../tools/thread-dump-generator/FormatRegressionSample.java');
const child = spawn(executable('java'), [...(legacyJson ? ['-Dcom.sun.management.HotSpotDiagnosticMXBean.dumpThreads.format=1'] : []), '-Xint', source, ...(mounted ? ['--mounted'] : [])], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: sampleEnvironment() });
try {
    await new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error('Sample JVM startup timed out')), 15000);
        let stdout = '';
        child.stdout.on('data', data => {
            stdout += data;
            if (stdout.includes('READY')) { clearTimeout(timer); resolveReady(); }
        });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Sample JVM exited: ${code}`)); });
        child.stderr.on('data', data => process.stderr.write(data));
    });
    const command = (...args) => {
        const result = spawnSync(executable('jcmd'), [String(child.pid), ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: sampleEnvironment() });
        if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
        return result.stdout.replaceAll('\r\n', '\n');
    };
    const classic = command('Thread.print', '-e', '-l');
    const version = classic.match(/Full thread dump .*?\((\d+)/)?.[1];
    if (!version) throw new Error('Unrecognized JVM version');
    mkdirSync(output, { recursive: true });
    const save = (format, content) => writeFileSync(join(output, `jdk${version}-${format}`), content);
    if (mounted) {
        if (Number(version) < 25) throw new Error('Mounted carrier JSON requires JDK 25+.');
        const path = join(directory, 'mounted.json');
        command('Thread.dump_to_file', '-format=json', `"${path}"`);
        const data = JSON.parse(readFileSync(path, 'utf8'));
        const all = data.threadDump.threadContainers.flatMap(container => container.threads);
        const virtual = all.find(thread => thread.name === 'sample-virtual-mounted');
        const carrier = all.find(thread => String(thread.tid) === String(virtual?.carrier));
        if (!virtual?.virtual || !carrier) throw new Error('No mounted virtual/carrier pair captured.');
        for (const container of data.threadDump.threadContainers) {
            container.threads = container.threads.filter(thread => thread === virtual || thread === carrier);
            container.threadCount = typeof container.threadCount === 'number' ? container.threads.length : String(container.threads.length);
        }
        data.threadDump.threadContainers = data.threadDump.threadContainers.filter(container => container.threads.length);
        save('mounted-virtual.json', JSON.stringify(data, null, 2) + '\n');
    } else {
        const classicBlocks = [...classic.matchAll(/^"sample-[\s\S]*?(?=^"|^JNI global refs:|$(?![\s\S]))/gm)].map(match => match[0]);
        const preamble = classic.slice(classic.indexOf('\n') + 1, classic.indexOf('Threads class SMR info:'));
        if (legacyJson && Number(version) < 27) throw new Error('JSON compatibility version requires JDK 27+.');
        if (!legacyJson) save('thread-print.txt', preamble + classicBlocks.join('') + 'JNI global refs: 0\n');
        for (const format of legacyJson ? ['json'] : ['plain', 'json']) {
            const path = join(directory, `dump.${format}`);
            command('Thread.dump_to_file', `-format=${format}`, `"${path}"`);
            const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
            if (format === 'plain') {
                const blocks = [...raw.matchAll(/^#\d+ "sample-[\s\S]*?(?=^#\d+ |$(?![\s\S]))/gm)].map(match => match[0]);
                save('dump-to-file.txt', raw.slice(0, raw.search(/^#\d+ /m)) + blocks.join(''));
            } else {
                const data = JSON.parse(raw);
                for (const container of data.threadDump.threadContainers) {
                    container.threads = container.threads.filter(thread => thread.name.startsWith('sample-'));
                    container.threadCount = typeof container.threadCount === 'number' ? container.threads.length : String(container.threads.length);
                }
                data.threadDump.threadContainers = data.threadDump.threadContainers.filter(container => container.threads.length);
                save(legacyJson ? 'dump-to-file-v1.json' : 'dump-to-file.json', JSON.stringify(data, null, 2) + '\n');
            }
        }
    }
    console.log(`Captured JDK ${version} samples in ${resolve(output)}`);
} finally {
    if (child.exitCode == null && child.pid) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
    }
    // mkdtemp created this exact directory under the OS temp directory.
    if (resolve(directory).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) {
        rmSync(directory, { recursive: true });
    }
}

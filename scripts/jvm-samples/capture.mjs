import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, sha256, saveJson, json, validateCase } from './model.mjs';
import { readReadyPort } from './port-file.mjs';
import { sampleEnvironment } from '../sample-environment.mjs';

export async function capture({ home, compiler = home, output, entry, material = 'all', runId = 'local', sourceCommit = 'working-tree', archiveReport = null }) {
    if (!['all', 'tda', 'tls'].includes(material)) throw new Error('Material must be all, tda or tls');
    const directory = resolve(output), work = join(directory, 'work');
    if (existsSync(join(directory, 'report.json')) || existsSync(work)) throw new Error('Capture output already exists; use a new run ID and output directory');
    mkdirSync(work, { recursive: true });
    const report = { schemaVersion: 1, id: `${runId}-${entry.key}-${material}`, major: entry.major,
        distribution: entry.distribution, capturedAt: new Date().toISOString(), status: 'capture-error',
        sourceCommit, package: entry.package || null, download: archiveReport, material, commands: [], sources: [], cases: [] };
    const exe = (jdk, name) => join(resolve(jdk), 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
    function command(jdk, name, args, options = {}) {
        report.commands.push({ executable: name, arguments: args });
        const r = spawnSync(exe(jdk, name), args, { encoding: 'utf8', timeout: 20000, maxBuffer: 8_000_000, windowsHide: true, cwd: work, env: sampleEnvironment(), ...options });
        if (r.error || r.status !== 0) throw new Error(`${name}: ${r.error?.message || r.stderr || r.stdout || `exit ${r.status}`}`);
        return r.stdout;
    }
    function source(path) {
        const content = readFileSync(join(ROOT, path), 'utf8').replaceAll('\r\n', '\n');
        report.sources.push({ path, normalizedSha256: sha256(content) });
        return join(ROOT, path);
    }
    function compile(jdk, path, legacy = false) {
        command(jdk, 'javac', [...(legacy ? ['-source', '7', '-target', '7'] : []), '-encoding', 'UTF-8', '-d', work, source(path)]);
    }
    const javaBase = ['-Duser.language=en', '-Duser.country=US', '-Duser.timezone=UTC', '-Dfile.encoding=UTF-8', '-Xms16m', '-Xmx64m'];
    function start(args, label, mergedPath, readyPath) {
        report.commands.push({ executable: 'java', arguments: args });
        const stdoutPath = join(work, `${label}-stdout.txt`), stderrPath = join(work, `${label}-stderr.txt`);
        const fd = mergedPath ? openSync(mergedPath, 'w') : null;
        const child = spawn(exe(home, 'java'), args, { stdio: fd == null ? ['ignore', 'pipe', 'pipe'] : ['ignore', fd, fd], windowsHide: true, cwd: work, env: sampleEnvironment() });
        if (fd != null) closeSync(fd);
        let stdout = '', stderr = '';
        child.stdout?.on('data', b => { stdout += b; if (stdout.length > 8_000_000) child.kill(); });
        child.stderr?.on('data', b => { stderr += b; if (stderr.length > 8_000_000) child.kill(); });
        let error;
        child.on('error', e => { error = e; });
        const closed = new Promise(accept => child.once('close', (code, signal) => accept({ code, signal })));
        return {
            child, closed,
            async ready() {
                const deadline = Date.now() + 15000;
                while (!(readyPath ? readReadyPort(readyPath) : stdout.includes('READY'))) {
                    if (error || child.exitCode != null || child.signalCode || Date.now() > deadline) throw new Error(`Child did not become ready: ${error?.message || stderr || stdout}`);
                    await delay(25);
                }
            },
            async finish() {
                let timer;
                const result = await Promise.race([closed, new Promise(r => { timer = setTimeout(() => r(null), 15000); })]);
                clearTimeout(timer);
                if (!result || result.code !== 0) throw new Error(`Child failed or timed out: ${stderr || stdout}`);
            },
            async stop() {
                if (child.exitCode == null && !child.signalCode && child.pid) child.kill();
                let timer;
                const exited = await Promise.race([closed, new Promise(r => { timer = setTimeout(() => r(null), 5000); })]);
                clearTimeout(timer);
                if (!exited && child.pid) child.kill('SIGKILL');
                writeFileSync(stdoutPath, stdout); writeFileSync(stderrPath, stderr);
                if (!exited) throw new Error('Owned child did not stop within five seconds');
            },
            stdout: () => stdout, stderr: () => stderr,
        };
    }
    function add(analyzer, id, file, expected, supported = true) {
        const bytes = readFileSync(join(directory, file));
        const item = { analyzer, id, file, bytes: bytes.length, sha256: sha256(bytes), expected, status: 'validation-error' };
        try {
            if (!supported) { item.status = 'unsupported-format'; item.error = 'Provider/VM format is outside the declared HotSpot/SunJSSE parser scope'; }
            else { item.validation = validateCase(item, directory, report.runtime); item.status = 'verified'; }
        } catch (e) { item.error = e.message; }
        report.cases.push(item);
        console.log(`${entry.key} ${id}: ${item.status}${item.error ? ` (${item.error.split('\n')[0]})` : ''}`);
    }
    async function attempt(analyzer, id, action) {
        try { await action(); }
        catch (e) { report.cases.push({ analyzer, id, status: 'capture-error', error: e.message }); console.error(`${entry.key} ${id}: ${e.message.split('\n')[0]}`); }
    }
    try {
        compile(entry.major === 7 ? home : compiler, 'tools/jvm-samples/TlsWorkload.java', true);
        const probe = command(home, 'java', [...javaBase, '-cp', work, 'TlsWorkload', 'identity']);
        writeFileSync(join(work, 'runtime.txt'), probe);
        report.runtime = Object.fromEntries(probe.trim().split(/\r?\n/).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
        const actualMajor = Number(report.runtime['java.version'].replace(/^1\./, '').match(/^\d+/)?.[0]);
        if (actualMajor !== entry.major) throw new Error(`Wrong installed JVM: expected ${entry.major}, got ${report.runtime['java.version']}`);
        if (!entry.package) {
            const identities = { zulu: /Azul/i, temurin: /Eclipse Adoptium|AdoptOpenJDK/i, corretto: /Amazon/i, liberica: /BellSoft/i,
                microsoft: /Microsoft/i, oracle: /Oracle/i, oracle_open_jdk: /Oracle/i, sap_machine: /SAP/i,
                dragonwell: /Alibaba/i, kona: /Tencent/i, jetbrains: /JetBrains/i, semeru: /IBM|Semeru/i,
                graalvm: /Oracle|GraalVM/i, graalvm_community: /Oracle|GraalVM/i, redhat: /Red Hat/i, openlogic: /OpenLogic|Perforce/i, bisheng: /Huawei/i };
            if (!identities[entry.distribution]?.test(report.runtime['java.vendor'])) throw new Error(`Local vendor label does not match java.vendor: ${entry.distribution} / ${report.runtime['java.vendor']}`);
        }
        if (entry.package?.release_status === 'ga' && /-ea\b/.test(report.runtime['java.runtime.version'])) throw new Error('Discovered GA package reported an EA runtime');
        const hotspot = !/openj9|j9 vm/i.test(report.runtime['java.vm.name']);
        if (material !== 'tls') await attempt('tda', 'platform-workload', async () => {
            compile(entry.major === 7 ? home : compiler, 'tools/jvm-samples/ThreadWorkload.java', true);
            const oraclePath = join(work, 'thread-oracle.json'), javacore = join(directory, 'javacore.txt');
            const owned = start([...javaBase, ...(!hotspot ? ['-Xdump:nofailover'] : []), '-cp', work, 'ThreadWorkload', oraclePath, javacore], 'platform');
            try {
                await owned.ready();
                const oracle = json(oraclePath);
                if (!hotspot) { add('tda', 'javacore', 'javacore.txt', { scenario: 'javacore', ...oracle }, false); return; }
                const help = command(home, 'jcmd', [String(owned.child.pid), 'help', 'Thread.print']);
                const extended = /(?:^|\s)-e\b/m.test(help);
                const dumps = [];
                await delay(500);
                for (let i = 0; i < 3; i++) {
                    if (i) await delay(1100);
                    const timestamp = new Date().toISOString();
                    const raw = command(home, 'jcmd', [String(owned.child.pid), 'Thread.print', '-l', ...(extended ? ['-e'] : [])]);
                    writeFileSync(join(work, `classic-${i + 1}.txt`), raw);
                    dumps.push(`${timestamp}\n${raw.replaceAll('\r\n', '\n').trimEnd()}\n`);
                }
                writeFileSync(join(directory, 'classic-sequence.txt'), dumps.join('\n'));
                add('tda', 'classic-sequence', 'classic-sequence.txt', { scenario: 'classic-sequence', snapshots: 3, ...oracle });
                if (entry.major >= 21) for (const format of ['plain', 'json']) await attempt('tda', `file-${format}`, async () => {
                    const file = `file-${format}.${format === 'json' ? 'json' : 'txt'}`;
                    const path = join(directory, file);
                    command(home, 'jcmd', [String(owned.child.pid), 'Thread.dump_to_file', `-format=${format}`, `"${path}"`]);
                    add('tda', `file-${format}`, file, { scenario: `file-${format}`, snapshots: 1, threads: oracle.threads });
                });
            } finally { await owned.stop(); }
        });
        if (material !== 'tls' && hotspot && entry.major >= 21) await attempt('tda', 'virtual-json', async () => {
            compile(home, 'tools/thread-dump-generator/ThreadLibraryScenarios.java');
            const main = 'com.robbanhoglund.jvmscope.samples.threaddump.ThreadLibraryScenarios';
            const owned = start([...javaBase, '-cp', work, main, 'virtual'], 'virtual');
            try {
                await owned.ready(); await delay(200);
                const path = join(directory, 'virtual.json');
                command(home, 'jcmd', [String(owned.child.pid), 'Thread.dump_to_file', '-format=json', `"${path}"`]);
                const threads = ['cpu-hot-worker', 'parked-worker', 'sleeping-worker', 'lock-owner', 'lock-waiter'].map(name => ({
                    name: `example-virtual-${name}`, state: name === 'cpu-hot-worker' ? 'RUNNABLE' : name === 'sleeping-worker' ? 'TIMED_WAITING' : 'WAITING',
                    virtualRequired: entry.major >= 25,
                }));
                // Older JSON has no virtual/state fields; presence and stacks are still verified.
                add('tda', 'virtual-json', 'virtual.json', { scenario: 'virtual-json', snapshots: 1, threads });
            } finally { await owned.stop(); }
        });
        if (material !== 'tls' && hotspot && entry.major >= 27) await attempt('tda', 'json-v1', async () => {
            compile(home, 'tools/thread-dump-generator/ThreadLibraryScenarios.java');
            const owned = start([...javaBase, '-Dcom.sun.management.HotSpotDiagnosticMXBean.dumpThreads.format=1', '-cp', work,
                'com.robbanhoglund.jvmscope.samples.threaddump.ThreadLibraryScenarios', 'virtual'], 'virtual-v1');
            try {
                await owned.ready();
                const path = join(directory, 'virtual-v1.json');
                command(home, 'jcmd', [String(owned.child.pid), 'Thread.dump_to_file', '-format=json', `"${path}"`]);
                const threads = ['cpu-hot-worker', 'parked-worker', 'sleeping-worker', 'lock-owner', 'lock-waiter'].map(name => ({
                    name: `example-virtual-${name}`, state: name === 'cpu-hot-worker' ? 'RUNNABLE' : name === 'sleeping-worker' ? 'TIMED_WAITING' : 'WAITING',
                }));
                add('tda', 'json-v1', 'virtual-v1.json', { scenario: 'json-v1', snapshots: 1, threads });
            } finally { await owned.stop(); }
        });
        if (material !== 'tls' && entry.major < 21) report.cases.push({ analyzer: 'tda', id: 'virtual-json', status: 'unavailable', error: 'Virtual-thread file capture requires Java 21+' });
        if (material !== 'tda') await attempt('tls', 'tls-setup', async () => {
            const tlsProbe = command(home, 'java', [...javaBase, '-cp', work, 'TlsWorkload', 'probe']);
            writeFileSync(join(work, 'tls-runtime.txt'), tlsProbe);
            const properties = Object.fromEntries(tlsProbe.trim().split(/\r?\n/).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
            report.runtime.provider = properties.provider;
            report.runtime.protocols = properties.protocols;
            const store = join(work, 'fixture.jks');
            command(home, 'keytool', ['-genkeypair', '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048', '-sigalg', 'SHA256withRSA', '-dname', 'CN=localhost,O=JvmScope controlled sample', '-validity', '30', '-keystore', store, '-storetype', 'JKS', '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-noprompt']);
            const untrustedStore = join(work, 'untrusted.jks');
            command(home, 'keytool', ['-genkeypair', '-alias', 'other', '-keyalg', 'RSA', '-keysize', '2048', '-sigalg', 'SHA256withRSA', '-dname', 'CN=unrelated-test-anchor,O=JvmScope controlled sample', '-validity', '30', '-keystore', untrustedStore, '-storetype', 'JKS', '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-noprompt']);
            const protocols = ['TLSv1.2', 'TLSv1.3'].filter(p => report.runtime.protocols.includes(p));
            if (!protocols.length) report.cases.push({ analyzer: 'tls', id: 'protocols', status: 'unavailable', error: `No enabled TLS 1.2/1.3 protocols: ${report.runtime.protocols}` });
            for (const protocol of protocols) for (const scenario of ['success', 'untrusted', 'mutual', 'optional-client-auth', 'required-client-auth', 'resumption']) {
                const id = `${protocol.toLowerCase()}-${scenario}`;
                await attempt('tls', id, async () => {
                    const portPath = join(work, `${id}-port.txt`), serverOracle = join(work, `${id}-server-oracle.txt`), clientOracle = join(work, `${id}-client-oracle.txt`);
                    const args = [...javaBase, '-Djavax.net.debug=ssl,handshake', '-cp', work, 'TlsWorkload'];
                    const serverFile = `${id}-server.txt`;
                    const server = start([...args, 'server', store, protocol, scenario, portPath, serverOracle], `${id}-server`, join(directory, serverFile), portPath);
                    try {
                        await server.ready(); const port = String(readReadyPort(portPath));
                        const clientLog = join(directory, `${id}-client.txt`), fd = openSync(clientLog, 'w');
                        try { command(home, 'java', [...args, 'client', store, protocol, scenario, port, clientOracle, untrustedStore], { stdio: ['ignore', fd, fd] }); }
                        finally { closeSync(fd); }
                        await server.finish();
                        for (const [side, oraclePath] of [['client', clientOracle], ['server', serverOracle]]) {
                            const results = readFileSync(oraclePath, 'utf8').trim().split(/\r?\n/).map(line => {
                                const [kind, first, ...rest] = line.split('|');
                                if (kind === 'SUCCESS') return { outcome: 'success', protocol: first, cipher: rest.join('|') };
                                if (kind === 'FAILURE') return { outcome: 'failure', exception: first, message: rest.join('|') };
                                throw new Error(`Invalid TLS workload result: ${line}`);
                            });
                            add('tls', `${id}-${side}`, `${id}-${side}.txt`, { protocol, scenario, side, results }, report.runtime.provider.startsWith('SunJSSE '));
                        }
                    } finally { await server.stop(); }
                });
            }
        });
        report.status = report.cases.some(c => ['capture-error', 'validation-error'].includes(c.status)) ? 'partial' : 'complete';
    } catch (e) { report.error = e.message; }
    finally {
        report.transformation = 'Classic sequence: complete stdout dumps, LF normalization and actual collector ISO timestamps. TLS: complete merged stdout/stderr in emission order. File dumps: unchanged JVM bytes.';
        saveJson(join(directory, 'report.json'), report);
    }
    return report;
}

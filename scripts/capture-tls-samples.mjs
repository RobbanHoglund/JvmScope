// node scripts/capture-tls-samples.mjs <javac/keytool JDK> <runtime home> <label> <output-dir> [protocol] [scenario] [expand]
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readReadyPort } from './jvm-samples/port-file.mjs';
import { sampleEnvironment } from './sample-environment.mjs';

const [compiler, runtime, label, output, protocol = 'TLSv1.2', scenario = 'success', expand] = process.argv.slice(2);
if (!output) throw new Error('Supply compiler JDK, runtime, label and output directory');
const exe = (home, name) => join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const temp = mkdtempSync(join(tmpdir(), 'tls-samples-'));
const children = [];
function run(home, name, args) {
    const result = spawnSync(exe(home, name), args, { encoding: 'utf8', timeout: 30000, windowsHide: true, env: sampleEnvironment() });
    if (result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
}
try {
    run(compiler, 'javac', ['--release', '8', '-d', temp, resolve(import.meta.dirname, '../tools/tls-log-generator/TlsRegressionSample.java')]);
    const store = join(temp, 'fixture.jks');
    run(compiler, 'keytool', ['-genkeypair', '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048', '-sigalg', 'SHA256withRSA', '-dname', 'CN=localhost,O=TLS regression sample', '-validity', '3650', '-ext', 'SAN=dns:localhost', '-keystore', store, '-storetype', 'JKS', '-storepass', 'fixture-only', '-keypass', 'fixture-only', '-noprompt']);
    const base = ['-Duser.language=en', '-Duser.country=US', '-Duser.timezone=UTC', `-Djavax.net.debug=ssl,handshake${expand ? ',expand' : ''}`, '-cp', temp, 'TlsRegressionSample'];
    const serverLog = join(temp, 'server.log');
    const clientLog = join(temp, 'client.log');
    const portFile = join(temp, 'port.txt');
    const serverFd = openSync(serverLog, 'w');
    const server = spawn(exe(runtime, 'java'), [...base, 'server', store, protocol, scenario, portFile], { windowsHide: true, stdio: ['ignore', serverFd, serverFd], env: sampleEnvironment() });
    closeSync(serverFd);
    children.push(server);
    const serverExit = once(server, 'close');
    const deadline = Date.now() + 15000;
    while (readReadyPort(portFile) == null) {
        if (Date.now() > deadline || server.exitCode != null) throw new Error('Server startup failed');
        await new Promise(resolvePoll => setTimeout(resolvePoll, 50));
    }
    const port = String(readReadyPort(portFile));
    const clientFd = openSync(clientLog, 'w');
    const client = spawnSync(exe(runtime, 'java'), [...base, 'client', store, protocol, scenario, port], { timeout: 20000, windowsHide: true, stdio: ['ignore', clientFd, clientFd], env: sampleEnvironment() });
    closeSync(clientFd);
    if (client.status !== 0) throw new Error(String(client.error || 'Client JVM failed'));
    await serverExit;
    mkdirSync(output, { recursive: true });
    const name = `${label}-${protocol.toLowerCase()}-${scenario}${expand ? '-expand' : ''}`;
    for (const [side, path] of [['client', clientLog], ['server', serverLog]]) {
        const log = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
        const results = [...log.matchAll(/^RESULT=(.+)$/gm)].map(match => match[1]);
        const expectedSuccess = !['untrusted', 'required-client-auth'].includes(scenario);
        if (Boolean(results.length) !== expectedSuccess) throw new Error(`Unexpected ${side} result: ${results}`);
        writeFileSync(join(output, `${name}-${side}.txt`), log.replace(/^RESULT=.+\n/gm, ''));
        console.log(`${name}-${side}: ${results.join('; ') || 'expected handshake failure'}`);
    }
} finally {
    for (const child of children) if (child.exitCode == null && child.pid) { const exited = once(child, 'exit'); child.kill(); await exited; }
    if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary directory');
    rmSync(temp, { recursive: true, force: true });
}

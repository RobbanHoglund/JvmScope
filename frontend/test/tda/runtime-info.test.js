import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeThreadDump, splitThreadDumpSnapshots } from '../../assets/javautils/tda/parser.js';
import { runtimeInfoMarkup } from '../../assets/javautils/tda/runtime-info.js';

const classic = (jdk = '', vm = 'OpenJDK 64-Bit Server VM (26-internal mixed mode, sharing)', name = 'worker') =>
    `2026-11-03 12:00:00\nFull thread dump ${vm}\n${jdk ? `                 ${jdk}\n` : ''}\n"${name}" #1 prio=5 tid=0x1 nid=1 runnable\n   java.lang.Thread.State: RUNNABLE\n\tat example.Work.run(Work.java:1)\n`;

for (const [major, javaVersion, runtimeVersion] of [[26, '26.0.2.1+1', '26.0.2.1+1-7'], [27, '27.0+35', '27+35-2325']]) {
    test(`reads JDK-8364106 metadata from the real Java ${major} runtime capture`, async () => {
        const text = await readFile(new URL(`./fixtures/runtime/jdk${major}-thread-print.txt`, import.meta.url), 'utf8');
        const result = analyzeThreadDump(text), dump = result.snapshots[0];
        assert.equal(result.status, 'success'); assert.equal(dump.parsedThreads.length, 5);
        assert.equal(dump.runtime.javaVersion, javaVersion);
        assert.equal(dump.runtime.runtimeVersion, runtimeVersion);
        assert.equal(dump.runtime.runtimeDescription, 'OpenJDK Runtime Environment');
        assert.equal(dump.runtime.vmHeaderLine, 2); assert.equal(dump.runtime.jdkHeaderLine, 3);
        assert.equal(dump.parsedThreads[0].rawStartLine, 5);
        assert.equal(text.split('\n')[dump.parsedThreads[0].rawStartLine - 1], dump.parsedThreads[0].rawBlock[0]);
    });
}

test('keeps Oracle names, vendor text and fastdebug/slowdebug build strings exactly as recorded', () => {
    for (const level of ['fastdebug', 'slowdebug']) {
        const [dump] = splitThreadDumpSnapshots(classic(`JDK version: Java(TM) SE Runtime Environment Vendor (custom) (26.0) (${level} build 26-internal-2025-07-28-0739549.dev)`));
        assert.equal(dump.runtime.runtimeDescription, 'Java(TM) SE Runtime Environment Vendor (custom)');
        assert.equal(dump.runtime.debugLevel, level);
        assert.equal(dump.runtime.runtimeVersion, '26-internal-2025-07-28-0739549.dev');
        assert.equal(dump.runtime.vmVersion, '26-internal');
    }
});

test('keeps mixed old/new snapshots independent, including CRLF, BOM and Java 8 VM versions', () => {
    const text = '\uFEFF' + (classic('', 'Java HotSpot(TM) 64-Bit Server VM (25.492-b09 mixed mode):', 'java8')
        + classic('JDK version: OpenJDK Runtime Environment Temurin-26+35 (26.0+35) (build 26+35)', undefined, 'java26')
        + classic('', 'OpenJDK 64-Bit Server VM (17.0.20+8 mixed mode):', 'java17')).replaceAll('\n', '\r\n');
    const result = analyzeThreadDump(text); assert.equal(result.snapshots.length, 3);
    const [old, modern, last] = result.snapshots;
    assert.equal(old.runtime.vmVersion, '25.492-b09'); assert.equal(old.runtime.javaVersion, null);
    assert.equal(old.runtime.runtimeVersion, null); assert.equal(old.runtime.jdkHeader, null);
    assert.equal(modern.runtime.runtimeVersion, '26+35');
    assert.equal(modern.runtime.runtimeDescription, 'OpenJDK Runtime Environment Temurin-26+35');
    assert.equal(last.runtime.runtimeVersion, null);
    for (const dump of result.snapshots) assert.equal(dump.parsedThreads.length, 1);
    assert.match(runtimeInfoMarkup(old.runtime), /JVM · 25.492-b09/);
    assert.doesNotMatch(runtimeInfoMarkup(old.runtime), /Java runtime · 25/);
});

test('reads a backported JDK header without a Java 26 version gate', () => {
    const text = classic('JDK version: OpenJDK Runtime Environment (21.0.13+8) (build 21.0.13+8-LTS)', 'OpenJDK 64-Bit Server VM (21.0.13+8-LTS mixed mode, sharing)');
    const [dump] = splitThreadDumpSnapshots(text);
    assert.equal(dump.runtime.javaVersion, '21.0.13+8');
    assert.equal(dump.runtime.runtimeVersion, '21.0.13+8-LTS');
    assert.equal(analyzeThreadDump(text).snapshots[0].parsedThreads.length, 1);
});

test('does not harvest a fake JDK header from a thread body or a different snapshot', () => {
    const text = classic() + '                 JDK version: Fake (99) (build 99+1)\n';
    assert.equal(splitThreadDumpSnapshots(text)[0].runtime.runtimeVersion, null);
    const malformed = splitThreadDumpSnapshots(classic('JDK version: Unexpected incomplete text'))[0];
    assert.equal(malformed.runtime.runtimeVersion, null);
    assert.match(runtimeInfoMarkup(malformed.runtime), /Unexpected incomplete text/);
    assert.equal(analyzeThreadDump(classic('JDK version: Unexpected incomplete text')).status, 'success');
});

test('handles the optional missing runtime properties allowed by the upstream printer', () => {
    const [dump] = splitThreadDumpSnapshots(classic('JDK version: (26.0) (build )'));
    assert.equal(dump.runtime.javaVersion, '26.0'); assert.equal(dump.runtime.runtimeDescription, null);
    assert.equal(dump.runtime.runtimeVersion, null); assert.equal(dump.runtime.debugLevel, null);
});

test('retains explicit dump-to-file runtime versions without inventing a VM or Java version', async () => {
    const json = await readFile(new URL('./fixtures/runtime/jdk27-dump-to-file.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(json), [dump] = splitThreadDumpSnapshots(json);
    assert.equal(dump.runtime.runtimeVersion, parsed.threadDump.runtimeVersion);
    assert.equal(dump.runtime.javaVersion, undefined);
    const plain = await readFile(new URL('./fixtures/runtime/jdk27-dump-to-file.txt', import.meta.url), 'utf8');
    const [plainDump] = splitThreadDumpSnapshots(plain);
    assert.equal(plainDump.runtime.runtimeVersion, plain.split(/\r?\n/)[2]);
    assert.equal(plainDump.runtime.vmVersion, undefined);
});

test('metadata presentation escapes all captured values and has English/Swedish labels', () => {
    const info = { runtimeVersion: '<img src=x onerror=alert(1)>', runtimeDescription: '<script>alert(1)</script>', vmVersion: '25 & 26' };
    const html = runtimeInfoMarkup(info, 'sv');
    assert.match(html, /Java-runtime/); assert.match(html, /Runtime \/ leverantörstext/);
    assert.match(html, /&lt;img/); assert.match(html, /25 &amp; 26/); assert.doesNotMatch(html, /<img|<script/);
    assert.equal(runtimeInfoMarkup(null), ''); assert.equal(runtimeInfoMarkup({}), '');
});

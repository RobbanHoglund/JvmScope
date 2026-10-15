import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { ROOT, checkReport } from '../../../../scripts/jvm-samples/model.mjs';

const samplesDirectory = join(ROOT, 'testdata/tls-logs');
const evidenceDirectory = join(ROOT, 'testdata/jvm-samples');
const manifest = JSON.parse(readFileSync(join(samplesDirectory, 'manifest.json'), 'utf8'));

test('every public TLS log has provenance and both endpoint perspectives', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.deepEqual(manifest.captures.map(capture => capture.major), [7, 8, 11, 17, 21, 25, 26, 27]);
    const files = manifest.captures.flatMap(capture => capture.samples.map(sample => sample.file));
    assert.equal(new Set(files).size, files.length, 'Duplicate sample filename');
    assert.deepEqual(readdirSync(samplesDirectory).filter(file => file.endsWith('.txt')).sort(), files.sort());
    for (const file of files) {
        const otherSide = file.endsWith('-client.txt') ? file.replace(/-client\.txt$/, '-server.txt')
            : file.replace(/-server\.txt$/, '-client.txt');
        assert.ok(files.includes(otherSide), `Missing endpoint pair for ${file}`);
    }
});

for (const capture of manifest.captures) {
    const report = JSON.parse(readFileSync(join(evidenceDirectory, capture.report), 'utf8'));
    for (const sample of capture.samples) {
        test(`public sample ${sample.file} preserves real JVM evidence and its workload result`, () => {
            assert.equal(capture.report, `${report.id}.json`);
            assert.equal(capture.major, report.major);
            assert.equal(capture.distribution, report.distribution);
            assert.equal(capture.runtimeVersion, report.runtime['java.runtime.version']);
            assert.equal(sample.file, `java${report.major}-${report.distribution}-${sample.caseId}.txt`);
            const original = report.cases.find(item => item.id === sample.caseId);
            assert.equal(original?.analyzer, 'tls');
            assert.equal(original.status, 'verified');
            assert.deepEqual(readFileSync(join(samplesDirectory, sample.file)),
                readFileSync(join(evidenceDirectory, original.file)), 'The captured bytes must remain unchanged');
            // Reuse the existing hash, runtime identity and independent workload-oracle
            // checks against the public copy, including failure origin and client auth.
            checkReport({ ...report, cases: [{ ...original, file: sample.file }] }, samplesDirectory);
        });
    }
}

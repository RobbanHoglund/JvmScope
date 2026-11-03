import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzeThreads } from '../src/analysis.mjs';
import { findingCopy } from '../ui/finding-copy.mjs';

test('Swedish deadlock summary uses the same snapshot evidence as the shared engine', async () => {
    const text = await readFile(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8');
    const report = analyzeThreads([{ text, path: '/sample.txt', name: 'sample.txt' }]);
    for (const snapshot of report.snapshots.items) {
        const original = snapshot.analysis.findings.items.find(f => f.id === 'confirmed-deadlock');
        const translated = findingCopy(original, 'sv');
        assert.match(translated.summary, /2 JVM-rapporterade cykler med 5 rapporterade deltagarposter/);
        assert.match(translated.summary, /5 trådblock matchade/);
        assert.equal(findingCopy(original, 'en').summary, original.summary);
        assert.equal(original.facts.items[0].value, '2');
    }
});

test('missing or ambiguous cycle mappings remain qualified in the translation', () => {
    const f = { id: 'confirmed-deadlock', facts: { items: [
        { label: 'JVM-reported cycles', value: 'Unavailable' },
        { label: 'Matched thread blocks', value: '1' },
        { label: 'Participant mapping warning', value: 'ambiguous name' },
    ] } };
    const translated = findingCopy(f, 'sv');
    assert.match(translated.summary, /cykelrapport saknas/);
    assert.match(translated.summary, /inte matchas entydigt/);
    assert.doesNotMatch(translated.summary, /undefined|NaN|Unavailable/);
});

test('localized heuristics and allocation evidence do not become confirmed diagnoses', () => {
    for (const id of ['possible-livelock', 'possible-starvation', 'allocation-hot', 'class-initialization-stall', 'likely-lock-bottleneck']) {
        const translated = findingCopy({ id }, 'sv');
        assert.equal(translated.original, false);
        assert.match(translated.qualification, /inte|bevisar inte/);
    }
    assert.match(findingCopy({ id: 'allocation-hot' }, 'sv').qualification, /konservativa undre gränser/);
    assert.match(findingCopy({ id: 'infra-hot' }, 'sv').qualification, /roll är en tolkning/);
});

test('future unknown findings preserve original text and explicitly signal untranslated content', () => {
    const future = { id: 'new-rule', title: 'New rule', summary: 'Observed, not proven.', qualification: 'Limited coverage.', recommendation: 'Inspect.' };
    const translated = findingCopy(future, 'sv');
    assert.equal(translated.summary, future.summary);
    assert.equal(translated.qualification, future.qualification);
    assert.equal(translated.original, true);
});

test('compact overviews use measured counts and retain allocation scope and unknown findings', async () => {
    const { findingOverview } = await import('../ui/finding-copy.mjs');
    const f = { id: 'allocation-hot', facts: { items: [{ label: 'Measured hot allocators', value: '2' }] } };
    assert.match(findingOverview(f, 'en'), /2 threads.*Does not measure retained heap/);
    assert.match(findingOverview(f, 'sv'), /2 trådar.*Visar inte kvarhållen heap/);
    const unknown = { id: 'future-rule', summary: 'A qualified observation; not a diagnosis.' };
    assert.equal(findingOverview(unknown, 'en'), unknown.summary);
    const missingCount = { id: 'cpu-hot', summary: 'Counter unavailable.' };
    assert.equal(findingOverview(missingCount, 'en'), missingCount.summary);
});

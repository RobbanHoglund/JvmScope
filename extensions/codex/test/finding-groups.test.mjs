import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzeThreads } from '../src/analysis.mjs';
import { groupFindings } from '../ui/finding-groups.mjs';

const list = items => ({ total: items.length, offset: 0, nextOffset: null, items });
const pair = () => [
    { id: 'observed-lock-contention', severity: 'high', resourceIds: list(['lock:1']), threads: list([{ sourceKey: 'waiter' }]) },
    { id: 'likely-lock-bottleneck', severity: 'medium', resourceIds: list(['lock:1']), threads: list([{ sourceKey: 'holder' }, { sourceKey: 'waiter' }]) },
];
test('real capture groups shared lock evidence without changing or dropping findings', async () => {
    const text = await readFile(new URL('../../../testdata/thread-dumps/real-java-all-3-snapshots.txt', import.meta.url), 'utf8');
    for (const snapshot of analyzeThreads([{ text, path: '/sample.txt', name: 'sample.txt' }]).snapshots.items) {
        const findings = snapshot.analysis.findings.items, before = structuredClone(findings);
        const groups = groupFindings(findings), grouped = groups.find(g => g.finding.id === 'observed-lock-contention');
        assert.equal(grouped.related[0].id, 'likely-lock-bottleneck');
        assert.equal(grouped.finding.severity, 'high');
        assert.equal(grouped.related[0].severity, 'medium');
        assert.equal(groups.flatMap(g => [g.finding, ...g.related]).length, findings.length);
        assert.deepEqual(findings, before);
    }
});
test('equal counts, unrelated threads and incomplete evidence never establish a grouping', () => {
    for (const mutate of [
        ([, f]) => { f.resourceIds.items = ['other-lock']; },
        ([, f]) => { f.threads.items[1].sourceKey = 'unrelated-waiter'; },
        ([f]) => { f.resourceIds.total = 2; f.resourceIds.nextOffset = 1; },
        ([, f]) => { f.threads.offset = 1; },
        ([f]) => { f.threads.items[0].sourceKey = null; },
        ([f]) => { f.resourceIds = list([]); },
    ]) {
        const findings = pair(); mutate(findings);
        assert.equal(groupFindings(findings).length, 2);
        assert.ok(groupFindings(findings).every(g => !g.related.length));
    }
    const future = { id: 'future-rule' };
    assert.deepEqual(groupFindings([future]), [{ finding: future, related: [] }]);
});

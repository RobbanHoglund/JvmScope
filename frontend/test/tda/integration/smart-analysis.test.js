import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { analyzeThreadDump, parseDeadlocks } from '../../../assets/javautils/tda/parser.js';
import { annotateDeadlocks } from '../../../assets/javautils/tda/deadlocks.js';
import { analyzeSnapshotProblems } from '../../../assets/javautils/tda/smart-analysis.js';
import { annotateLockPrecedence } from '../../../assets/javautils/tda/lock-precedence.js';
import { renderSmartAnalysisResources } from '../../../assets/javautils/tda/smart-analysis-view.js';
import { correlateThreadsAcrossSnapshots } from '../../../assets/javautils/tda/identity.js';
import { isPossibleStarvationCandidate } from '../../../assets/javautils/tda/classification.js';

// Synthetic classic-format samples exercise adversarial analysis and UI boundaries.

test('sample requires the second exact snapshot before repeated contention becomes eligible', () => {
    const raw = readFileSync(new URL('../fixtures/repeated-contention.txt', import.meta.url), 'utf8');
    const parsed = analyzeThreadDump(raw);
    assert.equal(parsed.status, 'success');
    const correlation = correlateThreadsAcrossSnapshots(parsed.snapshots.map(s => ({ ...s, threads: s.parsedThreads })));
    annotateLockPrecedence(correlation.dumps, correlation.series);
    assert.equal(correlation.dumps.length, 2);
    const owners = correlation.dumps.map(s => s.threads.find(t => t.threadName === 'owner'));
    assert.equal(owners[0].elapsedS, 600);
    assert.equal(isPossibleStarvationCandidate(owners[0]), false);
    assert.equal(isPossibleStarvationCandidate(owners[1]), true);
});

test('sample retains all seven unambiguous lock resources and excludes ambiguous owners', () => {
    const raw = readFileSync(new URL('../fixtures/smart-contention-edge-cases.txt', import.meta.url), 'utf8');
    const parsed = analyzeThreadDump(raw);
    assert.equal(parsed.status, 'success');
    const snapshot = { ...parsed.snapshots[0], threads: parsed.snapshots[0].parsedThreads };
    annotateLockPrecedence([snapshot], []);
    const result = analyzeSnapshotProblems({ snapshot });
    const finding = result.findings.find(f => f.id === 'likely-lock-bottleneck');
    assert.equal(finding.resourceIds.length, 7);
    assert.equal(finding.threads.length, 14);
    assert.ok(finding.threads.every(t => !t.name.startsWith('ambiguous-')));
    const html = renderSmartAnalysisResources(finding);
    assert.match(html, /Show all 7 resources/);
    assert.match(html, />0xa7<\/span>/);
});

test('missing deadlock participant blocks preserve the JVM report and expose mapping failures', () => {
    const raw = readFileSync(new URL('../fixtures/unmapped-deadlock-participants.txt', import.meta.url), 'utf8');
    const parsed = analyzeThreadDump(raw);
    const snapshot = parsed.snapshots[0];
    const threads = snapshot.parsedThreads;
    const deadlocks = parseDeadlocks(snapshot.rawText);
    const identityWarnings = annotateDeadlocks(threads, deadlocks);
    const result = analyzeSnapshotProblems({ snapshot: { ...snapshot, threads, deadlocks, diagnostics: { identityWarnings } }, analysisStatus: parsed.status, parserWarnings: parsed.warnings });
    const finding = result.findings.find(f => f.id === 'confirmed-deadlock');
    assert.equal(finding.severity, 'critical');
    assert.match(finding.summary, /2 reported participant entries/);
    assert.match(finding.summary, /0 thread blocks matched/);
    assert.match(finding.summary, /missing or ambiguous/);
    assert.equal(finding.threads.length, 0, 'unrelated threads must not appear in Focus');
    assert.equal(finding.facts.filter(f => f.label === 'Participant mapping warning').length, 4);
});

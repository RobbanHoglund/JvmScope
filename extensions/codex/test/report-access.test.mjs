import test from 'node:test';
import assert from 'node:assert/strict';
import { createReports } from '../src/reports.mjs';
import { createReportAccess } from '../src/report-access.mjs';
import { createAssessmentCache } from '../ui/assessment-cache.mjs';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const makeReport = () => ({ analyzer: 'threads', snapshotCount: 1,
    sources: [{ path: '/selected.txt', sha256: 'a'.repeat(64) }], snapshots: { total: 1, offset: 0, limit: 1, items: [{ index: 0 }] } });

test('expiry and eviction recover only when a matching source reference is supplied', async () => {
    let time = 0, runs = 0;
    const reports = createReports({ maxEntries: 1, ttlMs: 10, now: () => time });
    const access = createReportAccess({ reports, version: 'test', jobs: { async run(name, args) {
        runs++; assert.equal(name, 'analyze_thread_dumps'); assert.deepEqual(args.expectedSources, makeReport().sources); return makeReport();
    } } });
    const original = makeReport(), id = access.add(original), context = original.reportContext;
    await access.ensure(id, context); assert.equal(runs, 0, 'A warm render does not reparse or reread');
    time = 10;
    await assert.rejects(access.ensure(id), { code: 'REPORT_NOT_AVAILABLE' });
    await access.ensure(id, context); assert.equal(runs, 1);
    assert.equal(reports.get(id).reportId, id);
    access.add(makeReport());
    await access.ensure(id, context); assert.equal(runs, 2);
    await assert.rejects(access.ensure(id, { ...context, pluginVersion: 'other' }), { code: 'REPORT_VERSION_MISMATCH' });
});

test('concurrent recovery coalesces analysis and a failed attempt does not prevent retry', async () => {
    const reports = createReports(); let runs = 0, fail = true;
    const jobs = { async run() {
        runs++; await new Promise(resolve => setTimeout(resolve, 5));
        if (fail) throw new Error('Source unavailable'); return makeReport();
    } };
    const access = createReportAccess({ reports, version: 'test', jobs });
    const report = makeReport(), id = access.add(report), context = report.reportContext;
    const cold = createReportAccess({ reports: createReports(), version: 'test', jobs });
    const results = await Promise.allSettled([cold.ensure(id, context), cold.ensure(id, context)]);
    assert.equal(results.filter(r => r.status === 'rejected').length, 2); assert.equal(runs, 1);
    fail = false;
    await Promise.all([cold.ensure(id, context), cold.ensure(id, context)]); assert.equal(runs, 2);
});

test('widget assessments survive backend cache loss only within their exact report, view, snapshot and thread selection', () => {
    const saved = createAssessmentCache(), scope = { view: 'snapshot', snapshots: [0] };
    const assessment = { reportId: 'one', scope, origin: 'assistant', summary: 'Observed wait.', nextCheck: 'Compare another dump.' };
    saved.resolve(assessment, 'one', scope);
    assert.equal(saved.resolve(null, 'one', scope), assessment);
    assert.equal(saved.resolve(null, 'two', scope), null);
    assert.equal(saved.resolve(null, 'one', { ...scope, snapshots: [1] }), null);
    assert.equal(saved.resolve(null, 'one', { view: 'threads', snapshots: [0], sourceKeys: ['main'] }), null);
    assert.equal(saved.resolve(null, 'one', { view: 'comparison', snapshots: [0] }), null);
});

test('a recovery reference must fit the response budget before it can evict an accepted report', () => {
    const reports = createReports({ maxEntries: 1 }), access = createReportAccess({ reports, version: 'test', jobs: {} });
    const id = access.add(makeReport()), oversized = makeReport();
    oversized.sources[0].path = '/' + 'a'.repeat(270000);
    assert.throws(() => access.add(oversized), /512 KiB/);
    assert.equal(reports.get(id).reportId, id);
});

test('example recovery compares canonical paths and still rejects a different file with the same name', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jvmscope example '));
    try {
        await mkdir(path.join(directory, 'sub'));
        const file = path.join(directory, 'demo.txt'); await writeFile(file, 'sample');
        const report = makeReport(); report.sources[0].path = await realpath(file); report.example = { synthetic: true };
        const first = createReportAccess({ reports: createReports(), jobs: {}, version: 'test' });
        const id = first.add(report);
        const alias = `${directory}${path.sep}sub${path.sep}..${path.sep}demo.txt`;
        let reads = 0;
        const jobs = { async run() { reads++; return structuredClone(report); } };
        const resumed = createReportAccess({ reports: createReports(), jobs, version: 'test', example: { path: alias, definition: report.example } });
        await resumed.ensure(id, report.reportContext); assert.equal(reads, 1);
        const unrelated = createReportAccess({ reports: createReports(), jobs, version: 'test', example: { path: path.join(directory, 'sub', 'demo.txt') } });
        await writeFile(path.join(directory, 'sub', 'demo.txt'), 'different');
        await assert.rejects(unrelated.ensure(id, report.reportContext), { code: 'REPORT_CONTEXT_MISMATCH' });
        assert.equal(reads, 1);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
    getInputFeedback,
    getInputDialogFeedback,
    inputSourceLabel,
} from '../../assets/javautils/tda/input-feedback.js';
import { parseThreadDumpSession } from '../../assets/javautils/tda/session.js';

test('labels supported input sources without exposing browser paths', () => {
    assert.equal(inputSourceLabel({ kind: 'file', name: 'C:\\fakepath\\dump.log' }), 'dump.log');
    assert.equal(inputSourceLabel({ kind: 'clipboard' }), 'Clipboard input');
    assert.equal(inputSourceLabel({ kind: 'drop', name: 'snapshot.txt' }), 'snapshot.txt');
    assert.equal(inputSourceLabel({ kind: 'sample' }), 'Built-in sample');
});

test('returns actionable feedback for empty and unsupported input', () => {
    assert.deepEqual(getInputFeedback({ status: 'empty', warnings: [] }), {
        severity: 'error',
        summary: 'No thread dump content was provided.',
        guidance: 'Choose, drop, or paste a non-empty HotSpot thread dump in text or JSON format.',
    });
    assert.equal(
        getInputFeedback({ status: 'unsupported', warnings: ['No supported thread headers found.'] }).guidance,
        'Verify that the input contains a complete HotSpot Thread.print/jstack dump or Thread.dump_to_file text/JSON output.',
    );
});

test('preserves parser warnings for partial input with recovery guidance', () => {
    const feedback = getInputFeedback({
        status: 'partial',
        warnings: ['One snapshot was truncated.'],
    });
    assert.equal(feedback.severity, 'warning');
    assert.equal(feedback.summary, 'One snapshot was truncated.');
    assert.match(feedback.guidance, /available snapshots/i);
});

test('returns no message for successful analysis', () => {
    assert.equal(getInputFeedback({ status: 'success' }), null);
});

test('invalid and malformed JSON inputs give errors without claiming the existing session was replaced', () => {
    for (const text of ['unrelated application log', '{"threadDump":', '\u0000\u0001not a dump']) {
        const { sourceResults } = parseThreadDumpSession([{ name: 'C:\\fakepath\\bad.json', kind: 'file', text }]);
        const model = getInputDialogFeedback({ sourceResults, previousSnapshotCount: 3, mode: 'replace' });
        assert.equal(model.severity, 'error');
        assert.equal(model.title, 'Invalid thread dump');
        assert.equal(model.notes[0].label, 'bad.json');
        assert.match(model.outcome, /current session was kept/);
        assert.match(model.outcome, /No new snapshots/);
        assert.match(model.guidance, /Thread.dump_to_file text\/JSON/);
    }
});

test('empty files explain missing content and distinguish an empty analyzer from a preserved session', () => {
    const { sourceResults } = parseThreadDumpSession([{ name: 'empty.txt', text: '\n  \t' }]);
    const model = getInputDialogFeedback({ sourceResults });
    assert.equal(model.title, 'Empty thread dump');
    assert.equal(model.severity, 'error');
    assert.equal(model.outcome, 'No snapshots were loaded.');
    assert.match(model.notes[0].guidance, /text or JSON/);
});

test('partial captures use warnings and report the actual accepted snapshot count', async () => {
    const text = await readFile(join(import.meta.dirname, 'fixtures/partial-thread-snapshot.txt'), 'utf8');
    const { sourceResults } = parseThreadDumpSession([{ name: 'partial.txt', text }]);
    const model = getInputDialogFeedback({ sourceResults, previousSnapshotCount: 2 });
    assert.equal(model.severity, 'warning');
    assert.equal(model.title, 'Thread dump loaded with warnings');
    const loaded = sourceResults[0].snapshotCount;
    assert.match(model.outcome, new RegExp(`${loaded} snapshots? added`));
    assert.match(model.outcome, new RegExp(`contains ${loaded + 2} snapshots`));
    assert.match(model.notes[0].message, /could not be parsed/);
});

test('mixed batches isolate rejected/read-failed sources and use correct Add versus Replace counts', () => {
    const sourceResults = [
        { label: 'good.txt', accepted: true, status: 'success', snapshotCount: 2 },
        { label: '<img src=x>.txt', accepted: false, status: 'unsupported', warnings: ['No supported thread headers found.'] },
    ];
    for (const [mode, total, verb] of [['append', 5, 'added'], ['replace', 2, 'loaded']]) {
        const model = getInputDialogFeedback({ sourceResults, previousSnapshotCount: 3, mode, failures: ['unreadable.txt could not be read.'] });
        assert.equal(model.severity, 'warning');
        assert.match(model.outcome, new RegExp(`2 snapshots ${verb}.*contains ${total} snapshots`));
        assert.doesNotMatch(model.outcome, /session was kept/);
        assert.equal(model.notes.length, 2);
        assert.equal(model.notes[0].label, '<img src=x>.txt');
        assert.match(model.notes[1].message, /unreadable/);
    }
});

test('read failures are errors while clipboard notices retain their supplied warning/info severity', () => {
    const failed = getInputDialogFeedback({ failures: ['broken.txt could not be read.'], previousSnapshotCount: 1 });
    assert.equal(failed.title, 'Could not read thread dump file');
    assert.equal(failed.severity, 'error');
    assert.match(failed.outcome, /session was kept/);
    for (const severity of ['warning', 'info', 'error']) {
        const model = getInputDialogFeedback({ previousSnapshotCount: 1, notice: { severity, title: 'Clipboard', summary: 'Unavailable', guidance: 'Try Paste again.' } });
        assert.equal(model.severity, severity);
        assert.match(model.outcome, /session was kept/);
        assert.deepEqual(model.notes, []);
    }
});

test('valid submissions and cancelled/empty batches do not create dialogs or repeat previous warnings', () => {
    assert.equal(getInputDialogFeedback(), null);
    assert.equal(getInputDialogFeedback({ sourceResults: null, failures: null, previousSnapshotCount: NaN }), null);
    assert.equal(getInputDialogFeedback({ previousSnapshotCount: 5,
        sourceResults: [{ accepted: true, status: 'success', snapshotCount: 1 }] }), null);
    assert.equal(getInputDialogFeedback({ notice: { severity: 'unknown' } }).severity, 'error');
});

test('places input failures before diagnostic panels and charts', async () => {
    const markup = await readFile(join(import.meta.dirname, '../../jvmscope/tda.html'), 'utf8');
    const loadingStateIndex = markup.indexOf('id="loadingState"');
    const errorStateIndex = markup.indexOf('id="errorState"');

    assert.notEqual(loadingStateIndex, -1);
    assert.notEqual(errorStateIndex, -1);
    assert.ok(loadingStateIndex < errorStateIndex, 'Expected loadingState before errorState');
    for (const id of ['deadlockPanel', 'classInitializationPanel', 'dependencyGraphPanel', 'threadStateChartPanel']) {
        const panelIndex = markup.indexOf(`id="${id}"`);
        assert.notEqual(panelIndex, -1);
        assert.ok(loadingStateIndex < panelIndex, `Expected loadingState before ${id}`);
        assert.ok(errorStateIndex < panelIndex, `Expected errorState before ${id}`);
    }
});

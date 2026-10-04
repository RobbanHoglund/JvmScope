import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { analyzeTlsLog } from '../../assets/javautils/tls-parser.js';
import { prepareTlsAnalysis } from '../../assets/javautils/tls-analysis-model.js';

// A minimal DOM adapter runs the real tls.js listeners and parser without a browser dependency.
function element() {
    const listeners = new Map();
    const classes = new Set();
    return {
        textContent: '', innerHTML: '', value: '', checked: false, files: [], scrollLeft: 0,
        dataset: {},
        classList: {
            add(name) { classes.add(name); },
            remove(name) { classes.delete(name); },
            contains(name) { return classes.has(name); },
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        setAttribute() {},
        addEventListener(type, listener) {
            const registered = listeners.get(type) || [];
            registered.push(listener);
            listeners.set(type, registered);
        },
        async emit(type, event = {}) {
            await Promise.all((listeners.get(type) || []).map(listener => listener(event)));
        },
    };
}

const elements = new Map();
const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
};
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = globalThis.fetch;
const originalWorker = globalThis.Worker;
// The adapter exercises the actual listeners with asynchronous, cloned data.
// Native worker loading/cancellation is also covered in Chromium regressions.
globalThis.Worker = class {
    stopped = false;
    terminate() { this.stopped = true; }
    postMessage({ text }) {
        queueMicrotask(() => {
            if (this.stopped) return;
            const analysis = analyzeTlsLog(text);
            this.onmessage({ data: structuredClone({ result: { analysis, entries: prepareTlsAnalysis(analysis.interactions) } }) });
        });
    }
};
globalThis.fetch = async url => new Response(await readFile(new URL(url), 'utf8'));
globalThis.document = {
    getElementById: getElement,
    querySelectorAll(selector) {
        return selector === '#analyzerStart, #tableContainer'
            ? [getElement('analyzerStart'), getElement('tableContainer')] : [];
    },
    addEventListener() {},
};
globalThis.window = { addEventListener() {} };
await import('../../assets/javautils/tls.js');

after(() => {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
    globalThis.fetch = originalFetch;
    for (const [name, original] of [['document', originalDocument], ['window', originalWindow]]) {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
    }
});
beforeEach(async () => { await getElement('clearBtn').emit('click'); });

const log = marker => `javax.net.ssl|ERROR|01|fixture|2026-09-01 10:00:00.000 GMT|TransportContext.java:1|Fatal (HANDSHAKE_FAILURE): ${marker}`;

function pendingFile(name) {
    let resolve;
    let reject;
    const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
    return { file: { name, text: () => promise }, resolve, reject };
}

function select(file) {
    getElement('fileInput').files = [file];
    return getElement('fileInput').emit('change');
}

function drop(file) {
    return getElement('tableContainer').emit('drop', {
        preventDefault() {}, stopPropagation() {}, dataTransfer: { files: [file] },
    });
}

function displayedDataset() {
    return {
        name: getElement('fileName').textContent,
        rows: getElement('tlsTableBody').innerHTML,
        count: getElement('rowCount').textContent,
        selection: getElement('tlsAnalysisCount').textContent,
        chart: getElement('tlsTimeline').innerHTML,
        filters: getElement('tlsActiveFilters').innerHTML,
    };
}

test('a pending file selection cannot overwrite the sample or its filename', async () => {
    const older = pendingFile('older.log');
    const reading = select(older.file);
    await getElement('loadSampleBtn').emit('click');
    const sample = displayedDataset();
    assert.equal(sample.name, 'comprehensive-sample.log');
    assert.notEqual(sample.rows, '');

    older.resolve(log('old file marker'));
    await reading;
    assert.deepEqual(displayedDataset(), sample);
});

test('Clear invalidates a dropped file and removes its pending loading state', async () => {
    const older = pendingFile('dropped.log');
    const reading = drop(older.file);
    assert.equal(getElement('loadingState').classList.contains('hidden'), false);
    await getElement('clearBtn').emit('click');
    const cleared = displayedDataset();
    assert.equal(cleared.name, 'No file loaded');
    assert.equal(cleared.count, '0 / 0 interactions');
    assert.equal(getElement('loadingState').classList.contains('hidden'), true);

    older.resolve(log('old dropped marker'));
    await reading;
    assert.deepEqual(displayedDataset(), cleared);
});

test('file picker and drop share one ordering gate even when reads finish in reverse order', async () => {
    const older = pendingFile('older.log');
    const newer = pendingFile('newer.log');
    const firstRead = select(older.file);
    const secondRead = drop(newer.file);
    newer.resolve(log('new file marker'));
    await secondRead;
    const newest = displayedDataset();
    assert.equal(newest.name, 'newer.log');
    assert.equal(newest.count, '1 / 1 interactions');
    assert.match(newest.rows, /new file marker/);

    older.resolve(log('old file marker'));
    await firstRead;
    assert.deepEqual(displayedDataset(), newest);
});

test('an obsolete read error cannot hide the current loader or display an error', async () => {
    const older = pendingFile('older.log');
    const newer = pendingFile('newer.log');
    const firstRead = drop(older.file);
    const secondRead = select(newer.file);
    older.reject(new Error('obsolete read failed'));
    await firstRead;
    assert.equal(getElement('errorState').classList.contains('hidden'), true);
    assert.equal(getElement('loadingState').classList.contains('hidden'), false);

    newer.resolve(log('new file marker'));
    await secondRead;
    assert.equal(getElement('fileName').textContent, 'newer.log');
    assert.equal(getElement('loadingState').classList.contains('hidden'), true);
});

test('a current read failure is contained and clearing suppresses a late failure', async () => {
    const current = pendingFile('unreadable.log');
    const currentRead = select(current.file);
    current.reject(new Error('current read failed'));
    await currentRead;
    assert.match(getElement('errorState').textContent, /Could not read file: current read failed/);
    assert.equal(getElement('loadingState').classList.contains('hidden'), true);

    const obsolete = pendingFile('obsolete.log');
    const obsoleteRead = drop(obsolete.file);
    await getElement('clearBtn').emit('click');
    obsolete.reject(new Error('late failure'));
    await obsoleteRead;
    assert.equal(getElement('errorState').classList.contains('hidden'), true);
    assert.equal(getElement('rowCount').textContent, '0 / 0 interactions');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { parseThreadDump } from '../../assets/javautils/tda/parser.js';
import { formatSnapshotTime } from '../../assets/javautils/tda/time-quality.js';
import { escapeAttr, escapeHtml } from '../../assets/javautils/tda/ui-safety.js';

const fixture = (name) => readFile(join(import.meta.dirname, 'fixtures', name), 'utf8');

function assertNoExecutableMarkup(rendered) {
    assert.doesNotMatch(rendered, /[<>]/);
}

test('escapes dump-derived thread names, stack frames, and lock types as literal text', async () => {
    const [thread] = parseThreadDump(await fixture('malicious-html-content.txt'));
    const rawValues = [
        thread.threadName,
        thread.topFrame,
        thread.waitingLocks[0].lockType,
    ];

    for (const rawValue of rawValues) {
        const rendered = escapeHtml(rawValue);
        assertNoExecutableMarkup(rendered);
        assert.match(rendered, /&lt;/);
        assert.match(rendered, /&gt;/);
    }
});

test('escapes file names and parser warning previews before HTML interpolation', () => {
    const fileName = `dump"><img src=x onerror=alert('file')>.txt`;
    const warningPreview = `<script>alert('preview')</script> & unsupported`;

    const renderedFileName = escapeHtml(fileName);
    const renderedWarning = escapeHtml(warningPreview);
    assertNoExecutableMarkup(renderedFileName);
    assertNoExecutableMarkup(renderedWarning);
    assert.match(renderedFileName, /&quot;&gt;&lt;img/);
    assert.match(renderedWarning, /&lt;script&gt;/);
});

test('escapes quotes and line breaks in untrusted attribute values', () => {
    const rendered = escapeAttr(`"><img src=x onerror='attribute'>\r\nnext`);

    assertNoExecutableMarkup(rendered);
    assert.doesNotMatch(rendered, /[\r\n]/);
    assert.match(rendered, /&quot;&gt;&lt;img/);
    assert.match(rendered, /&#13;&#10;/);
});

test('escapes untrusted timestamp text for HTML and tooltip contexts', () => {
    const presentation = formatSnapshotTime({
        timestampRaw: `"><img src=x onerror='timestamp'>`,
    });
    const renderedHeadline = escapeHtml(presentation.headline);
    const renderedTooltip = escapeAttr(`${presentation.headline}\n${presentation.tooltip}`);

    assertNoExecutableMarkup(renderedHeadline);
    assertNoExecutableMarkup(renderedTooltip);
    assert.match(renderedHeadline, /&quot;&gt;&lt;img/);
    assert.doesNotMatch(renderedTooltip, /[\r\n]/);
});


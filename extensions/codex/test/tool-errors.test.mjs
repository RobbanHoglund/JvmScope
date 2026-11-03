import test from 'node:test';
import assert from 'node:assert/strict';
import { toolErrorCode, toolFailure } from '../src/tool-error.mjs';
import { toolErrorMessage } from '../ui/tool-errors.mjs';

test('report error codes survive transport and have actionable English/Swedish copy without raw tool names', () => {
    for (const code of ['REPORT_NOT_AVAILABLE', 'REPORT_SOURCE_CHANGED', 'REPORT_SOURCE_UNAVAILABLE', 'REPORT_CONTEXT_MISMATCH', 'REPORT_VERSION_MISMATCH']) {
        const error = Object.assign(new Error('Internal detail'), { code });
        assert.equal(toolFailure(error)._meta.jvmscopeError.code, code);
        for (const locale of ['en', 'sv']) {
            const message = toolErrorMessage(error, locale);
            assert.ok(message.length > 40); assert.doesNotMatch(message, /Internal detail|analyze_thread_dumps/);
        }
    }
    const oldServer = new Error('Report expired or belongs to another session. Run analyze_thread_dumps again.');
    assert.match(toolErrorMessage(oldServer, 'sv'), /Analysera filerna på nytt/);
    assert.equal(toolErrorCode(Object.assign(new Error('Missing file'), { code: 'ENOENT' })), 'REPORT_SOURCE_UNAVAILABLE');
    assert.equal(toolErrorCode(new Error('Capture changed since analysis.')), 'REPORT_SOURCE_CHANGED');
    assert.equal(toolErrorMessage(new Error('<img src=x> unknown'), 'sv'), '<img src=x> unknown', 'Unknown detail is retained as text for diagnosis');
});

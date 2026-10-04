import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { TLS_ISSUE_CATALOG } from '../../assets/javautils/tls-issue-catalog.js';
import { ISSUE_EXPLANATIONS, explainIssueText } from '../../assets/javautils/tls-explanations.js';

// Reviewed text references protect complete explanations, including punctuation
// and newlines, independently of their structured projection. Intentional content
// corrections also have semantic assertions in explanations.test.js.
const contract = JSON.parse(readFileSync(new URL('./fixtures/explanation-contract.json', import.meta.url), 'utf8'));
const sha256 = text => createHash('sha256').update(text).digest('hex');

test('the catalogue matches every stable key and reviewed explanation template', () => {
    assert.deepEqual([...ISSUE_EXPLANATIONS.keys()], contract.catalog.map(item => item.key));
    for (const { key, sha256: expected } of contract.catalog) {
        assert.equal(sha256(ISSUE_EXPLANATIONS.get(key)), expected, key);
    }
});

test('the resolver matches reviewed local, received, wrapped and unknown results', () => {
    const inputs = contract.catalog.flatMap(({ key }) => [
        key,
        `Sent fatal alert: ${key}`,
        `Received fatal alert: ${key}`,
        `Fatal (HANDSHAKE_FAILURE): ${key}`,
        `Fatal (HANDSHAKE_FAILURE): Received fatal alert: ${key}`,
    ]).concat(['Fatal (INTERNAL_ERROR): Unexpected error', 'Unexpected error', null, '']);
    const results = inputs.map(text => ({ text, result: explainIssueText(text) }));
    assert.equal(sha256(JSON.stringify(results)), contract.resolutionsSha256);
});

test('catalogue entries have unique stable identities and complete presentation sections', () => {
    assert.equal(new Set(TLS_ISSUE_CATALOG.map(issue => issue.id)).size, TLS_ISSUE_CATALOG.length);
    assert.equal(new Set(TLS_ISSUE_CATALOG.map(issue => issue.matchKey)).size, TLS_ISSUE_CATALOG.length);
    for (const issue of TLS_ISSUE_CATALOG) {
        assert.match(issue.id, /^[a-z][a-z0-9-]*$/);
        const ids = issue.sections.map(section => section.id);
        assert.equal(new Set(ids).size, ids.length, issue.id);
        assert.ok(ids.includes('meaning'), issue.id);
        assert.ok(ids.includes('checks'), issue.id);
        for (const section of issue.sections) {
            assert.ok(section.title.trim(), issue.id);
            assert.notEqual(Array.isArray(section.paragraphs), Array.isArray(section.bullets), issue.id);
            const lines = section.paragraphs ?? section.bullets;
            assert.ok(lines.length, issue.id);
            for (const line of lines) {
                assert.equal(typeof line, 'string', issue.id);
                assert.ok(line.trim(), issue.id);
                for (const [, placeholder] of line.matchAll(/\{([^}]+)\}/g)) {
                    assert.ok(['AlertEndpoint', 'alertEndpoint'].includes(placeholder), `${issue.id}: ${placeholder}`);
                }
            }
        }
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSmartAnalysisThreadButtons, renderSmartAnalysisResources } from '../../assets/javautils/tda/smart-analysis-view.js';

test('all resources remain available beyond the six-item preview', () => {
    const resourceIds = Array.from({ length: 9 }, (_, i) => `0x${i + 1}`);
    const html = renderSmartAnalysisResources({ resourceIds });
    for (const id of resourceIds) assert.equal(html.split(`>${id}</span>`).length - 1, 1);
    assert.match(html, /Resources \(9\)/);
    assert.match(html, /<summary>.*Show all 9 resources/);
    assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
    assert.match(html, /<details[\s\S]*0x9/);
});

test('additional threads retain source identity, escaping and disabled state', () => {
    const threads = Array.from({ length: 10 }, (_, i) => ({ sourceKey: `t${i}`, name: `worker-${i}` }));
    threads[8] = { sourceKey: 't"9', name: '<script>unsafe</script>' };
    threads[9] = { name: 'unmapped' };
    const html = renderSmartAnalysisThreadButtons({ threads });
    assert.equal((html.match(/<button /g) || []).length, 10);
    assert.match(html, /Show all 10 threads/);
    assert.match(html, /data-source-key="t&quot;9"/);
    assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.match(html, /data-source-key="" disabled>unmapped/);
    assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
});

test('empty and exact-preview-size collections need no extra disclosure', () => {
    assert.equal(renderSmartAnalysisResources({ resourceIds: null }), '');
    assert.equal(renderSmartAnalysisThreadButtons({ threads: null }), '');
    assert.doesNotMatch(renderSmartAnalysisResources({ resourceIds: Array(6).fill('<lock>') }), /<details/);
    assert.doesNotMatch(renderSmartAnalysisThreadButtons({ threads: Array(8).fill({ name: 't', sourceKey: 't' }) }), /<details/);
});

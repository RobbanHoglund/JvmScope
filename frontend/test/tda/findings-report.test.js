import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../assets/javautils/tda/analysis.js';
import {createBlockingFinding,reportHtml,reportMarkdown,inputDigest} from '../../assets/javautils/findings-report.js';
import {blockingSequence} from './blocking-fixture.js';

test('findings detach evidence, scope and origin from later dataset/model changes without default raw dumps',async()=>{
    const result=analyzeThreadDumpData(blockingSequence.map(text=>({text,name:'input.txt'})));
    const pattern=result.blockingPatterns.find(p=>p.title==='Dependencies on worker-1');
    const context={datasetRevision:1,filter:'blocked',inputSha256:await inputDigest([{text:blockingSequence.join('\n')}])};
    const f=createBlockingFinding({pattern,snapshotIndex:1,context});
    const exported=reportMarkdown([f]);
    pattern.observations[1].blocker.sourceLabel='new-dataset.txt';context.datasetRevision=99;
    assert.equal(reportMarkdown([f]),exported);
    assert.equal(f.observations.length,1);assert.equal(f.context.datasetRevision,1);
    assert.match(exported,/source snapshot/);assert.match(exported,/snapshot raw lines/);
    assert.match(exported,/not.*whole run/i);assert.match(exported,/full observed history/);
    assert.doesNotMatch(exported,/Full thread dump OpenJDK/);
    assert.equal(createBlockingFinding({pattern,snapshotIndex:1,context,allObservations:true}).observations.length,2);
    assert.throws(()=>createBlockingFinding({pattern,snapshotIndex:2,context}),/Choose a snapshot/);
});
test('hostile log text and notes cannot execute HTML or load resources in HTML or Markdown',()=>{
    const result=analyzeThreadDumpData(blockingSequence.join('\n'));
    const f=createBlockingFinding({pattern:result.blockingPatterns[0],snapshotIndex:1,context:{file:'<script>fetch("https://evil.invalid")</script>'}});
    f.notes='<img src="https://evil.invalid/leak" onerror="alert(1)">\n![x](https://evil.invalid)\n# counterfeit finding';
    f.title='</h2><iframe src="https://evil.invalid">';f.graphic='data:image/svg+xml,<svg onload="alert(1)">';
    const html=reportHtml([f]),md=reportMarkdown([f]);
    assert.doesNotMatch(html,/<script|<iframe|<img /i);assert.match(html,/default-src 'none'/);
    assert.match(html,/&lt;img/);assert.match(md,/\\!\\\[/);assert.match(md,/\\# counterfeit/);
    assert.doesNotMatch(md,/!\[x\]\(https:/);assert.match(html,/User notes/);
});

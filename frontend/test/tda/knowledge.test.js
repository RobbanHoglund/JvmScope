import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTICLES, FEATURES, JAVA_VERSIONS, VERIFIED_DATE, featureState, compareVersions, filterArticles, collectionEvidence } from '../../assets/javautils/knowledge/data.js';
import { parseGeneratedCoverage } from '../../assets/javautils/knowledge/coverage.js';
import { articleSections, renderBlock, sourceLinks, coverageEvidenceUrl } from '../../assets/javautils/knowledge/view.js';
import { articleExcerpt, highlightText, queryTokens, matchRanges, searchFragment, readSearchFragment } from '../../assets/javautils/knowledge/search.js';

test('knowledge content excerpts find practical body text and preserve exact safe text with real section targets',()=>{
    const article=ARTICLES.find(a=>a.id==='thread-dumps');
    const excerpt=articleExcerpt(article,'overwrite');
    assert.equal(excerpt.section,'check');
    assert.match(excerpt.text,/overwrite/);
    assert.ok(excerpt.text.length<=242);
    assert.match(highlightText(excerpt.text,queryTokens('overwrite')),/<mark>overwrite<\/mark>/);
    assert.equal(articleExcerpt(article,'').text,article.summary);
    for(const a of ARTICLES)for(const term of ['memory','CPU','Java']){
        const result=articleExcerpt(a,term);
        assert.ok(['articleIntro','does','versions','benefits','limits','check','measure'].includes(result.section));
    }
});

test('knowledge matching handles numeric boundaries, Unicode and overlapping literal terms without executable markup',()=>{
    assert.deepEqual(queryTokens('"-XX:+UseCompactObjectHeaders" VT'),['usecompactobjectheaders','virtual']);
    assert.deepEqual(queryTokens('x'.repeat(513)),[]);
    assert.deepEqual(matchRanges('Java 27, 127, 27.0',queryTokens('27')).map(r=>r.start),[5,14]);
    assert.deepEqual(matchRanges('éclair ÉCLAIR',queryTokens('éclair')).map(r=>r.start),[0,7]);
    assert.equal(highlightText('CPU cpu',queryTokens('CPU cpu')),'<mark>CPU</mark> <mark>cpu</mark>');
    assert.equal(highlightText('allocation',queryTokens('alloc allocation')),'<mark>allocation</mark>');
    const hostile='<img src="https://evil.invalid/x" onerror="alert(1)">';
    const html=highlightText(hostile,queryTokens('img alert'));
    assert.doesNotMatch(html,/<img|onerror="/);
    assert.match(html,/&lt;/);
    assert.match(html,/<mark>img<\/mark>/);
    assert.match(html,/<mark>alert<\/mark>/);
});

test('knowledge result links use bounded non-executable fragments and never put queries in an HTTP path',()=>{
    const query='CPU allocation & "<script>"';
    const link=new URL('./thread-counters.html?java=17'+searchFragment(query,'limits'),'https://example.test/JvmScope/knowledge/index.html');
    assert.equal(link.pathname,'/JvmScope/knowledge/thread-counters.html');
    assert.equal(link.search,'?java=17');
    assert.deepEqual(readSearchFragment(link.hash),{query,section:'limits'});
    assert.equal(readSearchFragment(searchFragment('cpu','<img>')).section,'articleIntro');
    for(const hash of ['#check','#find='+encodeURIComponent('x'.repeat(513)),'#find=---'])assert.equal(readSearchFragment(hash).query,'');
    assert.equal(searchFragment(''),'');
});

const state = (id, v) => featureState(FEATURES.find(f => f.id === id), v);
test('knowledge metadata distinguishes introduction, preview, product and changing defaults without extrapolation', () => {
    assert.deepEqual(JAVA_VERSIONS, Array.from({length:21},(_,i)=>i+7));
    assert.match(state('compact-headers',23).status,/Not introduced/);
    assert.match(state('compact-headers',24).status,/Experimental; disabled/);
    for(const v of [25,26]) assert.match(state('compact-headers',v).status,/Product; disabled/);
    assert.match(state('compact-headers',27).status,/enabled by default/);
    assert.match(state('compact-headers',28).status,/Outside verified/);
    assert.match(state('virtual-threads',19).status,/Preview/);
    assert.match(state('virtual-threads',20).status,/Preview/);
    assert.match(state('virtual-threads',21).status,/Final/);
    assert.match(state('monitor-unpinning',23).status,/Not introduced/);
    assert.match(state('monitor-unpinning',24).detail,/Native\/foreign/);
    assert.match(FEATURES.find(f=>f.id==='string-dedup').scope,/8u20/);
    assert.match(state('string-dedup',8).status,/update\/GC dependent/);
    assert.match(state('compact-strings',9).detail,/not UTF-8/);
    assert.deepEqual(compareVersions(27,27),[]);
    assert.match(state('g1-default',8).status,/Not introduced/);
    for(const v of [9,17,26]) assert.match(state('g1-default',v).status,/specified server configurations/);
    assert.match(state('g1-default',27).status,/all environments/);
    assert.match(state('g1-default',27).detail,/Explicit collector flags still override/);
    assert.match(state('g1-default',28).status,/Outside verified/);
    assert.ok(FEATURES.find(f=>f.id==='g1-default').sources.includes('https://openjdk.org/jeps/523'));
    const changes=compareVersions(26,27);
    assert.deepEqual(changes.map(row=>row.feature.id),['file-dump-json','compact-headers','class-pointer-option','g1-default']);
    assert.match(compareVersions(27,26).find(row=>row.feature.id==='compact-headers').to.status,/disabled/);
    assert.match(compareVersions(27,26).find(row=>row.feature.id==='g1-default').to.status,/specified server/);
    assert.match(ARTICLES.find(a=>a.id==='gc-memory').versions,/JEP 523/);
});

test('eight knowledge articles are complete, scoped and source-backed, with intersecting local filters', () => {
    assert.equal(ARTICLES.length,8);
    assert.equal(new Set(ARTICLES.map(a=>a.id)).size,8);
    assert.match(VERIFIED_DATE,/^\d{4}-\d{2}-\d{2}$/);
    for(const a of ARTICLES) {
        for(const field of ['summary','does','versions','benefits','limits','check','measure']) assert.ok(a[field]?.length>60,`${a.id} ${field}`);
        assert.ok(a.sources.length>=2);
        assert.ok(a.features.every(id=>FEATURES.some(f=>f.id===id)));
        for(const url of a.sources) assert.ok(/^https:\/\/(?:openjdk\.org\/jeps\/|docs\.oracle\.com\/|www\.oracle\.com\/java\/|github\.com\/openjdk\/jdk\/)/.test(url),url);
        assert.ok(readFileSync(new URL(`../../knowledge/${a.id}.html`,import.meta.url),'utf8').includes('knowledge/knowledge.js'));
    }
    assert.ok(!filterArticles({version:17}).some(a=>a.id==='virtual-threads'));
    assert.equal(filterArticles({query:'  COMPACT STRINGS ',version:27,topic:'memory'}).length,1);
    assert.deepEqual(filterArticles({query:'<script>unknown</script>'}),[]);
    assert.deepEqual(filterArticles({version:28}),[]);
    assert.deepEqual(filterArticles({version:6}),[]);
});

test('selected runtime and collection distinguish availability, optional fields, schemas and unknown VMs',()=>{
    for(const version of [7,8,17,18])for(const format of ['plain','json']){
        const evidence=collectionEvidence({format,version});
        assert.equal(evidence.available,false);
        assert.match(evidence.status,new RegExp(`Not available.*${version}`));
        assert.match(evidence.detail,/classical/);
    }
    for(const version of [19,20]){
        const evidence=collectionEvidence({format:'json',version});
        assert.equal(evidence.available,true);
        assert.match(evidence.detail,/APIs are preview/);
        assert.match(evidence.detail,/command itself is not an instruction to enable preview/);
    }
    const evidence=v=>collectionEvidence({format:'json',version:v});
    assert.match(evidence(21).detail,/limited thread evidence/);
    assert.match(evidence(25).detail,/Per-thread time\/state and lock/);
    assert.match(evidence(25).detail,/String identifiers/);
    assert.match(evidence(26).detail,/AbstractOwnableSynchronizer/);
    assert.match(evidence(26).detail,/String identifiers/);
    assert.match(evidence(27).detail,/formatVersion: 2/);
    assert.match(evidence(27).detail,/identifiers.*numbers/);
    for(const v of [19,21,25,26,27]){
        assert.match(evidence(v).detail,/No CPU\/allocation counters/);
        assert.match(evidence(v).detail,/Separately sampled/);
        assert.ok(evidence(v).facts.every(f=>f.state.sources.length>0 && /^\d{4}-\d{2}-\d{2}$/.test(f.state.verifiedDate)));
    }
    assert.ok(!collectionEvidence({format:'plain',version:27}).facts.some(f=>f.feature.id==='file-dump-json'));
    for(const version of ['',null,6,28,NaN])assert.equal(collectionEvidence({format:'json',version}).available,null);
    assert.equal(collectionEvidence({format:'json',version:27,vm:'unknown'}).available,null);
    assert.equal(collectionEvidence({format:'json',version:27,vm:'openj9'}).available,null);
    assert.equal(collectionEvidence({format:'<script>',version:27}).available,null);
});

test('upgrade metadata preserves collection changes in both directions without attributing all fields to 27',()=>{
    assert.match(state('file-dump-evidence',24).status,/limited thread/);
    assert.match(state('file-dump-evidence',25).status,/Per-thread time\/state/);
    assert.match(state('file-dump-evidence',26).status,/Park-blocker owner/);
    assert.match(state('file-dump-json',26).status,/String identifiers/);
    assert.match(state('file-dump-json',27).status,/numeric identifiers/);
    assert.deepEqual(compareVersions(25,26).map(r=>r.feature.id),['file-dump-evidence']);
    for(const [from,to] of [[21,27],[27,21]]){
        const rows=compareVersions(from,to);
        assert.ok(rows.some(r=>r.feature.id==='file-dump-evidence'));
        assert.ok(rows.some(r=>r.feature.id==='file-dump-json'));
    }
    assert.match(state('class-pointer-option',24).status,/Configuration-dependent/);
    assert.match(state('class-pointer-option',25).status,/Deprecated/);
    assert.match(state('class-pointer-option',26).status,/Deprecated/);
    assert.match(state('class-pointer-option',27).status,/Obsolete/);
    assert.match(state('class-pointer-option',27).detail,/always compresses/);
    for(const v of JAVA_VERSIONS)assert.deepEqual(compareVersions(v,v),[]);
});

test('KB019-01 carrier evidence is JSON-only across the shared collection and upgrade model',()=>{
    for(const version of [25,26,27]){
        const plain=collectionEvidence({format:'plain',version});
        const json=collectionEvidence({format:'json',version});
        assert.ok(!plain.facts.some(f=>['file-dump-carrier','file-dump-json'].includes(f.feature.id)));
        assert.doesNotMatch(plain.detail,/carrier|formatVersion|numeric identifiers/);
        assert.ok(json.facts.some(f=>f.feature.id==='file-dump-carrier'));
        assert.match(json.detail,/Optional mounted virtual-thread carrier identifier/);
        assert.match(json.detail,/JSON may include carrier/);
        assert.match(json.detail,/Plain text does not emit this identifier/);
        if(version>=26)for(const evidence of [plain,json])assert.match(evidence.detail,/AbstractOwnableSynchronizer/);
    }
    for(const version of [19,21,24])assert.match(state('file-dump-carrier',version).status,/No carrier identifier/);
    for(const [from,to] of [[24,25],[25,24]]){
        const row=compareVersions(from,to).find(r=>r.feature.id==='file-dump-carrier');
        assert.ok(row);
        assert.match(row.feature.scope,/JSON only/);
    }
    for(const id of ['thread-dumps','virtual-threads','upgrade-checklist'])assert.ok(ARTICLES.find(a=>a.id===id).features.includes('file-dump-carrier'));
});

test('KB019-02 the separate class-pointer option has sourced Java 7/8 and later lifecycle transitions',()=>{
    assert.match(state('class-pointer-option',7).status,/Separate option unavailable/);
    assert.match(state('class-pointer-option',7).detail,/does not establish.*compression itself is absent/);
    assert.match(state('class-pointer-option',7).sources[0],/\/jdk7u\/blob\/jdk7u80-b15\//);
    assert.match(state('class-pointer-option',8).status,/Configuration-dependent option/);
    assert.match(state('class-pointer-option',8).sources[0],/\/jdk8u\/blob\/jdk8-b132\//);
    for(const [from,to] of [[7,8],[8,7],[24,25],[25,24],[26,27],[27,26]])assert.ok(compareVersions(from,to).some(row=>row.feature.id==='class-pointer-option'));
    for(const version of [7,8])assert.match(sourceLinks(state('class-pointer-option',version).sources),/globals\.hpp/);
    assert.match(state('class-pointer-option',25).status,/Deprecated/);
    assert.match(state('class-pointer-option',26).status,/Deprecated/);
    assert.match(state('class-pointer-option',27).status,/Obsolete/);
    assert.match(state('class-pointer-option',27).detail,/option ignored|does not change the mode/);
});

test('local multiword search ranks relevant titles, handles flags and excludes serialized metadata',()=>{
    const ids=query=>filterArticles({query}).map(a=>a.id);
    assert.equal(ids('CPU allocation')[0],'thread-counters');
    assert.equal(ids('virtual threads Java 21')[0],'virtual-threads');
    assert.equal(ids('compressed object headers')[0],'object-headers');
    assert.equal(ids('-XX:+UseCompactObjectHeaders')[0],'object-headers');
    assert.equal(ids('VT carriers')[0],'virtual-threads');
    assert.equal(ids('String Deduplication')[0],'string-memory');
    assert.equal(ids('cpu, ALLOCATION!')[0],'thread-counters');
    for(const query of ['https','sources','minVersion','sourcechecked','java 99','---','<img src=x onerror=alert(1)>','x'.repeat(513)])assert.deepEqual(ids(query),[],query);
    assert.ok(!filterArticles({query:'virtual threads',version:17}).some(a=>a.id==='virtual-threads'));
    assert.ok(filterArticles({query:'CPU allocation',topic:'gc'}).every(a=>a.topics.includes('gc')));
});

test('KB019-03 punctuation around JVM prefixes preserves flag search without conflating mechanisms',()=>{
    for(const flag of ['-XX:+UseCompactObjectHeaders','-XX:-UseCompactObjectHeaders','-XX:UseCompactObjectHeaders']){
        for(const query of [flag,`"${flag}"`,`'${flag}'`,`(${flag})`,`[${flag}]`,`“${flag}”`,`headers, (${flag})!`])assert.equal(filterArticles({query})[0]?.id,'object-headers',query);
    }
    for(const flag of ['UseCompressedOops','UseCompressedClassPointers'])assert.equal(filterArticles({query:`"-XX:+${flag}"`})[0]?.id,'object-headers');
    assert.deepEqual(filterArticles({query:'foo-XX:+UseCompactObjectHeaders'}),[]);
    assert.deepEqual(filterArticles({query:'(-XX:+DefinitelyUnknownFlag)'}),[]);
    assert.deepEqual(filterArticles({query:'"-XX:+"'}),[]);
    assert.deepEqual(filterArticles({query:'"-XX:+UseCompactObjectHeaders"',topic:'threads'}),[]);
});

test('teaching blocks escape hostile text, reject executable sources and retain stable evidence anchors',()=>{
    const hostile='<img src="https://evil.invalid/x" onerror="alert(1)"><script>boom</script>';
    const blocks=[
        {type:'paragraph',text:hostile},{type:'list',items:[hostile]},
        {type:'table',caption:hostile,headers:[hostile],rows:[[hostile]]},
        {type:'code',caption:hostile,text:hostile},{type:'callout',title:hostile,text:hostile},
    ];
    for(const block of blocks){const html=renderBlock(block);assert.ok(!/<(?:img|script)\b/.test(html));assert.ok(html.includes('&lt;'));}
    assert.equal(renderBlock({type:'html',text:hostile}), '');
    assert.equal(sourceLinks(['javascript:alert(1)','data:text/html,evil','https://evil.invalid/x','//docs.oracle.com/x','https://github.com/openjdk/jdk8u-evil/blob/main/x','https://github.com/evil/jdk7u/blob/main/x','https://user:password@github.com/openjdk/jdk7u/blob/main/x']), '');
    assert.match(sourceLinks(['https://docs.oracle.com/en/java/javase/27/docs/specs/man/java.html']),/noopener noreferrer/);
    const url=coverageEvidenceUrl('a'.repeat(40));
    assert.equal(url,`https://github.com/RobbanHoglund/JvmScope/blob/${'a'.repeat(40)}/docs/JVM-SAMPLE-RESULTS.md`);
    for(const invalid of [null,'main','a'.repeat(39),'javascript:bad'])assert.equal(coverageEvidenceUrl(invalid),null);
    for(const id of ['thread-dumps','object-headers']){
        const article=ARTICLES.find(a=>a.id===id),html=articleSections(article);
        for(const anchor of ['does','versions','check','measure'])assert.match(html,new RegExp(`id="${anchor}"`));
        assert.match(html,/<pre><code>/);
        assert.match(html,/Illustrative/);
    }
    assert.match(articleSections(ARTICLES.find(a=>a.id==='object-headers')),/Same aligned size/);
});

test('knowledge coverage comes from the generated README evidence, rejects missing, duplicate or corrupt rows', () => {
    const readme=readFileSync(new URL('../../../README.md',import.meta.url),'utf8');
    const rows=parseGeneratedCoverage(readme);
    assert.equal(rows.length,21);
    for(const row of rows) {
        assert.ok(row.tda>0 && row.tls>0);
        assert.ok(readme.includes(`| ${row.version} | ${row.tda} | ${row.tls} |`));
    }
    const section=text=>`<!-- JVM-SAMPLES:START -->\n${text}\n<!-- JVM-SAMPLES:END -->`;
    assert.throws(()=>parseGeneratedCoverage(''),/missing/);
    assert.throws(()=>parseGeneratedCoverage(section('empty')),/missing/);
    assert.throws(()=>parseGeneratedCoverage(section('| 7 | nope | 2 | zulu | zulu |')),/Invalid/);
    assert.throws(()=>parseGeneratedCoverage(section('| 7 | 1 | 2 | zulu | zulu |\n| 7 | 1 | 2 | zulu | zulu |')),/Invalid/);
});

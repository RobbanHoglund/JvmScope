import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARTICLES, FEATURES, JAVA_VERSIONS, VERIFIED_DATE, featureState, compareVersions, filterArticles } from '../../assets/javautils/knowledge/data.js';
import { parseGeneratedCoverage } from '../../assets/javautils/knowledge/coverage.js';

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
    assert.deepEqual(changes.map(row=>row.feature.id),['compact-headers','g1-default']);
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
        for(const url of a.sources) assert.ok(/^https:\/\/(?:openjdk\.org\/jeps\/|docs\.oracle\.com\/|github\.com\/openjdk\/jdk\/)/.test(url),url);
        assert.ok(readFileSync(new URL(`../../knowledge/${a.id}.html`,import.meta.url),'utf8').includes('knowledge/knowledge.js'));
    }
    assert.ok(!filterArticles({version:17}).some(a=>a.id==='virtual-threads'));
    assert.equal(filterArticles({query:'  COMPACT STRINGS ',version:27,topic:'memory'}).length,1);
    assert.deepEqual(filterArticles({query:'<script>unknown</script>'}),[]);
    assert.deepEqual(filterArticles({version:28}),[]);
    assert.deepEqual(filterArticles({version:6}),[]);
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

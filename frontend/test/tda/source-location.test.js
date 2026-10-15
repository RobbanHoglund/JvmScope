import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeThreadDumpData } from '../../assets/javautils/tda/analysis.js';
import { threadSourceLocation } from '../../assets/javautils/tda/source-location.js';
const fixture = name => readFile(new URL('./fixtures/'+name,import.meta.url),'utf8');

test('source navigation distinguishes identical snapshots and same-named imported files', async () => {
    const dump=await fixture('ga-regressions/carrier-classic.txt');
    const text='\n\n'+dump.trim()+'\n\n'+dump.trim()+'\n';
    const sources=[{id:'a',name:'same.txt',hostSourceId:'host-a',text:text.replaceAll('\n','\r\n')},
        {id:'b',name:'same.txt',hostSourceId:'host-b',text:dump}];
    const {parsedDumps}=analyzeThreadDumpData(sources);assert.equal(parsedDumps.length,3);
    const starts=[];
    for(const snapshot of parsedDumps) {
        const source=sources.find(source=>source.id===snapshot.sourceId);
        const lines=source.text.replaceAll('\r\n','\n').split('\n');
        for(const thread of snapshot.threads) {
            const location=threadSourceLocation(snapshot,thread,sources);
            assert.equal(location.sourceId,source.hostSourceId);
            assert.equal(lines[location.startLine-1].trim(),thread.rawBlock[0].trim());
            assert.ok(location.endLine<=lines.length);
        }
        starts.push(threadSourceLocation(snapshot,snapshot.threads[0],sources).startLine);
    }
    assert.ok(starts[1]>starts[0]);assert.ok(starts[0]>starts[2]);
});
test('JSON source navigation uses original JSON object lines, including a leading BOM and blank lines', async () => {
    const text='\uFEFF\n\n'+await fixture('runtime/jdk25-dump-to-file.json');
    const sources=[{id:'json',hostSourceId:'host-json',text}];
    const {parsedDumps}=analyzeThreadDumpData(sources);assert.equal(parsedDumps.length,1);
    const snapshot=parsedDumps[0],lines=text.split('\n');
    for(const thread of snapshot.threads) {
        const location=threadSourceLocation(snapshot,thread,sources);
        assert.deepEqual(lines.slice(location.startLine-1,location.endLine),thread.rawBlock);
    }
});
test('examples and pasted inputs without an imported source never gain an original-file link', async () => {
    const sources=[{id:'sample',text:await fixture('ga-regressions/carrier-classic.txt')}];
    const snapshot=analyzeThreadDumpData(sources).parsedDumps[0];
    assert.equal(threadSourceLocation(snapshot,snapshot.threads[0],sources),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseThreadDump} from '../../assets/javautils/tda/parser.js';
import {createThreadNavigation} from '../../assets/javautils/host/navigation-model.js';

test('sidebar maps duplicate source/thread names to their exact snapshot objects',()=>{
    const text=readFileSync(new URL('./fixtures/ga-regressions/allocation-before.txt',import.meta.url),'utf8');
    const sources=[{id:'a',name:'dump.txt',text},{id:'b',name:'dump.txt',text}];
    const dumps=['a','b','a'].map(sourceId=>({sourceId,threads:parseThreadDump(text)}));
    const model=createThreadNavigation(sources,dumps);
    assert.deepEqual(model.children('').items.map(x=>x.key),['file:0','file:1']);
    assert.deepEqual(model.children('file:0').items.map(x=>x.key),['snapshot:0','snapshot:2']);
    assert.deepEqual(model.resolve('file:1'),{snapshotIndex:1});
    const node=model.children('snapshot:2').items[0];
    assert.equal(model.resolve(node.key).thread,dumps[2].threads[0]);
    assert.equal(model.resolve(node.key).snapshotIndex,2);
    assert.ok(!JSON.stringify(model.children('snapshot:2')).includes('rawBlock'));
});

test('sidebar pages large snapshots without dropping identical names or exposing stacks',()=>{
    const threads=Array.from({length:205},()=>({threadName:'same\n'+'x'.repeat(300),javaState:'RUNNABLE',rawBlock:'SECRET STACK'}));
    const model=createThreadNavigation([{id:'a',name:'dump'}],[{sourceId:'a',threads}]);
    const nodes=[...model.children('snapshot:0').items,...model.children('snapshot:0',100).items,...model.children('snapshot:0',200).items];
    assert.equal(nodes.length,205);assert.equal(new Set(nodes.map(x=>x.key)).size,205);
    assert.ok(nodes.every(x=>x.label.length===240&&!x.label.includes('\n')));
    assert.ok(!JSON.stringify(nodes).includes('SECRET STACK'));
    assert.equal(model.resolve(nodes[204].key).thread,threads[204]);
    for(const key of ['file:1','snapshot:1','thread:0:205','thread:-1:0','command:run'])assert.throws(()=>model.resolve(key));
    for(const offset of [-1,1.5,206])assert.throws(()=>model.children('snapshot:0',offset));
});

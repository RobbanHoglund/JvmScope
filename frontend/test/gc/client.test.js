import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGcClient} from '../../assets/javautils/gc/client.js';
function fixture(){const workers=[];const client=createGcClient(()=>{const w={terminate(){this.closed=true;},postMessage(value){this.value=value;}};workers.push(w);return w;});return {client,workers};}
test('GC worker replacement and cancellation ignore stale replies and terminate workers',async()=>{
    const {client,workers}=fixture();const first=client.analyze('old'),second=client.analyze('new');
    assert.equal(await first,null);assert.equal(workers[0].closed,true);
    workers[0].onmessage({data:{result:{events:['stale']}}});
    workers[1].onmessage({data:{result:{events:['current']}}});
    assert.deepEqual(await second,{events:['current']});assert.equal(workers[1].closed,true);
    const third=client.analyze('cancel');client.cancel();assert.equal(await third,null);assert.equal(workers[2].closed,true);
});
test('GC worker malformed replies, parser errors and transport errors are recoverable',async()=>{
    for(const payload of [null,{}, {result:{}},{error:'Unsupported GC log'}]){
        const {client,workers}=fixture();const result=client.analyze('text');workers[0].onmessage({data:payload});
        await assert.rejects(result);assert.equal(workers[0].closed,true);
        const next=client.analyze('valid');workers[1].onmessage({data:{result:{events:[]}}});assert.deepEqual(await next,{events:[]});
    }
    const {client,workers}=fixture();const result=client.analyze('text');workers[0].onmessageerror();await assert.rejects(result,/could not be read/);
});

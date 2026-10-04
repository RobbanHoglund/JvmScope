import assert from 'node:assert/strict';
import test from 'node:test';
import { createTlsAnalysisClient } from '../../assets/javautils/tls-analysis-client.js';

function fixture() {
    const workers = [];
    const client = createTlsAnalysisClient(() => {
        const worker = { terminate() { this.stopped = true; }, postMessage(data) { this.data = data; } };
        workers.push(worker); return worker;
    });
    return { client, workers };
}
const result = { analysis: { interactions: [], warnings: [], status: 'unsupported' }, entries: [] };

test('replacement and Clear terminate TLS workers; late results cannot replace the current capture', async () => {
    const { client, workers } = fixture();
    const first = client.analyze('first');
    const second = client.analyze('second');
    assert.equal(await first,null);
    assert.equal(workers[0].stopped,true);
    workers[0].onmessage({data:{result}});
    workers[1].onmessage({data:{result}});
    assert.equal(await second,result);
    assert.equal(workers[1].stopped,true);
    const clearing = client.analyze('clear me');
    client.cancel();
    assert.equal(await clearing,null);
    assert.equal(workers[2].stopped,true);
});

test('TLS worker errors, malformed replies, clone failures and construction failures reject cleanly', async () => {
    for (const event of ['error','bad-result','messageerror','exception']) {
        const {client,workers}=fixture();
        const pending=client.analyze('data');
        const rejection=assert.rejects(pending);
        if(event==='error')workers[0].onerror({message:'worker crash'});
        if(event==='bad-result')workers[0].onmessage({data:{result:{}}});
        if(event==='messageerror')workers[0].onmessageerror();
        if(event==='exception')workers[0].onmessage({data:{error:'parse failed'}});
        await rejection; assert.equal(workers[0].stopped,true);
    }
    await assert.rejects(createTlsAnalysisClient(()=>{throw new Error('blocked worker');}).analyze('data'),/blocked/);
    await assert.rejects(createTlsAnalysisClient(()=>({terminate(){},postMessage(){throw new Error('clone failed');}})).analyze('data'),/clone failed/);
});

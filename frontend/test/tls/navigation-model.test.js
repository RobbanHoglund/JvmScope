import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeTlsLog} from '../../assets/javautils/tls-parser.js';
import {tlsObservedSequence} from '../../assets/javautils/tls-sequence-model.js';
import {tlsOutcomeDisplay,tlsUncertaintyExplanation} from '../../assets/javautils/tls-view-model.js';
import {createTlsNavigation} from '../../assets/javautils/host/navigation-model.js';

test('TLS sidebar uses the existing Java runtime outcome, events and physical line numbers',()=>{
    const text=readFileSync(new URL('./fixtures/runtime/jdk25-tlsv1.3-required-client-auth-client.txt',import.meta.url),'utf8');
    const {interactions}=analyzeTlsLog(text),model=createTlsNavigation('capture.log',interactions);
    assert.equal(model.children('').items[0].label,'capture.log');
    for(const [index,it] of interactions.entries()) {
        const node=model.children('file:0',Math.floor(index/100)*100).items[index%100];
        assert.ok(node.description.startsWith(tlsOutcomeDisplay(it)));
        assert.equal(model.resolve(node.key).interaction,it);
        const events=tlsObservedSequence(it);
        const page=model.children(node.key);assert.equal(page.total,events.length);
        for(const [i,event] of page.items.entries()) {
            assert.equal(event.label,`${events[i].action} · ${events[i].title}`.slice(0,240));
            assert.equal(event.description,`Source line ${events[i].sourceLine}`);
            assert.deepEqual(model.resolve(event.key),{interaction:it,eventIndex:i});
        }
    }
    assert.throws(()=>model.resolve('event:0:99999'));
});

test('uncertain legacy TLS grouping is qualified and never invents attributable events',()=>{
    const {interactions}=analyzeTlsLog('first, WRITE: TLSv1.2 Handshake, length = 10\n*** ClientHello, TLSv1.2\nsecond, READ: TLSv1.2 Handshake, length = 10\n*** ServerHello, TLSv1.2\n*** Finished');
    assert.equal(interactions[0].correlationQuality,'ambiguous-legacy');
    const model=createTlsNavigation('ambiguous.log',interactions),node=model.children('file:0').items[0];
    assert.ok(node.description.includes(tlsUncertaintyExplanation(interactions[0]).slice(0,50)));
    assert.deepEqual(model.children(node.key),{total:0,items:[]});
    assert.throws(()=>model.resolve('event:0:0'));
});

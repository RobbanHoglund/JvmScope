import assert from 'node:assert/strict';
import test from 'node:test';
import {buildThreadDetailsViewModel} from '../../assets/javautils/tda/thread-modal.js';
for(const confirmed of [true,false,undefined])test(`deadlock fact distinguishes confirmation from absence (${confirmed})`,()=>{
    const fact=buildThreadDetailsViewModel({isDeadlocked:confirmed}).summaryMeta.find(f=>f.label==='Deadlock');
    assert.equal(fact.value,confirmed?'Confirmed':'Not confirmed by source');
    if(!confirmed)assert.match(fact.description,/virtual threads/);
});

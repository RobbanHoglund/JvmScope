const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AnalysisSidebar,NavigationSession,validatePage}=require('../src/analysis-sidebar.cjs');
const state=(revision=1,count=1)=>({type:'navigationState',revision,count,summary:'1 source'});
const item=(i,kind='thread')=>({key:kind==='thread'?`thread:0:${i}`:`${kind}:${i}`,kind,label:'same name',description:'RUNNABLE',children:kind!=='thread'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function session(send=()=>true,timeout=1000) {
    const messages=[];let changes=0;
    const navigation=new NavigationSession(message=>{messages.push(message);return send(message);},()=>changes++,timeout);
    navigation.receive(state());
    return {navigation,messages,changes:()=>changes,reply:(value,revision=1)=>navigation.receive({type:'navigationResult',id:messages.at(-1).id,revision,value})};
}
const vscode={
    EventEmitter:class {constructor(){this.event=()=>{};}fire(){}dispose(){}},
    TreeItem:class {constructor(label,collapsibleState){Object.assign(this,{label,collapsibleState});}},
    TreeItemCollapsibleState:{None:0,Collapsed:1},ThemeIcon:class {constructor(id){this.id=id;}},
};

test('navigation validates bounded plain labels, unique identities and complete pages',()=>{
    assert.equal(validatePage({total:1,items:[item(0)]},0).items.length,1);
    for(const value of [
        {total:2,items:[item(0)]}, {total:2,items:[item(0),item(0)]},
        {total:1,items:[{...item(0),label:'a'.repeat(241)}]},
        {total:1,items:[{...item(0),description:'a\nb'}]},
        {total:1,items:[{...item(0),key:'command:terminal'}]},
        {total:1,items:[{...item(0),kind:'file'}]},
        {total:10000001,items:[]},
    ]) assert.throws(()=>validatePage(value,0),/Invalid/);
});

test('replacement, clear and disposal cancel outstanding requests and reject late replies',async()=>{
    for(const change of ['replace','clear','dispose']) {
        const s=session(),promise=s.navigation.request('children');
        const rejected=assert.rejects(promise,/analysis changed/);
        await tick();
        if(change==='dispose')s.navigation.dispose();else s.navigation.receive(state(2,change==='clear'?0:1));
        s.reply({total:1,items:[item(0,'file')]});
        await rejected;assert.equal(s.navigation.pending.size,0);
    }
});

test('invalid revisions do not replace a valid analysis, and mismatched replies fail closed',async()=>{
    const s=session();
    for(const message of [state(1),state(0),state(2,-1),{...state(2),summary:'\n'}])s.navigation.receive(message);
    assert.equal(s.changes(),1);assert.equal(s.navigation.revision,1);
    const promise=s.navigation.request('select','thread:0:0');
    const rejected=assert.rejects(promise,/analysis changed/);await tick();s.reply(true,2);await rejected;
    const selection=s.navigation.request('select','thread:0:0');
    const invalid=assert.rejects(selection,/Invalid navigation selection/);await tick();s.reply({command:'anything'});await invalid;
    s.navigation.dispose();
});

test('undeliverable, rejected and timed-out requests release pending work',async()=>{
    for(const [send,pattern] of [[()=>false,/unavailable/],[()=>Promise.reject(new Error('closed')),/closed/],[()=>true,/did not respond/]]) {
        const s=session(send,10);await assert.rejects(s.navigation.request('children'),pattern);
        assert.equal(s.navigation.pending.size,0);s.navigation.dispose();
    }
});

function tree() {
    let opens=0,reveals=0;const requests=[];
    const sidebar=new AnalysisSidebar(vscode,async()=>opens++);
    function attach(analyzer,owner) {
        const navigation=new NavigationSession(message=>{
            requests.push(message);
            let value=true;
            if(message.action==='children') {
                const total=message.key===''?1:message.key==='file:0'?1:205;
                const kind=message.key===''?'file':message.key==='file:0'?'snapshot':'thread';
                value={total,items:Array.from({length:Math.min(100,total-message.offset)},(_,i)=>item(i+message.offset,kind))};
            }
            queueMicrotask(()=>navigation.receive({type:'navigationResult',id:message.id,revision:message.revision,value}));
            return true;
        },()=>sidebar.changed(analyzer));
        sidebar.attach(analyzer,{owner,navigation,panel:{reveal:()=>reveals++}});navigation.receive(state());
        return navigation;
    }
    const tda=attach('tda','tda-owner'),tls=attach('tls','tls-owner');
    return {sidebar,tda,tls,requests,opens:()=>opens,reveals:()=>reveals,dispose(){tda.dispose();tls.dispose();sidebar.dispose();}};
}

test('native tree pages all threads, preserves equal names, and selects by owner/revision/key',async()=>{
    const t=tree(),s=t.sidebar;
    const files=await s.list('tda'),snapshots=await s.list('tda',files[0].id);
    const first=await s.list('tda',snapshots[0].id);assert.equal(first.length,101);
    assert.equal(first[100].label,'More (101–200 of 205)');
    const second=await s.list('tda',first[100].id),third=await s.list('tda',second[100].id);
    assert.equal(third.length,5);
    assert.equal(new Set([...first,...second,...third].filter(x=>x.kind==='thread').map(x=>x.id)).size,205);
    assert.equal(await s.reveal(third[4].id),true);assert.equal(t.requests.at(-1).key,'thread:0:204');assert.equal(t.reveals(),1);
    assert.deepEqual(await s.list('tda',third[4].id),[]);
    await s.reveal('tls');assert.equal(t.opens(),1);
    t.dispose();
});

test('repeated reads do not invalidate native node objects; capture replacement only clears its own analyzer',async()=>{
    const t=tree(),s=t.sidebar;
    const [root]=s.roots;
    const [original]=await s.getChildren(root);
    await s.getChildren(root);
    assert.equal((await s.getChildren(original)).length,1);
    const [tlsFile]=await s.list('tls');
    t.tda.receive(state(2));
    await assert.rejects(s.reveal(original.id),/analysis changed/);
    assert.equal(await s.reveal(tlsFile.id),true);
    assert.deepEqual(await s.getChildren(original),[]);
    s.detach('tls',s.sessions.get('tls'));assert.deepEqual(await s.list('tls'),[]);
    await assert.rejects(s.reveal(tlsFile.id),/analysis changed/);
    t.dispose();
});

test('tree labels are plain text and webview input cannot supply executable commands',async()=>{
    const t=tree(),s=t.sidebar;
    const [file]=await s.list('tda');
    const native=s.getTreeItem(s.nodes.get(file.id));
    assert.equal(typeof native.tooltip,'string');
    assert.deepEqual(native.command,{command:'jvmscope.revealAnalysisItem',title:'Open analysis item',arguments:[file.id]});
    assert.equal(native.iconPath.id,'file');assert.ok(native.accessibilityInformation.label);
    await assert.rejects(s.list('tls',file.id),/analysis changed/);
    t.dispose();
});

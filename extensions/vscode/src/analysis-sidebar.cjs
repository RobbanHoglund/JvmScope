const PAGE_SIZE = 100;
const kinds = new Set(['file','snapshot','thread','interaction','event']);
const text = value => typeof value === 'string' && value.length <= 240 && !/[\x00-\x1f\x7f]/.test(value);
const key = value => typeof value === 'string' && /^(?:|(?:file|snapshot|interaction):\d{1,9}|(?:thread|event):\d{1,9}:\d{1,9})$/.test(value);
const stale = () => new Error('The analysis changed. Select an item from the updated JvmScope sidebar.');
function validatePage(value, offset) {
    if (!value || !Number.isSafeInteger(value.total) || value.total<offset || value.total>10000000 || !Array.isArray(value.items)
        || value.items.length!==Math.min(PAGE_SIZE,value.total-offset)) throw new Error('Invalid analysis navigation page.');
    const seen=new Set();
    for (const item of value.items) {
        if (!item || !key(item.key) || !item.key || seen.has(item.key) || !kinds.has(item.kind) || !item.key.startsWith(item.kind+':') || !text(item.label) || !text(item.description)
            || typeof item.children!=='boolean') throw new Error('Invalid analysis navigation item.');
        seen.add(item.key);
    }
    return value;
}

// A panel owns its navigation revision and pending requests. A new analysis or
// panel disposal invalidates both expanded nodes and in-flight replies.
class NavigationSession {
    constructor(send, changed, timeout=15000) {
        this.send=send;this.changed=changed;this.timeout=timeout;this.revision=0;this.count=0;
        this.summary='No capture loaded';this.pending=new Map();this.next=0;this.disposed=false;
    }
    receive(message) {
        if (this.disposed) return;
        if (message.type==='navigationState') {
            if (!Number.isSafeInteger(message.revision) || message.revision<=this.revision || !Number.isSafeInteger(message.count)
                || message.count<0 || message.count>10000000 || !text(message.summary)) return;
            this.cancel();this.revision=message.revision;this.count=message.count;this.summary=message.summary;this.changed();
        } else if (message.type==='navigationResult') {
            const job=this.pending.get(message.id);
            if (!job) return;
            this.pending.delete(message.id);clearTimeout(job.timer);
            if (message.revision!==this.revision || message.revision!==job.revision) job.reject(stale());
            else if (message.error) job.reject(new Error(String(message.error).slice(0,240)));
            else {
                try {
                    if (job.action==='select' && message.value!==true) throw new Error('Invalid navigation selection response.');
                    job.resolve(job.action==='children'?validatePage(message.value,job.offset):true);
                }
                catch(error) {job.reject(error);}
            }
        }
    }
    request(action, nodeKey='', offset=0) {
        if (this.disposed || !this.revision) return Promise.reject(stale());
        if (!['children','select'].includes(action) || !key(nodeKey) || !Number.isSafeInteger(offset) || offset<0) return Promise.reject(new Error('Invalid navigation request.'));
        const id=`nav:${++this.next}`,revision=this.revision;
        return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('The analysis view did not respond. Reopen the analyzer to try again.'));},this.timeout);
            this.pending.set(id,{resolve,reject,timer,revision,action,offset});
            Promise.resolve().then(()=>this.send({channel:'jvmscope',version:1,type:'navigationRequest',id,revision,action,key:nodeKey,offset})).then(sent=>{
                if (!sent && this.pending.has(id)) {this.pending.delete(id);clearTimeout(timer);reject(new Error('The analysis view is unavailable.'));}
            },error=>{this.pending.delete(id);clearTimeout(timer);reject(error);});
        });
    }
    cancel() {for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(stale());}this.pending.clear();}
    dispose(){this.disposed=true;this.cancel();}
}

class AnalysisSidebar {
    constructor(vscode, open) {
        this.vscode=vscode;this.open=open;this.sessions=new Map();this.nodes=new Map();
        this.events=new vscode.EventEmitter();this.onDidChangeTreeData=this.events.event;
        this.roots=['tda','tls','gc'].map(analyzer=>({id:analyzer,analyzer,root:true,key:''}));
        this.knowledge={id:'knowledge',label:'Knowledge base'};
    }
    attach(analyzer, session) {this.sessions.set(analyzer,session);this.changed(analyzer);}
    detach(analyzer,session) {if(this.sessions.get(analyzer)===session){this.sessions.delete(analyzer);this.changed(analyzer);}}
    changed(analyzer) {for(const [id,node] of this.nodes)if(node.analyzer===analyzer)this.nodes.delete(id);this.events.fire(this.roots.find(root=>root.analyzer===analyzer));}
    getTreeItem(node) {
        if (node===this.knowledge) {
            const item=new this.vscode.TreeItem(node.label,this.vscode.TreeItemCollapsibleState.None);
            item.id=node.id;item.tooltip='Open Java guides and references';
            item.iconPath=new this.vscode.ThemeIcon('book');item.contextValue='jvmscope.knowledge';
            item.command={command:'jvmscope.openKnowledge',title:'Open Knowledge Base'};
            return item;
        }
        const vscode=this.vscode,session=this.sessions.get(node.analyzer);
        const hasChildren=node.root?Boolean(session?.navigation.count):node.children;
        const item=new vscode.TreeItem(node.root?({tda:'Java thread dumps',tls:'Java TLS logs',gc:'Java garbage collection'})[node.analyzer]:node.label,
            hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        item.id=node.id;item.description=node.root?(session?.navigation.summary || 'No capture loaded'):node.description;
        item.tooltip=node.root?item.description:`${node.label}\n${node.description}`;
        item.iconPath=new vscode.ThemeIcon(node.root?({tda:'list-tree',tls:'shield',gc:'pulse'})[node.analyzer]:({file:'file',snapshot:'history',thread:'symbol-method',interaction:'plug',event:'arrow-right',page:'ellipsis',notice:'info'})[node.kind]);
        item.contextValue=node.root?'jvmscope.analyzer':'jvmscope.item';
        if (node.kind!=='page' && node.kind!=='notice') item.command={command:'jvmscope.revealAnalysisItem',title:'Open analysis item',arguments:[node.id]};
        item.accessibilityInformation={label:`${item.label}. ${item.description || ''}`};
        return item;
    }
    async getChildren(parent) {
        if (!parent) return [...this.roots,this.knowledge];
        const session=this.sessions.get(parent.analyzer);
        if (!session || !session.navigation.count) return [];
        if (!parent.root && (!parent.children || !this.nodes.has(parent.id) || parent.owner!==session.owner || parent.revision!==session.navigation.revision)) return [];
        const revision=session.navigation.revision,offset=parent.offset || 0;
        try {
            const value=await session.navigation.request('children',parent.key,offset);
            if (session!==this.sessions.get(parent.analyzer) || revision!==session.navigation.revision) return [];
            const items=value.items.map(item=>({key:item.key,kind:item.kind,label:item.label,description:item.description,children:item.children,analyzer:parent.analyzer,revision,owner:session.owner,id:`${session.owner}/${revision}/${item.key}`}));
            if (offset+items.length<value.total) items.push({kind:'page',label:`More (${offset+items.length+1}–${Math.min(value.total,offset+items.length+PAGE_SIZE)} of ${value.total})`,description:'',key:parent.key,offset:offset+items.length,children:true,analyzer:parent.analyzer,revision,owner:session.owner,id:`${session.owner}/${revision}/${parent.key}/page:${offset+items.length}`});
            if (!items.length && parent.kind==='interaction') items.push({kind:'notice',label:'No attributable events captured',description:'Open the interaction to inspect its evidence',analyzer:parent.analyzer,id:`${parent.id}/empty`});
            for(const item of items)this.nodes.set(item.id,item);
            return items;
        }catch(error){
            if (session!==this.sessions.get(parent.analyzer) || revision!==session.navigation.revision) return [];
            throw error;
        }
    }
    async reveal(id) {
        const root=this.roots.find(node=>node.id===id);
        if(root){await this.open(root.analyzer);return true;}
        const node=this.nodes.get(id),session=node && this.sessions.get(node.analyzer);
        if (!node || !session || session.owner!==node.owner || session.navigation.revision!==node.revision || ['page','notice'].includes(node.kind)) throw stale();
        session.panel.reveal();
        return session.navigation.request('select',node.key);
    }
    // Read-only access to loaded tree metadata, also used by extension-host tests.
    async list(analyzer,id) {
        const parent=id?this.nodes.get(id):this.roots.find(root=>root.analyzer===analyzer);
        if(!parent || parent.analyzer!==analyzer)throw stale();
        return (await this.getChildren(parent)).map(({id,label,description,kind,children})=>({id,label,description,kind,children}));
    }
    dispose(){this.nodes.clear();this.sessions.clear();this.events.dispose();}
}
module.exports={AnalysisSidebar,NavigationSession,validatePage};

import { tlsObservedSequence } from '../tls-sequence-model.js';
import { tlsOutcomeDisplay, tlsUncertaintyExplanation } from '../tls-view-model.js';

export const NAVIGATION_PAGE_SIZE = 100;
const label = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
const node = (key, kind, name, description, children = false) => ({key, kind, label: label(name), description: label(description), children});
function page(length, at, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) throw new Error('Invalid navigation page.');
    return {total: length, items: Array.from({length: Math.min(NAVIGATION_PAGE_SIZE, length-offset)}, (_,i)=>at(offset+i))};
}
const indices = (key, pattern) => {
    const match = key.match(pattern);
    if (!match) throw new Error('This analysis item is no longer available.');
    return match.slice(1).map(Number);
};

export function createThreadNavigation(sources, dumps) {
    const bySource = new Map(sources.map(source => [source.id, []]));
    dumps.forEach((dump,index) => bySource.get(dump.sourceId)?.push({dump,index}));
    const files = sources.map(source => ({source, snapshots: bySource.get(source.id)}));
    const snapshot = index => { if (!dumps[index]) throw new Error('Snapshot no longer available.'); return dumps[index]; };
    return {
        count: files.length, summary: `${files.length} sources · ${dumps.length} snapshots`,
        children(key, offset=0) {
            if (key === '') return page(files.length, i=>node(`file:${i}`, 'file', files[i].source.name || 'Pasted capture', `${files[i].snapshots.length} snapshots`, true), offset);
            if (/^file:\d+$/.test(key)) {
                const file=files[indices(key,/^file:(\d+)$/)[0]];
                if (!file) throw new Error('Source no longer available.');
                return page(file.snapshots.length, i=>{
                    const {dump,index}=file.snapshots[i];
                    return node(`snapshot:${index}`, 'snapshot', `Snapshot ${index+1}${dump.timestamp ? ' · '+dump.timestamp : ''}`, `${dump.threads.length} threads`, dump.threads.length>0);
                },offset);
            }
            const [index]=indices(key,/^snapshot:(\d+)$/), dump=snapshot(index);
            return page(dump.threads.length, i=>{
                const thread=dump.threads[i];
                return node(`thread:${index}:${i}`, 'thread', thread.threadName || 'Unnamed thread', `${thread.javaState || 'UNKNOWN'}${thread.jvmId != null ? ' · JVM #'+thread.jvmId : ''}`, false);
            },offset);
        },
        resolve(key) {
            if (/^file:\d+$/.test(key)) {
                const file=files[indices(key,/^file:(\d+)$/)[0]];
                if (!file?.snapshots.length) throw new Error('Source has no snapshots.');
                return {snapshotIndex:file.snapshots[0].index};
            }
            if (/^snapshot:\d+$/.test(key)) { const [index]=indices(key,/^snapshot:(\d+)$/);snapshot(index);return {snapshotIndex:index}; }
            const [index,threadIndex]=indices(key,/^thread:(\d+):(\d+)$/), dump=snapshot(index);
            if (!dump.threads[threadIndex]) throw new Error('Thread no longer available.');
            return {snapshotIndex:index,thread:dump.threads[threadIndex]};
        },
    };
}

export function createTlsNavigation(name, interactions) {
    // Cache only the currently expanded interaction's sequence, never raw text.
    let cachedIndex=-1, cachedEvents=[];
    const interaction = index => { if (!interactions[index]) throw new Error('Interaction no longer available.'); return interactions[index]; };
    const events = index => {
        const item=interaction(index);
        if (cachedIndex!==index) {cachedEvents=tlsObservedSequence(item);cachedIndex=index;}
        return cachedEvents;
    };
    return {
        count: name ? 1 : 0, summary: name ? `${interactions.length} interactions` : 'No capture loaded',
        children(key, offset=0) {
            if (key==='') return page(name?1:0, ()=>node('file:0','file',name,`${interactions.length} interactions`,interactions.length>0),offset);
            if (key==='file:0') return page(interactions.length, i=>{
                const item=interactions[i];
                return node(`interaction:${i}`,'interaction',`#${item.id} · ${item.peerHost || item.sni || 'Endpoint not captured'}`,
                    `${tlsOutcomeDisplay(item)}${tlsUncertaintyExplanation(item) ? ' · '+tlsUncertaintyExplanation(item) : ''}`,true);
            },offset);
            const [index]=indices(key,/^interaction:(\d+)$/), sequence=events(index);
            return page(sequence.length, i=>node(`event:${index}:${i}`,'event',`${sequence[i].action} · ${sequence[i].title}`,`Source line ${sequence[i].sourceLine}`,false),offset);
        },
        resolve(key) {
            if (key==='file:0' && name) return {};
            if (/^interaction:\d+$/.test(key)) {const [index]=indices(key,/^interaction:(\d+)$/);return {interaction:interaction(index)};}
            const [index,eventIndex]=indices(key,/^event:(\d+):(\d+)$/);
            if (!events(index)[eventIndex]) throw new Error('Event no longer available.');
            return {interaction:interaction(index),eventIndex};
        },
    };
}

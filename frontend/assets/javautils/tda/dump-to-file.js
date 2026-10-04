/** Adapters for HotSpot Thread.dump_to_file (JDK 21–27). No inferred metrics. */
export const MODERN_THREAD_HEADER = /^#(?<jvmId>\d+)\s+"(?<threadName>.*)"(?:\s+(?<virtual>virtual))?(?:\s+(?<state>NEW|RUNNABLE|BLOCKED|WAITING|TIMED_WAITING|TERMINATED)\s+(?<time>\S+))?\s*$/;
const isThreadId = value => (typeof value === 'string' && /^\d+$/.test(value))
    || (Number.isSafeInteger(value) && value >= 0);
const OBJECT_ID = /^(?<lockType>[^\s<>]+)@[0-9a-fA-F]+$/;

// File dumps sample threads separately. Several virtual threads may therefore
// report the same carrier at different observation times; retain every relation.
export function resolveJsonCarriers(threads) {
    const byId = new Map();
    for (const thread of threads) {
        const id = String(thread.jvmId);
        const matches = byId.get(id) || [];
        matches.push(thread);
        byId.set(id, matches);
        thread.carrierSourceKey = null;
        thread.observedVirtualThreadIds = [];
        thread.isCarrierThread = false;
        thread.carrierVirtualThreadId = null;
        thread.mountedVirtualThreadId = null;
    }
    for (const thread of threads) {
        if (thread.isVirtualThread !== true || thread.carrierThreadId == null
            || byId.get(String(thread.jvmId)).length !== 1) continue;
        const matches = byId.get(thread.carrierThreadId) || [];
        const carrier = matches.length === 1 ? matches[0] : null;
        if (!carrier || carrier === thread || carrier.isVirtualThread === true) continue;
        thread.carrierSourceKey = carrier.sourceKey;
        carrier.isCarrierThread = true;
        carrier.observedVirtualThreadIds.push(String(thread.jvmId));
    }
    for (const thread of threads) {
        if (thread.observedVirtualThreadIds.length === 1) {
            thread.carrierVirtualThreadId = thread.observedVirtualThreadIds[0];
            thread.mountedVirtualThreadId = thread.observedVirtualThreadIds[0];
        }
    }
    return threads;
}

export function observedVirtualThreadIds(thread) {
    if (thread?.observedVirtualThreadIds?.length) return thread.observedVirtualThreadIds;
    const id = thread?.mountedVirtualThreadId ?? thread?.carrierVirtualThreadId;
    return id == null ? [] : [String(id)];
}

export function parseModernLockLine(line) {
    const match = line.match(/^\s*-\s+(?<action>locked|waiting to lock|waiting on|parking to wait for)\s+<(?<lockId>[^<>]+)>(?:, owner #(?<ownerJvmId>\d+))?\s*$/);
    const object = match?.groups?.lockId.match(OBJECT_ID);
    if (!object) return null;
    if (match.groups.ownerJvmId && match.groups.action !== 'parking to wait for') return null;
    return {
        lockId: match.groups.lockId,
        lockType: object.groups.lockType,
        kind: { locked: 'monitor', 'waiting to lock': 'monitor-enter', 'waiting on': 'monitor-wait', 'parking to wait for': 'synchronizer-park' }[match.groups.action],
        ...(match.groups.ownerJvmId ? { ownerJvmId: String(BigInt(match.groups.ownerJvmId)) } : {}),
    };
}

// Locate thread objects in the original JSON without reserializing it or relying
// on indentation, property order, unique names, or unique IDs. JSON.parse validates
// syntax first; this iterative token walk only records source ranges.
function threadObjectRanges(source) {
    const stack = [];
    const ranges = new Map();
    let line = 1;
    let offset = 0;
    for (const match of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)) {
        line += (source.slice(offset, match.index).match(/\n/g) || []).length;
        offset = match.index + match[0].length;
        const token = match[0];
        const parent = stack.at(-1);
        if (token === ',' || token === ':') continue;
        if (token === '}' || token === ']') {
            const node = stack.pop();
            if (node.kind === '{' && node.path.length === 5
                && node.path[0] === 'threadDump' && node.path[1] === 'threadContainers'
                && node.path[3] === 'threads') {
                ranges.set(node.path.join('/'), { startLine: node.startLine, endLine: line });
            }
            continue;
        }
        if (parent?.kind === '{' && parent.key == null) {
            parent.key = JSON.parse(token);
            continue;
        }
        const component = parent?.kind === '[' ? parent.index++ : parent?.key;
        const path = parent ? [...parent.path.slice(0, 6), component] : [];
        if (parent?.kind === '{') parent.key = null;
        if (token === '{' || token === '[') stack.push({ kind: token, path, key: null, index: 0, startLine: line });
    }
    return ranges;
}

export function readJsonThreadDump(source) {
    if (!source.trimStart().startsWith('{')) return null;
    let root;
    try { root = JSON.parse(source); } catch { return { threads: [], invalid: true }; }
    const dump = root?.threadDump;
    if (!Array.isArray(dump?.threadContainers)) return { threads: [], invalid: true };
    const ranges = threadObjectRanges(source);
    const lines = source.split('\n');
    const threads = [];
    let skipped = 0;
    let collectionIncomplete = false;
    for (const [containerIndex, container] of dump.threadContainers.entries()) {
        if (!Array.isArray(container?.threads)) { skipped++; continue; }
        if (Number(container.threadCount) > container.threads.length) collectionIncomplete = true;
        for (const [threadIndex, value] of container.threads.entries()) {
            if (!value || !isThreadId(value.tid) || typeof value.name !== 'string'
                || !Array.isArray(value.stack) || value.stack.some(frame => typeof frame !== 'string' || /[\r\n]/.test(frame))
                || (value.virtual != null && typeof value.virtual !== 'boolean')
                || (value.state != null && (typeof value.state !== 'string' || !/^(NEW|RUNNABLE|BLOCKED|WAITING|TIMED_WAITING|TERMINATED)$/.test(value.state)))) {
                skipped++;
                continue;
            }
            const range = ranges.get(`threadDump/threadContainers/${containerIndex}/threads/${threadIndex}`);
            let carrierThreadId = null;
            if (value.carrier != null) {
                if (value.virtual === true && isThreadId(value.carrier)) carrierThreadId = String(BigInt(value.carrier));
                else skipped++;
            }
            const analysisLines = [`#${value.tid} "thread"${value.virtual === true ? ' virtual' : ''}${value.state ? ` ${value.state} 1970-01-01T00:00:00Z` : ''}`];
            const addLock = (action, identity, ownerJvmId = null) => {
                if (identity == null) return; // eliminated monitor
                if (typeof identity !== 'string' || !OBJECT_ID.test(identity)) { skipped++; return; }
                analysisLines.push(`    - ${action} <${identity}>${ownerJvmId == null ? '' : `, owner #${ownerJvmId}`}`);
            };
            if (value.parkBlocker != null) {
                if (value.parkBlocker?.object == null) skipped++;
                else {
                    const owner = value.parkBlocker.owner;
                    if (owner != null && !isThreadId(owner)) skipped++;
                    addLock('parking to wait for', value.parkBlocker.object,
                        owner != null && isThreadId(owner) ? String(BigInt(owner)) : null);
                }
            }
            if (value.state === 'BLOCKED') addLock('waiting to lock', value.blockedOn);
            if (value.state === 'WAITING' || value.state === 'TIMED_WAITING') addLock('waiting on', value.waitingOn);
            for (const frame of value.stack) analysisLines.push(`    at ${frame}`);
            if (value.monitorsOwned != null && !Array.isArray(value.monitorsOwned)) skipped++;
            for (const monitor of Array.isArray(value.monitorsOwned) ? value.monitorsOwned : []) {
                if (!Array.isArray(monitor?.locks) || !Number.isInteger(monitor.depth)
                    || monitor.depth < 0 || monitor.depth >= value.stack.length) { skipped++; continue; }
                for (const identity of monitor.locks) addLock('locked', identity);
            }
            threads.push({ value, carrierThreadId, analysisText: analysisLines.join('\n'), ...range,
                rawBlock: range ? lines.slice(range.startLine - 1, range.endLine) : [] });
        }
    }
    return { threads, time: dump.time, processId: dump.processId, runtimeVersion: dump.runtimeVersion, skipped, collectionIncomplete };
}

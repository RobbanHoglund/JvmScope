/**
 * Pure thread/lock dependency graph construction.
 *
 * The graph deliberately separates direct JVM observations from derived wait-for
 * relationships:
 *   - resourceEdges represent parsed waits, holds, and virtual-thread mounts;
 *   - dependencyEdges connect a waiter to every owner observed for the same lock;
 *   - confirmed JVM deadlock metadata is carried separately from inferred cycles.
 *
 * This module has no DOM or D3 dependencies and is covered by Node tests.
 */

import { resolveDeadlockParticipants } from './deadlocks.js';

function text(value) {
    return value == null ? '' : String(value).trim();
}

function normalized(value) {
    return text(value).toLowerCase();
}

function finiteNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function lockIdentity(lock) {
    const lockId = normalized(lock?.lockId);
    return lockId || null;
}

function threadIdentity(thread, index) {
    const sourceKey = text(thread?.sourceKey);
    if (sourceKey) return sourceKey;

    const stableParts = [
        text(thread?.tid),
        text(thread?.nid),
        text(thread?.jvmId),
        text(thread?.threadName),
    ].filter(Boolean);
    return stableParts.length ? `fallback:${stableParts.join(':')}:${index}` : `fallback:index:${index}`;
}

function lockResourceKind(kinds) {
    const values = new Set(kinds || []);
    const hasClassInitialization = values.has('class-initialization-wait');
    const hasSynchronizer = values.has('ownable-synchronizer') || values.has('synchronizer-park');
    const hasMonitor = values.has('monitor') || values.has('monitor-enter') || values.has('monitor-wait');
    if (hasClassInitialization && !hasSynchronizer && !hasMonitor) return 'class-initialization';
    if (hasSynchronizer && hasMonitor) return 'mixed';
    if (hasSynchronizer) return 'synchronizer';
    return 'monitor';
}

function relationTypeForWait(lock) {
    if (lock?.kind === 'synchronizer-park') return 'park';
    if (lock?.kind === 'monitor-wait') return 'await';
    return 'wait';
}

function isContendedWait(lock) {
    return lock?.kind === 'monitor-enter' || lock?.kind === 'synchronizer-park';
}

function createThreadNode(thread, index) {
    const identity = threadIdentity(thread, index);
    const sourceKey = text(thread?.sourceKey) || identity;
    const virtualThreadId = text(thread?.mountedVirtualThreadId || thread?.carrierVirtualThreadId);

    return {
        id: `thread:${sourceKey}`,
        type: 'thread',
        sourceKey,
        rawStartLine: Number.isInteger(thread?.rawStartLine) ? thread.rawStartLine : null,
        rawEndLine: Number.isInteger(thread?.rawEndLine) ? thread.rawEndLine : null,
        label: text(thread?.threadName) || `Thread ${index + 1}`,
        threadName: text(thread?.threadName) || `Thread ${index + 1}`,
        state: text(thread?.javaState) || 'UNKNOWN',
        stateDetail: text(thread?.javaStateDetail) || null,
        daemon: Boolean(thread?.daemon),
        deadlocked: Boolean(thread?.isDeadlocked),
        deadlockCycleId: thread?.deadlockCycleId ?? null,
        carrier: Boolean(thread?.isCarrierThread),
        isVirtualThread: thread?.isVirtualThread ?? null,
        carrierId: thread?.carrierSourceKey ? `thread:${thread.carrierSourceKey}` : null,
        lockDataAvailable: thread?.lockDataAvailable !== false,
        virtualThreadId: virtualThreadId || null,
        cpuMs: finiteNumber(thread?.cpuMs),
        cpuRatePercent: finiteNumber(thread?.cpuRatePercent),
        cpuIntervalQuality: thread?.cpuIntervalQuality ?? null,
        cpuIntervalReason: thread?.cpuIntervalReason ?? null,
        elapsedS: finiteNumber(thread?.elapsedS),
        allocatedBytes: finiteNumber(thread?.allocatedBytes),
        topFrame: text(thread?.topFrame) || null,
        tid: text(thread?.tid) || null,
        nid: text(thread?.nid) || null,
        jvmId: thread?.jvmId ?? null,
        nativeIdDec: thread?.nativeIdDec ?? null,
        locksHeldCount: thread?.lockDataAvailable === false ? null : (thread?.heldLocks?.length || 0),
        waitingLockCount: thread?.lockDataAvailable === false ? null : (thread?.waitingLocks?.length || 0),
        findingCount: Array.isArray(thread?.findings) ? thread.findings.length : 0,
        scenarioKey: text(thread?.scenarioKey) || null,
        scenarioLabel: text(thread?.scenarioLabel) || null,
        severity: text(thread?.lockAssessment?.severity) || null,
        severityScore: finiteNumber(thread?.lockAssessment?.severityScore),
        rawThread: thread,
        heldLockIds: [],
        waitingLockIds: [],
        dependencyTargetIds: [],
        dependencySourceIds: [],
        resourceDegree: 0,
        dependencyDegree: 0,
        role: 'isolated',
    };
}

function createLockNode(lock) {
    const identity = lockIdentity(lock);
    return {
        id: `lock:${identity}`,
        type: 'lock',
        label: text(lock?.className) || text(lock?.lockId) || identity,
        lockId: text(lock?.lockId) || identity,
        lockType: text(lock?.lockType) || 'Unknown lock type',
        className: text(lock?.className) || null,
        resourceKind: 'monitor',
        observedKinds: [],
        ownerIds: [],
        waiterIds: [],
        awaiterIds: [],
        deadlocked: false,
        deadlockCycleIds: [],
        resourceDegree: 0,
        dependencyDegree: 0,
        role: 'resource',
    };
}

function getOrCreateLock(lockNodesByIdentity, lock) {
    const identity = lockIdentity(lock);
    if (!identity) return null;
    if (!lockNodesByIdentity.has(identity)) {
        lockNodesByIdentity.set(identity, createLockNode(lock));
    }

    const node = lockNodesByIdentity.get(identity);
    if ((!node.lockType || node.lockType === 'Unknown lock type') && text(lock?.lockType)) {
        node.lockType = text(lock.lockType);
    }
    if (!node.className && text(lock?.className)) {
        node.className = text(lock.className);
        node.label = node.className;
    }
    const kind = text(lock?.kind);
    if (kind && !node.observedKinds.includes(kind)) node.observedKinds.push(kind);
    node.resourceKind = lockResourceKind(node.observedKinds);
    return node;
}

function pushUnique(array, value) {
    if (value && !array.includes(value)) array.push(value);
}

function edgeKey(...parts) {
    return parts.map((part) => text(part).replaceAll('|', '%7C')).join('|');
}

function addResourceEdge(resourceEdgesById, edge) {
    if (!edge?.id) return null;
    const existing = resourceEdgesById.get(edge.id);
    if (existing) {
        existing.deadlocked ||= Boolean(edge.deadlocked);
        existing.confirmedDeadlock ||= Boolean(edge.confirmedDeadlock);
        if (!existing.lockId && edge.lockId) existing.lockId = edge.lockId;
        if (!existing.lockType && edge.lockType) existing.lockType = edge.lockType;
        if (!existing.relationKind && edge.relationKind) existing.relationKind = edge.relationKind;
        return existing;
    }
    resourceEdgesById.set(edge.id, edge);
    return edge;
}

function addDependencyObservation(dependencyByPair, observation) {
    const key = `${observation.source}|${observation.target}`;
    if (!dependencyByPair.has(key)) {
        dependencyByPair.set(key, {
            id: `dependency:${key}`,
            source: observation.source,
            target: observation.target,
            type: 'dependency',
            locks: [],
            waitKinds: [],
            deadlocked: false,
            confirmedDeadlock: false,
            cycleIds: [],
            ambiguousOwner: false,
            observationCount: 0,
            className: text(observation.className) || null,
        });
    }

    const edge = dependencyByPair.get(key);
    const lockId = text(observation.lockId);
    const lockType = text(observation.lockType);
    const lockKey = `${normalized(lockId)}|${normalized(lockType)}`;
    if (lockId && !edge.locks.some((lock) => `${normalized(lock.lockId)}|${normalized(lock.lockType)}` === lockKey)) {
        edge.locks.push({ lockId, lockType: lockType || null });
    }
    pushUnique(edge.waitKinds, text(observation.waitKind) || 'wait');
    edge.deadlocked ||= Boolean(observation.deadlocked);
    edge.confirmedDeadlock ||= Boolean(observation.confirmedDeadlock);
    edge.ambiguousOwner ||= Boolean(observation.ambiguousOwner);
    if (!edge.className && text(observation.className)) edge.className = text(observation.className);
    if (observation.cycleId != null) pushUnique(edge.cycleIds, observation.cycleId);
    edge.observationCount += 1;
}

function startStrongConnectVisit(nodeId, state) {
    state.indexByNode.set(nodeId, state.nextIndex);
    state.lowLinkByNode.set(nodeId, state.nextIndex);
    state.nextIndex += 1;
    state.stack.push(nodeId);
    state.onStack.add(nodeId);
}

function completeStrongConnectVisit(frame, state) {
    if (frame.parentId != null) {
        state.lowLinkByNode.set(
            frame.parentId,
            Math.min(state.lowLinkByNode.get(frame.parentId), state.lowLinkByNode.get(frame.nodeId)),
        );
    }
    if (state.lowLinkByNode.get(frame.nodeId) !== state.indexByNode.get(frame.nodeId)) return;

    const component = [];
    let cursor = null;
    do {
        cursor = state.stack.pop();
        state.onStack.delete(cursor);
        component.push(cursor);
    } while (cursor !== frame.nodeId);
    state.components.push(component);
}

function visitStrongConnectComponent(startNodeId, adjacency, state) {
    startStrongConnectVisit(startNodeId, state);
    const visitStack = [{ nodeId: startNodeId, nextTargetIndex: 0, parentId: null }];

    while (visitStack.length) {
        const frame = visitStack.at(-1);
        const targets = adjacency.get(frame.nodeId) || [];
        if (frame.nextTargetIndex >= targets.length) {
            visitStack.pop();
            completeStrongConnectVisit(frame, state);
            continue;
        }

        const targetId = targets[frame.nextTargetIndex];
        frame.nextTargetIndex += 1;
        if (!state.indexByNode.has(targetId)) {
            startStrongConnectVisit(targetId, state);
            visitStack.push({ nodeId: targetId, nextTargetIndex: 0, parentId: frame.nodeId });
        } else if (state.onStack.has(targetId)) {
            state.lowLinkByNode.set(
                frame.nodeId,
                Math.min(state.lowLinkByNode.get(frame.nodeId), state.indexByNode.get(targetId)),
            );
        }
    }
}

function findStronglyConnectedComponents(nodeIds, edges) {
    const adjacency = new Map(nodeIds.map((id) => [id, []]));
    for (const edge of edges || []) {
        if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
        adjacency.get(edge.source).push(edge.target);
    }

    const state = {
        nextIndex: 0,
        indexByNode: new Map(),
        lowLinkByNode: new Map(),
        stack: [],
        onStack: new Set(),
        components: [],
    };
    for (const nodeId of nodeIds) {
        if (!state.indexByNode.has(nodeId)) visitStrongConnectComponent(nodeId, adjacency, state);
    }

    const selfLoops = new Set(
        (edges || [])
            .filter((edge) => edge.source === edge.target)
            .map((edge) => edge.source),
    );

    return state.components.filter((component) => component.length > 1 || selfLoops.has(component[0]));
}

function buildCondensedComponents(nodeIds, components) {
    const componentByNode = new Map();
    const allComponents = [];
    const cycleNodeSet = new Set((components || []).flat());

    for (const component of components || []) {
        const index = allComponents.length;
        allComponents.push(component);
        component.forEach((nodeId) => componentByNode.set(nodeId, index));
    }
    for (const nodeId of nodeIds) {
        if (cycleNodeSet.has(nodeId)) continue;
        const index = allComponents.length;
        allComponents.push([nodeId]);
        componentByNode.set(nodeId, index);
    }
    return { allComponents, componentByNode };
}

function buildCondensedAdjacency(componentCount, componentByNode, edges) {
    const adjacency = new Map(Array.from({ length: componentCount }, (_unused, index) => [index, new Set()]));
    for (const edge of edges) {
        const sourceComponent = componentByNode.get(edge.source);
        const targetComponent = componentByNode.get(edge.target);
        if (sourceComponent == null || targetComponent == null || sourceComponent === targetComponent) continue;
        adjacency.get(sourceComponent).add(targetComponent);
    }
    return adjacency;
}

function longestDagPath(adjacency, componentCount) {
    const indegree = new Array(componentCount).fill(0);
    for (const targets of adjacency.values()) {
        for (const target of targets) indegree[target] += 1;
    }

    const depth = new Array(componentCount).fill(1);
    const queue = [];
    for (let index = 0; index < indegree.length; index += 1) {
        if (indegree[index] === 0) queue.push(index);
    }

    let longest = 0;
    for (const componentIndex of queue) {
        longest = Math.max(longest, depth[componentIndex]);
        for (const target of adjacency.get(componentIndex) || []) {
            depth[target] = Math.max(depth[target], depth[componentIndex] + 1);
            indegree[target] -= 1;
            if (indegree[target] === 0) queue.push(target);
        }
    }
    return longest;
}

function longestCondensedPath(nodeIds, edges, components) {
    if (!edges?.length) return 0;
    const { allComponents, componentByNode } = buildCondensedComponents(nodeIds, components);
    const adjacency = buildCondensedAdjacency(allComponents.length, componentByNode, edges);
    return longestDagPath(adjacency, allComponents.length);
}

function finalizeNodeDegrees(nodes, resourceEdges, dependencyEdges) {
    const byId = new Map(nodes.map((node) => [node.id, node]));

    for (const edge of resourceEdges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (source) source.resourceDegree += 1;
        if (target) target.resourceDegree += 1;
    }

    for (const edge of dependencyEdges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (source) {
            source.dependencyDegree += 1;
            pushUnique(source.dependencyTargetIds, edge.target);
        }
        if (target) {
            target.dependencyDegree += 1;
            pushUnique(target.dependencySourceIds, edge.source);
        }
    }

    for (const node of nodes) {
        if (node.type !== 'thread') continue;
        const waits = node.waitingLockIds.length > 0;
        const holds = node.heldLockIds.length > 0;
        const blocks = node.dependencySourceIds.length > 0;
        const depends = node.dependencyTargetIds.length > 0;
        if ((waits || depends) && (holds || blocks)) node.role = 'waiter-owner';
        else if (waits || depends) node.role = 'waiter';
        else if (holds || blocks) node.role = 'owner';
        else if (node.carrier) node.role = 'carrier';
        else if (node.isVirtualThread === true && byId.has(node.carrierId)) node.role = 'virtual';
        else node.role = 'isolated';
    }
}

/**
 * Builds both graph projections for one parsed snapshot.
 */
export function buildThreadDependencyGraph(threads, deadlocks = []) {
    const normalizedThreads = Array.isArray(threads) ? threads : [];
    const normalizedDeadlocks = Array.isArray(deadlocks) ? deadlocks : [];

    const threadNodes = normalizedThreads.map(createThreadNode);
    const threadNodeByThread = new Map(threadNodes.map((node) => [node.rawThread, node]));
    const threadNodeById = new Map(threadNodes.map((node) => [node.id, node]));

    const lockNodesByIdentity = new Map();
    const resourceEdgesById = new Map();
    const ownersByLockIdentity = new Map();
    const dependencyByPair = new Map();

    for (const node of threadNodes) {
        const thread = node.rawThread;
        for (const lock of Array.isArray(thread?.heldLocks) ? thread.heldLocks : []) {
            const lockNode = getOrCreateLock(lockNodesByIdentity, lock);
            if (!lockNode) continue;
            const identity = lockIdentity(lock);
            if (!ownersByLockIdentity.has(identity)) ownersByLockIdentity.set(identity, []);
            if (!ownersByLockIdentity.get(identity).some(owner => owner.id === node.id)) {
                ownersByLockIdentity.get(identity).push(node);
            }
            pushUnique(lockNode.ownerIds, node.id);
            pushUnique(node.heldLockIds, lockNode.id);

            const deadlocked = Boolean(
                node.deadlocked && normalized(thread?.deadlockHoldingLockId) === identity,
            );
            lockNode.deadlocked ||= deadlocked;
            if (deadlocked && node.deadlockCycleId != null) pushUnique(lockNode.deadlockCycleIds, node.deadlockCycleId);

            addResourceEdge(resourceEdgesById, {
                id: `resource:${edgeKey('hold', lockNode.id, node.id, lock?.kind)}`,
                source: lockNode.id,
                target: node.id,
                type: 'hold',
                relationKind: text(lock?.kind) || 'monitor',
                lockId: lockNode.lockId,
                lockType: lockNode.lockType,
                deadlocked,
                confirmedDeadlock: deadlocked,
            });
        }
    }

    const initializersByClass = new Map();
    const waitersByClass = new Map();
    for (const node of threadNodes) {
        for (const initializer of Array.isArray(node.rawThread?.initializingClasses)
            ? node.rawThread.initializingClasses : []) {
            const className = text(initializer?.className);
            if (!className) continue;
            if (!initializersByClass.has(className)) initializersByClass.set(className, []);
            initializersByClass.get(className).push(node);
        }
        for (const wait of Array.isArray(node.rawThread?.classInitializationWaits)
            ? node.rawThread.classInitializationWaits : []) {
            const className = text(wait?.className);
            if (!className) continue;
            if (!waitersByClass.has(className)) waitersByClass.set(className, []);
            waitersByClass.get(className).push(node);
        }
    }

    for (const [className, rawWaiters] of waitersByClass.entries()) {
        const classResource = getOrCreateLock(lockNodesByIdentity, {
            lockId: `class-init:${className}`,
            lockType: `Class initialization monitor for ${className}`,
            className,
            kind: 'class-initialization-wait',
        });
        const initializers = [...new Map((initializersByClass.get(className) || [])
            .map((node) => [node.id, node])).values()];
        const waiters = [...new Map(rawWaiters.map((node) => [node.id, node])).values()];

        for (const initializer of initializers) {
            pushUnique(classResource.ownerIds, initializer.id);
            addResourceEdge(resourceEdgesById, {
                id: `resource:${edgeKey('initialize', classResource.id, initializer.id)}`,
                source: classResource.id,
                target: initializer.id,
                type: 'initialize',
                relationKind: 'class-initializer',
                lockId: classResource.lockId,
                lockType: classResource.lockType,
                className,
                deadlocked: false,
                confirmedDeadlock: false,
            });
        }

        for (const waiter of waiters) {
            pushUnique(classResource.waiterIds, waiter.id);
            pushUnique(waiter.waitingLockIds, classResource.id);
            addResourceEdge(resourceEdgesById, {
                id: `resource:${edgeKey('class-init-wait', waiter.id, classResource.id)}`,
                source: waiter.id,
                target: classResource.id,
                type: 'class-init-wait',
                relationKind: 'class-initialization-wait',
                lockId: classResource.lockId,
                lockType: classResource.lockType,
                className,
                deadlocked: false,
                confirmedDeadlock: false,
            });

            for (const initializer of initializers) {
                addDependencyObservation(dependencyByPair, {
                    source: waiter.id,
                    target: initializer.id,
                    lockId: classResource.lockId,
                    lockType: classResource.lockType,
                    waitKind: 'class-initialization',
                    className,
                    deadlocked: false,
                    confirmedDeadlock: false,
                    ambiguousOwner: initializers.length > 1,
                });
            }
        }
    }

    for (const node of threadNodes) {
        const thread = node.rawThread;
        for (const lock of Array.isArray(thread?.waitingLocks) ? thread.waitingLocks : []) {
            const lockNode = getOrCreateLock(lockNodesByIdentity, lock);
            if (!lockNode) continue;
            const identity = lockIdentity(lock);
            const relationType = relationTypeForWait(lock);
            const deadlocked = Boolean(
                node.deadlocked && normalized(thread?.deadlockWaitingLockId) === identity,
            );

            pushUnique(node.waitingLockIds, lockNode.id);
            if (relationType === 'await') pushUnique(lockNode.awaiterIds, node.id);
            else pushUnique(lockNode.waiterIds, node.id);
            lockNode.deadlocked ||= deadlocked;
            if (deadlocked && node.deadlockCycleId != null) pushUnique(lockNode.deadlockCycleIds, node.deadlockCycleId);

            addResourceEdge(resourceEdgesById, {
                id: `resource:${edgeKey(relationType, node.id, lockNode.id, lock?.kind)}`,
                source: node.id,
                target: lockNode.id,
                type: relationType,
                relationKind: text(lock?.kind) || relationType,
                lockId: lockNode.lockId,
                lockType: lockNode.lockType,
                deadlocked,
                confirmedDeadlock: deadlocked,
            });

            if (!isContendedWait(lock)) continue;
            const owners = ownersByLockIdentity.get(identity) || [];
            for (const owner of owners) {
                addDependencyObservation(dependencyByPair, {
                    source: node.id,
                    target: owner.id,
                    lockId: lockNode.lockId,
                    lockType: lockNode.lockType,
                    waitKind: relationType,
                    deadlocked,
                    confirmedDeadlock: deadlocked,
                    cycleId: node.deadlockCycleId,
                    ambiguousOwner: owners.length > 1,
                });
            }
        }
    }

    // The explicit deadlock section is authoritative. Add or upgrade direct
    // dependency observations even when a truncated stack omits a matching hold line.
    for (const cycle of normalizedDeadlocks) {
        const items = Array.isArray(cycle?.threads) ? cycle.threads : [];
        for (const item of items) {
            const { waiter, owner } = resolveDeadlockParticipants(normalizedThreads, item);
            const source = threadNodeByThread.get(waiter.thread)?.id;
            const target = threadNodeByThread.get(owner.thread)?.id;
            for (const id of [source, target]) {
                const node = threadNodeById.get(id);
                if (node) {
                    node.deadlocked = true;
                    node.deadlockCycleId ??= cycle.id;
                }
            }
            if (!source || !target) continue;

            const sourceNode = threadNodeById.get(source);
            const targetNode = threadNodeById.get(target);
            const cycleId = cycle?.id ?? sourceNode?.deadlockCycleId ?? targetNode?.deadlockCycleId;
            const lockId = text(item?.waitingLockId || sourceNode?.rawThread?.deadlockWaitingLockId);
            const lockType = text(item?.waitingLockType || sourceNode?.rawThread?.deadlockWaitingLockType);

            const parsedWait = (sourceNode?.rawThread?.waitingLocks || [])
                .find((lock) => lockIdentity(lock) === normalized(lockId));
            const waitKind = text(parsedWait?.kind) || 'monitor-enter';
            const waitRelationType = relationTypeForWait({ kind: waitKind });

            addDependencyObservation(dependencyByPair, {
                source,
                target,
                lockId,
                lockType,
                waitKind: waitRelationType,
                deadlocked: true,
                confirmedDeadlock: true,
                cycleId,
                ambiguousOwner: false,
            });

            if (lockId) {
                const lockNode = getOrCreateLock(lockNodesByIdentity, {
                    lockId,
                    lockType,
                    kind: waitKind,
                });
                lockNode.deadlocked = true;
                if (cycleId != null) pushUnique(lockNode.deadlockCycleIds, cycleId);
                pushUnique(lockNode.waiterIds, source);
                pushUnique(sourceNode?.waitingLockIds || [], lockNode.id);

                addResourceEdge(resourceEdgesById, {
                    id: `resource:${edgeKey(waitRelationType, source, lockNode.id, waitKind)}`,
                    source,
                    target: lockNode.id,
                    type: waitRelationType,
                    relationKind: waitKind,
                    lockId: lockNode.lockId,
                    lockType: lockNode.lockType,
                    deadlocked: true,
                    confirmedDeadlock: true,
                });

                if (targetNode) {
                    const parsedHold = (targetNode.rawThread?.heldLocks || [])
                        .find((lock) => lockIdentity(lock) === normalized(lockId));
                    const holdKind = text(parsedHold?.kind) || (waitKind === 'synchronizer-park' ? 'ownable-synchronizer' : 'monitor');
                    pushUnique(lockNode.ownerIds, target);
                    pushUnique(targetNode.heldLockIds, lockNode.id);
                    const identity = lockIdentity({ lockId });
                    if (identity) {
                        if (!ownersByLockIdentity.has(identity)) ownersByLockIdentity.set(identity, []);
                        if (!ownersByLockIdentity.get(identity).some((node) => node.id === targetNode.id)) {
                            ownersByLockIdentity.get(identity).push(targetNode);
                        }
                    }
                    addResourceEdge(resourceEdgesById, {
                        id: `resource:${edgeKey('hold', lockNode.id, target, holdKind)}`,
                        source: lockNode.id,
                        target,
                        type: 'hold',
                        relationKind: holdKind,
                        lockId: lockNode.lockId,
                        lockType: lockNode.lockType,
                        deadlocked: true,
                        confirmedDeadlock: true,
                    });
                }
            }
        }
    }

    const virtualThreadNodes = [];
    const threadNodeIdsPresent = new Set(threadNodes.map(node => node.id));
    for (const virtualNode of threadNodes) {
        if (virtualNode.isVirtualThread !== true || !threadNodeIdsPresent.has(virtualNode.carrierId)) continue;
        addResourceEdge(resourceEdgesById, {
            id: `resource:${edgeKey('mount', virtualNode.id, virtualNode.carrierId)}`,
            source: virtualNode.id,
            target: virtualNode.carrierId,
            type: 'mount',
            relationKind: 'virtual-thread-mount',
            deadlocked: false,
            confirmedDeadlock: false,
        });
    }
    for (const carrierNode of threadNodes) {
        if (carrierNode.rawThread?.format === 'hotspot-file-json') continue;
        if (!carrierNode.carrier || !carrierNode.virtualThreadId) continue;
        const virtualNode = {
            id: `virtual:${carrierNode.sourceKey}:${carrierNode.virtualThreadId}`,
            type: 'virtual-thread',
            label: `Virtual thread #${carrierNode.virtualThreadId}`,
            threadName: `Virtual thread #${carrierNode.virtualThreadId}`,
            state: 'MOUNTED',
            carrierId: carrierNode.id,
            virtualThreadId: carrierNode.virtualThreadId,
            deadlocked: false,
            resourceDegree: 0,
            dependencyDegree: 0,
            role: 'virtual',
        };
        virtualThreadNodes.push(virtualNode);
        addResourceEdge(resourceEdgesById, {
            id: `resource:${edgeKey('mount', virtualNode.id, carrierNode.id)}`,
            source: virtualNode.id,
            target: carrierNode.id,
            type: 'mount',
            relationKind: 'virtual-thread-mount',
            deadlocked: false,
            confirmedDeadlock: false,
        });
    }

    const lockNodes = [...lockNodesByIdentity.values()];
    const resourceEdges = [...resourceEdgesById.values()];
    const dependencyEdges = [...dependencyByPair.values()].map((edge) => ({
        ...edge,
        label: edge.className
            ? `Class init: ${edge.className}`
            : edge.locks.length === 1
            ? edge.locks[0].lockId
            : `${edge.locks.length} locks`,
    }));
    const nodes = [...threadNodes, ...lockNodes, ...virtualThreadNodes];

    finalizeNodeDegrees(nodes, resourceEdges, dependencyEdges);

    const threadNodeIds = threadNodes.map((node) => node.id);
    const observedCycles = findStronglyConnectedComponents(threadNodeIds, dependencyEdges);
    const cycleByNodeId = new Map();
    observedCycles.forEach((component, index) => {
        component.forEach((nodeId) => cycleByNodeId.set(nodeId, index + 1));
    });
    for (const node of threadNodes) {
        node.observedCycleId = cycleByNodeId.get(node.id) || null;
    }
    for (const edge of dependencyEdges) {
        const sourceCycle = cycleByNodeId.get(edge.source);
        edge.observedCycle = Boolean(sourceCycle && sourceCycle === cycleByNodeId.get(edge.target));
        edge.observedCycleId = edge.observedCycle ? sourceCycle : null;
    }

    const contendedLockNodes = lockNodes.filter((node) => node.waiterIds.length > 0);
    const contendedWaitEdges = resourceEdges.filter((edge) =>
        edge.type === 'wait' || edge.type === 'park' || edge.type === 'class-init-wait');
    const ownersObservedByWait = contendedWaitEdges.map((edge) => {
        const lockNode = lockNodesByIdentity.get(normalized(edge.lockId));
        return lockNode?.ownerIds?.length || 0;
    });
    const unresolvedWaitCount = ownersObservedByWait.filter((count) => count === 0).length;
    const ambiguousWaitCount = ownersObservedByWait.filter((count) => count > 1).length;
    const isolatedThreadCount = threadNodes.filter((node) => node.resourceDegree === 0).length;

    return {
        nodes,
        threadNodes,
        lockNodes,
        virtualThreadNodes,
        resourceEdges,
        dependencyEdges,
        observedCycles: observedCycles.map((nodeIds, index) => ({ id: index + 1, nodeIds })),
        metrics: {
            threadCount: threadNodes.length,
            virtualThreadCount: virtualThreadNodes.length + threadNodes.filter(node => node.isVirtualThread === true).length,
            lockCount: lockNodes.length,
            monitorCount: lockNodes.filter((node) => node.resourceKind === 'monitor').length,
            synchronizerCount: lockNodes.filter((node) => node.resourceKind === 'synchronizer').length,
            mixedLockCount: lockNodes.filter((node) => node.resourceKind === 'mixed').length,
            classInitializationResourceCount: lockNodes
                .filter((node) => node.resourceKind === 'class-initialization').length,
            holdRelationCount: resourceEdges.filter((edge) => edge.type === 'hold').length,
            waitRelationCount: contendedWaitEdges.length,
            awaitRelationCount: resourceEdges.filter((edge) => edge.type === 'await').length,
            mountRelationCount: resourceEdges.filter((edge) => edge.type === 'mount').length,
            classInitializationWaitCount: resourceEdges
                .filter((edge) => edge.type === 'class-init-wait').length,
            classInitializerRelationCount: resourceEdges
                .filter((edge) => edge.type === 'initialize').length,
            dependencyCount: dependencyEdges.length,
            contendedLockCount: contendedLockNodes.length,
            unresolvedWaitCount,
            ambiguousWaitCount,
            isolatedThreadCount,
            deadlockedThreadCount: threadNodes.filter((node) => node.deadlocked).length,
            confirmedDeadlockCycleCount: normalizedDeadlocks.length,
            observedDependencyCycleCount: observedCycles.length,
            maxDependencyDepth: longestCondensedPath(threadNodeIds, dependencyEdges, observedCycles),
            largestWaiterFanIn: contendedLockNodes.reduce(
                (max, node) => Math.max(max, node.waiterIds.length),
                0,
            ),
        },
    };
}

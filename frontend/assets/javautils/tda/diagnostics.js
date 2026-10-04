/** Pure provenance metadata for analyzer scenarios and findings. */

export const DIAGNOSTIC_EVIDENCE_LEVELS = Object.freeze([
    'fact',
    'measured',
    'mixed',
    'inferred',
    'heuristic',
    'unclassified',
]);

const LABELS = Object.freeze({
    fact: 'JVM FACT',
    measured: 'MEASURED',
    mixed: 'MIXED',
    inferred: 'INFERRED',
    heuristic: 'HEURISTIC',
    unclassified: 'UNCLASSIFIED',
});

function evidence(level, basis, qualification) {
    return Object.freeze({
        level,
        label: LABELS[level],
        basis,
        qualification,
    });
}

const JVM_DEADLOCK = evidence(
    'fact',
    'JVM-reported deadlock cycle and lock relationship.',
    'Directly reported in the thread dump rather than inferred by the analyzer.',
);
const MONITOR_CONTENTION = evidence(
    'fact',
    'JVM thread state BLOCKED with an explicit monitor identifier.',
    'Describes the observed snapshot only; it does not establish duration or application impact.',
);
const OBSERVED_LOCK_CONTENTION = evidence(
    'fact',
    'The JVM dump explicitly lists a monitor-enter or synchronizer wait with a lock identifier.',
    'Describes the observed snapshot only; it does not establish a wait duration, root cause, or application impact.',
);
const CONFIRMED_LOCK_HOLD = evidence(
    'fact',
    'The JVM dump lists the monitor or ownable synchronizer as held by this thread.',
    'Confirms only the current snapshot observation; it does not prove acquisition time, uninterrupted ownership, or blocking impact.',
);
const CARRIER_MARKER = evidence(
    'fact',
    'Explicit JVM carrier or mounted-virtual-thread marker.',
    'Describes the carrier relationship reported in this snapshot.',
);
const CLASS_INITIALIZATION_WAIT = evidence(
    'fact',
    'HotSpot explicitly reports a thread waiting on the class initialization monitor for a named class.',
    'Confirms only the current snapshot wait. It does not establish duration, application impact, or a deadlock.',
);
const CLASS_INITIALIZER_WITH_WAITERS = evidence(
    'fact',
    'The same snapshot contains exact <clinit> stack evidence for the named class and explicit class-initialization waiters.',
    'Establishes the same-snapshot initializer/waiter relationship, not duration or loss of progress.',
);
const CLASS_INITIALIZATION_STALL = evidence(
    'mixed',
    'Explicit class-initialization waiters and an exact <clinit> initializer are observed; the initializer is also waiting on a parsed JVM resource.',
    'The relationship and current waits are JVM observations, but calling it a stall candidate is an analyzer inference. It is not a confirmed hang or deadlock.',
);
const MEASURED_CPU = evidence(
    'measured',
    'Measured adjacent-snapshot CPU rate with exact thread identity and a validated interval.',
    'Hot is a configured threshold interpretation of the measured interval, not a JVM diagnosis.',
);
const MEASURED_ALLOCATION = evidence(
    'measured',
    'Measured adjacent-snapshot allocated-byte rate with exact thread identity and a validated interval.',
    'This is heap allocation throughput, not retained/live heap, off-heap usage, or proof of a memory leak.',
);
const MEASURED_INFRASTRUCTURE_CPU = evidence(
    'mixed',
    'Measured adjacent-snapshot CPU rate plus a deterministically scored selector or event-loop stack pattern.',
    'CPU activity is measured, but the infrastructure role remains an inference from scored stack evidence.',
);
const STACK_INFERENCE = evidence(
    'inferred',
    'A deterministic weighted score from exact JVM/library frames, Java state, and corroborating metadata.',
    'The scored stack pattern explains match strength but is not a probability or an explicit JVM diagnosis.',
);
const JVM_ROLE_INFERENCE = evidence(
    'inferred',
    'An exact match against the analyzer’s known JVM infrastructure thread-name list.',
    'The role is inferred from a known JVM naming convention and is not an explicit JVM diagnosis.',
);
const LOCK_INFERENCE = evidence(
    'inferred',
    'A deterministic weighted score from parsed lock semantics, Java state, and exact lock-related library frames.',
    'The scored stack pattern explains match strength, but the analyzer still cannot prove application-level ownership intent.',
);
const WAITING_GRAPH = evidence(
    'inferred',
    'Deterministically derived lock owner/waiter graph and a configured waiter threshold.',
    'The waiter count is derived from exact lock identifiers; the significance threshold is an analyzer interpretation.',
);
const LIKELY_LOCK_BLOCKER = evidence(
    'inferred',
    'A thread is observed holding a lock while another thread waits for the same lock in the same snapshot.',
    'This can identify a likely bottleneck, but it does not prove root cause, wait duration, or application impact.',
);
const STARVATION_HEURISTIC = evidence(
    'heuristic',
    'Exact adjacent thread identity and the same uniquely owned lock with at least three waiters at both endpoints of a valid interval.',
    'Repeated endpoint contention can be consistent with starvation but does not prove uninterrupted waiting, loss of progress, or scheduler/resource starvation.',
);
const LIVELOCK_HEURISTIC = evidence(
    'heuristic',
    'Measured current CPU plus a retry or coordination stack pattern.',
    'This pattern can be consistent with livelock but does not prove that useful progress has stopped.',
);

const CATALOG = Object.freeze({
    deadlock: JVM_DEADLOCK,
    'monitor-contention': MONITOR_CONTENTION,
    'observed-lock-contention': OBSERVED_LOCK_CONTENTION,
    'confirmed-lock-hold': CONFIRMED_LOCK_HOLD,
    'carrier-thread': CARRIER_MARKER,
    'class-initialization-wait': CLASS_INITIALIZATION_WAIT,
    'class-initializer-with-waiters': CLASS_INITIALIZER_WITH_WAITERS,
    'class-initialization-stall': CLASS_INITIALIZATION_STALL,

    'cpu-hot': MEASURED_CPU,
    'allocation-hot': MEASURED_ALLOCATION,
    'infra-hot': MEASURED_INFRASTRUCTURE_CPU,
    'hot-selector-event-loop': MEASURED_INFRASTRUCTURE_CPU,

    'reentrant-lock-holder': LOCK_INFERENCE,
    'reentrant-lock-contention': LOCK_INFERENCE,
    'rwlock-reader-wait': LOCK_INFERENCE,
    'rwlock-writer-lock': LOCK_INFERENCE,
    'rwlock-writer-holder': LOCK_INFERENCE,
    rwlock: LOCK_INFERENCE,
    'condition-await': LOCK_INFERENCE,
    'latch-await': STACK_INFERENCE,
    'object-wait': LOCK_INFERENCE,
    sleeping: STACK_INFERENCE,
    'executor-idle': STACK_INFERENCE,
    'jvm-internal': JVM_ROLE_INFERENCE,
    'selector-event-loop': STACK_INFERENCE,
    parked: STACK_INFERENCE,
    'many-waiters': WAITING_GRAPH,
    'likely-lock-bottleneck': LIKELY_LOCK_BLOCKER,

    'possible-starvation': STARVATION_HEURISTIC,
    'possible-livelock': LIVELOCK_HEURISTIC,
});

const UNCLASSIFIED = evidence(
    'unclassified',
    'No registered evidence provenance.',
    'This diagnostic has not been classified as fact, measurement, inference, or heuristic.',
);

export function diagnosticEvidenceFor(key) {
    return { ...(CATALOG[String(key || '')] || UNCLASSIFIED) };
}

export function hasThreadDiagnostic(thread, key) {
    const diagnosticKey = String(key || '');
    if (!diagnosticKey) return false;
    return String(thread?.scenarioKey || '') === diagnosticKey
        || (Array.isArray(thread?.findings)
            && thread.findings.some((finding) => String(finding?.key || '') === diagnosticKey));
}

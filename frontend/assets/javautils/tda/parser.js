/**
 * Pure parsing utilities for the JvmScope · Java Thread Dump Analyzer.
 *
 * This module intentionally has no DOM, D3, network, or browser-global dependencies so
 * parser behavior can be characterized with Node's built-in test runner.
 */

import { MODERN_THREAD_HEADER, parseModernLockLine, readJsonThreadDump, resolveJsonCarriers } from './dump-to-file.js';
import { assignThreadSourceKeys } from './identity.js';
import { parseSnapshotTimestamp } from './time-quality.js';

const DUMP_TIMESTAMP_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const FULL_THREAD_DUMP_HEADER_LINE = /^Full thread dump /;
const ISO_TIMESTAMP_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

// Typical header line:
// "Reference Handler" #19 [51631] daemon prio=10 os_prio=0 cpu=0.25ms elapsed=5064.23s tid=0x... nid=51631 waiting on condition [0x...]
const THREAD_HEADER =
    /^"(?<threadName>[^"]+)"\s+#(?<jvmId>\d+)\s+\[(?<nativeIdDec>\d+)\]\s+(?<daemon>daemon\s+)?prio=(?<prio>-?\d+)\s+os_prio=(?<osPrio>-?\d+)\s+cpu=(?<cpu>[0-9.]+)(?<cpuUnit>ms|s)\s+elapsed=(?<elapsed>[0-9.]+)(?<elapsedUnit>ms|s)(?:\s+(?!tid=)[^\s]+)*\s+tid=(?<tid>0x[0-9a-fA-F]+)\s+nid=(?<nid>[0-9a-fA-Fx]+)\s+(?<stateText>.*?)\s+\[(?<stackPtr>0x[0-9a-fA-F]+)\]\s*$/;
const THREAD_HEADER_JAVA25 =
    /^"(?<threadName>[^"]+)"\s+(?<daemon>daemon\s+)?(?:prio=(?<prio>-?\d+)\s+)?os_prio=(?<osPrio>-?\d+)\s+cpu=(?<cpu>[0-9.]+)(?<cpuUnit>ms|s)\s+elapsed=(?<elapsed>[0-9.]+)(?<elapsedUnit>ms|s)(?:\s+(?!tid=)[^\s]+)*\s+tid=(?<tid>0x[0-9a-fA-F]+)\s+nid=(?<nid>[0-9a-fA-Fx]+)\s+(?<stateText>.*?)\s*$/;
const THREAD_HEADER_CARRIER =
    /^"(?<threadName>[^"]+)"\s+#(?<jvmId>\d+)\s+\[(?<nativeIdDec>\d+)\]\s+(?<daemon>daemon\s+)?prio=(?<prio>-?\d+)\s+os_prio=(?<osPrio>-?\d+)\s+cpu=(?<cpu>[0-9.]+)(?<cpuUnit>ms|s)\s+elapsed=(?<elapsed>[0-9.]+)(?<elapsedUnit>ms|s)(?:\s+(?!tid=)[^\s]+)*\s+tid=(?<tid>0x[0-9a-fA-F]+)\s+\[(?<stackPtr>0x[0-9a-fA-F]+)\]\s*$/;
const JAVA_STATE = /^\s*java\.lang\.Thread\.State:\s*(?<state>[A-Z_]+)(?:\s*\((?<detail>[^)]+)\))?/;
const AT_LINE = /^\s*at\s+(.+)$/;
const WAITING_TO_LOCK_LINE = /^\s*-\s+(?:waiting to lock|waiting to re-lock in wait\(\)) <(?<lockId>0x[0-9a-fA-F]+)>\s+\((?<lockType>[^)]+)\)/;
const WAITING_ON_LINE = /^\s*-\s+waiting on <(?<lockId>0x[0-9a-fA-F]+)>\s+\((?<lockType>[^)]+)\)/;
const PARKING_TO_WAIT_FOR_LINE = /^\s*-\s+parking to wait for\s+<(?<lockId>0x[0-9a-fA-F]+)>\s+\((?<lockType>[^)]+)\)/;
const CLASS_INITIALIZATION_MONITOR_LINE =
    /^\s*-\s+waiting on the Class initialization monitor for\s+(?<className>\S+)\s*$/;
const LOCKED_LINE = /^\s*-\s+locked <(?<lockId>0x[0-9a-fA-F]+)>\s+\((?<lockType>[^)]+)\)/;
const OWNABLE_SYNCHRONIZERS_HEADER = /^\s*Locked ownable synchronizers:\s*$/;
const OWNABLE_SYNCHRONIZER_LINE = /^\s*-\s+<(?<lockId>0x[0-9a-fA-F]+)>\s+\((?<lockType>[^)]+)\)/;
const DEADLOCK_FOUND_LINE = /^Found (?:one|\d+) Java-level deadlock:/;
const DEADLOCK_THREAD_LINE = /^"(?<threadName>.*)":\s*$/;
const DEADLOCK_HELD_BY_LINE = /^\s*which is held by "(?<heldBy>.*)"\s*$/;
const DEADLOCK_WAITING_MONITOR_LINE =
    /^\s*waiting to lock monitor\s+\S+\s+\(object\s+(?<lockId>0x[0-9a-fA-F]+),\s+(?<lockType>[^)]+)\),?\s*$/;
const DEADLOCK_WAITING_SYNCHRONIZER_LINE =
    /^\s*waiting for ownable synchronizer\s+(?<lockId>0x[0-9a-fA-F]+),\s+\((?<lockType>[^)]+)\)/;
const CARRYING_VIRTUAL_THREAD_LINE = /^\s*Carrying virtual thread #(?<vtId>\d+)\s*$/;
const MOUNTED_VIRTUAL_THREAD_LINE = /^\s*Mounted virtual thread #(?<vtId>\d+)\s*$/;
const THREAD_DUMP_SECTION_BOUNDARIES = [
    /^JNI global (?:refs|references):/,
    /^Found (?:one|\d+) Java-level deadlock:/,
    /^Java stack information for the threads listed above:/,
    /^Threads class SMR info:/,
    /^_java_thread_list=/,
];
const KNOWN_HEADER_FIELDS = new Set([
    'prio', 'os_prio', 'cpu', 'elapsed', 'tid', 'nid', 'allocated', 'defined_classes',
]);
// Java 7 assigns prio to these native-only VM headers, without a Java ID,
// stack pointer or java.lang.Thread.State line. Keep unrelated/pruned Java
// headers incomplete rather than relaxing the check for every legacy thread.
const LEGACY_NATIVE_VM_THREAD_NAME = /^(?:VM Thread|VM Periodic Task Thread|GC task thread#\d+ \([^)]+\))$/;

function toNumberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function parseBytes(value) {
    if (!value) return null;

    const match = String(value).trim().match(/^([0-9.]+)\s*([KMGTP]?)(?:B)?$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;

    const unit = (match[2] || '').toUpperCase();
    const scale =
        unit === '' ? 1 :
            unit === 'K' ? 1024 :
                unit === 'M' ? 1024 ** 2 :
                    unit === 'G' ? 1024 ** 3 :
                        unit === 'T' ? 1024 ** 4 :
                            unit === 'P' ? 1024 ** 5 : 1;
    return Math.round(amount * scale);
}

function extractThreadLocks(thread) {
    thread.waitingToLock = null;
    thread.lockedMonitors = [];
    thread.ownedSynchronizers = [];
    thread.waitingLocks = [];
    let inOwnableSynchronizers = false;

    for (const line of thread.rawBlock || []) {
        if (OWNABLE_SYNCHRONIZERS_HEADER.test(line)) {
            inOwnableSynchronizers = true;
            continue;
        }

        if (inOwnableSynchronizers) {
            const synchronizerMatch = line.match(OWNABLE_SYNCHRONIZER_LINE);
            if (synchronizerMatch?.groups) {
                thread.ownedSynchronizers.push({
                    lockId: synchronizerMatch.groups.lockId,
                    lockType: synchronizerMatch.groups.lockType,
                    kind: 'ownable-synchronizer',
                });
            }
            continue;
        }

        const modernLock = parseModernLockLine(line);
        if (modernLock) {
            if (modernLock.kind === 'monitor') thread.lockedMonitors.push(modernLock);
            else thread.waitingLocks.push(modernLock);
            if (modernLock.kind === 'monitor-enter') thread.waitingToLock = modernLock;
            continue;
        }
        const waitingMatch = line.match(WAITING_TO_LOCK_LINE);
        if (waitingMatch?.groups) {
            const waitingLock = {
                lockId: waitingMatch.groups.lockId,
                lockType: waitingMatch.groups.lockType,
                kind: 'monitor-enter',
            };
            thread.waitingToLock = waitingLock;
            thread.waitingLocks.push(waitingLock);
            continue;
        }

        const waitingOnMatch = line.match(WAITING_ON_LINE);
        if (waitingOnMatch?.groups) {
            thread.waitingLocks.push({
                lockId: waitingOnMatch.groups.lockId,
                lockType: waitingOnMatch.groups.lockType,
                kind: 'monitor-wait',
            });
            continue;
        }

        const parkingMatch = line.match(PARKING_TO_WAIT_FOR_LINE);
        if (parkingMatch?.groups) {
            thread.waitingLocks.push({
                lockId: parkingMatch.groups.lockId,
                lockType: parkingMatch.groups.lockType,
                kind: 'synchronizer-park',
            });
            continue;
        }

        const lockedMatch = line.match(LOCKED_LINE);
        if (lockedMatch?.groups) {
            thread.lockedMonitors.push({
                lockId: lockedMatch.groups.lockId,
                lockType: lockedMatch.groups.lockType,
                kind: 'monitor',
            });
        }
    }

    // HotSpot may still print lexical '- locked' frames for the monitor released
    // by Object.wait(), including while the thread is blocked re-acquiring it.
    const unownedMonitors = new Set(thread.waitingLocks
        .filter((lock) => lock.kind === 'monitor-wait' || lock.kind === 'monitor-enter')
        .map((lock) => lock.lockId.toLowerCase()));
    thread.lockedMonitors = thread.lockedMonitors.filter((lock) => !unownedMonitors.has(lock.lockId.toLowerCase()));
    const uniqueLocks = locks => [...new Map(locks.map(lock => [lock.lockId.toLowerCase(), lock])).values()];
    thread.lockedMonitors = uniqueLocks(thread.lockedMonitors);
    thread.ownedSynchronizers = uniqueLocks(thread.ownedSynchronizers);
    thread.heldLocks = uniqueLocks([...thread.lockedMonitors, ...thread.ownedSynchronizers]);
}

function classNameFromClinitFrame(line) {
    const frame = String(line || '').match(/^\s*at\s+(.+?)\.<clinit>\(/)?.[1];
    if (!frame) return null;
    const className = frame.slice(frame.lastIndexOf('/') + 1).trim();
    return className || null;
}

function extractClassInitialization(thread) {
    thread.classInitializationWaits = [];
    thread.initializingClasses = [];

    for (const [lineIndex, line] of (thread.rawBlock || []).entries()) {
        const rawLineNumber = Number.isInteger(thread.rawStartLine)
            ? thread.rawStartLine + lineIndex
            : null;
        const waitingMatch = line.match(CLASS_INITIALIZATION_MONITOR_LINE);
        if (waitingMatch?.groups?.className) {
            thread.classInitializationWaits.push({
                className: waitingMatch.groups.className,
                kind: 'class-initialization-wait',
                rawLine: line,
                rawLineNumber,
            });
        }

        const className = classNameFromClinitFrame(line)
            || (thread.format === 'hotspot-file-text' ? classNameFromClinitFrame(`at ${line.trim()}`) : null);
        if (!className || thread.initializingClasses.some((item) => item.className === className)) continue;
        thread.initializingClasses.push({
            className,
            kind: 'class-initializer',
            rawLine: line,
            rawLineNumber,
        });
    }

    thread.classInitializationWait = thread.classInitializationWaits[0] || null;
}

function extractCarrierVirtualThreadInfo(thread) {
    thread.carrierVirtualThreadId = null;
    thread.mountedVirtualThreadId = null;
    thread.carrierStackLines = [];
    thread.mountedVirtualStackLines = [];
    thread.isCarrierThread = false;

    let inMountedSection = false;
    for (const line of thread.rawBlock || []) {
        const carryingMatch = line.match(CARRYING_VIRTUAL_THREAD_LINE);
        if (carryingMatch?.groups?.vtId) {
            thread.carrierVirtualThreadId = carryingMatch.groups.vtId;
            thread.isCarrierThread = true;
            continue;
        }

        const mountedMatch = line.match(MOUNTED_VIRTUAL_THREAD_LINE);
        if (mountedMatch?.groups?.vtId) {
            thread.mountedVirtualThreadId = mountedMatch.groups.vtId;
            thread.isCarrierThread = true;
            inMountedSection = true;
            continue;
        }

        if (/^\s*Locked ownable synchronizers:/.test(line)) inMountedSection = false;

        if (/^\s*at /.test(line) || /^\s*-\s+/.test(line)) {
            (inMountedSection ? thread.mountedVirtualStackLines : thread.carrierStackLines).push(line);
        }
    }
}

function isThreadDumpSectionBoundary(line) {
    return THREAD_DUMP_SECTION_BOUNDARIES.some((pattern) => pattern.test(line));
}

function splitThreadHeader(rawHeaderLine) {
    // HotSpot prints names verbatim, including empty names and embedded quotes.
    // The closing quote is followed by JVM fields, never part of the name.
    return rawHeaderLine.match(/^"(?<threadName>.*)"\s+(?<rest>.+)$/)?.groups || null;
}

function isSuspectedThreadHeader(line) {
    const parts = splitThreadHeader(line);
    return Boolean(parts && /(?:^|\s)(?:#\d+\b|(?:prio|os_prio|tid|nid)=)/.test(parts.rest));
}

function toHeaderResult(match, format, rawHeaderLine) {
    const fields = match.groups;
    return {
        format,
        rawHeaderLine,
        threadName: splitThreadHeader(rawHeaderLine).threadName,
        jvmId: fields.jvmId ?? null,
        nativeIdDec: fields.nativeIdDec ?? null,
        daemon: Boolean(fields.daemon),
        prio: fields.prio ?? null,
        osPrio: fields.osPrio ?? null,
        cpu: fields.cpu ?? null,
        cpuUnit: fields.cpuUnit ?? null,
        elapsed: fields.elapsed ?? null,
        elapsedUnit: fields.elapsedUnit ?? null,
        tid: fields.tid ?? null,
        nid: fields.nid ?? null,
        stateText: (fields.stateText || '').trim(),
        stackPtr: fields.stackPtr ?? null,
        extraHeaderFields: Object.fromEntries(
            [...splitThreadHeader(rawHeaderLine).rest.matchAll(/\b([a-z_]+)=([^\s\]]+)/gi)]
                .filter(([, key]) => !KNOWN_HEADER_FIELDS.has(key.toLowerCase()))
                .map(([, key, value]) => [key, value]),
        ),
    };
}

/**
 * Parses supported header shapes in order. The fallback deliberately requires both
 * a quoted name and credible JVM header markers so normal quoted log lines are not
 * mistaken for threads.
 */
export function parseThreadHeader(rawHeaderLine) {
    const modern = rawHeaderLine.match(MODERN_THREAD_HEADER)?.groups;
    if (modern) return {
        format: 'hotspot-file-text', rawHeaderLine, threadName: modern.threadName,
        jvmId: modern.jvmId, isVirtualThread: Boolean(modern.virtual),
        javaState: modern.state || null, observationTime: modern.time || null,
        extraHeaderFields: {},
    };
    const namedHeader = splitThreadHeader(rawHeaderLine);
    if (!namedHeader) return null;
    const headerFields = `"thread" ${namedHeader.rest}`;
    const standardMatch = headerFields.match(THREAD_HEADER);
    if (standardMatch?.groups) return toHeaderResult(standardMatch, 'hotspot-standard', rawHeaderLine);

    const relaxedMatch = headerFields.match(THREAD_HEADER_JAVA25);
    if (relaxedMatch?.groups) return toHeaderResult(relaxedMatch, 'hotspot-relaxed', rawHeaderLine);

    const carrierMatch = headerFields.match(THREAD_HEADER_CARRIER);
    if (carrierMatch?.groups) return toHeaderResult(carrierMatch, 'carrier', rawHeaderLine);

    const rest = namedHeader.rest;
    const hasIdentityMarker = /(?:^|\s)#\d+\b|\btid=0x[0-9a-f]+\b|\bnid=(?:0x)?[0-9a-f]+\b/i.test(rest);
    const hasSchedulingMarker = /\b(?:prio|os_prio)=/.test(rest);
    if (!hasIdentityMarker || !hasSchedulingMarker) return null;

    const fields = Object.fromEntries(
        [...rest.matchAll(/\b([a-z_]+)=([^\s\]]+)/gi)].map(([, key, value]) => [key.toLowerCase(), value]),
    );
    const cpuMatch = String(fields.cpu || '').match(/^(?<value>[0-9.]+)(?<unit>ms|s)$/i);
    const elapsedMatch = String(fields.elapsed || '').match(/^(?<value>[0-9.]+)(?<unit>ms|s)$/i);
    const idMatch = rest.match(/(?:^|\s)#(?<jvmId>\d+)\b(?:\s+\[(?<nativeIdDec>\d+)\])?/);
    const stackPointerMatches = [...rest.matchAll(/\[(0x[0-9a-f]+)\]/gi)];
    const stackPtr = stackPointerMatches.at(-1)?.[1] || null;
    const stateText = rest
        .replace(/(?:^|\s)#\d+\b(?:\s+\[\d+\])?/, ' ')
        .replace(/\bdaemon\b/g, ' ')
        .replace(/\b[a-z_]+=[^\s\]]+/gi, ' ')
        .replace(/\[(?:0x[0-9a-f]+|\d+)\]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        format: fields.nid ? 'hotspot-classic' : 'carrier',
        rawHeaderLine,
        threadName: namedHeader.threadName,
        jvmId: idMatch?.groups?.jvmId ?? null,
        nativeIdDec: idMatch?.groups?.nativeIdDec ?? null,
        daemon: /(?:^|\s)daemon(?:\s|$)/.test(rest),
        prio: fields.prio ?? null,
        osPrio: fields.os_prio ?? null,
        cpu: cpuMatch?.groups?.value ?? null,
        cpuUnit: cpuMatch?.groups?.unit?.toLowerCase() ?? null,
        elapsed: elapsedMatch?.groups?.value ?? null,
        elapsedUnit: elapsedMatch?.groups?.unit?.toLowerCase() ?? null,
        tid: fields.tid ?? null,
        nid: fields.nid ?? null,
        stateText,
        stackPtr,
        extraHeaderFields: Object.fromEntries(
            Object.entries(fields).filter(([key]) => !KNOWN_HEADER_FIELDS.has(key)),
        ),
    };
}

/**
 * Parses HotSpot Thread.print/jstack and Thread.dump_to_file text/JSON.
 * Missing source fields remain unavailable; JSON keeps original source ranges.
 */
export function parseThreadDump(text, { snapshotIndex = 0, diagnostics = null } = {}) {
    const source = String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/^\uFEFF/, '');
    const json = readJsonThreadDump(source);
    if (json) {
        if (diagnostics) {
            diagnostics.invalidJson = Boolean(json.invalid);
            diagnostics.skippedRecords = json.skipped || 0;
            diagnostics.collectionIncomplete = Boolean(json.collectionIncomplete);
        }
        return resolveJsonCarriers(assignThreadSourceKeys(json.threads.map(record => {
            const thread = parseThreadDump(record.analysisText, { snapshotIndex })[0];
            thread.format = 'hotspot-file-json';
            thread.threadName = record.value.name;
            thread.isVirtualThread = record.value.virtual ?? null;
            thread.carrierThreadId = record.carrierThreadId;
            thread.observationTime = typeof record.value.time === 'string' ? record.value.time : null;
            thread.rawBlock = record.rawBlock;
            thread.rawHeaderLine = record.rawBlock[0] || '';
            thread.rawStartLine = record.startLine;
            thread.rawEndLine = record.endLine;
            // JSON source coordinates refer to the actual object, not generated text.
            thread.classInitializationWaits = [];
            for (const item of thread.initializingClasses) item.rawLineNumber = null;
            return thread;
        }), snapshotIndex));
    }
    const lines = source.split('\n');
    const threads = [];
    let current = null;

    function flush() {
        if (!current) return;
        current.topFrame = current.topFrame || '';
        extractThreadLocks(current);
        extractClassInitialization(current);
        extractCarrierVirtualThreadInfo(current);
        current.locksHeldCount = current.heldLocks.length;
        threads.push(current);
        current = null;
    }

    for (const [lineIndex, line] of lines.entries()) {
        const lineNumber = lineIndex + 1;
        if (current && isThreadDumpSectionBoundary(line)) {
            flush();
            continue;
        }

        const header = parseThreadHeader(line);
        if (header) {
            flush();
            const cpu = toNumberOrNull(header.cpu);
            const elapsed = toNumberOrNull(header.elapsed);
            const headerFields = splitThreadHeader(line)?.rest || '';
            const allocated = (headerFields.match(/\ballocated=(\S+)/) || [])[1] || null;
            const definedClasses = (headerFields.match(/\bdefined_classes=(\S+)/) || [])[1] || null;

            current = {
                index: threads.length + 1,
                format: header.format,
                rawHeaderLine: header.rawHeaderLine,
                extraHeaderFields: header.extraHeaderFields,
                threadName: header.threadName,
                jvmId: header.jvmId == null ? null : (Number.isSafeInteger(Number(header.jvmId)) ? Number(header.jvmId) : header.jvmId),
                nativeIdDec: header.nativeIdDec != null ? Number(header.nativeIdDec) : null,
                daemon: header.daemon,
                prio: header.prio != null ? Number(header.prio) : null,
                osPrio: header.osPrio != null ? Number(header.osPrio) : null,
                cpuMs: cpu == null ? null : (header.cpuUnit === 's' ? cpu * 1000 : cpu),
                elapsedS: elapsed == null ? null : (header.elapsedUnit === 'ms' ? elapsed / 1000 : elapsed),
                elapsedResolutionMs: elapsed == null ? null
                    : (header.elapsedUnit === 'ms' ? 1 : 1000) * 10 ** -(String(header.elapsed).split('.')[1]?.length || 0),
                tid: header.tid,
                nid: header.nid || null,
                stateText: header.stateText,
                stackPtr: header.stackPtr,
                javaState: header.javaState || null,
                isVirtualThread: header.isVirtualThread ?? null,
                lockDataAvailable: header.format !== 'hotspot-file-text' || Boolean(header.javaState),
                observationTime: header.observationTime || null,
                javaStateDetail: null,
                topFrame: null,
                rawBlock: [line],
                rawStartLine: lineNumber,
                rawEndLine: lineNumber,
                stackLines: [],
                stackFrames: 0,
                allocated,
                allocatedBytes: allocated ? parseBytes(allocated) : null,
                definedClasses: definedClasses != null ? Number(definedClasses) : null,
                carrierVirtualThreadId: null,
                mountedVirtualThreadId: null,
                carrierStackLines: [],
                mountedVirtualStackLines: [],
                isCarrierThread: false,
            };
            continue;
        }

        if (isSuspectedThreadHeader(line) || /^#\d+\s+"/.test(line)) {
            flush();
            if (diagnostics) (diagnostics.unparsedHeaderLines ??= []).push(lineNumber);
            continue;
        }
        if (!current) continue;
        current.rawBlock.push(line);
        current.rawEndLine = lineNumber;

        const stateMatch = line.match(JAVA_STATE);
        if (stateMatch?.groups) {
            current.javaState = stateMatch.groups.state || null;
            current.javaStateDetail = stateMatch.groups.detail || null;
            continue;
        }

        const frameMatch = line.match(AT_LINE)
            || (current.format === 'hotspot-file-text' ? line.match(/^\s+((?!-)[^\s]+\.[^\s(]+\([^)]*\))\s*$/) : null);
        if (frameMatch) {
            const frame = String(frameMatch[1] || '').trim();
            current.stackLines.push(/^\s*at\s/.test(line) ? line : `    at ${frame}`);
            current.stackFrames += 1;
            if (!current.topFrame) current.topFrame = frame;
            continue;
        }

        if (/^\s*-\s+/.test(line)) current.stackLines.push(line);
    }

    flush();
    return assignThreadSourceKeys(threads, snapshotIndex);
}

export function parseDeadlocks(text) {
    const lines = String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const cycles = [];
    let entries = [];
    let inDeadlockSection = false;
    let current = null;

    function flushEntry() {
        if (current?.heldBy != null) entries.push(current);
        current = null;
    }

    function flushSection() {
        flushEntry();
        // Each HotSpot deadlock section reports its participants in cycle order.
        // Names need not be unique; preserve every entry for lock-based resolution.
        if (entries.length) cycles.push({ id: cycles.length + 1, threads: entries });
        entries = [];
        inDeadlockSection = false;
    }

    for (const line of lines) {
        if (DEADLOCK_FOUND_LINE.test(line)) {
            flushSection();
            inDeadlockSection = true;
            continue;
        }
        if (!inDeadlockSection) {
            continue;
        }
        if (/^Java stack information for the threads listed above:/.test(line)) {
            flushSection();
            continue;
        }

        const threadMatch = line.match(DEADLOCK_THREAD_LINE);
        if (threadMatch?.groups) {
            flushEntry();
            current = { threadName: threadMatch.groups.threadName, waitingLockId: null, waitingLockType: null, heldBy: null };
            continue;
        }
        if (!current) continue;

        const waitingMatch = line.match(DEADLOCK_WAITING_MONITOR_LINE)
            || line.match(DEADLOCK_WAITING_SYNCHRONIZER_LINE);
        if (waitingMatch?.groups) {
            current.waitingLockId = waitingMatch.groups.lockId;
            current.waitingLockType = waitingMatch.groups.lockType;
            continue;
        }

        const heldByMatch = line.match(DEADLOCK_HELD_BY_LINE);
        if (heldByMatch?.groups) current.heldBy = heldByMatch.groups.heldBy;
    }
    flushSection();
    return cycles;
}

function snapshotTimestampFields(value) {
    const metadata = parseSnapshotTimestamp(value);
    return {
        timestampRaw: metadata.raw,
        timestampQuality: metadata.status,
        timestampFormat: metadata.format,
        timestampTimezoneKind: metadata.timezoneKind,
        timestampTimezoneLabel: metadata.timezoneLabel,
        timestampEpochMs: metadata.epochMs,
        timestampQualityReason: metadata.reason,
    };
}

function parseTimestampLine(value) {
    const timestampRaw = String(value || '').trim();
    if (!timestampRaw) return null;
    if (!DUMP_TIMESTAMP_LINE.test(timestampRaw) && !ISO_TIMESTAMP_LINE.test(timestampRaw)) return null;
    return snapshotTimestampFields(timestampRaw);
}

/**
 * Finds snapshot headers before slicing input. This prevents a later header from
 * leaking into the preceding snapshot and preserves any initial preamble.
 */
export function splitThreadDumpSnapshots(text) {
    const normalized = String(text || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/^\uFEFF/, '');
    const json = readJsonThreadDump(normalized);
    if (json) return [{ index: 0, timestamp: json.time || null, ...snapshotTimestampFields(json.time),
        boundaryStrategy: 'json', headerLine: null, rawText: normalized.trim(),
        processId: json.processId ?? null, collectionScope: 'all-threads' }];
    const lines = normalized.split('\n');
    const boundaries = [];

    for (let headerIndex = 0; headerIndex < lines.length; headerIndex += 1) {
        if (/^\d+$/.test(lines[headerIndex].trim()) && parseTimestampLine(lines[headerIndex + 1])
            && /^\d+(?:[.\-+]|$)/.test(lines[headerIndex + 2] || '')) {
            boundaries.push({ headerIndex, startIndex: headerIndex,
                timestamp: parseTimestampLine(lines[headerIndex + 1]), boundaryStrategy: 'file-text',
                processId: lines[headerIndex].trim(), collectionScope: 'all-threads' });
            continue;
        }
        if (!FULL_THREAD_DUMP_HEADER_LINE.test(lines[headerIndex])) continue;

        const adjacentTimestamp = parseTimestampLine(lines[headerIndex - 1]);
        // ThreadDumpCollector prepends an ISO timestamp to jcmd's PID/date/header
        // triple. Keep it for chronology, but also retain the actual JVM clock:
        // a collector clock does not measure the atomic thread sampling time.
        // Require the exact prefix shape so unrelated preamble dates stay unused.
        const collectorTimestamp = adjacentTimestamp
            && /^\d+:$/.test(String(lines[headerIndex - 2] || '').trim())
            && ISO_TIMESTAMP_LINE.test(String(lines[headerIndex - 3] || '').trim())
            ? parseTimestampLine(lines[headerIndex - 3]) : null;
        const timestamp = collectorTimestamp || adjacentTimestamp;
        boundaries.push({
            headerIndex,
            startIndex: collectorTimestamp ? headerIndex - 3 : timestamp ? headerIndex - 1 : headerIndex,
            timestamp,
            timestampSource: collectorTimestamp ? 'collector' : 'jvm',
            jvmTimestampRaw: adjacentTimestamp?.timestampRaw ?? null,
            boundaryStrategy: timestamp ? 'timestamp-header' : 'header',
            collectionScope: 'platform-threads',
        });
    }

    if (!boundaries.length) {
        const missingTimestamp = snapshotTimestampFields(null);
        return [{
            index: 0,
            timestamp: null,
            ...missingTimestamp,
            boundaryStrategy: 'single-fallback',
            headerLine: null,
            rawText: normalized.trim(),
        }];
    }

    return boundaries.map((boundary, index) => {
        const nextBoundary = boundaries[index + 1];
        const startIndex = index === 0 ? 0 : boundary.startIndex;
        const endIndex = nextBoundary ? nextBoundary.startIndex : lines.length;
        const timestampRaw = boundary.timestamp?.timestampRaw ?? null;
        const timestampMetadata = boundary.timestamp || snapshotTimestampFields(null);

        return {
            index,
            timestamp: timestampRaw,
            timestampRaw,
            timestampSource: boundary.timestampSource ?? 'jvm',
            jvmTimestampRaw: boundary.jvmTimestampRaw ?? null,
            timestampQuality: timestampMetadata.timestampQuality,
            timestampFormat: timestampMetadata.timestampFormat,
            timestampTimezoneKind: timestampMetadata.timestampTimezoneKind,
            timestampTimezoneLabel: timestampMetadata.timestampTimezoneLabel,
            timestampEpochMs: timestampMetadata.timestampEpochMs,
            timestampQualityReason: timestampMetadata.timestampQualityReason,
            boundaryStrategy: boundary.boundaryStrategy,
            processId: boundary.processId ?? null,
            collectionScope: boundary.collectionScope,
            headerLine: lines[boundary.headerIndex].trim(),
            rawText: lines.slice(startIndex, endIndex).join('\n').trim(),
        };
    });
}

/**
 * Produces an explicit parsing status without requiring presentation code to
 * interpret an empty list as a valid zero-thread analysis.
 */
export function analyzeThreadDump(text, { snapshotIndexOffset = 0 } = {}) {
    const sourceText = String(text || '');
    if (!sourceText.trim()) {
        return {
            status: 'empty',
            snapshots: [],
            warnings: ['No thread-dump content was supplied.'],
            diagnostics: { supportedThreadHeaders: 0, snapshots: 0 },
        };
    }

    const snapshots = splitThreadDumpSnapshots(sourceText).map(value => {
        const snapshot = { ...value, index: value.index + snapshotIndexOffset };
        const diagnostics = {};
        const parsedThreads = parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index, diagnostics });
        const headerOnlyVmThreads = parsedThreads.filter(thread =>
            thread.rawBlock.slice(1).every(line => !String(line || '').trim())
            && thread.jvmId == null && (thread.prio == null || LEGACY_NATIVE_VM_THREAD_NAME.test(thread.threadName)) && thread.stackPtr == null
            && thread.javaState == null && thread.stackFrames === 0
            && Boolean(thread.tid && thread.nid && thread.stateText));
        const vmKeys = new Set(headerOnlyVmThreads.map(thread => thread.sourceKey));
        const truncatedThreads = parsedThreads.filter(thread =>
            !thread.format.startsWith('hotspot-file-') && !vmKeys.has(thread.sourceKey)
            && (thread.rawBlock.length === 1 || (!thread.javaState && thread.stackFrames === 0)));
        Object.assign(diagnostics, {
            supportedThreadHeaders: parsedThreads.length,
            truncatedThreads: truncatedThreads.length,
            unparsedThreadHeaders: diagnostics.unparsedHeaderLines?.length || 0,
            headerOnlyVmThreads: headerOnlyVmThreads.length,
        });
        const incomplete = !parsedThreads.length || truncatedThreads.length || diagnostics.unparsedThreadHeaders
            || diagnostics.skippedRecords || diagnostics.invalidJson || diagnostics.collectionIncomplete;
        return { ...snapshot, parsedThreads, diagnostics, parsingStatus: incomplete ? 'partial' : 'success' };
    });
    const sum = key => snapshots.reduce((total, snapshot) => total + (snapshot.diagnostics[key] || 0), 0);
    const supportedThreadHeaders = sum('supportedThreadHeaders');
    const truncatedThreads = sum('truncatedThreads');
    const unparsedThreadHeaders = sum('unparsedThreadHeaders');
    const incompleteSnapshots = snapshots.filter(snapshot => snapshot.parsingStatus !== 'success').length;
    const warnings = [];
    if (!supportedThreadHeaders) warnings.push('No supported thread headers were found in the supplied content.');
    if (truncatedThreads) warnings.push(`${truncatedThreads} parsed thread block(s) appears truncated or incomplete.`);
    if (unparsedThreadHeaders) warnings.push(`${unparsedThreadHeaders} suspected thread header(s) could not be parsed; their blocks were excluded.`);
    if (incompleteSnapshots) warnings.push(`${incompleteSnapshots} snapshot(s) is incomplete; thread arrivals and departures cannot be determined reliably.`);
    return {
        status: !supportedThreadHeaders ? 'unsupported' : incompleteSnapshots ? 'partial' : 'success',
        snapshots, warnings,
        diagnostics: { supportedThreadHeaders, snapshots: snapshots.length, truncatedThreads, unparsedThreadHeaders,
            headerOnlyVmThreads: sum('headerOnlyVmThreads'), incompleteSnapshots, skippedRecords: sum('skippedRecords') },
    };
}

/**
 * Safe canonicalization used for stack comparisons. Raw stack frames remain unchanged.
 * The lambda replacement is intentionally characterized before TDA-104 corrects it.
 */
export function normalizeStackFrame(frame) {
    let normalized = String(frame || '').trim();
    if (!normalized) return '';

    normalized = normalized.replace(/\(Native Method\)/g, '()');
    normalized = normalized.replace(/:\d+\)/g, ')');
    normalized = normalized.replace(/\$\$Lambda\/0x[0-9a-fA-F]+/g, '$$Lambda');
    normalized = normalized.replace(/0x[0-9a-fA-F]+/g, '0x');
    normalized = normalized.replace(/\blambda\$([^(]+)\$\d+\b/g, (_match, methodName) => `lambda$${methodName}`);
    return normalized.replace(/\s+/g, ' ').trim();
}

export function extractNormalizedFrames(thread) {
    return (Array.isArray(thread?.stackLines) ? thread.stackLines : Array.isArray(thread?.rawBlock) ? thread.rawBlock : [])
        .map((line) => String(line || '').match(/^\s*at\s+(.+)$/))
        .map((match) => match ? normalizeStackFrame(match[1]) : '')
        .filter(Boolean);
}

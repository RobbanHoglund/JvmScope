import { analyzeThreadDumpData } from '../../../frontend/assets/javautils/tda/analysis.js';
import { analyzeTlsLog } from '../../../frontend/assets/javautils/tls-parser.js';
import { explainIssueSections } from '../../../frontend/assets/javautils/tls-explanations.js';
import { parseGcLog, analyzeGc } from '../../../frontend/assets/javautils/gc/parser.js';
import { sourceInfo } from './captures.mjs';

export function page(items, offset = 0, limit = 10) {
    return { total: items.length, offset, nextOffset: offset + limit < items.length ? offset + limit : null, items: items.slice(offset, offset + limit) };
}
const tally = values => values.reduce((result, value) => { result[value] = (result[value] || 0) + 1; return result; }, {});
const overview = captures => ({ schemaVersion: 1, sources: captures.map(sourceInfo), privacy: 'Parsed locally. Returned evidence is visible to the connected AI host; this is not offline AI.' });

export function analyzeThreads(captures, { offset = 0, limit = 10 } = {}) {
    const result = analyzeThreadDumpData(captures.map((c, i) => ({ id: `source:${i}`, name: c.name, label: c.name, text: c.text })));
    const rejected = result.sourceResults.filter(s => !s.accepted);
    if (!result.parsedDumps.length) throw new Error(`No supported thread snapshots. ${result.parserResult.warnings.join(' ')}`);
    const snapshots = result.parsedDumps.map(d => {
        const source = captures[Number(d.sourceId.split(':')[1])];
        const findThread = ref => d.threads.find(t => t.sourceKey === ref.sourceKey);
        const findings = d.smartAnalysis.findings.map(f => ({
            ...f,
            facts: page(f.facts || [], 0, 20), resourceIds: page(f.resourceIds || [], 0, 20),
            threads: page((f.threads || []).map(ref => {
                const t = findThread(ref);
                // JSON dumps have no physical per-thread source range in the parser.
                const hasLines = t?.format === 'hotspot-classic' && Number.isInteger(t.rawStartLine);
                return { ...ref, startLine: hasLines ? d.sourceStartLine + t.rawStartLine - 1 : null,
                    endLine: hasLines ? d.sourceStartLine + t.rawEndLine - 1 : null };
            }), 0, 20),
        }));
        return { index: d.index, sourcePath: source.path, sourceStartLine: d.sourceStartLine,
            collectionScope: d.collectionScope, parsingStatus: d.parsingStatus, diagnostics: d.diagnostics,
            snapshotTime: d.snapshotTime, threadCount: d.threads.length, states: tally(d.threads.map(t => t.javaState || 'UNKNOWN')),
            changes: d.threadChanges ? { baselineCount: d.threadChanges.baselineCount, newCount: d.threadChanges.newCount,
                endedCount: d.threadChanges.endedCount, changedCount: d.threadChanges.changedCount, endedStatus: d.threadChanges.endedStatus } : null,
            analysis: { ...d.smartAnalysis, findings: page(findings, 0, 20) } };
    });
    return { ...overview(captures), analyzer: 'threads', status: rejected.length ? 'partial' : result.parserResult.status,
        warnings: result.parserResult.warnings, sourceResults: result.sourceResults,
        snapshotCount: snapshots.length, findingCounts: tally(result.parsedDumps.flatMap(d => d.smartAnalysis.findings.map(f => f.severity))),
        snapshots: page(snapshots, offset, limit),
        limitations: ['Input order is preserved. Cross-snapshot rates require comparable process identity, counters and timestamps.',
            'No findings does not establish health. Read per-snapshot limitations and rejected sources.',
            'Evidence sublists are bounded and expose totals; use source ranges to inspect omitted details.'] };
}

export function analyzeTls(captures, { offset = 0, limit = 10 } = {}) {
    const result = analyzeTlsLog(captures[0].text);
    if (result.status === 'unsupported') throw new Error(result.warnings.join(' '));
    const interactions = result.interactions.map(i => {
        const records = i.observedRecords || [];
        const evidence = records.filter(r => /fatal|exception|failed|failure|negotiated protocol/i.test(r.message)).map(r => ({
            startLine: r.sourceStart + 1, endLine: r.sourceStart + r.rawEnd - r.rawStart, message: r.message,
        }));
        return { id: i.id, outcome: i.outcome, direction: i.direction, tlsVersion: i.tlsVersion,
            cipherSuite: i.cipherSuite, peerHost: i.peerHost, peerHostSource: i.peerHostSource,
            correlationQuality: i.correlationQuality, correlationWarnings: i.correlationWarnings,
            timeQuality: i.timeQuality, durationMs: i.durationMs, failureReason: i.failureReason,
            explanation: i.failureReason ? explainIssueSections(i.failureReason) : null,
            startLine: records.length ? records.reduce((n, r) => Math.min(n, r.sourceStart), Infinity) + 1 : null,
            endLine: records.length ? records.reduce((n, r) => Math.max(n, r.sourceStart + r.rawEnd - r.rawStart), 0) : null,
            evidence: page(evidence, 0, 20) };
    });
    return { ...overview(captures), analyzer: 'tls', status: result.status, warnings: result.warnings,
        outcomes: tally(result.interactions.map(i => i.outcome)), interactions: page(interactions, offset, limit),
        limitations: ['An alert records an outcome, not necessarily the root cause. Preserve endpoint direction and correlation warnings.',
            'Interleaved records inside a source range may belong to other connections. A ClientHello or Finished alone does not establish final success.'] };
}

export function analyzeGarbageCollection(captures, { session = 0, pauseBudgetMs = 200, offset = 0, limit = 10 } = {}) {
    const parsed = parseGcLog(captures[0].text);
    if (!parsed.sessions.some(s => s.id === session)) throw new Error('Unknown JVM session. Use a session id returned in sessions.');
    const analysis = analyzeGc(parsed, { session, pauseBudgetMs });
    const eventsById = new Map(analysis.events.map(event => [event.id, event]));
    return { ...overview(captures), analyzer: 'gc', status: parsed.warnings.length ? 'partial' : 'success', warnings: parsed.warnings,
        sessions: parsed.sessions, selectedSession: session, pauseBudgetMs, stats: analysis.stats,
        eventCount: analysis.events.length, eventKinds: tally(analysis.events.map(e => e.kind)),
        findings: page(analysis.findings.map(f => ({ ...f,
            event: eventsById.get(f.eventId) || null })), offset, limit),
        limitations: ['Metrics cover only the selected JVM session and recorded interval; inspect parser warnings for coverage gaps.',
            'The pause budget is a user threshold. Concurrent cycles and allocation stalls are not global stop-the-world pause time.',
            'Full GC or high heap occupancy does not prove a leak. Recorded capacity is not necessarily Xmx.'] };
}

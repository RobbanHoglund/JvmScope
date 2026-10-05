import { escapeHtml } from './tda/ui-safety.js';

export const REPORT_VERSION = 'JvmScope findings/1; blocking-patterns/2';
export const EXPORT_WARNING = 'Reports may contain sensitive thread names, classes, filenames, lock evidence and your notes. Preview and review before sharing. No automatic anonymization is performed. Full raw dumps are not included. Nothing is uploaded or automatically saved.';
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const html = value => escapeHtml(clean(value));
const md = value => clean(value).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replace(/[\\`*_[\]()#!|~]/g, '\\$&');

/** Detached evidence snapshot: never resolve a saved finding through a later dataset. */
export function createBlockingFinding({ pattern, snapshotIndex, context, allObservations = false }) {
    const observations = allObservations ? pattern.observations : pattern.observations.filter(o => o.snapshotIndex === snapshotIndex);
    if (!observations.length) throw new Error('Choose a snapshot with an observed dependency before adding this finding.');
    return structuredClone({ id: crypto.randomUUID(), tool: 'TDA', version: REPORT_VERSION,
        title: pattern.title, scope: allObservations ? 'Selected pattern observations only' : 'Selected pattern in one snapshot only',
        context, observations, derivation: pattern.priorityReason, uncertainty: pattern.limitations,
        nextCheck: 'Inspect the identified owner and waiter stacks and lock evidence in comparable captures. Use latency traces, CPU profiles or JFR to test application-impact or progress hypotheses.',
        notes: '', graphic: null, graphicSnapshotIndex: snapshotIndex,
    });
}

function fields(finding) {
    const times = finding.observations.map(o => `#${o.snapshotIndex + 1}: ${o.blocker.timestamp || 'time unavailable'}`).join('; ');
    return [ ['Scope', `${finding.scope}. Included snapshots: ${times}. Not an analysis of the whole run.`],
        ['Input origin', JSON.stringify(finding.context)], ['Analysis version', finding.version],
        ['Observation', finding.observations.map(o => `Snapshot #${o.snapshotIndex + 1}: ${o.dependentCount} unique observed dependents (${o.directCount} direct, ${o.indirectCount} indirect); ${o.uncertainDependentCount} uncertain. ${o.complete ? 'Parsed collection' : 'Partial collection; lower bound'}.`).join('\n')],
        ['Derivation', `${finding.derivation} Ranking uses the candidate's full observed history, even when this report selects one snapshot.`], ['Uncertainty / conflicting evidence', `${finding.uncertainty}\n${finding.observations.flatMap(o => o.relations.filter(r => r.ambiguous).map(r => `Ambiguous owner: ${r.waiter.name} → ${r.owner.name}`)).join('\n')}`],
        ['Collection/time qualifications', finding.observations.map(o=>`Snapshot #${o.snapshotIndex+1}: scope ${o.blocker.collectionScope || 'not supplied'}; time metadata ${JSON.stringify(o.blocker.timeQuality || {status:'unavailable'})}`).join('; ')],
        ['Relation comparison uncertainty', finding.observations.flatMap(o=>o.relations.filter(r=>r.change==='uncertain').map(r=>`Snapshot #${o.snapshotIndex+1}: ${r.waiter.name} → ${r.owner.name}; continuity/comparison not established${r.ambiguous ? '; ambiguous owner' : ''}`)).join('; ') || '(none in selected observations)'],
        ['Next check', finding.nextCheck], ['User notes', finding.notes || '(none)'] ];
}
function refs(finding) {
    return finding.observations.flatMap(o => [o.blocker, ...o.dependents].map(e => `${e.sourceLabel} · source snapshot #${Number(e.sourceSnapshotIndex) + 1} · session snapshot #${e.snapshotIndex + 1} · ${e.name} · snapshot raw lines ${e.startLine ?? '?'}–${e.endLine ?? '?'}${e.processId ? ` · PID ${e.processId}` : ''}`));
}
function lockEvidence(finding) {
    return finding.observations.flatMap(o => o.relations.map(r => `Snapshot #${o.snapshotIndex + 1}: ${r.waiter.name} → ${r.owner.name}; ${r.kinds.join(', ')}; ${r.locks.map(l => `${l.lockId} ${l.lockType || ''}`).join(', ')}; ${r.change}${r.cycle ? '; cycle observed within this snapshot' : ''}${r.ambiguous ? '; ambiguous owner' : ''}`));
}
export function reportMarkdown(findings) {
    return `# JvmScope selected findings\n\n${EXPORT_WARNING}\n\n${findings.length} selected findings, in user-defined order. Table filters are recorded as context; blocking candidates use full parsed snapshots.\n\n` + findings.map((f,i) => `## ${i+1}. ${md(f.title)}\n\n` + [...fields(f), ['Raw references (snapshot-local lines)', refs(f).join('\n')], ['Lock observations',lockEvidence(f).join('\n')]].map(([name,value]) => `### ${name}\n\n${md(value)}\n\n`).join('') + (f.graphic ? 'Graphic: included in HTML export; use the existing graph PNG export for a separate image.\n\n' : '')).join('');
}
export function reportHtml(findings) {
    const sections = findings.map((f,i) => `<section><h2>${i+1}. ${html(f.title)}</h2>${[...fields(f), ['Raw references (snapshot-local lines)', refs(f).join('\n')],['Lock observations',lockEvidence(f).join('\n')]].map(([name,value])=>`<h3>${name}</h3><pre>${html(value)}</pre>`).join('')}${/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f.graphic || '') ? `<figure><img alt="Focused dependency graph for the selected snapshot at capture time" src="${f.graphic}"><figcaption>Graph of snapshot #${html(Number(f.graphicSnapshotIndex)+1)} captured when this finding was added; no relations from other snapshots are merged.</figcaption></figure>` : ''}</section>`).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>JvmScope selected findings</title><style>body{font:15px system-ui;color:#152333;margin:40px;max-width:1000px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}img{max-width:100%}section{border-top:1px solid #aaa;padding:20px 0}h3{font-size:16px}@media print{body{margin:12mm}figure{break-inside:avoid}}</style></head><body><h1>JvmScope selected findings</h1><p>${html(EXPORT_WARNING)}</p><p>${findings.length} selected findings, in user-defined order. Blocking candidates use full parsed snapshots; table filters are context, not evidence exclusions.</p>${sections}</body></html>`;
}

export async function inputDigest(sources) {
    const bytes = new TextEncoder().encode(JSON.stringify(sources.map(s => s.text)));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}

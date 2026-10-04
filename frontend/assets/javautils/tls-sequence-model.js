import { classifyTlsFailureEvidence, readTlsAlert, isTlsCorrelationAmbiguous } from './tls-core.js';
import { explainIssueText } from './tls-explanations.js';

const MESSAGE = /^(Produced|Consuming)\s+(?:(client|server)\s+)?(ClientHello|ServerHello|HelloRetryRequest|EncryptedExtensions|CertificateRequest|CertificateVerify|Certificate|Finished|NewSessionTicket|KeyUpdate|ClientKeyExchange|ServerKeyExchange|ServerHelloDone|EndOfEarlyData)\b/i;
const reliableTime = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER && Number.isFinite(new Date(value).getTime());

// A sequence of observations in file order, not a reconstructed wire exchange.
// Repeated messages, retries, absent clocks and repeated diagnostics stay distinct.
export function tlsObservedSequence(interaction) {
    if (interaction.correlationQuality === 'ambiguous-legacy') return [];
    const ambiguous = isTlsCorrelationAmbiguous(interaction);
    const events = [];
    let producedFinished = false, consumedFinished = false, completed = false;
    for (const record of interaction.observedRecords || []) {
        const add = (title, action, kind, offset = record.prefixLength - 1) => {
            const rawIndex = record.rawStart + offset;
            events.push({ title, action, kind, rawIndex,
                sourceLine: record.sourceStart + offset,
                epochMillis: reliableTime(record.epochMillis) ? record.epochMillis : null,
                tsRaw: record.tsRaw, postHandshake: completed,
            });
        };
        const match = record.message.match(MESSAGE);
        if (match) {
            const action = match[1].toLowerCase() === 'produced' ? 'Produced' : 'Consumed';
            add([match[2], match[3]].filter(Boolean).join(' '), action, 'handshake');
            if (/^(?:Produced|Consuming) (?:client |server )?Finished handshake message/.test(record.message)) {
                if (action === 'Produced') producedFinished = true;
                else consumedFinished = true;
                completed ||= !ambiguous && producedFinished && consumedFinished;
            }
        } else if (/^Handshake (completed|finished)\b/i.test(record.message)) {
            add('Handshake completion', 'Observed', 'handshake');
            completed = !ambiguous;
        } else if (/^(Produced|Consuming|Received|Sent)\s+alert\b/i.test(record.message)) {
            const alert = readTlsAlert(record.message, interaction.rawLines.slice(record.rawStart, record.rawEnd));
            const verb = record.message.split(/\s/)[0].toLowerCase();
            add(alert?.description ? `${alert.level === 'fatal' ? 'Fatal alert' : 'Alert'}: ${alert.description}` : 'Alert (description not captured)',
                ({ produced: 'Produced', consuming: 'Consumed', received: 'Received', sent: 'Sent' })[verb], alert?.level === 'fatal' ? 'failure' : 'alert');
        } else if (record.format === 'legacy' && /^\*\*\*\s/.test(interaction.rawLines[record.rawStart])) {
            add(interaction.rawLines[record.rawStart].replace(/^\*\*\*\s*/, ''), 'Observed', 'handshake');
        }
        const diagnosticRecord = /Fatal\s*\(|exception|fatal alert|handshake failed|(?:SEND|RECV).*ALERT:/i.test(record.message);
        const evidence = classifyTlsFailureEvidence(record.message, { sawHandshakeFinished: completed });
        if (evidence) add(evidence.text, /^Received fatal alert:/i.test(evidence.text) ? 'Received' : /^Sent fatal alert:/i.test(evidence.text) ? 'Sent' : 'Diagnostic', evidence.promotesHandshakeFailure ? 'failure' : evidence.phase === 'post-handshake' ? 'transport' : 'hint');
        if (!diagnosticRecord) continue;
        // Body diagnostics point to the exact physical source line, even when
        // other threads' records occur between this interaction's records.
        for (let offset = record.prefixLength; offset < record.rawEnd - record.rawStart; offset++) {
            const text = interaction.rawLines[record.rawStart + offset];
            const detail = classifyTlsFailureEvidence(text, { sawHandshakeFinished: completed });
            if (detail) add(detail.text, 'Diagnostic', detail.promotesHandshakeFailure ? 'failure' : detail.phase === 'post-handshake' ? 'transport' : 'hint', offset);
        }
    }
    return events;
}

export function tlsDiagnosis(interaction) {
    if (isTlsCorrelationAmbiguous(interaction)) return 'Grouping uncertain';
    if (interaction.outcome === 'failure') {
        const key = explainIssueText(interaction.failureReason)?.key;
        if (key?.includes('during TLS handshake')) return interaction.failureReason;
        return key && !['Received fatal alert:', 'local-fatal'].includes(key)
            ? key.replaceAll('_', ' ') : interaction.failureReason || 'TLS failure';
    }
    return interaction.outcome === 'success' ? 'Finished exchange observed' : 'No final outcome captured';
}

export function tlsCaptureCoverage(interaction) {
    if (isTlsCorrelationAmbiguous(interaction)) return 'Handshake stages cannot be assigned reliably to a single connection.';
    return [
        `ClientHello: ${interaction.sawClientHello ? 'observed' : 'not captured'}`,
        `ServerHello: ${interaction.sawServerHello ? 'observed' : 'not captured'}`,
        `Finished exchange: ${interaction.sawHandshakeFinished ? 'observed' : 'not captured'}`,
        ...(interaction.timeQuality === 'reversed' ? ['Clock moves backwards; span and period filtering unavailable']
            : interaction.timeQuality === 'unavailable' ? ['Incomplete or ambiguous clock; span and period filtering unavailable'] : []),
    ].join(' · ');
}

export function reconcileTlsSelection(selected, visible, autoSelect = false) {
    if (selected && visible.includes(selected)) return selected;
    return autoSelect ? visible[0] || null : null;
}

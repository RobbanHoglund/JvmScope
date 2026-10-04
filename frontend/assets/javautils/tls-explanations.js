import { matchTlsFailureReason } from './tls-core.js';
import { TLS_ISSUE_CATALOG, LOCAL_FATAL_EXPLANATION } from './tls-issue-catalog.js';

// Compatibility projection: stable keys and the existing newline-delimited format.
export const ISSUE_EXPLANATIONS = new Map(TLS_ISSUE_CATALOG.map(issue => [
    issue.matchKey,
    issue.sections.map(section => [
        `${section.title}:`,
        ...(section.paragraphs ?? section.bullets.map(bullet => `• ${bullet}`)),
    ].join('\n')).join('\n\n'),
]));

const FALLBACK_KEYS = new Set(['Received fatal alert:']);
const ALERT_KEYS = new Set([
    'certificate_unknown', 'handshake_failure', 'unknown_ca', 'bad_certificate',
    'unsupported_certificate', 'certificate_expired', 'certificate_revoked',
    'certificate_required', 'protocol_version', 'unrecognized_name', 'access_denied',
    'illegal_parameter', 'insufficient_security', 'decrypt_error',
    'unsupported_extension', 'no_application_protocol',
]);
const LOCAL_FATAL_KEY = 'local-fatal';

let cachedExplanationKeyTiers = null;

function explanationKeysBySpecificity() {
    if (!cachedExplanationKeyTiers) {
        const keys = Array.from(ISSUE_EXPLANATIONS.keys());
        cachedExplanationKeyTiers = [
            keys.filter((key) => !FALLBACK_KEYS.has(key) && !ALERT_KEYS.has(key))
                .sort((left, right) => right.length - left.length),
            keys.filter((key) => ALERT_KEYS.has(key))
                .sort((left, right) => right.length - left.length),
            keys.filter((key) => FALLBACK_KEYS.has(key))
                .sort((left, right) => right.length - left.length),
        ];
    }
    return cachedExplanationKeyTiers;
}

function findExplanationKey(candidates) {
    for (const keys of explanationKeysBySpecificity()) {
        for (const key of keys) {
            if (candidates.some(candidate => candidate.includes(key.toLowerCase()))) return key;
        }
    }
    return null;
}

export function explainIssueText(issueText) {
    const text = String(issueText || '').trim().toLowerCase();
    if (!text) return null;
    // Alert origin is independent of the specific reason accompanying the alert.
    const receivedAlert = text.includes('received fatal alert:');
    const locallyRaised = (/^fatal\s*\(/.test(text) || /^sent fatal alert:/.test(text))
        && !receivedAlert;
    // A bare catalogue key does not establish which endpoint sent an alert.
    const endpoint = locallyRaised ? 'the local JVM'
        : receivedAlert ? 'the remote peer' : 'the endpoint that sent the alert';

    // A local diagnostic reason is more specific than its enclosing alert category,
    // regardless of the lengths of their catalogue keys. Received alerts keep their
    // existing lookup: they do not establish a local diagnostic cause.
    const localReason = locallyRaised
        ? (text.match(/^fatal\s*\([^)]+\):\s*([\s\S]*)$/)?.[1]
            ?? text.match(/^sent fatal alert:\s*[a-z0-9_]+\b\s*:?\s*([\s\S]*)$/)?.[1])
        : null;
    const renormalized = localReason ? matchTlsFailureReason(localReason)?.text?.toLowerCase() : null;
    // Compare raw and normalized reasons by specificity before considering the wrapper.
    // An alert name inside an exception must not hide a normalized hostname diagnostic.
    const transportKey = [
        ['broken pipe', 'Broken pipe during TLS handshake'],
        ['unexpected eof', 'Unexpected EOF during TLS handshake'],
        ['peer closed connection', 'Peer closed connection during TLS handshake'],
        ['connection reset', 'Connection reset during TLS handshake'],
    ].find(([observation]) => text.startsWith(observation))?.[1];
    const key = findExplanationKey([localReason, renormalized].filter(Boolean))
        || findExplanationKey([text]) || transportKey;
    if (key) {
        const explanation = ISSUE_EXPLANATIONS.get(key)
            .replaceAll('{AlertEndpoint}', endpoint[0].toUpperCase() + endpoint.slice(1))
            .replaceAll('{alertEndpoint}', endpoint);
        return { key, explanation, locallyRaised };
    }
    return locallyRaised
        ? { key: LOCAL_FATAL_KEY, explanation: LOCAL_FATAL_EXPLANATION, locallyRaised }
        : null;
}

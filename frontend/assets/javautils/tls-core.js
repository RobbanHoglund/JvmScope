const FAILURE_REASON_RULES = Object.freeze([
    {
        key: 'local_fatal_alert',
        priority: 93,
        regex: /Fatal\s+\(([A-Z0-9_]+)\):\s*([^\r\n]*)|(SEND|RECV) TLSv?[\d.]+ ALERT:\s*fatal,\s*description\s*=\s*([a-z0-9_]+)/i,
        normalize: match => match[1] ? `Fatal (${match[1]}): ${match[2].replace(/\s*\($/, '').trim()}` : `${match[3].toUpperCase() === 'SEND' ? 'Sent' : 'Received'} fatal alert: ${match[4]}`,
    },
    {
        key: 'sent_fatal_alert',
        // A generic sent alert must not hide an observed cipher/PKIX cause.
        priority: 74,
        regex: /Sent fatal alert:\s*([a-z0-9_]+)/i,
        normalize: match => `Sent fatal alert: ${match[1].toLowerCase()}`,
    },
    {
        key: 'fatal_certificate_unknown',
        priority: 100,
        regex: /Fatal\s+\(CERTIFICATE_UNKNOWN\):\s*Received fatal alert:\s*certificate_unknown|Received fatal alert:\s*certificate_unknown/i,
        normalize: () => 'Received fatal alert: certificate_unknown',
    },
    {
        key: 'fatal_handshake_failure',
        priority: 95,
        regex: /Fatal\s+\(HANDSHAKE_FAILURE\):\s*Received fatal alert:\s*handshake_failure|Received fatal alert:\s*handshake_failure/i,
        normalize: () => 'Received fatal alert: handshake_failure',
    },
    {
        key: 'fatal_alert',
        priority: 94,
        regex: /(?:Fatal\s+\([^)]+\):\s*)?Received fatal alert:\s*([a-z0-9_]+)/i,
        normalize: (match) => `Received fatal alert: ${String(match[1] || '').toLowerCase()}`,
    },
    {
        key: 'hostname_verification',
        priority: 92,
        regex: /No subject alternative DNS name matching\s+(\S+?)\.?\s+found|No name matching\s+(\S+?)\.?\s+found|Hostname\s+(\S+?)\s+not verified/i,
        normalize: (match) => {
            const host = String(match[1] || match[2] || match[3] || '').replace(/[.,]+$/, '');
            return host
                ? `Certificate name mismatch: no certificate name matching ${host} found`
                : 'Certificate name mismatch: no certificate name matching the requested host found';
        },
    },
    {
        key: 'ssl_handshake_exception',
        priority: 90,
        regex: /SSLHandshakeException:.*$/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'pkix',
        priority: 85,
        regex: /PKIX path building failed.*$/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'no_common_cipher_suite',
        priority: 75,
        regex: /No cipher suites? in common/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'no_available_auth_scheme',
        priority: 70,
        regex: /No available authentication scheme.*$/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'keymgr_no_matching_key',
        priority: 65,
        regex: /KeyMgr:\s*no matching key found.*$/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'issuers_do_not_match',
        priority: 60,
        regex: /issuers do not match.*$/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'connection_reset',
        priority: 50,
        regex: /java\.net\.SocketException:\s*Connection reset|java\.net\.SocketException:\s*Broken pipe|\bEOFException\b|Connection closed by peer/i,
        normalize: (match) => match[0].trim(),
    },
    {
        key: 'socket_timeout',
        priority: 40,
        regex: /SocketTimeoutException:\s*Read timed out|java\.net\.SocketTimeoutException/i,
        normalize: () => 'SocketTimeoutException: Read timed out',
    },
    {
        key: 'no_x509_cert_selected',
        priority: 30,
        regex: /No X\.509 cert selected(?:.*)$/i,
        normalize: (match) => match[0].trim(),
    },
].sort((left, right) => right.priority - left.priority));

// Read only the structured payload of an actual JSSE alert record. A fatal
// alert is evidence even when the capture ends before the following exception.
export function readTlsAlert(message, rawLines) {
    const verb = String(message).match(/^(Received|Consuming|Produced|Sent)\s+alert message\b/i)?.[1]?.toLowerCase();
    if (!verb) return null;
    const end = rawLines.findIndex((line, index) => index > 0 && /^\)\s*$/.test(line));
    const payload = rawLines.slice(0, end < 0 ? rawLines.length : end).join('\n').match(/"Alert"\s*:\s*\{([^}]*)/)?.[1];
    if (payload == null) return null;
    const level = payload.match(/"level"\s*:\s*"(warning|fatal)"/i)?.[1]?.toLowerCase();
    const description = payload.match(/"description"\s*:\s*"([a-z0-9_]+)"/i)?.[1]?.toLowerCase() || null;
    const action = { received: 'Received', consuming: 'Consumed', produced: 'Produced', sent: 'Sent' }[verb];
    const origin = ['received', 'consuming'].includes(verb) ? 'Received' : 'Sent';
    return { level, description, action, reason: level === 'fatal' ? `${origin} fatal alert: ${description || 'unspecified'}` : null };
}

export const TLS_FAILURE_HIGHLIGHT =
    /Fatal\s+\([^)]+\):|(?:Sent|Received) fatal alert:\s*[a-z0-9_]+|(?:SEND|RECV) TLSv?[\d.]+ ALERT:\s*fatal|No cipher suites? in common|No X\.509 cert selected|No available authentication scheme|No available client authentication scheme|KeyMgr:\s*no matching key found|issuers do not match|SSLHandshakeException|No subject alternative DNS name matching|No name matching|Hostname\s+\S+\s+not verified|PKIX path building failed|java\.net\.SocketException:\s*Connection reset|\bConnection reset\b|\bBroken pipe\b|\bEOFException\b|Connection closed by peer|SocketTimeoutException|Read timed out/i;

export function matchTlsFailureReason(text) {
    const value = String(text || '');
    if (!value) return null;

    for (const rule of FAILURE_REASON_RULES) {
        const match = value.match(rule.regex);
        if (!match) continue;
        return {
            key: rule.key,
            priority: rule.priority,
            text: rule.normalize(match),
        };
    }

    return null;
}

export function certificateCommonName(subject) {
    const match = String(subject || '').match(/(?:^|,\s*)CN\s*=\s*("(?:\\.|[^"\\])*"|(?:\\.|[^,])*)/i);
    if (!match) return null;
    const value = match[1].trim().replace(/^"(.*)"$/, '$1');
    return value.replace(/\\([,+"\\<>;= ])/g, '$1');
}

export function classifyTlsFailureEvidence(text, {
    sawHandshakeFinished = false,
} = {}) {
    const evidence = matchTlsFailureReason(text);
    if (!evidence) return null;

    const phase = sawHandshakeFinished ? 'post-handshake' : 'handshake';
    return {
        ...evidence,
        phase,
        // Algorithm/key selection misses are diagnostic candidates, not a
        // failed handshake. TLS 1.3 peers can also reject client auth after the
        // local Finished exchange; an explicit fatal alert remains a failure.
        promotesHandshakeFailure: !['no_available_auth_scheme', 'keymgr_no_matching_key', 'issuers_do_not_match', 'no_x509_cert_selected'].includes(evidence.key)
            && (phase === 'handshake' || evidence.key.includes('fatal')),
    };
}

export function deriveTlsDirection({
    initiatedByLocal = false,
    initiatedByPeer = false,
} = {}) {
    if (initiatedByLocal && !initiatedByPeer) return 'outbound';
    if (initiatedByPeer && !initiatedByLocal) return 'inbound';
    if (initiatedByLocal && initiatedByPeer) return 'both';
    return 'unknown';
}

export function resolveTlsPeerHost({
    peerHost = null,
    sni = null,
    direction = 'unknown',
} = {}) {
    const explicitPeerHost = String(peerHost || '').trim();
    if (explicitPeerHost) return explicitPeerHost;
    if (direction !== 'outbound') return null;

    const targetName = String(sni || '').trim();
    if (targetName) return targetName;

    return null;
}

export function summarizeTlsTransportFailure(failureReason, {
    sawClientHello = false,
    sawServerHello = false,
} = {}) {
    const value = String(failureReason || '').trim();
    if (!value) return null;

    // Missing log messages do not establish wire order or who reset a socket.
    const context = `handshake phase unknown${!sawServerHello ? '; ServerHello not captured' : ''}`;
    if (/broken pipe/i.test(value)) {
        return `Broken pipe (socket write failed; ${context})`;
    }
    if (/\bEOFException\b/i.test(value)) {
        return `Unexpected EOF (${context})`;
    }
    if (/connection closed by peer/i.test(value)) {
        return `Peer closed connection (${context})`;
    }
    if (/connection reset/i.test(value)) {
        return `Connection reset (${context})`;
    }

    return null;
}

export function isTlsCorrelationAmbiguous(interaction) {
    return ['ambiguous-legacy', 'ambiguous-thread'].includes(interaction?.correlationQuality);
}

import { certificateCommonName } from './tls-core.js';

export function clientCertDisplay(it) {
    if (it.clientCertSubjectCn) return it.clientCertSubjectCn;
    if (it.clientCertSubject) {
        const subject = String(it.clientCertSubject).trim();
        return subject.length > 64 ? `${subject.slice(0, 61)}…` : subject;
    }
    if (it.clientCertificateEmpty) return 'Empty list';
    if (it.sawProducedClientCertificate) return 'Not captured';
    return '—';
}

export function clientCertificateDetailsText(it) {
    return it.clientCertSubject || (clientCertDisplay(it) === '—' ? 'Not reported' : clientCertDisplay(it));
}

export function certificateAuthorityShortName(authority) {
    return certificateCommonName(authority) || String(authority || '').trim();
}

export function certificateAuthoritiesDisplay(it) {
    const authorities = it.certificateAuthorities || [];
    if (authorities.length) {
        const first = certificateAuthorityShortName(authorities[0]);
        return authorities.length > 1 ? `${first} +${authorities.length - 1}` : first;
    }
    if (it.certificateAuthoritiesComplete) return 'Empty list';
    if (it.sawCertRequest) return 'Not captured';
    return '—';
}

export function certificateAuthoritiesTooltip(it) {
    const authorities = it.certificateAuthorities || [];
    if (authorities.length) return authorities.join('\n');
    if (it.certificateAuthoritiesComplete) return 'Explicitly empty acceptable CA list';
    if (it.sawCertRequest) return 'CertificateRequest found, but certificate authorities were not captured';
    return 'No CertificateRequest found';
}

export function certificateAuthoritiesDetailsText(it) {
    const authorities = it.certificateAuthorities || [];
    if (authorities.length) return authorities.join('\n');
    if (it.certificateAuthoritiesComplete) return 'Empty list';
    if (it.sawCertRequest) return 'Not captured';
    return '—';
}

export function certificateAuthoritiesTooltipBody(it) {
    const authorities = it.certificateAuthorities || [];
    if (authorities.length) {
        return [
            `Observed CA entries: ${authorities.length}`,
            '',
            ...authorities.map((authority, idx) => `${idx + 1}. ${authority}`),
            '',
            'These are the acceptable issuing CAs advertised in the TLS CertificateRequest.'
        ].join('\n');
    }

    if (it.certificateAuthoritiesComplete) return 'The acceptable CA list is explicitly empty. This does not mean that no certificate matched.';
    if (it.sawCertRequest) {
        return [
            'CertificateRequest was found, but no "certificate authorities" list was captured.',
            '',
            'This may mean:',
            '- the server sent an empty acceptable CA list',
            '- the JSSE log format was different',
            '- the parser did not match the block'
        ].join('\n');
    }

    return 'No CertificateRequest was seen for this interaction.';
}

export function clientCertTooltipBody(it) {
    if (it.clientCertSubject) {
        const lines = [
            'Subject:',
            it.clientCertSubject
        ];

        if (it.clientCertSubjectCn) {
            lines.push('', 'CN:', it.clientCertSubjectCn);
        }

        return lines.join('\n');
    }

    if (it.clientCertificateEmpty) return 'The peer observed or sent an empty client certificate list. This alone does not prove a failure; client authentication may be optional.';
    if (it.sawProducedClientCertificate) {
        return [
            'A client Certificate message was observed, but no certificate subject was captured.',
            '',
            'This usually means:',
            '- no matching client certificate was selected',
            '- the certificate list was empty',
            '- the JSSE log format was different from what the parser expected'
        ].join('\n');
    }

    return 'No client Certificate message was seen for this interaction.';
}

export function cipherTooltipBody(it) {
    return [
        'TLS version:',
        it.tlsVersion || 'unknown',
        '',
        'Cipher suite:',
        it.cipherSuite || 'unknown'
    ].join('\n');
}

export function peerHostTooltipBody(it) {
    if (it.peerHostSource === 'outbound-sni') return `${it.peerHost}\nDerived from outbound SNI; not a captured network address.`;
    return it.peerHost || 'No peer host value was captured for this interaction.';
}

export function sniTooltipBody(it) {
    return it.sni || 'No SNI value was captured for this interaction.';
}

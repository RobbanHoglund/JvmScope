function jsse(level, tid, thread, timestamp, zone, message) {
    return `javax.net.ssl|${level}|${tid}|${thread}|${timestamp} ${zone}|null:-1|${message}`;
}

export function buildComprehensiveTlsSampleLog() {
    return [
        // 1. Outbound TLS 1.2 success: offered suites must not replace the negotiated suite.
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2", "cipher suites" : [TLS_RSA_WITH_AES_128_CBC_SHA]})'),
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.010', 'GMT',
            'extension server_name, type=host_name (0), value=api.example.com'),
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.080', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.120', 'GMT',
            '"Certificates": [{"certificate" : {"subject" : "CN=api.example.com, O=Example Corp"}}]'),
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.180', 'GMT',
            'Negotiated cipher suite: TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'),
        jsse('DEBUG', '01', 'outbound-tls12', '2026-08-31 08:00:00.320', 'GMT',
            'Handshake completed'),

        // 2. Outbound TLS 1.3 success with ALPN.
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.000', 'UTC',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.010', 'UTC',
            'extension server_name, type=host_name (0), value=h2.example.com'),
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.050', 'UTC',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.090', 'UTC',
            'Negotiated cipher suite: TLS_AES_256_GCM_SHA384'),
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.100', 'UTC',
            'application_layer_protocol_negotiation (16): [h2]'),
        jsse('DEBUG', '02', 'outbound-tls13', '2026-08-31 08:00:04.240', 'UTC',
            'Handshake completed'),

        // 3. Inbound TLS 1.3 success with SNI. SNI is the local virtual host, not the peer.
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.000', 'CEST',
            'Consuming ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.010', 'CEST',
            'extension server_name, type=host_name (0), value=inbound.example.com'),
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.020', 'CEST',
            'peer host: 192.0.2.44'),
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.060', 'CEST',
            'Produced ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.180', 'CEST',
            'Negotiated cipher suite: TLS_AES_128_GCM_SHA256'),
        jsse('DEBUG', '03', 'server-worker-1', '2026-08-31 10:00:08.260', 'CEST',
            'Handshake completed'),

        // 4. Successful outbound mutual TLS with requested issuers and selected client cert.
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.000', 'CET',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.010', 'CET',
            'extension server_name, type=host_name (0), value=mtls-success.example.com'),
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.050', 'CET',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.080', 'CET',
            'Consuming CertificateRequest handshake message ('),
        '"certificate authorities": [',
        '  "CN=Example Root CA, O=Example, C=SE",',
        '  "CN=Example Intermediate CA, O=Example, C=SE"',
        ']',
        ')',
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.110', 'CET',
            'Produced client Certificate handshake message ('),
        '"Certificates": [{"certificate" : {"subject" : "CN=payments-client, OU=Production, O=Example"}}]',
        ')',
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.180', 'CET',
            'Negotiated cipher suite: TLS_AES_128_GCM_SHA256'),
        jsse('DEBUG', '04', 'mtls-success', '2026-08-31 09:00:12.300', 'CET',
            'Handshake completed'),

        // 5. Hostname/SAN mismatch followed by the peer fatal alert and stack trace.
        jsse('DEBUG', '05', 'san-mismatch', '2026-08-31 08:00:16.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '05', 'san-mismatch', '2026-08-31 08:00:16.010', 'GMT',
            'extension server_name, type=host_name (0), value=10.0.0.12'),
        jsse('DEBUG', '05', 'san-mismatch', '2026-08-31 08:00:16.080', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('ERROR', '05', 'san-mismatch', '2026-08-31 08:00:16.120', 'GMT',
            'SSLHandshakeException: (certificate_unknown) No subject alternative names matching IP address 10.0.0.12'),
        jsse('ERROR', '05', 'san-mismatch', '2026-08-31 08:00:16.140', 'GMT',
            'Fatal (CERTIFICATE_UNKNOWN): Received fatal alert: certificate_unknown'),
        'at sun.security.ssl.Alert.createSSLException(Alert.java:131)',
        'at sun.security.ssl.TransportContext.fatal(TransportContext.java:370)',

        // 6. PKIX trust-path failure followed by unknown_ca.
        jsse('DEBUG', '06', 'pkix-failure', '2026-08-31 08:00:20.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '06', 'pkix-failure', '2026-08-31 08:00:20.010', 'GMT',
            'extension server_name, type=host_name (0), value=untrusted.example.net'),
        jsse('DEBUG', '06', 'pkix-failure', '2026-08-31 08:00:20.070', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('ERROR', '06', 'pkix-failure', '2026-08-31 08:00:20.120', 'GMT',
            'SSLHandshakeException: PKIX path building failed: unable to find valid certification path to requested target'),
        jsse('ERROR', '06', 'pkix-failure', '2026-08-31 08:00:20.140', 'GMT',
            'Fatal (UNKNOWN_CA): Received fatal alert: unknown_ca'),

        // 7. mTLS required but the client cannot select a certificate.
        jsse('DEBUG', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.010', 'GMT',
            'extension server_name, type=host_name (0), value=mtls-required.example.com'),
        jsse('DEBUG', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.070', 'GMT',
            'Consuming CertificateRequest handshake message ('),
        '"certificate authorities": ["CN=Required Client CA, O=Example"]',
        ')',
        jsse('ALL', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.100', 'GMT',
            'No X.509 cert selected for EC'),
        jsse('ALL', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.110', 'GMT',
            'KeyMgr: no matching key found'),
        jsse('ERROR', '07', 'mtls-missing-cert', '2026-08-31 08:00:24.150', 'GMT',
            'Fatal (CERTIFICATE_REQUIRED): Received fatal alert: certificate_required'),

        // 8. The advertised acceptable issuers do not match the local certificate chain.
        jsse('DEBUG', '08', 'issuer-mismatch', '2026-08-31 08:00:28.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '08', 'issuer-mismatch', '2026-08-31 08:00:28.010', 'GMT',
            'extension server_name, type=host_name (0), value=strict-mtls.example.com'),
        jsse('DEBUG', '08', 'issuer-mismatch', '2026-08-31 08:00:28.070', 'GMT',
            'Consuming CertificateRequest handshake message'),
        jsse('ALL', '08', 'issuer-mismatch', '2026-08-31 08:00:28.100', 'GMT',
            'matching alias: client-ec-prod'),
        jsse('ALL', '08', 'issuer-mismatch', '2026-08-31 08:00:28.110', 'GMT',
            'issuers do not match'),
        jsse('ERROR', '08', 'issuer-mismatch', '2026-08-31 08:00:28.150', 'GMT',
            'Fatal (CERTIFICATE_UNKNOWN): Received fatal alert: certificate_unknown'),

        // 9. Authentication-scheme mismatch ending in handshake_failure.
        jsse('DEBUG', '09', 'auth-scheme-failure', '2026-08-31 08:00:32.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('WARNING', '09', 'auth-scheme-failure', '2026-08-31 08:00:32.100', 'GMT',
            'No available authentication scheme'),
        jsse('ERROR', '09', 'auth-scheme-failure', '2026-08-31 08:00:32.150', 'GMT',
            'Fatal (HANDSHAKE_FAILURE): Received fatal alert: handshake_failure'),

        // 10. Transport reset before ServerHello.
        jsse('DEBUG', '10', 'connection-reset', '2026-08-31 08:00:36.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '10', 'connection-reset', '2026-08-31 08:00:36.010', 'GMT',
            'extension server_name, type=host_name (0), value=reset.example.org'),
        jsse('ERROR', '10', 'connection-reset', '2026-08-31 08:00:36.120', 'GMT',
            'java.net.SocketException: Connection reset'),
        'java.net.SocketException: Connection reset',
        'at java.base/sun.nio.ch.NioSocketImpl.implRead(NioSocketImpl.java:328)',

        // 11. Read timeout while waiting for the peer.
        jsse('DEBUG', '11', 'read-timeout', '2026-08-31 08:00:40.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '11', 'read-timeout', '2026-08-31 08:00:40.010', 'GMT',
            'extension server_name, type=host_name (0), value=slow.example.org'),
        jsse('ERROR', '11', 'read-timeout', '2026-08-31 08:00:42.500', 'GMT',
            'java.net.SocketTimeoutException: Read timed out'),

        // 12. SNI/virtual-host rejection.
        jsse('DEBUG', '12', 'unknown-sni', '2026-08-31 08:00:44.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '12', 'unknown-sni', '2026-08-31 08:00:44.010', 'GMT',
            'extension server_name, type=host_name (0), value=wrong-vhost.example.com'),
        jsse('ERROR', '12', 'unknown-sni', '2026-08-31 08:00:44.120', 'GMT',
            'Fatal (UNRECOGNIZED_NAME): Received fatal alert: unrecognized_name'),

        // 13. Protocol mismatch from a legacy client.
        jsse('DEBUG', '13', 'legacy-client', '2026-08-31 08:00:48.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.1"})'),
        jsse('ERROR', '13', 'legacy-client', '2026-08-31 08:00:48.080', 'GMT',
            'Fatal (PROTOCOL_VERSION): Received fatal alert: protocol_version'),

        // 14. ALPN mismatch.
        jsse('DEBUG', '14', 'alpn-mismatch', '2026-08-31 08:00:52.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '14', 'alpn-mismatch', '2026-08-31 08:00:52.010', 'GMT',
            'extension server_name, type=host_name (0), value=h2-only.example.com'),
        jsse('ERROR', '14', 'alpn-mismatch', '2026-08-31 08:00:52.100', 'GMT',
            'Fatal (NO_APPLICATION_PROTOCOL): Received fatal alert: no_application_protocol'),

        // 15. Expired certificate alert.
        jsse('DEBUG', '15', 'expired-certificate', '2026-08-31 08:00:56.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '15', 'expired-certificate', '2026-08-31 08:00:56.010', 'GMT',
            'extension server_name, type=host_name (0), value=expired.example.com'),
        jsse('ERROR', '15', 'expired-certificate', '2026-08-31 08:00:56.120', 'GMT',
            'Fatal (CERTIFICATE_EXPIRED): Received fatal alert: certificate_expired'),

        // 16. Incomplete capture: a started handshake with no terminal evidence.
        jsse('DEBUG', '16', 'incomplete-capture', '2026-08-31 08:01:00.000', 'GMT+00:00',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '16', 'incomplete-capture', '2026-08-31 08:01:00.010', 'GMT+00:00',
            'extension server_name, type=host_name (0), value=incomplete.example.com'),
        jsse('DEBUG', '16', 'incomplete-capture', '2026-08-31 08:01:00.100', 'GMT+00:00',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),

        // 17. Completed handshake followed by close_notify; all lines belong to one interaction.
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.000', '+00:00',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.100', '+00:00',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.180', '+00:00',
            'Handshake completed'),
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.260', '+00:00',
            'Received close_notify'),
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.280', '+00:00',
            'closing inbound'),
        jsse('DEBUG', '17', 'clean-close', '2026-08-31 08:01:04.300', '+00:00',
            'closing outbound'),

        // 18–19. Interleaved client/server handshakes verify per-thread partitioning.
        jsse('DEBUG', '18', 'interleaved-client', '2026-08-31 08:01:08.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '19', 'interleaved-server', '2026-08-31 08:01:08.010', 'GMT',
            'Consuming ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '18', 'interleaved-client', '2026-08-31 08:01:08.020', 'GMT',
            'extension server_name, type=host_name (0), value=parallel.example.com'),
        jsse('DEBUG', '19', 'interleaved-server', '2026-08-31 08:01:08.030', 'GMT',
            'extension server_name, type=host_name (0), value=denied.example.com'),
        jsse('DEBUG', '19', 'interleaved-server', '2026-08-31 08:01:08.040', 'GMT',
            'peer host: 198.51.100.27'),
        jsse('DEBUG', '18', 'interleaved-client', '2026-08-31 08:01:08.080', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('ERROR', '19', 'interleaved-server', '2026-08-31 08:01:08.090', 'GMT',
            'Fatal (ACCESS_DENIED): Received fatal alert: access_denied'),
        jsse('DEBUG', '18', 'interleaved-client', '2026-08-31 08:01:08.130', 'GMT',
            'Negotiated cipher suite: TLS_CHACHA20_POLY1305_SHA256'),
        jsse('DEBUG', '18', 'interleaved-client', '2026-08-31 08:01:08.200', 'GMT',
            'Handshake completed'),

        // 20. TLS 1.3 session resumption using a pre-shared key.
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.010', 'GMT',
            'extension server_name, type=host_name (0), value=resumed.example.com'),
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.040', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.060', 'GMT',
            'Resuming session: pre_shared_key selected_identity=0'),
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.080', 'GMT',
            'Negotiated cipher suite: TLS_AES_128_GCM_SHA256'),
        jsse('DEBUG', '20', 'resumed-session', '2026-08-31 08:01:12.140', 'GMT',
            'Handshake completed'),

        // 21. Inbound TLS 1.2 success with an explicit remote peer address.
        jsse('DEBUG', '21', 'server-worker-2', '2026-08-31 08:01:16.000', 'GMT',
            'Consuming ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '21', 'server-worker-2', '2026-08-31 08:01:16.010', 'GMT',
            'peer host: 203.0.113.18'),
        jsse('DEBUG', '21', 'server-worker-2', '2026-08-31 08:01:16.040', 'GMT',
            'Produced ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('DEBUG', '21', 'server-worker-2', '2026-08-31 08:01:16.080', 'GMT',
            'Negotiated cipher suite: TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384'),
        jsse('DEBUG', '21', 'server-worker-2', '2026-08-31 08:01:16.160', 'GMT',
            'Handshake completed'),

        // 22. Outbound success to an IP address without SNI.
        jsse('DEBUG', '22', 'outbound-ip-no-sni', '2026-08-31 08:01:20.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '22', 'outbound-ip-no-sni', '2026-08-31 08:01:20.010', 'GMT',
            'peer host: 203.0.113.77'),
        jsse('DEBUG', '22', 'outbound-ip-no-sni', '2026-08-31 08:01:20.050', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.2"})'),
        jsse('DEBUG', '22', 'outbound-ip-no-sni', '2026-08-31 08:01:20.080', 'GMT',
            'Negotiated cipher suite: TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'),
        jsse('DEBUG', '22', 'outbound-ip-no-sni', '2026-08-31 08:01:20.180', 'GMT',
            'Handshake completed'),

        // 23. The peer rejects a structurally invalid certificate.
        jsse('DEBUG', '23', 'bad-certificate', '2026-08-31 08:01:24.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '23', 'bad-certificate', '2026-08-31 08:01:24.010', 'GMT',
            'extension server_name, type=host_name (0), value=bad-cert.example.com'),
        jsse('ERROR', '23', 'bad-certificate', '2026-08-31 08:01:24.100', 'GMT',
            'Fatal (BAD_CERTIFICATE): Received fatal alert: bad_certificate'),

        // 24. Revocation checking rejects the certificate.
        jsse('DEBUG', '24', 'revoked-certificate', '2026-08-31 08:01:28.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '24', 'revoked-certificate', '2026-08-31 08:01:28.010', 'GMT',
            'extension server_name, type=host_name (0), value=revoked.example.com'),
        jsse('ERROR', '24', 'revoked-certificate', '2026-08-31 08:01:28.100', 'GMT',
            'Fatal (CERTIFICATE_REVOKED): Received fatal alert: certificate_revoked'),

        // 25. Finished-message or signature verification fails.
        jsse('DEBUG', '25', 'decrypt-error', '2026-08-31 08:01:32.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '25', 'decrypt-error', '2026-08-31 08:01:32.010', 'GMT',
            'extension server_name, type=host_name (0), value=crypto-error.example.com'),
        jsse('ERROR', '25', 'decrypt-error', '2026-08-31 08:01:32.100', 'GMT',
            'Fatal (DECRYPT_ERROR): Received fatal alert: decrypt_error'),

        // 26. A validly encoded but unacceptable handshake parameter.
        jsse('DEBUG', '26', 'illegal-parameter', '2026-08-31 08:01:36.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '26', 'illegal-parameter', '2026-08-31 08:01:36.010', 'GMT',
            'extension server_name, type=host_name (0), value=parameter-error.example.com'),
        jsse('ERROR', '26', 'illegal-parameter', '2026-08-31 08:01:36.100', 'GMT',
            'Fatal (ILLEGAL_PARAMETER): Received fatal alert: illegal_parameter'),

        // 27. No common cipher suite; the offered suite must not appear as negotiated.
        jsse('DEBUG', '27', 'cipher-mismatch', '2026-08-31 08:01:40.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2", "cipher suites" : [TLS_RSA_WITH_3DES_EDE_CBC_SHA]})'),
        jsse('DEBUG', '27', 'cipher-mismatch', '2026-08-31 08:01:40.010', 'GMT',
            'extension server_name, type=host_name (0), value=modern-only.example.com'),
        jsse('WARNING', '27', 'cipher-mismatch', '2026-08-31 08:01:40.080', 'GMT',
            'No cipher suites in common'),
        jsse('ERROR', '27', 'cipher-mismatch', '2026-08-31 08:01:40.100', 'GMT',
            'Fatal (HANDSHAKE_FAILURE): Received fatal alert: handshake_failure'),

        // 28. JVM algorithm constraints reject the available certificate/key material.
        jsse('DEBUG', '28', 'algorithm-constraints', '2026-08-31 08:01:44.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '28', 'algorithm-constraints', '2026-08-31 08:01:44.010', 'GMT',
            'extension server_name, type=host_name (0), value=weak-key.example.com'),
        jsse('ERROR', '28', 'algorithm-constraints', '2026-08-31 08:01:44.080', 'GMT',
            'SSLHandshakeException: Certificates do not conform to algorithm constraints'),
        jsse('ERROR', '28', 'algorithm-constraints', '2026-08-31 08:01:44.100', 'GMT',
            'Fatal (INSUFFICIENT_SECURITY): Received fatal alert: insufficient_security'),

        // 29. The transport reaches EOF before ServerHello.
        jsse('DEBUG', '29', 'unexpected-eof', '2026-08-31 08:01:48.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '29', 'unexpected-eof', '2026-08-31 08:01:48.010', 'GMT',
            'extension server_name, type=host_name (0), value=eof.example.com'),
        'java.io.EOFException: SSL peer shut down incorrectly',
        'at java.base/sun.security.ssl.SSLSocketInputRecord.read(SSLSocketInputRecord.java:489)',

        // 30. The socket breaks while the ClientHello is being sent.
        jsse('DEBUG', '30', 'broken-pipe', '2026-08-31 08:01:52.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.2"})'),
        jsse('DEBUG', '30', 'broken-pipe', '2026-08-31 08:01:52.010', 'GMT',
            'extension server_name, type=host_name (0), value=broken-pipe.example.com'),
        jsse('ERROR', '30', 'broken-pipe', '2026-08-31 08:01:52.080', 'GMT',
            'java.net.SocketException: Broken pipe'),

        // 31. Peer rejects a certificate type it does not support.
        jsse('DEBUG', '31', 'unsupported-certificate', '2026-08-31 08:01:56.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '31', 'unsupported-certificate', '2026-08-31 08:01:56.010', 'GMT',
            'extension server_name, type=host_name (0), value=unsupported-cert.example.com'),
        jsse('ERROR', '31', 'unsupported-certificate', '2026-08-31 08:01:56.080', 'GMT',
            'Fatal (UNSUPPORTED_CERTIFICATE): Received fatal alert: unsupported_certificate'),

        // 32. Peer rejects an unsupported TLS extension.
        jsse('DEBUG', '32', 'unsupported-extension', '2026-08-31 08:02:00.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '32', 'unsupported-extension', '2026-08-31 08:02:00.010', 'GMT',
            'extension server_name, type=host_name (0), value=unsupported-extension.example.com'),
        jsse('ERROR', '32', 'unsupported-extension', '2026-08-31 08:02:00.080', 'GMT',
            'Fatal (UNSUPPORTED_EXTENSION): Received fatal alert: unsupported_extension'),

        // 33. Peer closes the connection during the handshake.
        jsse('DEBUG', '33', 'peer-close', '2026-08-31 08:02:04.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '33', 'peer-close', '2026-08-31 08:02:04.010', 'GMT',
            'extension server_name, type=host_name (0), value=peer-close.example.com'),
        jsse('ERROR', '33', 'peer-close', '2026-08-31 08:02:04.080', 'GMT',
            'Connection closed by peer'),

        // 34. Outbound DNS host-name verification failure. The chain itself verifies,
        //     but no certificate name covers the requested host, so the client aborts
        //     locally rather than receiving a fatal alert from the peer.
        jsse('DEBUG', '34', 'hostname-mismatch', '2026-08-31 08:02:08.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '34', 'hostname-mismatch', '2026-08-31 08:02:08.010', 'GMT',
            'extension server_name, type=host_name (0), value=api.example.com'),
        jsse('DEBUG', '34', 'hostname-mismatch', '2026-08-31 08:02:08.060', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('DEBUG', '34', 'hostname-mismatch', '2026-08-31 08:02:08.090', 'GMT',
            '"Certificates": [{"certificate" : {"subject" : "CN=other.example.com, O=Example Corp"}}]'),
        jsse('ERROR', '34', 'hostname-mismatch', '2026-08-31 08:02:08.120', 'GMT',
            'javax.net.ssl.SSLHandshakeException: java.security.cert.CertificateException: '
            + 'No subject alternative DNS name matching api.example.com found.'),

        // 35. The peer aborts with an alert this analyzer has no dedicated explanation
        //     for, which is what the generic fatal-alert fallback exists to cover.
        jsse('DEBUG', '35', 'internal-error', '2026-08-31 08:02:12.000', 'GMT',
            'Produced ClientHello handshake message ("ClientHello": {"client version" : "TLSv1.3"})'),
        jsse('DEBUG', '35', 'internal-error', '2026-08-31 08:02:12.010', 'GMT',
            'extension server_name, type=host_name (0), value=internal-error.example.com'),
        jsse('DEBUG', '35', 'internal-error', '2026-08-31 08:02:12.060', 'GMT',
            'Consuming ServerHello handshake message ("ServerHello": {"server version" : "TLSv1.3"})'),
        jsse('ERROR', '35', 'internal-error', '2026-08-31 08:02:12.110', 'GMT',
            'Fatal (INTERNAL_ERROR): Received fatal alert: internal_error'),
    ].join('\n');
}

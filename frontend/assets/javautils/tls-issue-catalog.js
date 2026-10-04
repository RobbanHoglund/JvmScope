// Authored content only: stable IDs, matching aliases and ordered sections.
// Keep matching priorities and endpoint resolution in tls-explanations.js.
export const TLS_ISSUE_CATALOG = [
    {
        "id": "certificate-unknown",
        "matchKey": "certificate_unknown",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} rejected a certificate during the TLS handshake.",
                    "In TLS, certificate_unknown means {alertEndpoint} found the certificate unacceptable for some unspecified certificate-processing reason."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "The rejecting endpoint is not necessarily the endpoint at fault",
                    "It is broader than unknown_ca",
                    "It often appears after earlier local JSSE hints such as 'No X.509 cert selected' or 'KeyMgr: no matching key found'"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "{AlertEndpoint} did not trust the presented certificate chain",
                    "The certificate chain was incomplete (missing intermediate CA)",
                    "The certificate identity was not acceptable to {alertEndpoint} for the intended purpose",
                    "The certificate type/algorithm was not acceptable",
                    "In mTLS: the server rejected the client certificate",
                    "In normal TLS: the client rejected the server certificate"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Which side sent the alert?",
                    "Was a certificate actually presented?",
                    "Does the presented chain include intermediate CA certificates?",
                    "Does {alertEndpoint} trust the issuing CA/root?",
                    "Does the certificate match the expected identity / usage?"
                ]
            },
            {
                "id": "tip",
                "title": "Tip",
                "paragraphs": [
                    "If nearby lines say 'No X.509 cert selected' or 'KeyMgr: no matching key found', the alert from {alertEndpoint} may just be the final outcome of the client not presenting a usable certificate."
                ]
            }
        ]
    },
    {
        "id": "certificate-not-selected",
        "matchKey": "No X.509 cert selected",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE did not select a certificate to present for one of the requested key types during certificate selection."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is a local JSSE diagnostic",
                    "It is often an early clue, not the final handshake failure reason",
                    "You may see several variants such as 'for EC', 'for RSA', or 'for EdDSA'",
                    "A later candidate may succeed; server certificate selection also emits this message"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "No client certificate configured / wrong keystore",
                    "No certificate in the keystore matches the requested key type",
                    "Signature schemes / certificate algorithms do not overlap",
                    "The peer sent acceptable issuers and none of your certificate chains matched"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Is mutual TLS actually required by the peer?",
                    "Are you loading the correct keystore and alias?",
                    "Does the keystore contain a usable RSA / EC / EdDSA certificate for this handshake?",
                    "Do the peer's acceptable CA issuers match your certificate chain?"
                ]
            },
            {
                "id": "tip",
                "title": "Tip",
                "paragraphs": [
                    "If the handshake later ends with 'Received fatal alert: certificate_unknown' or 'handshake_failure', this line may be the upstream cause."
                ]
            }
        ]
    },
    {
        "id": "trust-path-building",
        "matchKey": "PKIX path building failed",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The JVM could not build a trusted certification path from the peer certificate to a trust anchor in the active truststore."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Missing intermediate CA certificate",
                    "Issuing CA/root is not trusted by the active truststore",
                    "Wrong truststore loaded at runtime",
                    "Certificate expired / not yet valid / revoked (depending on settings)",
                    "TLS interception proxy presents a different chain than expected"
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "paragraphs": [
                    "A trusted endpoint can still fail with this error if the peer sends an incomplete chain."
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Does the peer send the full chain (leaf + intermediate(s))?",
                    "Does the active truststore contain the correct trust anchor?",
                    "Is the intended truststore actually loaded at runtime?",
                    "Are dates and certificate validity correct?"
                ]
            }
        ]
    },
    {
        "id": "authentication-scheme-unavailable",
        "matchKey": "No available authentication scheme",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE could not find any usable certificate/authentication scheme for this side of the handshake."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "paragraphs": [
                    "This is often a local-side problem that later shows up on the peer as a generic fatal 'handshake_failure'.",
                    "For optional client authentication, an empty client certificate list can still lead to a successful handshake. Check the final alert or Finished exchange."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Available certificates use unsupported key algorithms for the negotiated TLS version",
                    "Signature scheme overlap is empty",
                    "Disabled algorithms / security policy block the available certificate",
                    "In TLS 1.3, old or incompatible certificate types can trigger this"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Certificate key algorithm and signature algorithm",
                    "Enabled protocols and signature schemes",
                    "jdk.tls.disabledAlgorithms / java.security restrictions",
                    "TLS 1.2 vs TLS 1.3 behavior differences"
                ]
            }
        ]
    },
    {
        "id": "handshake-failure",
        "matchKey": "handshake_failure",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} aborted the handshake with the generic TLS alert 'handshake_failure'."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "paragraphs": [
                    "This alert usually means {alertEndpoint} could not negotiate acceptable security parameters, but it often does not identify the real root cause by itself."
                ]
            },
            {
                "id": "causes",
                "title": "Typical root causes",
                "bullets": [
                    "No common protocol version / cipher suite / signature scheme",
                    "Certificate or trust problem",
                    "Client certificate required but missing or unusable",
                    "Key exchange / group mismatch"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Look for earlier local JSSE clues such as 'No X.509 cert selected', 'KeyMgr: no matching key found', or 'No available authentication scheme'",
                    "Compare enabled TLS versions, cipher suites, groups, and certificate algorithms on both sides"
                ]
            }
        ]
    },
    {
        "id": "received-fatal-alert",
        "matchKey": "Received fatal alert:",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The remote peer aborted the TLS connection with a fatal alert.",
                    "The alert name after the colon identifies the protocol condition reported by the peer."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is a generic fallback for fatal alerts that do not have a more specific explanation in this analyzer",
                    "The alert describes what the peer reported; nearby local JSSE messages may contain the more useful root-cause clue"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Note the exact alert name and which side sent it",
                    "Inspect the preceding ClientHello, ServerHello, certificate, and key-selection messages",
                    "Compare both peers' TLS versions, cipher suites, extensions, certificates, and security policies",
                    "Correlate the same connection with logs from the remote peer"
                ]
            }
        ]
    },
    {
        "id": "matching-key-unavailable",
        "matchKey": "KeyMgr: no matching key found",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The JSSE key manager could not find a certificate/private key entry that matched the peer's requirements for this handshake."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "paragraphs": [
                    "This is a local key-selection symptom, not a peer alert."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "mTLS is required but the configured keystore has no usable client certificate",
                    "The certificate key type does not match what the peer accepts",
                    "Signature schemes or TLS-version constraints eliminate the available certs",
                    "Acceptable issuer constraints do not match the certificate chain"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Does the configured keystore contain the expected key entry?",
                    "Is the selected alias correct?",
                    "Does the certificate algorithm match the peer's request?",
                    "Does the chain match the acceptable CA issuers?"
                ]
            }
        ]
    },
    {
        "id": "issuer-mismatch",
        "matchKey": "issuers do not match",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The candidate certificate chain did not match the acceptable certificate-authority issuer list sent by the peer."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The peer restricts client certificates to specific CA issuers",
                    "Your certificate chain is signed by a different CA",
                    "An intermediate CA is missing, so the chain does not match correctly"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Compare your certificate chain issuers with the CA names sent in CertificateRequest",
                    "Ensure intermediates are present in the chain",
                    "Verify the correct client certificate/alias is being considered"
                ]
            }
        ]
    },
    {
        "id": "broken-pipe",
        "matchKey": "Broken pipe during TLS handshake",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE observed a failed socket write (broken pipe). The socket was no longer writable; this observation alone does not establish the TLS phase or which endpoint caused the closure."
                ]
            },
            {
                "id": "context",
                "title": "What it usually means",
                "bullets": [
                    "The peer or an intermediary may have closed the connection before this write",
                    "Use the captured handshake messages and surrounding source lines to locate the observation"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Inspect peer, proxy, load-balancer, and firewall logs at the same timestamp",
                    "Verify that the target port expects TLS and accepts the offered protocol settings",
                    "Compare with an openssl s_client or curl -v test from the same host"
                ]
            }
        ]
    },
    {
        "id": "unexpected-eof",
        "matchKey": "Unexpected EOF during TLS handshake",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE observed an unexpected end of the input stream. This observation alone does not establish the TLS phase or explain why the connection closed."
                ]
            },
            {
                "id": "context",
                "title": "What it usually means",
                "bullets": [
                    "The peer or an intermediary may have closed the connection; a TLS alert may be absent from this capture",
                    "If no TLS response was captured, verify that the selected service and port actually expect TLS"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Verify host, port, proxy route, and TLS termination point",
                    "Inspect the remote endpoint and middlebox logs for an early close",
                    "Reproduce with openssl s_client and compare whether a ServerHello is returned"
                ]
            }
        ]
    },
    {
        "id": "peer-closed",
        "matchKey": "Peer closed connection during TLS handshake",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE reported that the peer closed the connection. The message alone does not establish whether TLS negotiation completed or identify an intermediary involved in the close."
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Confirm that the peer accepted the connection and inspect its TLS logs",
                    "Check proxies, load balancers, and firewalls for early connection termination",
                    "Verify host, port, SNI, and enabled TLS versions"
                ]
            }
        ]
    },
    {
        "id": "connection-reset",
        "matchKey": "Connection reset during TLS handshake",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "JSSE observed a TCP connection reset. This observation alone does not identify who sent the reset or establish whether the TLS handshake had completed."
                ]
            },
            {
                "id": "context",
                "title": "What it usually means",
                "bullets": [
                    "A peer or intermediary may have interrupted the connection; compare source messages and endpoint logs before assigning a cause"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Wrong port / wrong service",
                    "Proxy, firewall, or load balancer interruption",
                    "TLS policy rejection before full handshake completion",
                    "SNI-based routing or filtering issue"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Verify host and port",
                    "Compare direct path vs proxy/load balancer path",
                    "Test with openssl s_client or curl -v",
                    "Check server, proxy, load balancer, and firewall logs"
                ]
            }
        ]
    },
    {
        "id": "unknown-ca",
        "matchKey": "unknown_ca",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} received a certificate chain or partial chain, but did not accept it because the issuing CA was not trusted."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is more specific than certificate_unknown",
                    "It usually points to a truststore / CA trust problem on {alertEndpoint}"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The issuing root CA is missing from {alertEndpoint}'s truststore",
                    "An intermediate CA is missing, so the chain cannot be linked to a trusted root",
                    "The wrong truststore is loaded at runtime",
                    "A proxy / load balancer presents a certificate chain signed by an unexpected CA"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Which side sent the alert?",
                    "Does that side trust the issuing root/intermediate CA?",
                    "Is the full certificate chain being sent?",
                    "Is the intended truststore actually loaded?"
                ]
            }
        ]
    },
    {
        "id": "bad-certificate",
        "matchKey": "bad_certificate",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} reported a certificate-related handshake failure."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "paragraphs": [
                    "This alert alone does not establish that a certificate was corrupt or even presented.",
                    "Java 8 can also send this alert when required client authentication receives an empty client certificate chain (null cert chain)."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "A required client certificate was not provided",
                    "Corrupt certificate data",
                    "Certificate signature verification failed",
                    "Broken or malformed certificate chain",
                    "Unsupported or rejected signature/hash combination during validation"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Was a client certificate required, and was a non-empty certificate chain actually sent?",
                    "Can the certificate and chain be parsed successfully?",
                    "Does signature verification succeed?",
                    "Is the certificate chain complete and in the correct order?",
                    "Is a proxy or TLS terminator rewriting the chain?"
                ]
            }
        ]
    },
    {
        "id": "unsupported-certificate",
        "matchKey": "unsupported_certificate",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} rejected the certificate because its type was not acceptable."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The certificate type / key algorithm is not supported by {alertEndpoint}",
                    "The certificate is inappropriate for that role or handshake",
                    "TLS version and certificate capabilities do not line up cleanly"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Certificate key algorithm (RSA / EC / EdDSA)",
                    "TLS stack support on {alertEndpoint}",
                    "Whether the certificate is suitable for the endpoint role",
                    "TLS 1.2 vs TLS 1.3 differences"
                ]
            }
        ]
    },
    {
        "id": "certificate-expired",
        "matchKey": "certificate_expired",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The certificate has expired or is not currently valid."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Certificate NotAfter date has passed",
                    "Certificate NotBefore date is in the future",
                    "Clock skew between systems"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Certificate validity dates",
                    "System time and timezone on both sides",
                    "Whether an old certificate is still being served or selected"
                ]
            }
        ]
    },
    {
        "id": "certificate-revoked",
        "matchKey": "certificate_revoked",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} determined that the certificate had been revoked by its issuer."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "OCSP or CRL checking reports the certificate as revoked",
                    "The wrong replacement certificate was not deployed after revocation"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "OCSP / CRL status for the certificate",
                    "Revocation-checking behavior on {alertEndpoint}",
                    "Whether the currently deployed certificate is the intended one"
                ]
            }
        ]
    },
    {
        "id": "certificate-required",
        "matchKey": "certificate_required",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} required a client certificate, but none was provided for the handshake."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is the clearest protocol-level signal for missing client authentication",
                    "It is stronger than local clues like 'No X.509 cert selected'"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "mTLS is required but no client certificate is configured",
                    "The client keystore is wrong or empty",
                    "The certificate-selection step found no matching key/cert",
                    "No certificate matched the server's requested key types / issuers"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Look for earlier lines such as 'No X.509 cert selected' or 'KeyMgr: no matching key found'",
                    "Is the correct client keystore configured? Verify path, alias, password, and certificate chain",
                    "Does the client certificate match the requested key types and acceptable issuers?",
                    "Confirm whether the server requires or merely requests client auth"
                ]
            }
        ]
    },
    {
        "id": "protocol-version",
        "matchKey": "protocol_version",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} recognized the proposed or negotiated TLS version, but did not support or accept it."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "No overlap in enabled TLS protocol versions",
                    "One side only supports older TLS versions",
                    "TLS 1.0 / 1.1 disabled on one side while the other still tries to use them",
                    "TLS 1.3 / TLS 1.2 policy mismatch",
                    "A proxy or load balancer enforces stricter TLS policy than the backend",
                    "Legacy renegotiation or version fallback edge cases"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Enabled TLS versions on client, server, and any middleboxes",
                    "JVM security settings and disabled protocols",
                    "Load balancer / proxy TLS policy in front of the service"
                ]
            }
        ]
    },
    {
        "id": "unrecognized-name",
        "matchKey": "unrecognized_name",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The server did not recognize the server name indicated by the client, typically via SNI."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The client connected with the wrong hostname",
                    "SNI is missing, stripped, or rewritten by a proxy",
                    "The requested virtual host is not configured on the server / load balancer"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Exact hostname in the client configuration",
                    "Whether SNI is being sent, and whether it survives proxies / load balancers",
                    "How the target hostname maps to certificates, virtual hosts, and listeners"
                ]
            }
        ]
    },
    {
        "id": "access-denied",
        "matchKey": "access_denied",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} understood the certificate or authentication material but refused the handshake for authorization reasons."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Certificate authenticated successfully but is not permitted for access",
                    "mTLS certificate is valid but mapped to an unauthorized identity",
                    "Policy on a gateway or server denies this caller"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Authorization rules tied to certificate subject / SAN / issuer",
                    "mTLS identity mapping",
                    "Gateway, proxy, or service access policy logs"
                ]
            }
        ]
    },
    {
        "id": "illegal-parameter",
        "matchKey": "illegal_parameter",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "A handshake field was syntactically valid but inconsistent, incorrect, or unacceptable to {alertEndpoint}."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Protocol parameter mismatch",
                    "Invalid group / signature / extension combination",
                    "Buggy client, server, or middlebox rewriting handshake fields"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Nearby handshake details in the raw TLS debug log",
                    "TLS version / cipher / named group negotiation",
                    "Proxy / gateway devices that terminate or inspect TLS"
                ]
            }
        ]
    },
    {
        "id": "insufficient-security",
        "matchKey": "insufficient_security",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "Negotiation failed because the server requires stronger parameters than the client supports."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Client only offers weak ciphers or old protocols",
                    "Server enforces stronger policy than the client can satisfy"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Cipher suites and protocol versions on both sides",
                    "JVM disabledAlgorithms / policy settings",
                    "TLS policy on proxies and load balancers"
                ]
            }
        ]
    },
    {
        "id": "decrypt-error",
        "matchKey": "decrypt_error",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "A handshake-layer cryptographic operation failed."
                ]
            },
            {
                "id": "protocol",
                "title": "Protocol meaning",
                "paragraphs": [
                    "This can include failure to verify a signature, Finished message, or PSK binder."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Signature verification failure",
                    "Broken or mismatched key material",
                    "Corrupted handshake data",
                    "TLS interception / middlebox modification"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Nearby certificate and Finished-message logs",
                    "Whether any proxy is modifying or terminating TLS",
                    "Certificate/key consistency"
                ]
            }
        ]
    },
    {
        "id": "unsupported-extension",
        "matchKey": "unsupported_extension",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "{AlertEndpoint} rejected a TLS extension it did not support or did not allow in that context."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Extension sent in the wrong handshake context",
                    "Old TLS stack receiving a newer extension set",
                    "Proxy or gateway interference"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "TLS versions and feature support on both sides",
                    "Whether ALPN, SNI, or other extensions are expected",
                    "Any TLS-terminating middleboxes in the path"
                ]
            }
        ]
    },
    {
        "id": "no-application-protocol",
        "matchKey": "no_application_protocol",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "ALPN negotiation failed because the client and server had no application protocol in common."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "Client offered only protocols the server does not support",
                    "HTTP/2 vs HTTP/1.1 ALPN mismatch",
                    "Proxy / ingress terminator has different ALPN policy than the backend"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "ALPN offerings on client and server",
                    "HTTP/2 enablement",
                    "Proxy / ingress TLS termination configuration"
                ]
            }
        ]
    },
    {
        "id": "hostname-mismatch",
        "matchKey": "Certificate name mismatch",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The server certificate did not match the requested host name. This diagnostic alone does not establish certificate trust or validity.",
                    "For DNS names, SunJSSE checks SAN dNSName entries first. When no DNS SAN is present, its hostname checker can fall back to the subject CN; other clients may apply different policies."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is an endpoint-identification failure, not a truststore or certificate-chain failure",
                    "The chain may verify perfectly and still be rejected here",
                    "The client usually sends certificate_unknown to the peer immediately afterwards"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The client connected using a host name the certificate does not cover",
                    "SNI-based routing returned a certificate for a different virtual host",
                    "A wildcard certificate does not cover the depth of the requested name",
                    "A TLS interception proxy presented its own certificate",
                    "DNS SAN entries are present but none covers the requested name; SunJSSE does not fall back to the subject CN in this case"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Compare the exact host name used by the client with the certificate's SAN dNSName entries",
                    "Verify which virtual host or listener answered, and what SNI was sent",
                    "Confirm the certificate has a SAN extension covering the requested name",
                    "Rule out a proxy or load balancer terminating TLS with a different certificate"
                ]
            }
        ]
    },
    {
        "id": "ip-address-mismatch",
        "matchKey": "SSLHandshakeException: (certificate_unknown) No subject alternative names matching IP address",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "TLS certificate validation reached endpoint identity checking, and the server certificate did not contain a Subject Alternative Name (SAN) matching the IP address you connected to."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is usually a hostname / endpoint-identification failure, not primarily a truststore-chain failure",
                    "When the client connects by IP address, the certificate must contain a matching IP-address SAN",
                    "A DNS SAN like api.example.com does not satisfy verification for a literal IP such as 10.0.0.12"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The client connected to the server by IP address instead of DNS name",
                    "The certificate only contains DNS SAN entries, not IP SAN entries",
                    "The wrong certificate is being served by the target, proxy, or load balancer",
                    "SNI / virtual-host routing sent back a certificate for a different hostname"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Did the client connect to an IP address instead of a hostname?",
                    "Does the certificate contain an IP SAN for that exact address?",
                    "Would connecting with the intended DNS name match one of the certificate DNS SANs?",
                    "Is a proxy / load balancer presenting a different certificate than expected?"
                ]
            },
            {
                "id": "fixes",
                "title": "Typical fixes",
                "bullets": [
                    "Connect using the DNS name that already appears in the certificate",
                    "Or reissue the certificate with the required IP-address SAN",
                    "Or fix routing / SNI so the correct certificate is presented"
                ]
            }
        ]
    },
    {
        "id": "read-timeout",
        "matchKey": "SocketTimeoutException: Read timed out",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The JVM waited for data from the remote peer, but no data arrived within the configured socket read timeout."
                ]
            },
            {
                "id": "important",
                "title": "Important",
                "bullets": [
                    "This is a transport-level timeout, not a TLS alert",
                    "The TLS handshake or application data exchange was in progress when the timeout fired",
                    "The connection may or may not have completed TLS negotiation before the timeout"
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The remote server is slow or overloaded",
                    "A firewall or proxy silently drops packets after the TCP connection is established",
                    "The socket read timeout is set too low for the network conditions",
                    "DNS resolved to a host that accepts TCP connections but does not respond on the TLS layer",
                    "A load balancer or reverse proxy is not forwarding traffic correctly"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Can you reach the target host and port from this environment? (telnet, openssl s_client)",
                    "What is the configured socket/read timeout?",
                    "Are there firewall rules, network policies, or proxies in the path?",
                    "Does the server log show the incoming connection?",
                    "Is the server under heavy load or resource pressure?"
                ]
            },
            {
                "id": "tip",
                "title": "Tip",
                "paragraphs": [
                    "A timeout can occur at different handshake stages or during application reads. Inspect the last captured messages and endpoint logs; a missing completion message does not prove that the peer never answered ClientHello."
                ]
            }
        ]
    },
    {
        "id": "no-common-cipher",
        "matchKey": "cipher suites in common",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The client and server did not share a mutually acceptable cipher suite for this handshake."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "The running JDK disabled the suites offered by the peer through jdk.tls.disabledAlgorithms",
                    "The server is restricted to a narrow cipher-suite list",
                    "An older JDK lacks the required JCE unlimited-strength policy",
                    "TLS 1.2 certificate authentication does not match the shared suites, for example an RSA certificate when only ECDHE_ECDSA suites are enabled",
                    "The enabled TLS 1.3 and TLS 1.2 cipher-suite families do not overlap"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Compare the ClientHello offered suites with the peer's configured suite list",
                    "Inspect java.security and jdk.tls.disabledAlgorithms for the running JDK",
                    "Verify that the certificate key type is compatible with the enabled suites; TLS 1.2 ECDHE_RSA uses an RSA certificate with ECDHE key exchange"
                ]
            }
        ]
    },
    {
        "id": "algorithm-constraints",
        "matchKey": "algorithm constraints",
        "sections": [
            {
                "id": "meaning",
                "title": "Meaning",
                "paragraphs": [
                    "The local JVM security policy rejected the certificate or key material; the peer did not make this decision."
                ]
            },
            {
                "id": "causes",
                "title": "Common causes",
                "bullets": [
                    "A certificate in the chain uses a SHA-1 signature",
                    "A certificate key is smaller than the minimum allowed by the active JDK security policy",
                    "A certificate algorithm or TLS parameter was disabled by jdk.certpath.disabledAlgorithms or jdk.tls.disabledAlgorithms after a JDK update"
                ]
            },
            {
                "id": "checks",
                "title": "What to check",
                "bullets": [
                    "Inspect the disabled-algorithm properties in java.security for the running JDK",
                    "Check the signature algorithm and key size of every certificate in the chain",
                    "Determine whether the failure started after a JDK upgrade"
                ]
            },
            {
                "id": "tip",
                "title": "Tip",
                "paragraphs": [
                    "This is a local JVM policy decision. Check the local JDK security configuration before changing the peer."
                ]
            }
        ]
    }
];

export const LOCAL_FATAL_EXPLANATION = 'The local JSSE endpoint aborted TLS. Read the accompanying reason and earlier handshake messages for the cause. This is a locally reported failure, not evidence that the remote peer sent this alert.';

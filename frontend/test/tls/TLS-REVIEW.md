> Historical verification record from the predecessor application. Product names and results below describe that earlier build; see the repository README for current JvmScope verification. Command paths below reflect the earlier layout; current launch, build and capture scripts live in `scripts/`.

# Java TLS log review — 2026-09-08

This is the original dated parser review. Current Java 25–27 runtime evidence and help-guide corrections are recorded in the [2026-10-03 compatibility review](../JAVA25-27-REVIEW.md).

## Research basis

SunJSSE debug output is diagnostic text, not a stable interchange format. Oracle explicitly says it may change between releases. `javax.net.debug=ssl,handshake` provides handshake diagnostics; available fields depend on enabled categories and how much of the exchange was captured. Java 8 itself has materially different implementations: Oracle documents TLS 1.3 support from 8u261. [Java 25 JSSE guide](https://docs.oracle.com/en/java/javase/25/security/java-secure-socket-extension-jsse-reference-guide.html), [Java 8 JSSE guide](https://docs.oracle.com/javase/8/docs/technotes/guides/security/jsse/JSSERefGuide.html).

Modern compact records contain logger, level, hexadecimal JVM thread ID, thread name, timestamp, source location and message, followed by optional multiline details. `expand` changes the wrapper into JSON-like text; certificate details can still contain unescaped quotes and non-JSON values. Java 25's formatter uses `kk` for hours (1–24), so `24:15` denotes 00:15 on that same date. Custom `System.Logger` output is a separate format. These details were checked directly in the implementation. [OpenJDK 25 SSLLogger](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/SSLLogger.java).

TLS 1.3 deliberately retains `TLSv1.2` in the ServerHello compatibility-version field. The selected version is supplied by `supported_versions`. A record header or ClientHello offer is therefore insufficient to identify the negotiated version. [Oracle's TLS debugging walkthrough](https://docs.oracle.com/en/java/javase/25/security/java-secure-socket-extension-jsse-reference-guide.html).

Receiving the server Finished is only one step: a TLS 1.3 client may still need to send its certificate, CertificateVerify and Finished. A local key-selection miss also does not necessarily end the handshake: the client-side certificate producer can send an empty list, while server-side failure to choose authentication can produce a fatal alert. [OpenJDK Finished implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/Finished.java), [OpenJDK CertificateMessage implementation](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/CertificateMessage.java).

## Information represented

| Log evidence | Analyzer interpretation |
| --- | --- |
| Produced/consumed ClientHello | Local client/server role; generic read/write alone is not connection direction |
| Negotiated protocol or complete ServerHello selection | Selected TLS version and cipher |
| SNI host_name | Requested virtual host; outbound peer-name fallback is labelled as derived |
| Explicit peer-host message | Observed peer-host value |
| CertificateRequest | Client certificate requested; acceptable CAs may be present, absent or empty |
| Produced or consumed client Certificate | Observed client identity; empty certificate list is not automatically an error |
| Both Finished directions / explicit completion | Locally observed completion, subject to later explicit fatal evidence |
| Fatal alerts and handshake exceptions | Failure, retaining local-versus-received semantics |
| Algorithm/key selection misses | Diagnostic clues; final outcome remains separate |
| Record times | Observed span; unknown zone/calendar values do not become guessed durations |

ALPN, session identifiers, supported groups, signature algorithms, trust configuration, server certificate chains and record details remain available in raw text. They are not all projected into summary fields. The resumption fixture verifies two correctly parsed exchanges; it does not claim a dedicated resumption classifier.

## Confirmed problems corrected

1. Legacy Java 8 and expanded records produced no usable interactions. The reader now supports both, with conservative handling of unscoped legacy data.
2. The monolithic UI owned the parser, while existing tests only exercised small helpers and searched synthetic sample strings. The actual browser parser and display projections are now imported by unit and disk-fixture integration tests.
3. A successful real Java 25 server was classified as failed after an unsuccessful EdDSA key candidate. Optional client-auth success exhibited the same issue. Selection clues no longer promote failure by themselves.
4. A received server Finished could mark completion prematurely and hide a later client-auth rejection. One direction remains incomplete; fatal rejection is retained even after a local Finished exchange.
5. A three-second pause split legitimate handshakes; another ClientHello split HelloRetryRequest. Handshake markers and explicit retry context now drive boundaries, independent of arbitrary elapsed gaps.
6. Offered/ignored cipher values and compatibility versions could be shown as negotiated values. Selection now requires relevant server/negotiation evidence.
7. Thread names, including renames and pipe characters, could damage grouping. Modern grouping uses the JVM thread ID; separate IDs with equal names stay separate.
8. Generic message direction and certificate CN could imply a remote endpoint without evidence. Endpoint and direction inference are now limited and labelled.
9. Missing CA/certificate data was displayed as `no match`; produced and consumed client certificates were treated differently, and produced CertificateRequest variants were missed. The parser and all detail/table projections now distinguish unknown, truncated and explicitly empty lists.
10. Raw unrelated application or certificate text could become TLS error evidence. Detail interpretation now follows the containing JSSE message.
11. The second pass caught incomplete CA lists labelled empty, quoted/escaped distinguished names being truncated, and local fatal alerts receiving peer-blaming explanations. All received targeted regression tests.

## System consequences and validation

The file chooser, drag/drop, demo, filters, table, modal and copied summary use the same parsing/projection path. Changes affect interpretation only; no network TLS settings, backend API, database or production data are changed. Original fixture/raw text remains available. Existing browser tabs need a reload and reparse; no historical results are rewritten.

The runtime catalog contains 38 endpoint captures from eight runtime variants, plus two edge-case files. Unit tests additionally challenge partial input, duplicate Finished events, ID collisions, renames, slow exchanges, HelloRetryRequest, quoted data, UTC midnight, offsets and unavailable timestamps. Integration tests run from the normal npm and Gradle build, without installing historical JVMs in CI. See [sample provenance and commands](README.md).

The target is Java 8–25 SunJSSE format support, not certification of every release/provider/platform or reliable connection reconstruction from arbitrary merged logs. Those boundaries are visible in the application help and the sample README.

Final verification: `gradlew build` passed, including 452 frontend tests (46 TLS unit tests and 42 TLS integration tests) and the Java tests. A browser smoke test loaded actual Java 8 mutual-TLS, Java 25 optional/required client-auth and expanded server captures through the file chooser and checked the table/details. The 35-case demo also rendered successfully. The final adversarial pass included quoted input, truncated lists, thread renames, diagnostic text embedded in certificate data, and local-versus-peer failure interpretation.

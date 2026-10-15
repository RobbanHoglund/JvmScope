# Real Java TLS log samples

Start with [Java 17 TLS 1.3 success](java17-temurin-tlsv1.3-success-client.txt)
or [Java 17 certificate trust failure](java17-temurin-tlsv1.3-untrusted-client.txt).
In VS Code, right-click a `.txt` file and choose **Analyze as Java TLS Log**.
In the standalone JvmScope application, open **TLS Log Analyzer → Choose TLS log**.
When downloading from GitHub, save the file's **Raw** contents, not the HTML page.

These 28 files are real SunJSSE output from controlled Java client/server processes
on Linux x64, captured on **2026-10-04**. They are unchanged copies of verified
captures in [`../jvm-samples/`](../jvm-samples/), with descriptive filenames.
Each pair comes from the same scenario and runtime. Open **one endpoint file at a
time**; combining client and server output can make handshake correlation ambiguous.

## Choose a scenario

Expected results are per file. The failure scenarios deliberately reject the
connection; a failure in the analyzer is the expected result.

| Java | Protocol | Scenario | Expected interactions | Logs |
| --- | --- | --- | --- | --- |
| 7 | TLS 1.2 | Successful handshake | 1 success | [Client](java7-zulu-tlsv1.2-success-client.txt) · [Server](java7-zulu-tlsv1.2-success-server.txt) |
| 8 | TLS 1.2 | Successful handshake | 1 success | [Client](java8-temurin-tlsv1.2-success-client.txt) · [Server](java8-temurin-tlsv1.2-success-server.txt) |
| 8 | TLS 1.3 | Successful handshake | 1 success | [Client](java8-temurin-tlsv1.3-success-client.txt) · [Server](java8-temurin-tlsv1.3-success-server.txt) |
| 11 | TLS 1.3 | Successful handshake | 1 success | [Client](java11-temurin-tlsv1.3-success-client.txt) · [Server](java11-temurin-tlsv1.3-success-server.txt) |
| 17 | TLS 1.3 | Successful handshake | 1 success | [Client](java17-temurin-tlsv1.3-success-client.txt) · [Server](java17-temurin-tlsv1.3-success-server.txt) |
| 17 | TLS 1.3 | Client does not trust the server certificate | 1 failure | [Client](java17-temurin-tlsv1.3-untrusted-client.txt) · [Server](java17-temurin-tlsv1.3-untrusted-server.txt) |
| 21 | TLS 1.3 | Successful handshake | 1 success | [Client](java21-temurin-tlsv1.3-success-client.txt) · [Server](java21-temurin-tlsv1.3-success-server.txt) |
| 21 | TLS 1.3 | Required client certificate is missing | 1 failure | [Client](java21-temurin-tlsv1.3-required-client-auth-client.txt) · [Server](java21-temurin-tlsv1.3-required-client-auth-server.txt) |
| 25 | TLS 1.3 | Successful handshake | 1 success | [Client](java25-temurin-tlsv1.3-success-client.txt) · [Server](java25-temurin-tlsv1.3-success-server.txt) |
| 25 | TLS 1.3 | Mutual TLS with a client certificate | 1 success | [Client](java25-temurin-tlsv1.3-mutual-client.txt) · [Server](java25-temurin-tlsv1.3-mutual-server.txt) |
| 26 | TLS 1.3 | Successful handshake | 1 success | [Client](java26-temurin-tlsv1.3-success-client.txt) · [Server](java26-temurin-tlsv1.3-success-server.txt) |
| 26 | TLS 1.3 | Optional client certificate is absent | 1 success | [Client](java26-temurin-tlsv1.3-optional-client-auth-client.txt) · [Server](java26-temurin-tlsv1.3-optional-client-auth-server.txt) |
| 27 | TLS 1.3 | Successful handshake | 1 success | [Client](java27-temurin-tlsv1.3-success-client.txt) · [Server](java27-temurin-tlsv1.3-success-server.txt) |
| 27 | TLS 1.2 | Two connections using one SSLContext | 2 successes | [Client](java27-temurin-tlsv1.2-resumption-client.txt) · [Server](java27-temurin-tlsv1.2-resumption-server.txt) |

`resumption` is the workload's name for an attempt to reuse a session. Both
connections succeeded; that alone does not prove that session resumption occurred.
In the trust-failure pair, the client has the local certificate-validation cause;
the server observes the rejection or a socket abort. In the required-client-auth
pair, the server rejects the absent client certificate and the client receives the
alert. Use both files separately to compare the endpoint perspectives.

## Exact Java builds and provenance

| Java | Distribution | Reported runtime version | Original capture metadata |
| --- | --- | --- | --- |
| 7 | Azul Zulu | `1.7.0_352-b01` | [Report](../jvm-samples/gh-37178916324-1-zulu-7-all.json) |
| 8 | Eclipse Temurin | `1.8.0_504-b01` | [Report](../jvm-samples/gh-37178916324-1-temurin-8-all.json) |
| 11 | Eclipse Temurin | `11.0.32.1+1` | [Report](../jvm-samples/gh-37178916324-1-temurin-11-all.json) |
| 17 | Eclipse Temurin | `17.0.20.1+1` | [Report](../jvm-samples/gh-37178916324-1-temurin-17-all.json) |
| 21 | Eclipse Temurin | `21.0.12.1+1-LTS` | [Report](../jvm-samples/gh-37178916324-1-temurin-21-all.json) |
| 25 | Eclipse Temurin | `25.0.4.1+1-LTS` | [Report](../jvm-samples/gh-37178916324-1-temurin-25-all.json) |
| 26 | Eclipse Temurin | `26.0.2.1+1` | [Report](../jvm-samples/gh-37178916324-1-temurin-26-all.json) |
| 27 | Eclipse Temurin | `27+35` | [Report](../jvm-samples/gh-37178916324-1-temurin-27-all.json) |

All selected captures come from
[Capture JVM samples run 37178916324](https://github.com/RobbanHoglund/JvmScope/actions/runs/37178916324),
using [`TlsWorkload.java`](../../tools/jvm-samples/TlsWorkload.java) at commit
[`cd39251ea66c06061742aca772ee02306ed518de`](https://github.com/RobbanHoglund/JvmScope/tree/cd39251ea66c06061742aca772ee02306ed518de).
The workload used `-Djavax.net.debug=ssl,handshake`, an ephemeral test certificate
and a loopback-only server. Standard output and error were recorded together in
emission order. The logs retain the original JVM messages, timestamps, certificate
data and whitespace. No explanatory header or synthetic message was inserted.

[`manifest.json`](manifest.json) maps each friendly filename to its original
report and case ID. Those reports contain runtime/provider identity, capture time,
commands, workload source hashes, byte counts, SHA-256 hashes and independent
handshake/echo results. The TLS integration tests check that every file is an exact
copy and replay it against that recorded result. Copying the samples here does not
add new runtime-compatibility evidence to the generated matrix.

The Java 8 sample is **8u504**, which includes TLS 1.3 support; it is not evidence
that every Java 8 update supports TLS 1.3. Java 7 uses the older debug format and
does not supply record timestamps, so an unavailable duration is expected.
Certificate dates describe the captured session; JvmScope does not reconnect or
revalidate the certificate against today's date when replaying a log.

These controlled test sessions can contain ephemeral TLS diagnostics. They contain
no production traffic, and no private keystore is included. See the
[collection guide](../../docs/JVM-SAMPLES.md) to capture additional versions or
scenarios with the same workload.

## Verify the samples

From the repository root, with Node.js 24 (no JDK or network connection needed):

```sh
node --test frontend/test/tls/integration/testdata-files.test.js
```

The same checks run as part of `npm run test:tls --prefix frontend` and normal CI.

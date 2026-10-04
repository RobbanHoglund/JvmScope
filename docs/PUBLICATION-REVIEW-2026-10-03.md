# Public-release review — 2026-10-03

## Verdict

The analyzers have substantial automated coverage and the reviewed `c23fbef`
baseline passed Linux CI. The repository should remain private until the project license
is selected and the publication decisions below are resolved. This review does
not certify universal Java 7–27 compatibility or every dependency/hosting setup.

Reviewed code baseline: `c23fbef` on `main`. That commit removes Docker/OCI
analysis and adds real CPU/virtual-thread examples. The README, documentation
index and third-party notice corrections are subsequent local preparation.

**Subsequent change:** Spring Boot delivery has been removed at the owner's
request. Root and standalone builds now produce the same dependency-free Java
server. The dependency and full-binary findings below describe the pushed
`c23fbef` baseline, not the new runtime. See [Spring removal](SPRING-REMOVAL.md)
for current contracts, system consequences and local verification. See GitHub
Actions for checks on the latest commit; container deployment and public
visibility changes are outside this follow-up.

## Publication decisions

| Item | Finding / required action |
| --- | --- |
| Project license | No root LICENSE exists. Recommended: Apache-2.0; MIT is a simpler permissive alternative. Owner selection is pending. |
| Contributions | Recommended: accept bug reports and small fixes; discuss larger features in an issue before a PR. Maintainer retains merge/release decisions. Owner selection is pending. |
| Security reporting | GitHub private vulnerability reporting is not available for this private repo (API 404). Enable it when making the repo public, and add/verify SECURITY.md and its actual reporting channel. |
| Merge protection | Current account/private repo cannot enable branch protection (API 403). After publication, require the `analyzers` and `container-ga` checks for PR merges. |
| Spring runtime dependencies | Removed by the subsequent local change; the sole server has no external Java library dependencies. Earlier version-advisory evidence is retained below. Previously distributed binaries are not repaired by source removal. |
| Former Spring binary notices | Historical finding: SnakeYAML, JSpecify and both Logback JARs had no named LICENSE/NOTICE entries. Those binaries are no longer release targets. Do not redistribute old artifacts using the current notices. |
| Downloads | There are no tagged binary releases. README accurately describes building from source; do not advertise prebuilt downloads until platform-specific artifacts, hashes and legal notices are published. |

Both [Apache-2.0](https://choosealicense.com/licenses/apache-2.0/) and
[MIT](https://choosealicense.com/licenses/mit/) allow commercial use, modification
and redistribution subject to their terms. A project license covers downloading
and using the licensed software; a separate end-user license is not needed for
the proposed permissive model. Bundled third-party/JDK licenses remain separate.
No ownership transfer, paid support or guaranteed response time is proposed.

## Verification evidence for pushed baseline c23fbef

[CI run 37131645399](https://github.com/RobbanHoglund/JvmScope/actions/runs/37131645399)
passed on `c23fbef`, including both Linux jobs:

| Check | Result |
| --- | --- |
| Node parser/model/session/catalog/launcher tests | 605 passed: TDA 340 + 27, TLS 134 + 92, launcher 12 |
| Spring real-server and route tests | 5 passed in the local baseline; the CI Java test/build step also passed |
| Full Chromium suite | 210 passed, desktop and laptop |
| Slim real HTTP/configuration suite | 1002 assertions passed before adding the legal assets |
| Slim Chromium suite | 210 passed, desktop and laptop |
| Actual Linux container | Three cold starts, non-root/read-only runtime, verified 60-second load, 210 browser cases, SIGTERM; 128 MiB without swap / 0.5 CPU |
| npm advisory audit | 0 reported vulnerabilities across 43 installed dependencies |

The test review followed the real input-to-parser-to-model-to-view paths. Existing
coverage checks malformed and malicious input, literal HTML rendering, missing
and unsafe IDs, unknown/zero counters, missing/reversed/equal timestamps, partial
and duplicate snapshots, process separation, multi-source append/replace,
worker cancellation, stale reads, failed batches, clipboard failure, sorting,
filters, keyboard dialogs, exact raw-copy/source spans and static HTTP behavior.
There are no skipped/only test declarations in the committed browser/Node suite.
Counts measure cases/assertions, not percentage line coverage.

The recently added real CPU program verifies actual adjacent counters and precise
collector timestamps; the virtual-worker example verifies reported state/carrier
facts without inventing CPU measurements. Both retain source/capture provenance.

## Test gaps and release boundaries

| Scenario | Priority / expected result |
| --- | --- |
| Real Java 7 TLS and classic dumps | High before claiming Java 7 support; controlled captures must preserve IDs, grouping and incomplete evidence. |
| Real Java 8/11/17 TDA captures | High for broader stable/LTS claims; older classic output must parse with missing metrics remaining unavailable. |
| Real Java 9–10, 12–16, 18–20 and 22 | Required before claiming the full major-version range; version-labelled runtime cases for both analyzers. |
| Other browsers | No Firefox/WebKit compatibility claim. Chromium is the automated baseline; test another engine before expanding browser support. |
| Other build platforms | Windows local and Linux CI evidence exist. macOS launch/package behavior is not independently verified by this review. |
| Large TLS inputs | Main-thread parsing can block the UI. Worker parsing/row virtualization is future work, not an existing guarantee. |

The [README matrix](../README.md#java-input-compatibility) is the current public
contract. Synthetic format fixtures are useful regression tests but do not
substitute for real JVM-version evidence. Full coverage-percentage targets or
additional tests that merely mirror implementation are not required to publish
the currently documented scope.

## Historical Spring dependency advisories: baseline c23fbef

An OSV batch query of 49 resolved Maven coordinates plus vendored D3 7.9.0 found
13 advisory matches in four Spring runtime components:

| Resolved component | Version | Matches / relevant boundary |
| --- | --- | --- |
| `org.apache.tomcat.embed:tomcat-embed-core` | 11.0.22 | 3 OSV matches involving authentication/access-control configurations; upstream lists further fixes. JvmScope configures no FORM/DIGEST authenticator, WebSocket endpoints, HTTP/2 or AJP connector. |
| `org.apache.logging.log4j:log4j-api` | 2.25.4 | 1 match for non-finite MapMessage JSON serialization. No such application logging path was found. |
| `tools.jackson.core:jackson-core` | 3.1.4 | 2 parser resource-exhaustion matches. No dump/log upload or JSON-deserialization controller exists. |
| `tools.jackson.core:jackson-databind` | 3.1.4 | 7 deserialization/resource matches. No external object-binding analysis API exists. |

These were confirmed **version matches**, not demonstrated exploits against the
reviewed baseline. The dependency-free runtime contains none of them. Spring
has subsequently been removed. If an old Spring binary is independently retained
or redistributed, its dependency and legal obligations still require attention.
An update of that former distribution would need real HTTP tests, frontend tests
and a fresh dependency query.
Advisory fixes include Tomcat 11.0.26, Log4j 2.25.5 and Jackson 3.1.7 within the
current release families; use actual available managed versions and retest rather
than accepting this dated table as an update instruction forever.

Sources: [Tomcat security](https://tomcat.apache.org/security-11.html),
[Log4j security](https://logging.apache.org/security.html#CVE-2026-49844),
[Jackson core advisory](https://github.com/FasterXML/jackson-core/security/advisories/GHSA-7hhh-6rmp-j9qf),
[Jackson databind advisory](https://github.com/FasterXML/jackson-databind/security/advisories/GHSA-wv8q-qhhj-9h54).
The npm/OSV checks do not scan operating-system/JDK packages or prove that every
advisory database entry is complete. The container runtime must be rebuilt for
vendor/JDK/OS updates.

## History, fixtures and documentation hygiene

All four reachable commits and 490 blobs were inventoried; 489 text blobs
(7,886,133 bytes) were scanned for key/token/credential/URL and personal-path
patterns. No live credential was identified. Two old Docker test fixtures
contain intentional fake secret strings/PEM markers; they are test input in
earlier commits, not valid private keys. Email-shaped hits in JSSE hexdumps are
random printable bytes, not contact identities. Git author metadata is public
when publishing Git history. Pattern scanning is not a guarantee of absence.

The only binary blob is the Gradle wrapper JAR. Its SHA-256 matches the official
Gradle 8.10–8.12.1 wrapper checksum family; it launches the configured Gradle
9.1.0 distribution. It is an older authentic wrapper, not a binary independently
verified as a 9.1.0 wrapper. [Official checksums](https://gradle.org/release-checksums/).
Current tracked files contain
no captures/private directories, key stores, .env files or runtime outputs.
The new repository does not carry the predecessor Git history or its operational
dumps. Controlled JSSE fixtures contain ephemeral local test-session material;
they must not be mistaken for external credentials or promoted into production.

README is now the concise product entry point and compatibility matrix. Current
guides remain in `docs`, `scripts`, `slim` and test directories, indexed from
[docs/README.md](README.md). Historical reports and roadmap files are explicitly
separated from current claims. No historically valuable report was deleted.

## System consequences and second pass for documentation preparation

The documentation changes narrow claims to actual browser execution, fixture
coverage, platforms and distributions. They do not change parser outcomes,
session formats, CSS, ports, APIs, persisted preferences or production data.
The D3/Gradle license texts are shipped as static legal assets through Vite into
both distributions and the indexed Slim JAR. Runtime legal trees are retained;
the selected application license must also accompany future packages/JARs.

The separate second pass checks source versus packaged assets, full versus Slim
paths, release claims versus real runtime fixtures, original byte hashes, HTTP
GET/HEAD and legal-notice propagation. Existing open tabs and deployed images do
not receive new documentation/assets until rebuilt/reloaded. No historical
browser storage, production data or Git history is rewritten by these changes.

The final local full/Slim Vite builds passed. The Java full build and five
Spring tests passed; the rebuilt Slim package passed **1030** real-server and
configuration assertions including the two legal assets. All 42 local links
in the five new/rewritten documents resolve with correct filename case and
anchors. The unchanged browser/parser code is covered by the green pushed CI;
the legal assets were checked at the packaging/HTTP boundary rather than
rerunning every browser scenario for a text-only addition.

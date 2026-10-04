> Historical review. The 2026-10-04 correctness and responsiveness repairs supersede the main-thread/full-table exclusions below. Current behavior and regression coverage are described in README.md.

> Historical verification record from the predecessor application. Product names and results below describe that earlier build; see the repository README for current JvmScope verification. Command paths below reflect the earlier layout; current launch, build and capture scripts live in `scripts/`.

# Java TLS log analyzer — GA review

This report preserves the 2026-10-02 release-candidate assessment. See the [2026-10-03 compatibility review](../JAVA25-27-REVIEW.md) for current Java 25–27 runtime evidence and help-guide corrections.

Reviewed locally on 2026-10-02 in the predecessor repository, including the investigation workspace. `git pull --ff-only` succeeded before inspection. No release, tag, commit or push was performed by this review.

## Assessment and scope

The desktop/laptop Chromium release candidate passes its build, parser, fixture and browser gates. No known blocking defect remains in the verified scope. This is a scoped readiness assessment, not certification of every Java provider, browser, log volume or connection-correlation pattern.

Reviewed all TLS source modules, structured explanations and their matching rules, HTML/CSS, both launch-page entries, file selection/drop/sample/Clear paths, loading/error states, latest-input coordination, filters/facets, timeline/UTC selection, sorting, inspector, modal details, copying, raw-source navigation, branding assets, test gates and bundled-resource integration. Revisited shared TDA styles/input coordination and launcher behavior. Existing staged changes were absent; existing unstaged/untracked investigation changes were preserved. Generated bundles, runtime state, logs, screenshots and test traces remain ignored and are not release source. Docker/OCI-specific domain behavior was not independently re-audited; its existing tests were rerun as part of the shared build.

## Findings fixed

| Finding | Evidence and consequence | Fix and verification |
| --- | --- | --- |
| P2 · VERIFIED_RUNTIME · HIGH confidence · MEDIUM fix risk: structured fatal alerts | An actual Java 25 required-client-auth capture cut immediately after its received `Alert` record was reported as successful after a local Finished exchange. Synthetic pre-completion alerts were unknown. The next exception had been required to recognize failure. A second-pass probe also found that the new generic sent-alert rule could hide a specific cipher diagnostic. | Parse fatal level/description only inside an actual JSSE alert payload. Preserve sender origin and more specific local certificate/cipher diagnostics in either record order. The table, failure facets, sequence and details share the result. Actual truncated-fixture replay, compact/expanded records, missing description, sent/received origin, warning alerts, post-completion alerts and hostile/unrelated bodies are covered. |
| P2 · VERIFIED_RUNTIME · HIGH confidence · MEDIUM fix risk: unreliable interaction clocks | The parser stored min/max timestamps, making backwards record order appear to be a normal timed interval; one valid timestamp could also hide missing or ambiguous clocks in other records. Period selection and observed span could imply unjustified precision. | Track reliability per interaction. Unreliable interactions stay in the unfiltered table and **Without time**, with unavailable span, but are omitted from histogram placement and selected periods. Outcomes/raw evidence stay intact. Unit/browser cases cover reversed, mixed valid/ambiguous, equal, future and independently interleaved clocks. |
| P2 · VERIFIED_STATIC · HIGH confidence · LOW fix risk: keyboard sorting | Click-only column headers prevented keyboard users from changing sort order, and exposed no current sort direction. | Native header buttons, `aria-sort`, and centralized sort-state projection. Browser tests use Enter/Space and verify resetting on another capture. Inspector panels are focusable for keyboard scrolling. |
| P3 · VERIFIED_STATIC · HIGH confidence · LOW fix risk: source lookup cost | The raw inspector searched every observed record for each rendered raw line, making source-number projection quadratic in dense single-interaction captures. | Build a linear source-number projection for the selected interaction and release it on selection/Clear. Exact source jumps and full raw records are verified across fixtures and in the browser. |
| P2 · VERIFIED_STATIC · HIGH confidence · LOW fix risk: misleading diagnostic guidance | Hostname guidance implied the certificate was otherwise valid and that modern Java rejects every CN-only certificate. Cipher guidance incorrectly excluded RSA certificates from all ECDHE configurations. Algorithm guidance asserted a fixed 2048-bit rejection threshold and implied disabled-algorithm rules apply directly to trust anchors. | Correct the three templates against the pinned OpenJDK sources. Separate name matching from trust/validity, explain DNS SAN precedence and SunJSSE CN fallback, distinguish ECDHE_RSA from ECDHE_ECDSA, and refer to the active JDK policy. Add guidance regressions and deliberately update only those three content fingerprints plus the 159-result resolver fingerprint. |

The structured alert format was checked against [OpenJDK 25 Alert.java](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/Alert.java). Logger format limits and clocks are documented in [OpenJDK SSLLogger.java](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/SSLLogger.java) and the earlier [TLS research review](TLS-REVIEW.md).

The explanation corrections were checked against OpenJDK 25's [HostnameChecker](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/util/HostnameChecker.java), [cipher-suite definitions](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/CipherSuite.java) and [security-policy configuration](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/conf/security/java.security). These statements describe SunJSSE behavior and configurable policy, not guaranteed behavior of every TLS client or JDK vendor.

## System consequences

- The input producers are the file chooser, drop and synthetic sample. All use the same parser and newest-input gate. No background worker, upload API, persistence migration, scheduled job or reconciliation path writes TLS interactions.
- Parsed interactions are finalized once, then read by the table, histogram, facets, selection reconciliation, sequence, certificate panels, details and clipboard summaries. `readTlsAlert` is shared by parser and sequence; clock quality is consumed by the common time selector, observed span, compact row clocks, details and exported summary.
- Explanation content flows through the existing resolver to inspector guidance and the issue dialog. Stable keys, IDs, matching and endpoint resolution are unchanged; failure facets and diagnostic labels depend on those unchanged keys. The text corrections do not alter parsing, stored evidence or outcomes.
- Fatal-alert recognition intentionally strengthens failure classification for truncated captures. Complete recorded captures retain their outcomes and negotiated fields; structured alerts add explicit failure evidence. Clock reliability intentionally changes time placement/span for unreliable captures. Neither fix invents handshake stages or establishes network delivery.
- Grouping remains JVM-thread/handshake-marker based. Source metadata does not merge connections. Time filters do not trim records or recompute outcomes. File order remains authoritative for the sequence, including retries/repeated messages and reversed clocks.
- Native sort controls preserve mouse behavior, numeric/text ordering and object-based selection. The copied summary retains its existing leading header/raw section and adds product identity, clock quality and observed span. Raw-copy text remains the complete selected interaction's normalized records.
- Branding changes affect TLS CSS, its SVG/favicon, page metadata/guide and the two portal cards. All 38 TDA/shared source files are unchanged. The TDA JavaScript and shared stylesheet production hashes are unchanged; a real browser regression checks its table, details and raw iframe.
- No backend API, stored schema, registry flow or shared CSS contract changes. Hashed production assets are rebuilt with their HTML. Old browser tabs must reload/reparse to receive the corrections; no previously loaded state or existing production data is automatically repaired.
- The parser handles capture text locally. Browser tests observe no network requests during file analysis, search or inspector changes; clipboard copying is the only explicit evidence export. Untrusted values are escaped in table, menus, tooltips, dialogs, sequence and raw views.
- Latest-input invalidation, loading cleanup, failed reads, unsupported input, empty intersections and delayed copy results are exercised. Malformed/ambiguous clocks affect their interaction rather than removing unrelated valid interactions. Launcher controls stop only their own authenticated supervisor/process trees.

## Completed verification

| Command/check | Result |
| --- | --- |
| `npm run build:ci` in `frontend` | Passed: 543 JavaScript tests, production Vite build, 88 Chromium browser scenarios, no skipped/expected-failure tests or retries in the final run. |
| `gradlew.bat test -x npmInstall -x npmBuild` | Passed: 34 backend tests, using existing dependencies and the separately built frontend. |
| Runtime fixtures | 38 real captures covering the recorded Java 8, 11, 17, 21, 23, 24 and 25 runtimes, plus synthetic/edge inputs and an actual truncated Java 25 fatal alert. Exact runtime/vendor coverage is in [the test README](README.md). |
| Complete-capture comparison with HEAD | 43 inputs, including a 72-interaction real capture, retain all existing outcome, grouping, negotiated, certificate, timing and raw-record fields. The intended difference is one added structured-alert evidence item in 16 interactions; new source/clock metadata is additional. |
| Desktop/laptop integration | 1440×900 and 1366×768; selection, all three views, timeline/UTC overlap, facets, empty/error states, keyboard dialogs/tabs/sorting, clipboard fallback/stale results, escaping, source navigation, branding and portal links. |
| Dense capture | 2,000 interactions / 6,000 records load, remain searchable, retain selected raw evidence and clear correctly on both viewport sizes. This is an exercised workload, not a maximum-size guarantee. |
| TDA compatibility | Actual 67-thread, three-snapshot capture; existing 50-row pagination, BLOCKED filter, four details tabs, raw iframe/stylesheet, snapshot navigation and Clear pass on both viewport sizes. |
| Launcher lifecycle: `node scripts/local-dev.integration.mjs` | Four cases pass: cancellation cleanup, invalid JAVA_HOME, concurrent/ANSI starts sharing one supervisor/backend/frontend, and final stop releasing fixed ports. |
| Actual investigation capture | 72 interactions (32 success / 40 failure) exercised at 1440×900, 1366×768 and 2547×1365, including exact source jumps, complete raw evidence and full-width desktop layout. |
| Final local restart | `stop.ps1` / `start.ps1` completed. The supervisor reports both services ready, backend health is UP, and ports 23871/23872 both serve the rebuilt Java TLS log analyzer page with HTTP 200. |

One intermediate TDA test incorrectly equated visible DOM rows with the total thread count. Its assertion was corrected to verify the actual 50-row pagination and 67-thread total. The final full gate passes without retry.

## Adversarial second pass and remaining limits

Rechecked null/empty/unsupported input; truncated structured bodies and absent alert descriptions; payload-like certificate text and unrelated lines after a closed message; warning versus fatal origin; diagnostics after completion; repeated messages/retries; reversed/equal/future/ambiguous clocks; independent thread interleaving; stale file reads/copy completions; filter removal/empty selection; object identity across capture replacement; and dense-capture source navigation. The new cases exercise real parser/UI paths rather than separate mock implementations.

- Parsing and full-table rendering still run on the main thread. Worker parsing, row virtualization and a guaranteed upper file/interaction limit are intentionally excluded. Very large captures can pause the browser; the tested workload does not certify hundreds of MB or millions of records.
- Formal browser coverage is Chromium desktop/laptop. Firefox, Safari, mobile and narrow embedded side panels are outside this release candidate's verification scope.
- SunJSSE text is not a stable protocol. Custom logging wrappers, combined JVM/process captures, DTLS and other providers are not certified. Thread migration/shared SSLEngine event loops cannot reliably establish connection identity from thread IDs alone. Ambiguous legacy streams remain unknown.
- General explanations are hypotheses/checks, not proven root causes; the tool does not validate certificates against live trust stores or certify remote/application health.
- `build:ci` supplies the local release gate. This repository currently has no checked-in GitHub Actions release workflow. Publishing/versioning/tagging remains a separate release action.

No percentage coverage claim is made: verification is based on important behavior, fixture expectations and real browser/integration boundaries.

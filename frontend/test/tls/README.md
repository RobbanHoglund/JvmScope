# TLS verification and refactoring baseline

The browser imports `analyzeTlsLog` from `assets/javautils/tls-parser.js`. Unit and integration tests import that same implementation and the same certificate display helpers. File-ordering tests use a minimal DOM adapter; the Playwright suite exercises the actual built HTML, JavaScript and CSS in Chromium.

The product is **JvmScope · Java TLS Log Analyzer**. Its SVG mark, favicon and teal accents are scoped to TLS; the two utility landing pages use the same identity. The [GA review](GA-REVIEW.md) records the verified release scope, system consequences and remaining limits.

## Automatic build gate

- `npm run test:tls:unit`: parsing, state transitions, timestamps, explanatory text and display regressions.
- `npm run test:tls:integration`: reads all 70 runtime samples and synthetic edge-case files from disk, and also parses the UI demonstration.
- `npm run test:tls`: both suites.
- `npm run test:tls:ui`: builds the production bundle and runs browser tests at desktop and laptop viewport sizes.
- `npm run test:tls:all`: unit, integration and browser suites.
- `npm test`, every `npm run build` entrypoint and root `scripts/gradlew build`: include both suites automatically. The root build delegates to `slim`, where `prepareAssets → npmBuild → npm run build:slim → npm test` gates the sole Java package.
- `npm run build:ci`: additionally requires the browser suite. Normal builds and local start do not require a browser installation.

## Browser setup and scope

From `frontend`, install the locked dependencies and Chromium once:

```bash
npm ci
npx playwright install chromium
npm run test:tls:all
```

Linux CI may need `npx playwright install --with-deps chromium` to install the browser's OS dependencies. See [Playwright browser setup](https://playwright.dev/docs/browsers).

The suite serves the production bundle on an ephemeral loopback port and shuts down its own server and browser. It does not reuse the user's application or occupy its fixed port 23873. Preview tests need no Java server; packaged tests use an isolated linked Java server. Neither contacts a TLS service. Traces and screenshots on failure are kept under `.run/tls-ui/` and are ignored by Git.

Browser coverage includes combined search/outcome/warning/direction filters, sort order with equal and unknown times, file chooser and drop, actual captured logs, details, alert-origin explanations, raw/summary copying, HTML escaping, incomplete capture, later transport errors, keyboard dialogs and tooltip bounds. Each flow runs in a fresh browser context at desktop (1440 × 900) and laptop (1366 × 768) sizes. These are the application's target platforms; mobile layouts are outside scope.

GA cases also cover keyboard sorting with `aria-sort`, product identity, structured fatal alerts without a following exception, clock reliability, a dense 2,000-interaction capture, and the absence of network requests when investigating an uploaded file. Separate TDA regressions load real dumps, filter the paginated table, check the Overview/Locks/History sidebar alongside the central thread block, and exercise the raw-evidence browser tab.

## Capture analysis and selection contract

**Investigate** is the default desktop workspace: a compact start histogram, an interaction list showing diagnostic reasons and observed spans, and a persistent inspector. **Overview** and **All columns** retain the table projections. Exact UTC fields are available in a keyboard-accessible menu in Investigate and remain visible in table modes. Row selection survives sorting and view changes; removing its interaction with a filter clears the inspector. A new capture selects its first visible interaction and never reuses a selection solely because its numeric ID matches a previous capture.

`tls-sequence-model.js` projects only observed JSSE messages, alerts and diagnostic occurrences in file order. It preserves repeats and HelloRetryRequest, does not synthesize missing stages, and does not reinterpret Produced/Consuming as confirmed network delivery. Fatal alerts after the Finished exchange remain failures; later transport errors keep their separate classification. Ambiguous legacy groups have raw evidence but no inferred single-connection sequence. Source metadata in the parser points to physical file lines, including expanded headers and interleaved thread records. It does not change grouping, outcomes, negotiated parameters or existing raw records. Raw evidence renders on demand and is never clipped to the selected period.

The inspector separates observed facts from general explanations, has keyboard-navigable Sequence/Certificates/Raw log tabs, links events to highlighted source lines, and retains Full details. Browser tests cover selection, filtering, view transitions, source navigation, full raw copying, fallback failure and stale asynchronous copy results. Unit tests cover repeats, reversed clocks, absent clocks, ambiguous grouping, post-completion rejection, capture identity and source spans across all 70 runtime fixtures. Shared TDA styles and code are outside this change.

`tls-analysis-model.js` supplies one presentation selector for the table, selection counters, timeline and facets. The entire capture is parsed first. A time filter never truncates an interaction's raw records or changes its outcome. Periods use UTC milliseconds and `[From, To)` bounds; interactions overlap when their first record is before To and their last observed record is at or after From. Missing, ambiguous or reversed timestamps stay in the default table, are omitted from the histogram and can be selected using **Without time**. They are excluded from a selected period with an explicit count.

The histogram counts interaction **starts**, once per interaction, colored by its complete outcome. It does not count physical lines, handshake messages, highlights or concurrent active interactions. Long interactions may overlap the selected period despite starting outside the chart's current viewport; the note distinguishes rows shown from starts in view. Faint bars supply context before the time filter. Zoom, pan and Full range change only the chart viewport; Apply period, dragging/clicking the chart and Clear period change selection. UTC fields are the keyboard alternative to pointer selection.

Timeline captions and unavailable-time messages are HTML text outside the SVG, so resizing the graph does not stretch or clip them. Host, SNI and failure categories use searchable menus rather than a horizontal category strip. Menu selection keeps keyboard focus and the menu open while its contents are rendered again; Escape closes it and restores focus to the summary. Text selection is disabled only on controls and headings, leaving raw evidence selectable.

The **Overview** mode omits TID, certificate authorities, client certificate, cipher suite and thread count columns, keeping start, duration and warnings visible on desktop/laptop. **All columns** exposes the full existing table. This is a presentation choice: switching views keeps the selected interactions, their order and complete Details unchanged. Column choice lasts for the page session, including subsequent loads and Clear; it is not a data filter. The page uses the full window width with 28 CSS pixels of margin on each side. Regression checks cover desktop/laptop sizes and the reported 2547-pixel-wide window.

Host and SNI values are combined with OR within each facet and AND across different filters. Host uses the existing parser's peer name or outbound SNI fallback, without inferring a certificate CN or an inbound SNI as a remote peer. Unknown values are explicit choices. Failure categories use the existing explanation resolver and count failed interactions; a category is an observed diagnostic, not proof of a root cause. Facet counts apply every filter except their own facet, retain zero-count alternatives and support recovery through removable active chips or Clear filters.

Loading another capture clears dataset-specific host, SNI, failure and time filters and resets zoom. Existing generic search, outcome, warning and direction controls retain their prior loading behavior. Clear removes the capture and every filter. Parsed time records the load rather than each subsequent filter operation. Analysis can collapse to give the table more space on a laptop.

The analysis tests cover overlap boundaries, equal times, missing clocks, case-insensitive multi-value facets, failure/highlight distinctions, invalid periods, draft UTC fields, pointer selection, zoom/pan, keyboard focus and all 70 real Java captures. They also verify that obsolete file reads cannot overwrite analysis views. TLS parsing and search-index preparation run in a disposable browser worker. Clear and replacement inputs terminate pending jobs; failed/stale results retain the current capture. Tables display 200 rows per page while filters, timeline and inspector navigation use the complete capture. Unit and browser tests cover contradictory grouping, incomplete capture observations, worker cancellation and pagination; large inputs still depend on browser memory.

TLS presentation uses the `.tls-page` scope in `assets/javautils/tls.css`; the shared `styles.css` and TDA sources remain unchanged. File actions, filters and status occupy separate header rows. Search sits beside Refresh in the table card. The table scrolls within its own region, keeping row actions visible; a new capture and Clear reset both scroll axes. Help opens a separate native dialog with the existing capture guidance. Layout tests cover long filenames, contained horizontal scrolling, reachable row actions and dialog footers, keyboard filters, all guide close paths with focus restoration, and distinct empty/filtered/unsupported states.

The issue dialog is named for assistive technology and updates `aria-hidden` through every open/close path, including Escape. Clipboard regression tests inspect the actual OS clipboard when the modern API rejects or is absent: both raw and summary copying select their fallback textarea inside the native modal. Additional tests require cleanup, truthful failure feedback and retry when legacy copying returns false or throws, await modern writes before success feedback, and prevent delayed results from changing another interaction's controls. These scenarios must pass normally; no expected-failure annotations remain. Sorting unknown start times first in descending order is preserved as current behavior.

## Explanation content contract

`assets/javautils/tls-issue-catalog.js` owns the 31 authored explanations with stable IDs and ordered sections. Each section has a stable ID, an existing heading and either `paragraphs` or `bullets`. Content is plain text; endpoint placeholders are resolved by `tls-explanations.js`. The local-fatal fallback text also lives in the catalogue module.

`tls-explanations.js` keeps the matching tiers, normalization, endpoint resolution and the existing `ISSUE_EXPLANATIONS`/`explainIssueText` exports. It projects structured sections into the existing newline-delimited format. File loading, drop, demonstration, filters, table, details and copied summaries retain their existing paths; no parser, API, shared CSS or persisted data is changed by extraction. The unmatched-issue UI hint now directs users to Details instead of referring to the old catalogue implementation location.

`catalog.test.js` checks catalogue identities/section completeness and uses `fixtures/explanation-contract.json` to verify all complete templates and 159 resolver results. The baseline was captured before extraction; three explanation templates were deliberately corrected during the [GA review](GA-REVIEW.md), covering hostname validity/SAN precedence, RSA/ECDHE authentication and configurable algorithm constraints. Content and matching changes must deliberately update this contract after reviewing the changed output; it should not be regenerated merely to silence a failed refactor test.

The integration catalog enumerates expected runtime filenames and fails on missing or untested additions. Tests assert outcome, protocol, selected cipher, direction, SNI/peer semantics, client certificates, requested CAs, time availability, raw text and repeated handshakes. CI needs Node and the regular project JDK; it does not need the other historical JVMs or a live TLS service.

## Runtime samples

Captured on Windows x64: Java 8–25 on 2026-09-08, Java 26/27 on 2026-10-03. These are complete console streams from controlled loopback processes, not logs from an application or production service.

| Filename prefix | Actual runtime | Scenarios, both client and server |
| --- | --- | --- |
| `jdk8u252` | AdoptOpenJDK 8u252-b09 | Legacy TLS 1.0, 1.1, 1.2 success; mutual TLS; required client authentication failure |
| `jdk8u504` | Temurin 8u504-b01 | Compact TLS 1.3 success |
| `jdk11` | Temurin 11.0.32.1+1 | Compact TLS 1.3 success |
| `jdk17` | Temurin 17.0.20.1+1 | Compact TLS 1.3 success |
| `jdk21` | Corretto 21.0.8+9 | Compact TLS 1.3 success |
| `jdk23` | Temurin 23.0.2+7 | Compact TLS 1.3 success |
| `jdk24` | Temurin 24.0.2+12 | Compact TLS 1.3 success |
| `jdk25` | Corretto 25.0.3+9 | TLS 1.2/1.3 success; TLS 1.2 resumption; optional/required client authentication; mutual TLS; empty truststore failure; expanded TLS 1.3 output |
| `jdk26` | OpenJDK 26.0.2.1+1-7 | Same eight scenarios as Java 25, both endpoints |
| `jdk27` | OpenJDK 27+35-2325 GA | Same eight scenarios; default TLS 1.3 X25519MLKEM768 hybrid key exchange |

`truncated-server-finished.txt` is the JDK 25 client success capture cut immediately after its received server Finished message. `interleaved-legacy.txt` is a deliberately ambiguous synthetic stream. The 35-case browser demonstration is synthetic; it is not evidence of runtime-version coverage.

`local-algorithm-constraints.txt` is a synthetic minimal JSSE diagnostic, with invented timestamp, thread ID and source line. It exercises the parser-to-explanation boundary when `UNSUPPORTED_CERTIFICATE` encloses an algorithm-policy failure. The combination follows OpenJDK 25's [algorithm checker](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/provider/certpath/AlgorithmChecker.java) and [certificate alert mapping](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/CertificateMessage.java); it does not add runtime-version coverage. The Java 8 required-client-auth server capture also verifies that `bad_certificate` can mean a missing client certificate (`null cert chain`), as in [OpenJDK 8's server handshaker](https://github.com/openjdk/jdk8u/blob/jdk8u252-b09/jdk/src/share/classes/sun/security/ssl/ServerHandshaker.java), rather than proving certificate corruption.

To regenerate a pair deliberately:

```powershell
node scripts/capture-tls-samples.mjs "C:\path\to\jdk25" "C:\path\to\runtime" jdk25 frontend/test/tls/fixtures/runtime TLSv1.3 success
```

Arguments after the directory are protocol, scenario and optional `expand`. Scenarios: `success`, `mutual`, `optional-client-auth`, `required-client-auth`, `untrusted`, `resumption`. The generator compiles `TlsRegressionSample.java` with `--release 8`, generates an ephemeral self-signed fixture key store, binds only to loopback and records each endpoint separately. Standard output and error share a file descriptor: older Java writes debug information to both streams, so concatenating them afterwards would corrupt ordering. Only the helper's `RESULT=` lines are removed; JVM text, public certificate data, transient cryptographic diagnostics, timestamps and IDs remain unchanged. Temporary key stores and compiled classes are deleted. No keystore/private-key file is checked in.

The historical portable runtimes were downloaded from AdoptOpenJDK/Adoptium and SHA-256 verified before running. Recorded archive hashes:

| Runtime archive | SHA-256 |
| --- | --- |
| OpenJDK8U-jre_x64_windows_hotspot_8u252b09.zip | `55f79e116cff39eba0daffa3c9a10048ce95efa7e0ae3a919abdcdda74d48ac2` |
| OpenJDK8U-jre_x64_windows_hotspot_8u504b01.zip | `82e2cdc6693737c5998445b31f69668fa0da77c7705121053f6508ac84961123` |
| Temurin 11.0.32.1+1 JRE, Windows x64 | `f8c7da672f5dba36b6f870608820b6b598cfae91296929f1b8f21ef2f1e8a0dd` |
| Temurin 17.0.20.1+1 JRE, Windows x64 | `bc21a93923103cdaac93ee337b0ae4365e739fde36df823dd456bc67c8a9d352` |
| OpenJDK 26.0.2.1+1-7 JDK, Windows x64 | `0c3a8a30993de864937e6bced5270edc39c80c584cfd359ac222638c42758f1c` |
| OpenJDK 27+35-2325 JDK, Windows x64 | `41172837168dd25a8d9fe5eb253ac1efc568c5f9ff608144bcacadfdf50f876c` |

## Support boundaries

The target is SunJSSE console format families used across Java 8–27, including legacy text, compact SSLLogger output and `expand`. The table records actual runtime coverage; Java 9, 10, 12–16, 18–20 and 22 have not been run here. Vendor patches, custom System.Logger formatting, application log wrappers, mixed JVM/process captures, DTLS, Netty/OpenSSL and other TLS providers are not certified by these fixtures.

JSSE thread IDs are not connection IDs. Thread migration with SSLEngine, several engines on one event-loop thread, and interleaved legacy bodies cannot reliably reconstruct connections without extra context. Grouping remains thread based; unsupported input gets explicit feedback and recognized ambiguous legacy streams suppress conclusions. Keep endpoint/process captures separate. A gap does not prove a new connection; HelloRetryRequest keeps the second ClientHello in the current interaction.

Success denotes an observed local Finished exchange or explicit completion, not a guarantee of remote acceptance, socket health, or application success. Later fatal alerts remain failures; later transport errors are retained separately. Record headers and client offers do not select a TLS version or cipher. Missing or ambiguous times remain unavailable, and duration is the observed log span, including closure. SNI identifies a requested virtual host; a certificate CN is not a network endpoint. Certificate and CA lists distinguish observed empty lists from missing or truncated information. Logs already loaded in an old browser tab must be reloaded/reparsed to receive the corrections.

Structured JSSE `Alert` bodies with an explicit fatal level now establish failure even if the following exception is absent, including rejection after a local Finished exchange. Warning alerts and payload-like certificate data do not. The parser records clock quality per interaction: missing/ambiguous record clocks or clocks moving backwards make its observed span unavailable and remove it from histogram/period placement, while preserving its outcome and complete evidence. Equal clocks and independently interleaved threads remain supported. These are intentional GA correctness changes, rather than presentation-only refactoring.

Research and verified findings: [original TLS review](TLS-REVIEW.md) and [Java 25–27 help and compatibility review](../JAVA25-27-REVIEW.md). The older review and GA report are dated snapshots; current runtime coverage is recorded here.

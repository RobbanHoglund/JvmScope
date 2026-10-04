# JvmScope · Java Thread Dump Analyzer tests

`npm run test:tda` runs both the unit tests and sample-file integration tests with Node's built-in test runner. The tests import only modules under `assets/javautils/tda/`; they do not require a DOM, D3, a browser, or network access.

The analysis runs in a disposable browser worker. Clear and replacement inputs terminate the previous worker; failed or stale jobs cannot overwrite the current capture. Node tests exercise the actual worker entry and structured-clone boundary, including shared thread/lock references. Large captures remain subject to the available browser memory.

TDA defaults to **Add to session** for file selection, drop, Paste and Ctrl+V. Several files can be selected/dropped together. Each source is parsed independently (including mixed text/JSON and headerless input), then assigned global snapshot/source keys before the shared history, metrics and graph pipeline runs. Snapshot order is submission order and source-local order, without inferred timestamps. Identical inputs are kept as separate observations. Known process changes still separate histories. Source labels are shown in snapshot navigation and raw evidence.

Additions are serialized rather than replacing a running addition; file/clipboard reads start when submitted. Clear and Replace invalidate queued work and cancel the worker. Replace and Sample start a new session only after a usable source is validated. Malformed/unreadable batch items are excluded without blocking valid items. A failed addition or replacement keeps the current session and raw tab; a successful commit invalidates old evidence/detail projections. CPU profile changes reanalyze the entire session and commit the profile only after success. The session is held in browser memory and is lost on reload; nothing is uploaded or persisted. Analysis currently reparses accumulated sources when adding snapshots, so large sessions incur additional client CPU and peak memory.

`session.test.js` checks physical-source equivalence, global identities, JSON carrier/graph relationships, partial/malformed/null items, equal/reversed/missing/future timestamps, duplicate inputs, process separation and queue cancellation. The real worker test covers the multi-source structured-clone boundary. `tda-session.spec.js` exercises all input paths, timeline/history, multi-file batches, source provenance, rapid pastes, delayed reads, Clear, transactional replacement and failure recovery on desktop/laptop in the frontend preview and packaged application.

`npm run test:tda:ui` exercises the built frontend preview's TDA flows. The shared browser suites cover desktop (1440×900) and laptop (1366×768), worker responsiveness/cancellation/recovery, partial cluster counts, CPU profiles/timeline navigation, JSON and untrusted input, clipboard/drop, dependency map/PNG export, and the raw evidence workspace. The same cases run against the packaged Java server with `npm run test:slim:ui`. Build the corresponding distribution before running its browser suite.

Raw dump opens a separate browser tab and reuses it for the selected snapshot. Its thread details and graph links lead back to the analyzer; the graph provides a return-to-evidence button. Changing snapshot, replacing the capture, clearing it or unloading the analyzer closes its evidence tab. Navigating the evidence tab elsewhere releases it without closing the user's destination. Raw text stays in browser memory; only display preferences enter local storage. Browser tests cover these transitions, blocked-tab recovery, literal untrusted text, search, filters, source lines and clipboard operations finishing after tab close/navigation.

Thread details display information in a left sidebar (Overview, Locks and History) and a readable Stack in the central panel. Classic dumps retain their reported header and annotations; text/JSON file dumps show the actual identity, available state and parsed stack/lock observations, without the parser's internal placeholder header or invented counters. Original / Original JSON displays the source block with its whitespace. Both panels scroll independently and the dump stays visible when changing information tabs. Copying always preserves the entire original block regardless of the selected presentation. Browser tests cover actual JVM text/JSON captures, classic dumps, missing counters, class-initialization evidence, untrusted text, keyboard navigation and entry from the raw-evidence tab.

The dialog identifies the selected snapshot, source and qualified timestamp. CPU deltas show their adjacent comparison and the actual interval basis; rounding is presentation-only. An unmatched diagnostic rule does not imply a healthy thread. Identity/status, measurements and assessment evidence are displayed once in their respective sections.

Stack colors distinguish headers, states, locks, JVM frames, common library packages and other frames. Package hints are incomplete navigation heuristics, not verified application ownership or diagnostic classifications. Colors can be disabled and apply only to Stack; Original uses neutral text. Literal, case-insensitive search highlights up to 1000 matches without changing source text; Enter/Shift+Enter navigate, Ctrl+F focuses the search, and Escape first clears an active query. Changing presentation retains the query and recalculates matches, while each view remembers its scroll position when no search match takes priority. Reopening Details resets to Stack with an empty query and colors enabled. Tests verify Unicode/regex-like queries, bounded matches, hostile/minified evidence, exact copying during search and in either view, independent scrolling, and desktop/laptop layouts. Styles are scoped to the TDA dialog.

Clicking a thread row opens its Details view; focused rows also accept Enter or Space, and closing restores focus to the row or Details button used. Text selection and nested controls retain their behavior. Browser checks cover row activation after sorting, filtering, paging and snapshot changes, including threads with identical names.

`.github/workflows/analyzer-tests.yml` automatically checks all Node tests, frontend preview checks, real Java HTTP-server checks and packaged application browser checks. Railway deploys independently; making this GitHub check required for merges is a repository setting.

Recurring RUNNABLE clusters are paged in groups of 25, and detailed stack groups load when opened. Incomplete snapshots show lower-bound counts (`≥N`, or `?` when none were observed), and their trends are unavailable. Changes in process or collection coverage also suppress trends. Growing/persistent filters exclude unavailable trends.

Input feedback uses a native modal: rejected/empty/unreadable dumps produce an
error, partly accepted batches produce a warning, an empty clipboard produces an
information message and denied clipboard access produces a warning. Dialogs name
the affected source, explain recovery and report what was loaded or preserved.
Only newly submitted sources trigger warnings; an old partial capture does not
reopen its warning on every valid addition. Text is rendered literally. Header,
footer, backdrop and Escape closing restore focus; Choose dumps opens the file
chooser. Clear/Replace invalidate pending reads and prevent stale dialogs.
The same feedback paths cover file selection, drops, Paste, Ctrl+V and worker
failures; inline statuses remain available. Browser coverage exercises these
paths and preserves existing sessions/raw tabs on rejected replacements.

## Automatic build integration

All 21 runtime captures and the synthetic incomplete-snapshot examples are read from disk and parsed automatically by `integration/sample-files.test.js`. This is a build gate, not a manual validation procedure. Missing files, incorrect results, or a runtime sample without explicit test expectations fail the suite.

- `npm run test:tda:integration`: run the sample-file integration suite alone.
- `npm run test:tda`: run unit and integration tests.
- `npm test`: run all frontend tests, including the integration suite.
- `npm run build`, `build:ci`, and `build:all`: run all tests before Vite; any failure stops the build.
- Root `scripts/gradlew build` delegates to the dependency-free `slim` project. Its `npmBuild` calls `npm run build:slim`, including the same Node unit/integration gate before packaging. The standalone `-p slim assembleSlim` command uses that same path.

No sample generation or JDK 21–27 installation is needed in CI. The generator below is only for maintainers deliberately updating the checked-in reference files.

Fixtures are deliberately small and contain no production data. Top-level fixtures are synthetic format/edge-case examples. `fixtures/runtime/` contains controlled JVM captures, described below.

## Format coverage

| Samples | Provenance | Covered behavior |
| --- | --- | --- |
| `hotspot-jdk8-classic.txt` | Synthetic | Classic headers without CPU/elapsed/allocation counters |
| `hotspot-jdk17-standard.txt`, `hotspot-jdk25-relaxed.txt` | Synthetic parser variants, not runtime certification | Header fields and units |
| `runtime/jdk21-*` | Amazon Corretto 21.0.8+9, Windows x64 | Thread.print, older file text and JSON |
| `runtime/jdk23-*` | Eclipse Temurin 23.0.2+7, Windows x64 | Thread.print, older file text and JSON |
| `runtime/jdk24-*` | Eclipse Temurin 24.0.2+12, Windows x64 | Thread.print, older file text and JSON |
| `runtime/jdk25-*` | Amazon Corretto 25.0.3+9, Windows x64 | Thread.print, file text/JSON with states and monitors |
| `runtime/jdk26-*` | OpenJDK 26.0.2.1+1-7, Windows x64 | Classic/text/JSON, including reported parking owners |
| `runtime/jdk27-*` | OpenJDK 27+35-2325 GA, Windows x64 | Classic/text, default JSON v2, compatibility JSON v1 and numeric carrier IDs |
| `truncated-final-snapshot.txt`, `partial-thread-snapshot.txt` | Synthetic | Empty/partly excluded snapshots, reliable arrival/departure suppression |

`integration/sample-files.test.js` replays all 21 runtime samples through parsing, identities, metrics, lock analysis, change analysis, dependency graph and raw-source mapping. It also checks carrier filtering, virtual thread details and unknown lock counts. `format-regressions.test.js` covers duplicate names, large IDs, escaped JSON names, reordered/minified JSON, malformed records, eliminated monitors, missing values and genuine zero values. `carrier-regressions.test.js` covers mounted/unmounted threads, duplicate/missing/invalid carrier references and multiple observations on the same carrier. These are ordinary Node tests and need no installed JVM in CI.

### Recreating controlled runtime samples

From the repository root, with a JDK 21 or newer:

```powershell
node scripts/capture-parser-samples.mjs "C:\path\to\jdk" frontend/test/tda/fixtures/runtime
```

The script launches `FormatRegressionSample.java` with `-Xint`, waits for its known monitor/virtual-thread states, and attaches `jcmd` only to that child process. It captures `Thread.print -e -l` and `Thread.dump_to_file -format=plain|json`. It retains only `sample-*` threads. JSON is pretty-printed, unused containers are removed, and container counts are adjusted to the retained excerpts; the irrelevant classic JNI-reference count is normalized to zero. JVM-generated timestamps, IDs, stack frames and monitor identities remain in the samples. The child and temporary dump files are cleaned up. Production/workspace dumps must never be passed to this script.

With JDK 25 or newer, append `--mounted` to capture `jdk<version>-mounted-virtual.json`: a controlled virtual thread spinning in `Thread.onSpinWait()` and its JVM-reported carrier. That mode retains both records, including the carrier's original pool name. Checked-in captures use Amazon Corretto 25.0.3+9 and OpenJDK 27+35-2325. Carrier relations are observations at each virtual thread's capture time; several observations can reference the same carrier without proving simultaneous mounts. Missing or ambiguous carrier IDs create no graph edge, and real virtual threads never get duplicate synthetic graph nodes.

### Support boundaries

The target is HotSpot formats, including the Java 8–27 classic header family and Java 21–27 file dumps. OpenJ9 javacores, mixed native stacks, and arbitrary log wrappers are not covered. Java 8–20 and 22 have not all been exercised on actual JVMs here; synthetic fixtures do not certify every release/vendor/platform. See [JDK 26/27 format verification](JDK26-27-REVIEW.md) for source comparisons and [the Java 25–27 help and compatibility review](../JAVA25-27-REVIEW.md) for current verification of both analyzers.

Java 21–24 file dumps omit states, locks and CPU counters; their JSON also omits the virtual-thread flag. Those values remain unknown. Java 25 file dumps supply per-thread states/monitor observations, but still no CPU counters. File dumps are collected per thread rather than as an atomic lock snapshot; graph dependencies remain observations, not JVM-confirmed deadlocks. The file-dump object identity strings are not interchangeable with classic monitor addresses. A single JSON document is supported per input; text inputs can contain concatenated snapshots, including mixed classic/file-text captures. Different process IDs or collection scopes do not establish thread births/deaths. Incomplete snapshots suppress absence-based conclusions and lock transitions. Truncation that leaves no detectable structural damage cannot always be recognized.

`malicious-html-content.txt` contains inert HTML-like strings solely to verify that thread names, stack frames, lock types, file names, and diagnostic previews are rendered as literal text.

JDK 26+ parking lines and JSON blockers may report an owner thread ID. It is retained and displayed in Locks as a report at the waiting thread's observation time. It does not manufacture held-lock counters, confirmed ownership transitions or graph edges where no held resource was observed. JDK 27 JSON v2 numeric IDs and v1 string IDs are supported; unsafe numeric IDs remain invalid, and IDs outside JavaScript's safe integer range must be strings. A missing process ID cannot bridge two different known JVM processes into one thread history.

`cross-snapshot-identity.txt` uses repeated and replacement worker identities to verify conservative series correlation without name- or stack-based guesses.

`cpu-precision-sequence.txt` contains two complete real Corretto 25 dumps from
the controlled `CpuPrecisionProbe.java.source` program. The adjacent JVM wall
clocks differ by one second, while the same thread's elapsed counter advances
1.66 seconds. `cpu-precision-provenance.json` records source/capture hashes and
the capture command. `interval-resolution.test.js` verifies the corrected rate,
collector/JVM clock separation, conflicting intervals and conservative diagnostics.
Coarse estimates are labelled; they cannot establish CPU/allocation heat.

Manual validation may use the workspace-level `threaddumps` folder, but its contents must not be copied into this repository or used as committed fixtures.

# Garbage Collection Log Analyzer

Open **Garbage collection** from JvmScope's tool navigation, or run **JvmScope:
Open Java Garbage Collection Log Analyzer** in VS Code. The VS Code sidebar,
editor title and file context menu also expose GC analysis.

Drop one UTF-8 `.log`/`.txt` file, choose **Open GC log**, or **Load sample**.
Select a different real collector example next to Load sample. Parsing runs in a
cancelable local worker; no log is uploaded. GC analysis does not invoke AI.

## Reading the view

- **Summary:** describes all analyzed records in the selected JVM segment, even
  when the chart is zoomed. Pause-budget results and memory-pressure indicators
  remain separate; a short pause is not proof of healthy memory behavior. Expand
  the summary for interpretation notes. Metrics always cover the whole segment;
  the timeline heading identifies the currently visible interval and event count.
- **Heap:** dots mark recorded total-heap bytes before/after collections. Dashed
  links between collections are visual guides, not continuous measurements. Reported capacity is not
  necessarily `-Xmx`; ZGC percentages are not converted to an invented capacity.
- **Pauses:** completed stop-the-world phases. Max and nearest-rank p95 use these
  durations only. The graph auto-scales independently of the pause budget.
  Pause bars retain their own color; separate diamonds show review severity.
- **Concurrent work / cycles and stalls:** separate from stop-the-world pauses.
  An allocation stall affects the allocating thread; it is not a global pause.
- **Tooltips:** hover or focus an event for time, duration, heap values and
  review reasons. Escape dismisses the tooltip; click or Enter opens the
  event inspector. Log evidence is expandable and remains copyable.
- **Annotations:** numbered source-backed review points. Nearby annotations
  share a labelled findings badge. Click or Enter opens details immediately;
  for a cluster, switch between its findings inside the detail panel. Click a
  numbered chart marker, a review diamond, a list entry or an event
  to see its duration, heap values, rule explanation and exact physical log lines.
  In VS Code, imported sources can be opened at those lines, with existing stale
  source protection. Samples and dropped browser files have copyable evidence.
- **Time overview / Zoom to event / Full range:** inspect a region without discarding
  the capture. Event zoom frames nearby events using their actual spacing;
  large gaps are not compressed on the time axis. The searchable, paginated
  event table retains all parsed events.
  The chart uses bounded representative marks for dense logs. The small pause
  overview always covers the entire segment. Drag its handles to resize the
  interval or drag the selected window to move it; the controls also support
  keyboard navigation. Left/right arrows move the focused window, Home/End move
  it to a boundary. Hide details expands the timeline; selecting a chart event
  reopens the inspector.
- **View all findings:** opens a paginated list of every finding in the selected
  segment, including standalone JVM signals. The three chart annotations are
  a compact selection, not the complete list. Signal descriptions explain the
  recorded cause; expand Original JVM message to inspect the unchanged evidence.

The initial pause budget is **200 ms**, a user-changeable review threshold, not a
JVM correctness rule. High occupancy (at least 90% of recorded capacity), full or
degenerated collections and explicit collector-pressure signals are explained
separately. Explicit `System.gc()` full collections are informational. Ordinary
`Allocation Failure` triggers do not imply OOM or a memory leak.

Observed pause share is the union of timed pause intervals divided by the
first-to-last observed event window. It is **not** GC CPU, whole-JVM uptime,
application throughput, all safepoints, or request latency. A short capture may
give an unrepresentative p95/share. Missing values remain unknown.

## Compatibility and limits

Sun/OpenJDK **HotSpot**: legacy Java 8 and unified Java 9–27 logging. Tested
collector families: Serial, Parallel, G1, historical CMS, ZGC and Shenandoah.
Availability varies by release/build. OpenJ9/IBM formats are not supported.
GC log text is implementation output, not a format defined by the Java language
specification. Consult the in-app **GC guide** for capture recipes and sources.

One file up to 64 MiB and 200,000 parsed events. Reaching the event limit produces
a partial-analysis warning. Incomplete/interleaved legacy records without a
reliable duration are skipped with a coverage warning. Missing timestamps keep
events in the table but not on the timeline. Java version is shown only when
present in recorded metadata. Restart/startup evidence separates JVM segments;
arbitrary concatenated files without such evidence cannot reliably be separated.
Rotation gaps and missing log lines cannot be reconstructed.

## Multi-day captures

Elapsed time is not limited to one day. Uptime labels include days and wall-clock
evidence retains the UTC calendar date. The existing 64 MiB / 200,000-event
limits still apply; exceeding the event count produces partial results.
Rotated files must be ordered and combined externally, within the input limit.
A synthetic three-day, 100,000-event regression tests scale and late findings;
it is not a production benchmark or a real multi-day JVM capture.

## Reproducible verification

`testdata/gc-logs/` contains actual isolated JVM workload captures for every major
release 8–27, with exact builds, launch arguments, hashes and independent MXBean
observations. Seven examples remain plain `.log`; other regression fixtures are
losslessly gzip-compressed. Tests verify hashes of decompressed original bytes.

```sh
npm ci --prefix frontend
npm run test:gc --prefix frontend
npm run build --prefix extensions/vscode
frontend/node_modules/.bin/playwright test --config extensions/vscode/test/playwright.config.mjs --grep 'GC '
```

Regenerate with `node scripts/capture-gc.mjs 8,11,17,21,25,26,27`, or provide all
majors 8–27. Linux x64, Node 24, curl and tar are required; the script downloads
Zulu HotSpot runtimes from the Foojay catalog, checks provided archive checksums,
and caches them under `.run/gc-runtimes`. Run Java 8 first on a new cache so a JDK
compiler is available. The workload compiles for Java 8 and runs in isolated
32 MiB child JVMs with a 45-second limit per collector. It deliberately reaches
allocation pressure and catches its own OOME; never run it inside an application.

Failed/unsupported collector runs are recorded, not counted as successful tests.
Replay does not need downloads or Java installed. Tests cover real output,
independent Serial/Parallel MXBean counts, start/end pairing, source coordinates,
concurrent-vs-pause semantics, restarts, truncated input, malformed files, filters,
source navigation, drag/drop, keyboard access and four live VS Code themes.

These stress captures test correctness and compatibility, not production GC
performance or tuning recommendations.

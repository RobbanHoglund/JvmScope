# JvmScope — future features

Recorded on 2026-10-03 from the discussion about additional JVM diagnostics.
This is the project's persistent backlog for future reference. These ideas are
not implemented features or commitments for the current GA release.

The suggested priority below reflects usefulness to JvmScope and estimated scope;
each feature still needs a separate design and implementation decision.

## Required compatibility work: Java input versions

Recorded and clarified on 2026-10-03: both existing analyzers must aim to accept
diagnostic input from **every major Java release from Java 7 through the latest
stable Java release**, currently **Java 27**. TDA must cover thread dumps and TLS
must cover Java TLS/JSSE logs. This includes all intermediate versions, not just
LTS releases or the versions represented in the current example library.
This is a compatibility requirement for the existing analyzers, separate from
the proposed new analyzers below.

Java 27 reached GA on 2026-09-15; see the
[official JDK 27 release notes](https://www.oracle.com/java/technologies/javase/27all-relnotes.html).
The coverage target advances when a newer stable Java release becomes available.

This records the target, not verified support for every release. A shared format
or one passing example must not be treated as certification of all versions.

- [x] Create a manual JVM capture/import workflow and generated input-compatibility matrix for TDA and TLS covering the Java 7–27 target, with exact build, vendor/provider, format and verification status. Actual gaps remain unverified; see [workflow](JVM-SAMPLES.md) and [results](JVM-SAMPLE-RESULTS.md).
- [x] Capture small controlled examples on Java 7, 8, 11, 15, 16 and 17, then cover Java 9, 10, 12, 13 and 14; record unavailable runtimes or unsupported formats explicitly.
- [x] Fill verification gaps for Java 18–24 and retain regression coverage for Java 25–27; include platform threads, virtual threads and text/JSON formats where the producing JVM provides them.
- [x] Verify classic thread headers, states, monitor/synchronizer ownership, deadlocks and multi-snapshot correlation on older TDA captures, including absent CPU/allocation counters.
- [x] Verify older JSSE record formats, handshake outcomes, certificate failures and client authentication on the protocols actually available in each tested JVM; do not require newer TLS protocols to declare an older log format usable.
- [x] Replay verified real-runtime captures in ordinary regression tests; keep synthetic scenarios labelled separately from controlled runtime captures.
- [ ] Expand the in-app example chooser with selected, clearly named older-version captures from the verified corpus.
- [x] Fix confirmed parser incompatibilities while preserving current input formats, raw evidence and browser-local analysis.
- [x] Update both Help guides and support documentation from the verified matrix, including provider/format limits and clear messages for unsupported inputs.
- [ ] Review each new stable Java release for dump/log format changes and extend controlled captures, regression tests, examples and the compatibility matrix before claiming verified support.

This requirement concerns the Java version producing the diagnostic files, not
the minimum Java runtime used to start JvmScope's server. Existing Java 8 TLS
fixtures provide evidence for those specific captures. Controlled HotSpot/SunJSSE
captures now cover every Java major from 7–27 in the generated
[evidence matrix](../README.md#java-input-compatibility). This is not certification
of every vendor, patch or platform; OpenJ9 javacores remain outside the TDA scope.

## 1. GC and safepoint log analyzer — first priority

- [ ] Import HotSpot GC logs and identify the collector and available fields.
- [ ] Show heap usage before/after collections, collection frequency and pause durations.
- [ ] Add a zoomable timeline with period filtering and inspection of individual events.
- [ ] Summarize the longest pauses and explain relevant GC events with linked raw evidence.
- [ ] Import safepoint logs and distinguish time reaching a safepoint from time spent there.
- [ ] Distinguish concurrent GC work from application pauses; rising heap usage alone must not be presented as proof of a memory leak.
- [ ] Define supported JDK/collector formats and test them with versioned fixtures, including Java 25, 26 and 27 where available.

Source: [JVM unified logging](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html#enable-logging-with-the-jvm-unified-logging-framework).

## 2. JVM crash report analyzer

- [ ] Import `hs_err_pid*.log` fatal error logs.
- [ ] Present the reported error, problematic frame, affected thread, native libraries, JVM version and environment in a readable report.
- [ ] Link each finding to its original log section and distinguish observations from possible explanations.
- [ ] Accept incomplete reports and identify missing sections without inventing a crash cause.

Source: [Troubleshoot system crashes](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-system-crashes.html).

## 3. Memory snapshots: NMT and heap histograms

- [ ] Import Native Memory Tracking summaries and baseline differences from `jcmd VM.native_memory`.
- [ ] Compare multiple snapshots and show changes by category: heap, threads, class metadata, code and other reported categories.
- [ ] Keep reserved and committed memory separate; explain that NMT does not cover all native allocations or measure process RSS.
- [ ] Import `jcmd GC.class_histogram` output and rank classes by instance count and bytes.
- [ ] Compare histograms over time to identify growing classes; distinguish growth from a confirmed leak.

Sources: [Native Memory Tracking](https://docs.oracle.com/en/java/javase/25/vm/native-memory-tracking.html),
[JDK diagnostic tools](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html).

## 4. JFR recordings — high value, larger scope

- [ ] Investigate local import of binary `.jfr` recordings, including parser options and memory/performance limits.
- [ ] Show recorded CPU, allocation, GC, monitor/lock wait and file/socket I/O events on a timeline.
- [ ] Filter by thread, event type and period, with stack inspection where the recording contains stacks.
- [ ] Explain recording settings and thresholds; an absent event must not be interpreted as proof that no activity occurred.
- [ ] Assess a focused JFR viewer that complements the existing analyzers before designing broader profiling functionality.

Source: [Troubleshoot performance using JFR](https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html).

## 5. Specialized diagnostics — later priority

- [ ] Investigate JIT compilation logs, including `hotspot.log`, compilation activity and inlining decisions where recorded.
- [ ] Investigate class loading/unloading logs with class lists and timelines for startup and class-loader investigations.
- [ ] Evaluate full `.hprof` heap-dump analysis separately: object references, retained memory and large-file handling make this a substantially larger feature than histogram import.

Sources: [Java diagnostic options](https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html),
[JDK diagnostic tools](https://docs.oracle.com/en/java/javase/25/troubleshoot/diagnostic-tools.html).

## Cross-cutting goal: one diagnostic session

- [ ] Allow several diagnostic files to be added to one session, regardless of their physical source files.
- [ ] Correlate GC/safepoint events with TDA snapshots and, where meaningful, TLS interactions or JFR events.
- [ ] Let a selected timeline period filter related evidence and expose the source of every observation.
- [ ] Verify JVM/process identity and compatible clocks before alignment; handle uptime-only timestamps, missing timezones and clock changes explicitly.
- [ ] Present temporal correlation as evidence to investigate, rather than an automatic claim of causation.

## Requirements to preserve when designing these features

- [ ] Keep analysis local and avoid uploading diagnostic contents.
- [ ] Design for desktop and laptop use.
- [ ] Keep files independent from the Java version running the web server; declare and test each analyzer's actual input-format coverage.
- [ ] Preserve raw evidence and contain malformed-input failures without losing the existing session.

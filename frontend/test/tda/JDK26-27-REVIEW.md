> Historical verification record from the predecessor application. Product names and results below describe that earlier build; see the repository README for current JvmScope verification. Command paths below reflect the earlier layout; current launch, build and capture scripts live in `scripts/`.

# JDK 26 and 27 thread-dump verification

Reviewed 2026-10-02 against OpenJDK GA sources and controlled Windows x64 JVM captures.

| Format | JDK 26 | JDK 27 | Analyzer behavior |
| --- | --- | --- | --- |
| `Thread.print -e -l` | No structural change to the classic Java-thread header/state emitter relative to 25 | Same emitter as 26 | Real fixtures cover IDs, states, stacks, monitors and AQS locks |
| `Thread.dump_to_file -format=plain` | Parking line can end in `, owner #<thread-id>` | Same addition | Wait resource and exact reported owner are retained; Locks shows the report |
| `Thread.dump_to_file -format=json` | `parkBlocker.owner` added as a string ID | Default `formatVersion: 2`; safe long IDs/counts are numbers, larger long IDs remain strings | Both representations are accepted without rounding unsafe numeric IDs |
| Compatibility JSON | Original string-ID representation | JVM property `com.sun.management.HotSpotDiagnosticMXBean.dumpThreads.format=1` selects v1 | Actual JDK 27 v1 and v2 captures are replayed |
| Mounted virtual threads | Same model as 25 | Numeric carrier ID in v2 | Actual JDK 27 virtual/carrier pair resolves across containers |

Source pins:

- JDK 25 GA: `6c48f4ed707bf0b15f9b6098de30db8aae6fa40f`
- JDK 26 GA: `4408cd2a07a14243a58cd9d30813302bfbe81133`
- JDK 27 GA: `815ff4dc327fe17f2433c7d115a5a503af10f3c4`

Primary sources: [JDK 26 ThreadDumper](https://github.com/openjdk/jdk/blob/jdk-26-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java), [JDK 27 ThreadDumper](https://github.com/openjdk/jdk/blob/jdk-27-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java), [JDK 27 JSON format](https://github.com/openjdk/jdk/blob/jdk-27-ga/src/jdk.management/share/classes/com/sun/management/doc-files/threadDump.html), [classic header/state emitter](https://github.com/openjdk/jdk/blob/jdk-27-ga/src/hotspot/share/runtime/javaThread.cpp).

Official OpenJDK Windows ZIPs were SHA-256 verified before use:

- 26.0.2.1+1-7: `0c3a8a30993de864937e6bced5270edc39c80c584cfd359ac222638c42758f1c`
- 27+35-2325: `41172837168dd25a8d9fe5eb253ac1efc568c5f9ff608144bcacadfdf50f876c`

Eight new excerpts were produced by `tools/thread-dump-generator/capture-parser-samples.mjs`. Only that script's child JVM is attached. Normal captures contain monitor and ReentrantLock owner/waiter pairs, quoted names and a sleeping virtual thread. The mounted mode contains a spinning virtual thread and its reported carrier. No application/user data is present. Names, IDs, frames, states and blocker objects are JVM output; container counts are adjusted to excerpt size while retaining their original numeric/string type.

Recreate the three ordinary formats with a JDK home and `frontend/test/tda/fixtures/runtime` as output. For JDK 27 append `--json-v1` for compatibility JSON, or `--mounted` for the mounted pair. Integration tests require explicit expectations for every runtime fixture. They verify raw source ranges, IDs, states, locks, reported parking owners, unavailable CPU counters, graph resource counts and virtual/carrier resolution. Browser tests verify owner display at both target viewport sizes.

Process boundaries were separately checked with real-format concatenations through the actual browser worker: PID 100, one/two classic snapshots without PID, PID 200. The latter starts a new series, cannot inherit stable diagnostics and cannot reuse CPU/lock-transition history. Returning to PID 100 later starts another series rather than reconnecting the old one.

File dumps remain per-thread observations, not an atomic lock snapshot. Reported parking owners are metadata and do not create unobserved held locks or JVM-confirmed deadlocks. Classic dump sources lack PID; two unrelated captures with no distinguishing process/identity information cannot be detected automatically. Keep independent JVM captures separate. This verifies these HotSpot builds and formats, not every vendor/platform or future JSON version.

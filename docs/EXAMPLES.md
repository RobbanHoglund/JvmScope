# JvmScope example library

Use **Browse examples** on either analyzer's start panel, or the arrow next to
**Sample / Full sample** in the header. Search by symptom or filter by Java
version/format. Each card describes what to inspect and distinguishes a
**Controlled capture** from a **Synthetic scenario**.

Selecting a card starts a new example session/capture. It does not append unrelated
examples to an existing session. Opening, searching or closing the library does
not change the loaded data. A failed download keeps the current session/capture.
The original quick **Sample / Full sample** buttons remain available.

## Available examples

TDA has 15 examples: the original three-snapshot overview, a confirmed monitor
deadlock, persistent monitor contention, ReentrantLock contention, a class
initialization stall, four real CPU-hot snapshots, five real virtual workers,
idle workers, thread identity over
time, a partial snapshot, and controlled Java 25/26/27 classic, text and JSON
captures including a mounted virtual thread.

TLS has 20 examples: the original mixed-outcome overview, controlled Java
25/26/27 success, trust failure, optional/required client authentication,
mutual TLS, resumption and expanded-format cases, a legacy Java 8 format example,
and focused synthetic timeout, hostname mismatch, expired-certificate alert,
ALPN failure and incomplete-handshake examples.

The legacy TLS 1.0 example demonstrates an old log format. Its obsolete protocol
was enabled only in an isolated test harness. Synthetic examples illustrate
specific evidence and are not a compatibility certification for a Java release.

The requested input-compatibility target is **every major Java release from Java 7
through the latest stable release**, currently **Java 27**, for both thread dumps
and Java TLS/JSSE logs. Additional controlled captures, tests and versioned library
examples are tracked in the [compatibility backlog](TODO.md#required-compatibility-work-java-input-versions).
The current library does not demonstrate verified coverage of that entire range.

## Files and packaging

The catalog in `frontend/assets/javautils/example-catalog.js` selects a bounded
set of existing controlled fixtures and dedicated teaching files. Unrelated,
malformed and malicious regression fixtures are not selected for the library.
Most focused TDA/synthetic TLS examples are only a few kilobytes. The largest
example is the original TDA overview, approximately 166 KB; every file is below
200 KB.

Vite emits the selected TXT/JSON captures as separate, fingerprinted assets.
The full Java server and the Slim JAR both serve these packaged files; the same
URLs also work in development. Files are fetched only when selected. No new
analysis/upload API, database or external service is required. Parsing and
analysis stay in the browser.

Controlled runtime fixtures retain their original captured text. See
[sample provenance](../testdata/README.md) and the capture scripts in
[`scripts/`](../scripts/README.md).

## Real CPU and virtual-thread scenarios

**CPU hot worker · 4 real snapshots** runs a real prime-calculation worker plus
parked and sleeping peers. Four complete `jcmd Thread.print -e -l` captures from
the same JVM form one chronological session. Snapshot 1 is the baseline;
snapshots 2–4 show measured CPU activity. Expand **Charts and distributions**,
filter the CPU timeline by `example-cpu-hot-worker`, select a point and inspect
the thread's **History**. The parked/sleeping peers provide a low-CPU comparison.

**Virtual threads · parked, sleeping & mounted** runs five virtual threads:
prime calculation, latch waiting, sleeping, a ReentrantLock owner and its waiter.
The complete `Thread.dump_to_file -format=json` capture retains supporting
platform threads and the JVM-reported carrier of the running virtual worker.
Inspect the individual stacks and use **Carrying VT only** to find the carrier.
This format has no CPU/allocation counters; a RUNNABLE virtual thread is not
labelled CPU hot without a measured rate. The captured Java 25 format does not
report every lock-owner relationship, so unavailable facts remain unavailable.

Both examples were captured from `ThreadLibraryScenarios.java` on Corretto
25.0.3, not assembled from invented thread records. The source is separate from
the older generator's compilation tree so its Java 21+ virtual-thread APIs do
not raise that generator's minimum JDK version. Recreate the public samples with:

```powershell
node scripts/capture-thread-examples.mjs 'C:\Program Files\Amazon Corretto\jdk25.0.3_9'
```

```bash
node scripts/capture-thread-examples.mjs "$JAVA_HOME"
```

Use JDK 25 for the version-labelled public library. Another JDK 25+ can write
to a separately supplied output directory. The script launches and attaches only
to its own children, uses no network services and stops both processes afterwards.
The program also stops itself after 45 seconds if run manually. Raw command
results and process output stay under ignored `.run/thread-examples/`.

`thread-examples-provenance.json` beside the samples records the actual JDK,
source checksum, flags, capture commands, byte counts and SHA-256 hashes.
CPU files preserve complete JVM output with LF line endings and the collector's
actual ISO timestamps prepended. TDA retains those millisecond timestamps ahead
of the JVM's second-rounded timestamp. The virtual-thread JSON is unchanged.
Git preserves the two captured files' bytes on Windows and Linux.

Regenerate the shipped synthetic TLS overview and focused extracts with:

```bash
node scripts/generate-tls-examples.mjs
```

The canonical synthetic scenario source remains `tls-sample.js`. Catalog tests
check the emitted overview against that source and exercise each example through
the analyzer engine. Browser tests load every packaged example, verify download
bytes and check filtering, keyboard interaction, failure recovery and cancellation
on desktop/laptop in full and Slim distributions.

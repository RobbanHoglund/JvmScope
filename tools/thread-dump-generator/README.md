# Java thread-dump generator

These dependency-free Java programs create deterministic thread situations and
capture real dumps with the JDK version being tested. They do not use the
repository's Gradle toolchain.

## Programs

- `ThreadScenarioRunner` starts one scenario (or `all`). With `--hold` it prints
  `READY pid=...` and stays alive for an external collector.
- `ThreadDumpCollector` captures one or more snapshots from a target PID using
  `jcmd PID Thread.print -e -l`. The `-e` flag is required for per-thread
  `allocated=` counters; `-l` includes concurrent-lock information.
- `ThreadLibraryScenarios.java` is a separate Java 21+ program for the public
  library: `cpu` runs one prime-calculation worker and two idle peers; `virtual`
  runs five virtual workers with computation, parking, sleep and lock contention.
  It prints readiness only after the expected states are reached, and stops
  itself after 45 seconds. It is outside `src/main/java` so the older generator
  can still be compiled with its existing JDK requirements.

The external collector is the canonical path. Keeping attach outside the target
also works for the combined monitor-deadlock/AQS scenario where self-attach can
stall on some JDKs.

The new public examples are captured with
`node scripts/capture-thread-examples.mjs <jdk25-home>` from the repository root.
This compiles the standalone program, starts only its own processes, records four
complete CPU snapshots and one complete virtual-thread JSON dump, then stops the
children. No JVM-supplied thread names, counters, stacks or relationships are
invented. See [the example guide](../../docs/EXAMPLES.md#real-cpu-and-virtual-thread-scenarios)
for capture provenance, commands and what to inspect in TDA.

## Generate the committed samples

Run these commands from the repository root; the scripts resolve their Java
sources independently of the caller's directory.

PowerShell (optionally pass a future JDK home):

```powershell
.\scripts\generate-thread-samples.ps1 -JavaHome 'C:\Java\jdk-under-test'
```

POSIX shell:

```sh
JAVA_HOME=/opt/jdk-under-test ./scripts/generate-thread-samples.sh
```

Each run writes both canonical fixtures below the repository root:

```text
testdata/thread-dumps/real-java-all-1-snapshot.txt
testdata/thread-dumps/real-java-all-3-snapshots.txt
```

The three-snapshot fixture is also copied into the frontend assets for the
built-in Sample action. The default interval is 1500 ms so CPU and allocation rates meet the analyzer's
minimum one-second observation window. Use `-Portable` or `PORTABLE=1` only when
attach is unavailable. The portable formatter reads CPU and allocated-byte
counters from management beans when supported and omits unavailable counters.
It cannot reproduce HotSpot-only class-initialization wait markers.

## Manual single or repeated capture

Run the manual commands in this section from `tools/thread-dump-generator/`.

Compile both programs:

```text
javac -encoding UTF-8 -d out <all Java sources below src/main/java>
```

Start the scenario in one terminal:

```text
java -cp out com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner \
  --scenario allocation-churn-1 --warmup-ms 800 --hold
```

Then use the printed PID in another terminal. One dump:

```text
java -cp out com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector \
  --pid 12345 --snapshots 1 --output single.txt
```

Three dumps for temporal analysis:

```text
java -cp out com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector \
  --pid 12345 --snapshots 3 --interval-ms 1500 --output series.txt
```

## Scenarios

```text
deadlock-2 / deadlock-3       intrinsic-monitor cycles
lock-holder-many-waiters      one holder and three BLOCKED waiters
synchronizer-contention       ReentrantLock holder and AQS waiters
livelock-2 / livelock-3       CAS retry agents with no useful completion
waiting / parked / sleeping   Object.wait, LockSupport.park, Thread.sleep
cpu-hot-1 / cpu-hot-3         continuously runnable CPU workers
allocation-churn-1 / -3       high allocation throughput with discarded arrays
allocation-retained-growth    bounded retained growth up to 32 MiB
cpu-and-allocation-hot        simultaneous CPU and allocation activity
class-initialization-stall    initializer waits while ten threads await the class
all                           representative instances of every category
```

Allocation churn and retained growth are intentionally separate. A thread dump
can measure cumulative allocation and a cross-snapshot allocation rate, but it
cannot prove live retention or a memory leak. The retained scenario is bounded to
avoid turning a diagnostic fixture into an uncontrolled OOM test.

## Parser format captures

`scripts/capture-parser-samples.mjs` is the separate loopback/local-child capture tool for
small, version-specific parser regressions. From the repository root:

```powershell
node scripts/capture-parser-samples.mjs "C:\path\to\jdk27" frontend/test/tda/fixtures/runtime
```

It captures HotSpot `Thread.print -e -l`, file text and JSON. On Java 27, run again
with `--json-v1` to capture compatibility JSON alongside default v2. Append `--mounted` on Java
25+ for a mounted virtual thread and its reported carrier. See the
[TDA fixture guide](../../frontend/test/tda/README.md) for how excerpts are retained
and [Java 25–27 verification](../../frontend/test/JAVA25-27-REVIEW.md) for actual
builds and limits. These fixtures contain controlled threads, not production data.

TDA's **Add to session** accepts separately collected files or pastes. Collect
snapshots from the same JVM in chronological order; a single physical file is not
required. Modern file dumps do not provide CPU or allocation counters, so use
`Thread.print -e -l` when measuring those rates.

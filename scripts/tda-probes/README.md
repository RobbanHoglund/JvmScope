# TDA runtime regression probes

These probes reproduce JVM behavior independently of JvmScope. The captured
Java 25.0.4.1 files in `frontend/test/tda/fixtures/ga-regressions/` are replayed
by the normal unit, integration and Playwright suites. They do not require a
running JVM during ordinary frontend CI.

## Rounded allocation counters

Compile `AllocationProbe.java` with JDK 25 and run it with `-Xmx64m`. Send commands
on stdin, waiting for each response:

1. `prime` — allocates transient arrays up to just below a 101 GiB cumulative
   counter boundary. This is cumulative churn, not a 101 GiB live heap.
2. `dump /absolute/path/before.txt`.
3. Wait at least one second, then `step` — advances by 128 KiB.
4. `dump /absolute/path/after.txt`, then `quit`.

The `ALLOCATED=` responses are the independent ThreadMXBean counters. HotSpot's
DiagnosticCommand `threadPrint -e -l` prints 100G and 101G for these captures.
The checked-in counters differ by 131072 bytes; they must not imply an exact
1 GiB delta or a confident high-allocation diagnosis.

References: OpenJDK 25 `src/hotspot/share/runtime/thread.cpp` and
`src/hotspot/share/utilities/globalDefinitions.hpp` (`byte_size_in_proper_unit`).

## Mounted virtual monitor owner

Compile `CarrierProbe.java` with JDK 25; run `java CarrierProbe /new/output/dir`.
A virtual thread holds a monitor while a platform thread waits for it. The
classic and JSON captures must identify the virtual JVM ID as the owner, with
no CPU/allocation counters copied from its carrier. The saved review captures
were produced by the equivalent carrier branch of the original `AuditProbe`;
these standalone probes preserve the scenario while separating the bugs.

## Deadlock and lock-data coverage

Compile `CoverageProbe.java` with JDK 25; run `java CoverageProbe /new/path/coverage`.
It creates two virtual threads that each retain one monitor and wait for the
other, plus a platform thread retaining a ReentrantLock. It prints independent
ThreadMXBean/state facts and captures JSON, classic default and classic `-l`.
The saved `coverage.json` has two BLOCKED virtual participants. No platform-only
JVM deadlock confirmation must be interpreted as proof that they are safe.
See Java 25 `ThreadMXBean.findDeadlockedThreads()` documentation.

## Condition.awaitUninterruptibly

Compile `ConditionProbe.java` with JDK 25; run `java ConditionProbe /new/output/dir`.
The probe checks that the waiter reached WAITING and released its associated
ReentrantLock. Both output formats should classify it as Condition await.
The regression suite reuses the real `audit-uninterruptible-condition` records
in the earlier carrier captures. Application methods with a similar name are
not sufficient evidence for this classification.

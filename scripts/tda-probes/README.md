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

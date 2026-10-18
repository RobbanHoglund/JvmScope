# Real HotSpot GC samples · Java 8–27

All GC records here were emitted by real Azul Zulu OpenJDK HotSpot JVMs running
[`GcWorkload.java`](../../tools/gc-samples/GcWorkload.java), not hand-authored
pretend logs. Each `javaN-provenance.json` records the runtime download checksum,
exact version, command, workload hash, original log SHA-256 and independent
`GarbageCollectorMXBean` observations.

Ready to drop into JvmScope:

| File | Demonstrates |
| --- | --- |
| `java27-serial.log` | Serial young/full collections |
| `java27-parallel.log` | Unified Parallel GC |
| `java8-cms.log` | Historical CMS phases and pauses |
| `java8-parallel.log` | Legacy format, young/full collections and explicit GC |
| `java27-g1.log` | Unified logging, heap pressure and evacuation failure |
| `java27-zgc.log` | Generational phases, concurrent cycles and allocation stalls |
| `java17-shenandoah.log` | Concurrent phases, pauses and aggregate statistics |

These three additional plain samples are byte-identical decompressions of their matching `.log.gz` files. Other successful captures are `.log.gz` to keep the regression corpus small.
Decompress before opening in the analyzer; the test suite decompresses them
automatically and verifies the original-byte hash. No output lines are rewritten.

Every Java major 8–27 has successful Serial, Parallel and G1 captures. CMS is
captured where available (8–13). ZGC and Shenandoah are captured where the selected
build and this host successfully run them. Java 11–13 ZGC and Java 23 Shenandoah
did not complete successfully in this environment and are explicitly reported
as `unavailable-or-failed`; they are **not** silently counted as verified cases.
See each provenance report for the exact result, not an assumed support matrix.

The small heap creates intentional pressure. Successful simulation of pressure
does not mean the analyzer observed a logged OOME: the workload catches that
exception. Each GC signal still needs to exist in the input log to be displayed.

See [capture and test instructions](../../docs/GC-ANALYZER.md). These are parser
fixtures, not realistic production latency benchmarks or collector rankings.

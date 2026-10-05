/** Synthetic contradictory counters, not a capture from a real JVM. */
export function elapsedSnapshot(second, cpu, elapsed, allocated = 1000) {
    return `2026-10-04T12:00:0${second}.000Z\nFull thread dump OpenJDK 64-Bit Server VM:\n\n"elapsed-worker" #41 prio=5 os_prio=0 cpu=${cpu}ms ${elapsed == null ? '' : `elapsed=${elapsed}s `}allocated=${allocated}B tid=0x12345678 nid=0x42 runnable [0x98765432]\n   java.lang.Thread.State: RUNNABLE\n    at example.Work.run(Work.java:10)\n\nJNI global refs: 1\n`;
}

export const elapsedRegressionSnapshots = [elapsedSnapshot(0, 100, '100.000'), elapsedSnapshot(1, 800, '1.000', 1000000)];

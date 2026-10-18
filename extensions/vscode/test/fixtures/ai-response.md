## Observed facts

The JVM reports **two deadlock cycles involving five threads**. The excerpt covers the selected snapshot; it does not establish how long these conditions have persisted.

- **Cycle 1:** `scenario-deadlock-2-1` waits for a monitor held by `scenario-deadlock-2-2`. The second thread waits for the first thread's monitor.
- **Cycle 2:** three threads form a separate reported cycle. Their stack traces point to `ThreadScenarioRunner.java:458`.
- The observed `RUNNABLE` state **does not establish CPU usage**. Interval measurements are unavailable.

## Analyzer inferences

| Finding | Evidence | Limit |
| --- | --- | --- |
| Java-level deadlock | JVM-reported cycles | Application impact is not established |
| Lock contention | Observed holders and waiters | A single snapshot does not establish duration |
| Possible initialization stall | Class initialization waiters | The initializer's full stack is missing |

> A lock bottleneck is a hypothesis about impact. Verify it against repeated captures and application symptoms.

## Suggested checks

1. Capture another dump and compare the same threads.
2. Inspect the application paths acquiring the two monitors.
   - Check whether both paths acquire locks in the same order.
   - Distinguish a deliberate test scenario from production code.
3. Correlate the capture time with request latency and CPU measurements.

```java
// Illustrative only: examine the actual acquisition order.
synchronized (firstLock) {
    synchronized (secondLock) {
        completeWork();
    }
}
```

Further reading: [Java documentation](https://docs.oracle.com/en/java/).

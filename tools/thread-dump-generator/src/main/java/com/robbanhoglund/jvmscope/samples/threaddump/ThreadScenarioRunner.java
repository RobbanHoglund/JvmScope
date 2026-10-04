package com.robbanhoglund.jvmscope.samples.threaddump;

import java.io.IOException;
import java.io.PrintStream;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.locks.LockSupport;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Starts deterministic JVM thread situations and captures one or more thread dumps.
 *
 * <p>The program intentionally has no third-party dependencies. Compile it with the
 * JDK version being tested and run it with that same JDK. The preferred dump source is
 * the JDK's own {@code jcmd <pid> Thread.print -e -l}; a portable ThreadMXBean formatter
 * is used when jcmd is unavailable or when {@code --portable} is requested.</p>
 */
public final class ThreadScenarioRunner implements AutoCloseable {
    private static final DateTimeFormatter SNAPSHOT_TIME = DateTimeFormatter.ISO_OFFSET_DATE_TIME;
    private static final long DEFAULT_WARMUP_MS = 500L;
    private static final long DEFAULT_INTERVAL_MS = 1_000L;
    private static final int DEFAULT_SNAPSHOTS = 1;

    private final AtomicBoolean running = new AtomicBoolean(true);
    private final List<Thread> threads = Collections.synchronizedList(new ArrayList<Thread>());
    private final AtomicLong cpuBlackhole = new AtomicLong();
    private final AtomicReference<byte[]> allocationBlackhole = new AtomicReference<byte[]>();
    private final List<byte[]> retainedAllocations = Collections.synchronizedList(new ArrayList<byte[]>());

    public static void main(String[] args) throws Exception {
        Config config;
        try {
            config = Config.parse(args);
        } catch (IllegalArgumentException e) {
            System.err.println("Error: " + e.getMessage());
            System.err.println(Config.usage());
            System.exit(2);
            return;
        }

        if (config.help) {
            System.out.println(Config.usage());
            return;
        }
        if (config.list) {
            printScenarioList(System.out);
            return;
        }

        ThreadScenarioRunner runner = new ThreadScenarioRunner();
        try {
            runner.start(config.scenario);
            sleepQuietly(config.warmupMs);

            if (config.hold) {
                Runtime.getRuntime().addShutdownHook(new Thread(runner::close, "thread-scenario-shutdown"));
                System.out.printf(Locale.ROOT, "READY pid=%s scenario=%s%n", currentPid(), config.scenario.cliName);
                System.out.flush();
                while (runner.running.get()) {
                    LockSupport.parkNanos(runner, TimeUnit.SECONDS.toNanos(30));
                }
                return;
            }

            StringBuilder result = new StringBuilder();
            for (int i = 0; i < config.snapshots; i++) {
                if (i > 0) {
                    sleepQuietly(config.intervalMs);
                }
                String dump = captureDump(config);
                result.append(OffsetDateTime.now().format(SNAPSHOT_TIME)).append('\n');
                result.append(dump.trim()).append("\n\n");
            }

            // Keep a separator between snapshots without adding a blank line at EOF.
            if (result.length() > 0) {
                result.setLength(result.length() - 1);
            }
            writeResult(result.toString(), config.output);
        } finally {
            runner.close();
        }
    }

    private static void printScenarioList(PrintStream out) {
        out.println("Available scenarios:");
        for (Scenario scenario : Scenario.values()) {
            out.printf(Locale.ROOT, "  %-28s %s%n", scenario.cliName, scenario.description);
        }
        out.println();
        out.println("Use --scenario all to combine representative instances of every category in one JVM.");
    }

    private static String captureDump(Config config) throws Exception {
        // Some JDK builds pause indefinitely while jcmd attaches to an application
        // that combines AQS parking with monitor deadlocks. The mixed sample must be
        // reliable across future JDKs, so it deliberately uses the in-process dump.
        boolean jcmdSafe = config.scenario != Scenario.ALL
                && config.scenario != Scenario.SYNCHRONIZER_CONTENTION;
        if (config.useJcmd && !config.portable && jcmdSafe) {
            String jcmdDump = tryJcmd(config.jcmd);
            if (jcmdDump != null) {
                return jcmdDump;
            }
        }
        return portableThreadMxBeanDump();
    }

    private static String tryJcmd(Path configuredJcmd) {
        Path jcmd = configuredJcmd != null ? configuredJcmd : findJcmd();
        if (jcmd == null) {
            return null;
        }

        Process process = null;
        try {
            String pid = currentPid();
            process = new ProcessBuilder(
                    jcmd.toString(), pid, "Thread.print", "-e", "-l")
                    .redirectErrorStream(true)
                    .start();
            final Process startedProcess = process;
            final StringBuilder outputBuffer = new StringBuilder();
            Thread outputReader = new Thread(() -> {
                try {
                    outputBuffer.append(new String(
                            startedProcess.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
                } catch (IOException ignored) {
                    // The process may be terminated after the timeout.
                }
            }, "thread-dump-jcmd-output-reader");
            outputReader.setDaemon(true);
            outputReader.start();
            boolean finished = process.waitFor(15, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                outputReader.join(2_000L);
                System.err.println("jcmd timed out; using ThreadMXBean fallback.");
                return null;
            }
            outputReader.join(2_000L);
            String output = outputBuffer.toString();
            if (finished && process.exitValue() == 0 && output.contains("Full thread dump")) {
                return output;
            }
            System.err.println("jcmd did not return a usable thread dump; using ThreadMXBean fallback.");
        } catch (Exception e) {
            System.err.println("Unable to run jcmd (" + e.getMessage() + "); using ThreadMXBean fallback.");
            if (process != null) {
                process.destroyForcibly();
            }
        }
        return null;
    }

    private static Path findJcmd() {
        String javaHome = System.getProperty("java.home");
        List<Path> candidates = new ArrayList<Path>();
        if (javaHome != null) {
            Path home = Path.of(javaHome);
            candidates.add(home.resolve("bin").resolve(executableName("jcmd")));
            Path parent = home.getParent();
            if (parent != null) {
                candidates.add(parent.resolve("bin").resolve(executableName("jcmd")));
            }
        }
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private static String executableName(String name) {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win")
                ? name + ".exe" : name;
    }

    private static String currentPid() {
        String runtimeName = ManagementFactory.getRuntimeMXBean().getName();
        int separator = runtimeName.indexOf('@');
        return separator > 0 ? runtimeName.substring(0, separator) : runtimeName;
    }

    private static String portableThreadMxBeanDump() {
        ThreadMXBean bean = ManagementFactory.getThreadMXBean();
        long[] ids = bean.getAllThreadIds();
        ThreadInfo[] infos = bean.getThreadInfo(ids, true, true);
        long[] cpuTimes = unavailableCounters(ids.length);
        if (bean.isThreadCpuTimeSupported()) {
            if (!bean.isThreadCpuTimeEnabled()) {
                try {
                    bean.setThreadCpuTimeEnabled(true);
                } catch (RuntimeException ignored) {
                    // Leave the counter unavailable rather than inventing a value.
                }
            }
            for (int index = 0; index < ids.length; index++) {
                cpuTimes[index] = bean.getThreadCpuTime(ids[index]);
            }
        }
        long[] allocatedBytes = allocatedByteCounters(bean, ids);
        double elapsedSeconds = ManagementFactory.getRuntimeMXBean().getUptime() / 1_000.0d;
        StringBuilder dump = new StringBuilder("Full thread dump (portable ThreadMXBean):\n\n");
        for (int index = 0; index < infos.length; index++) {
            ThreadInfo info = infos[index];
            if (info == null) {
                continue;
            }
            dump.append('"').append(info.getThreadName()).append('"')
                    .append(" #").append(info.getThreadId());
            if (isDaemonThread(info.getThreadId())) {
                dump.append(" daemon");
            }
            dump.append(" prio=").append(info.getPriority())
                    .append(" os_prio=0");
            if (cpuTimes[index] >= 0L) {
                dump.append(" cpu=").append(decimal(cpuTimes[index] / 1_000_000.0d)).append("ms");
            }
            dump.append(" elapsed=").append(decimal(elapsedSeconds)).append('s');
            if (allocatedBytes[index] >= 0L) {
                dump.append(" allocated=").append(allocatedBytes[index]).append('B');
            }
            dump
                    .append(" tid=0x").append(Long.toHexString(info.getThreadId()))
                    .append(" nid=0x").append(Long.toHexString(info.getThreadId()))
                    .append(" state=").append(info.getThreadState()).append('\n');
            dump.append("   java.lang.Thread.State: ").append(info.getThreadState()).append('\n');
            for (StackTraceElement frame : info.getStackTrace()) {
                dump.append("\tat ").append(frame).append('\n');
            }
            for (java.lang.management.LockInfo lock : info.getLockedSynchronizers()) {
                dump.append("\t- locked ").append(lock).append('\n');
            }
            if (info.getLockInfo() != null) {
                java.lang.management.LockInfo lock = info.getLockInfo();
                String lockId = lockId(lock);
                String lockType = "a " + lock.getClassName();
                if (info.getThreadState() == Thread.State.BLOCKED) {
                    dump.append("\t- waiting to lock <").append(lockId).append("> (")
                            .append(lockType).append(")\n");
                } else if (isSynchronizerWait(info)) {
                    dump.append("\t- parking to wait for <").append(lockId).append("> (")
                            .append(lockType).append(")\n");
                } else {
                    dump.append("\t- waiting on <").append(lockId).append("> (")
                            .append(lockType).append(")\n");
                }
            }
            for (java.lang.management.MonitorInfo monitor : info.getLockedMonitors()) {
                dump.append("\t- locked <").append(lockId(monitor)).append("> (a ")
                        .append(monitor.getClassName()).append(")\n");
            }
            dump.append('\n');
        }
        long[] deadlocked = bean.findDeadlockedThreads();
        if (deadlocked != null && deadlocked.length > 0) {
            dump.append("Found one Java-level deadlock:\n");
            for (long id : deadlocked) {
                ThreadInfo info = bean.getThreadInfo(id);
                if (info != null) {
                    java.lang.management.LockInfo lock = info.getLockInfo();
                    dump.append('"').append(info.getThreadName()).append("\":\n");
                    if (lock != null) {
                        dump.append("  waiting to lock monitor ").append(lockId(lock))
                                .append(" (object ").append(lockId(lock)).append(", a ")
                                .append(lock.getClassName()).append("),\n");
                    }
                    dump.append("  which is held by \"").append(info.getLockOwnerName())
                            .append("\"\n");
                }
            }
        }
        return dump.toString();
    }

    private static long[] unavailableCounters(int size) {
        long[] counters = new long[size];
        Arrays.fill(counters, -1L);
        return counters;
    }

    private static long[] allocatedByteCounters(ThreadMXBean bean, long[] ids) {
        long[] counters = unavailableCounters(ids.length);
        if (!(bean instanceof com.sun.management.ThreadMXBean)) {
            return counters;
        }
        com.sun.management.ThreadMXBean allocationBean = (com.sun.management.ThreadMXBean) bean;
        if (!allocationBean.isThreadAllocatedMemorySupported()) {
            return counters;
        }
        try {
            if (!allocationBean.isThreadAllocatedMemoryEnabled()) {
                allocationBean.setThreadAllocatedMemoryEnabled(true);
            }
            if (!allocationBean.isThreadAllocatedMemoryEnabled()) {
                return counters;
            }
            return allocationBean.getThreadAllocatedBytes(ids);
        } catch (RuntimeException ignored) {
            return counters;
        }
    }

    private static boolean isSynchronizerWait(ThreadInfo info) {
        for (StackTraceElement frame : info.getStackTrace()) {
            if (frame.getClassName().equals(LockSupport.class.getName())
                    || frame.getClassName().contains("AbstractQueuedSynchronizer")) {
                return true;
            }
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private static boolean isDaemonThread(long threadId) {
        for (Thread thread : Thread.getAllStackTraces().keySet()) {
            if (thread.getId() == threadId) {
                return thread.isDaemon();
            }
        }
        return false;
    }

    private static String lockId(java.lang.management.LockInfo lock) {
        return "0x" + Integer.toHexString(lock.getIdentityHashCode());
    }

    private static String lockId(java.lang.management.MonitorInfo monitor) {
        return "0x" + Integer.toHexString(monitor.getIdentityHashCode());
    }

    private static String decimal(double value) {
        return value < 0 ? "0.00" : String.format(Locale.ROOT, "%.2f", value);
    }

    private static void writeResult(String result, Path output) throws IOException {
        if (output == null) {
            System.out.print(result);
            return;
        }
        Path parent = output.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        Files.writeString(output, result, StandardCharsets.UTF_8);
        System.err.println("Wrote " + output.toAbsolutePath());
    }

    private void start(Scenario scenario) {
        switch (scenario) {
            case DEADLOCK_2:
                startDeadlock(2);
                break;
            case DEADLOCK_3:
                startDeadlock(3);
                break;
            case LOCK_HOLDER_MANY_WAITERS:
                startLockHolderManyWaiters(3);
                break;
            case SYNCHRONIZER_CONTENTION:
                startSynchronizerContention(3);
                break;
            case LIVELOCK_2:
                startLivelock(2);
                break;
            case LIVELOCK_3:
                startLivelock(3);
                break;
            case WAITING:
                startWaiting(3);
                break;
            case PARKED:
                startParked(3);
                break;
            case SLEEPING:
                startSleeping(3);
                break;
            case CPU_HOT_1:
                startCpuHot(1);
                break;
            case CPU_HOT_3:
                startCpuHot(3);
                break;
            case ALLOCATION_CHURN_1:
                startAllocationChurn(1);
                break;
            case ALLOCATION_CHURN_3:
                startAllocationChurn(3);
                break;
            case ALLOCATION_RETAINED_GROWTH:
                startRetainedAllocationGrowth();
                break;
            case CPU_AND_ALLOCATION_HOT:
                startCpuAndAllocationHot();
                break;
            case CLASS_INITIALIZATION_STALL:
                startClassInitializationStall(10);
                break;
            case ALL:
                startAll();
                break;
            default:
                throw new IllegalArgumentException("Unsupported scenario: " + scenario.cliName);
        }
    }

    private void startAll() {
        startDeadlock(2);
        startDeadlock(3);
        startLockHolderManyWaiters(3);
        startSynchronizerContention(3);
        startLivelock(2);
        startLivelock(3);
        startWaiting(3);
        startParked(3);
        startSleeping(3);
        startCpuHot(3);
        startAllocationChurn(1);
        startRetainedAllocationGrowth();
        startCpuAndAllocationHot();
        startClassInitializationStall(10);
    }

    private void startDeadlock(int count) {
        final Object[] locks = new Object[count];
        for (int i = 0; i < count; i++) {
            locks[i] = new Object();
        }
        final CyclicBarrier barrier = new CyclicBarrier(count);
        for (int i = 0; i < count; i++) {
            final int index = i;
            final int next = (i + 1) % count;
            daemon("scenario-deadlock-" + count + "-" + (i + 1), () -> {
                synchronized (locks[index]) {
                    awaitBarrier(barrier);
                    synchronized (locks[next]) {
                        // Never reached: every participant owns the next lock's predecessor.
                    }
                }
            });
        }
    }

    private void startLockHolderManyWaiters(int waiterCount) {
        final Object lock = new Object();
        final CountDownLatch holderEntered = new CountDownLatch(1);
        daemon("scenario-lock-holder", () -> {
            synchronized (lock) {
                holderEntered.countDown();
                while (running.get()) {
                    sleepQuietly(60_000L);
                }
            }
        });
        awaitLatch(holderEntered);
        for (int i = 1; i <= waiterCount; i++) {
            final int waiter = i;
            daemon("scenario-lock-waiter-" + waiter, () -> {
                synchronized (lock) {
                    while (running.get()) {
                        waitQuietly(lock);
                    }
                }
            });
        }
    }

    private void startSynchronizerContention(int waiterCount) {
        final ReentrantLock lock = new ReentrantLock();
        final CountDownLatch holderEntered = new CountDownLatch(1);
        daemon("scenario-synchronizer-holder", () -> {
            lock.lock();
            try {
                holderEntered.countDown();
                LockSupport.parkNanos(this, TimeUnit.MINUTES.toNanos(10));
            } finally {
                lock.unlock();
            }
        });
        awaitLatch(holderEntered);
        for (int i = 1; i <= waiterCount; i++) {
            final int waiter = i;
            daemon("scenario-synchronizer-waiter-" + waiter, () -> {
                lock.lock();
                try {
                    while (running.get()) {
                        LockSupport.parkNanos(this, TimeUnit.MINUTES.toNanos(10));
                    }
                } finally {
                    lock.unlock();
                }
            });
        }
    }

    private void startLivelock(int count) {
        final AtomicLong coordination = new AtomicLong();
        for (int i = 0; i < count; i++) {
            final int agent = i + 1;
            daemon("scenario-livelock-" + count + "-agent-" + (i + 1), () -> {
                long attempts = agent;
                while (running.get()) {
                    long observed = coordination.get();
                    if (coordination.compareAndSet(observed, observed + 1L)) {
                        Thread.onSpinWait();
                        coordination.compareAndSet(observed + 1L, observed);
                    } else {
                        Thread.onSpinWait();
                    }
                    attempts += 1L;
                    cpuBlackhole.lazySet(attempts);
                }
            });
        }
    }

    private void startWaiting(int count) {
        final Object monitor = new Object();
        for (int i = 1; i <= count; i++) {
            final int waiter = i;
            daemon("scenario-waiting-" + waiter, () -> {
                synchronized (monitor) {
                    while (running.get()) {
                        waitQuietly(monitor);
                    }
                }
            });
        }
    }

    private void startParked(int count) {
        for (int i = 1; i <= count; i++) {
            final int parker = i;
            daemon("scenario-parked-" + parker, () -> {
                while (running.get()) {
                    LockSupport.park(this);
                    if (Thread.interrupted() && !running.get()) {
                        return;
                    }
                }
            });
        }
    }

    private void startSleeping(int count) {
        for (int i = 1; i <= count; i++) {
            final int sleeper = i;
            daemon("scenario-sleeping-" + sleeper, () -> {
                while (running.get()) {
                    try {
                        Thread.sleep(TimeUnit.MINUTES.toMillis(10));
                    } catch (InterruptedException e) {
                        if (!running.get()) {
                            return;
                        }
                    }
                }
            });
        }
    }

    private void startCpuHot(int count) {
        for (int i = 1; i <= count; i++) {
            final int worker = i;
            daemon("scenario-cpu-hot-" + worker, () -> {
                long value = worker;
                while (running.get()) {
                    value = (value * 1664525L + 1013904223L) ^ (value >>> 13);
                    if ((value & 0x3ffL) == 0) {
                        cpuBlackhole.lazySet(value);
                    }
                }
                cpuBlackhole.lazySet(value);
            });
        }
    }

    private void startAllocationChurn(int count) {
        for (int i = 1; i <= count; i++) {
            final int worker = i;
            daemon("scenario-allocation-churn-" + worker, () -> {
                int marker = worker;
                while (running.get()) {
                    byte[] allocation = new byte[64 * 1024];
                    allocation[0] = (byte) marker++;
                    allocationBlackhole.lazySet(allocation);
                    LockSupport.parkNanos(this, TimeUnit.MILLISECONDS.toNanos(1));
                }
            });
        }
    }

    private void startRetainedAllocationGrowth() {
        daemon("scenario-allocation-retained-growth", () -> {
            int marker = 0;
            while (running.get() && retainedAllocations.size() < 32) {
                byte[] allocation = new byte[1024 * 1024];
                allocation[0] = (byte) marker++;
                retainedAllocations.add(allocation);
                allocationBlackhole.lazySet(allocation);
                sleepQuietly(100L);
            }
            while (running.get()) {
                sleepQuietly(60_000L);
            }
        });
    }

    private void startCpuAndAllocationHot() {
        daemon("scenario-cpu-and-allocation-hot", () -> {
            long value = 1L;
            while (running.get()) {
                value = (value * 1664525L + 1013904223L) ^ (value >>> 13);
                if ((value & 0xffffL) == 0L) {
                    byte[] allocation = new byte[32 * 1024];
                    allocation[0] = (byte) value;
                    allocationBlackhole.lazySet(allocation);
                }
            }
            cpuBlackhole.lazySet(value);
        });
    }

    private void startClassInitializationStall(int waiterCount) {
        ClassInitializationCoordinator.reset();
        daemon("scenario-class-init-initializer", ClassInitializationTarget::touch);
        awaitLatch(ClassInitializationCoordinator.initializerEntered);
        for (int i = 1; i <= waiterCount; i++) {
            daemon("scenario-class-init-waiter-" + i, ClassInitializationTarget::touch);
        }
    }

    private void daemon(String name, Runnable body) {
        Thread thread = new Thread(() -> {
            try {
                body.run();
            } catch (Throwable error) {
                if (running.get()) {
                    System.err.println("Scenario thread " + Thread.currentThread().getName()
                            + " stopped: " + error);
                }
            }
        }, name);
        thread.setDaemon(true);
        thread.setPriority(Thread.NORM_PRIORITY);
        threads.add(thread);
        thread.start();
    }

    @Override
    public void close() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        synchronized (threads) {
            for (Thread thread : threads) {
                thread.interrupt();
                LockSupport.unpark(thread);
            }
        }
        ClassInitializationCoordinator.blocker.complete(null);
    }

    private static void awaitLatch(CountDownLatch latch) {
        try {
            latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void awaitBarrier(CyclicBarrier barrier) {
        try {
            barrier.await(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void waitQuietly(Object monitor) {
        try {
            monitor.wait();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void sleepQuietly(long millis) {
        if (millis <= 0) {
            return;
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private enum Scenario {
        DEADLOCK_2("deadlock-2", "two threads hold opposite intrinsic monitors"),
        DEADLOCK_3("deadlock-3", "three threads form a cyclic monitor deadlock"),
        LOCK_HOLDER_MANY_WAITERS("lock-holder-many-waiters", "one monitor holder and three BLOCKED waiters"),
        SYNCHRONIZER_CONTENTION("synchronizer-contention", "ReentrantLock holder with parked AQS waiters"),
        LIVELOCK_2("livelock-2", "two CAS retry agents coordinate without useful completion"),
        LIVELOCK_3("livelock-3", "three CAS retry agents coordinate without useful completion"),
        WAITING("waiting", "three threads wait on an object monitor without notification"),
        PARKED("parked", "three threads are parked with LockSupport"),
        SLEEPING("sleeping", "three threads sleep for a long timeout"),
        CPU_HOT_1("cpu-hot-1", "one continuously runnable CPU worker"),
        CPU_HOT_3("cpu-hot-3", "three continuously runnable CPU workers"),
        ALLOCATION_CHURN_1("allocation-churn-1", "one thread allocates and discards memory continuously"),
        ALLOCATION_CHURN_3("allocation-churn-3", "three threads allocate and discard memory continuously"),
        ALLOCATION_RETAINED_GROWTH("allocation-retained-growth", "one thread retains bounded allocations until 32 MiB"),
        CPU_AND_ALLOCATION_HOT("cpu-and-allocation-hot", "one thread is both CPU hot and allocation hot"),
        CLASS_INITIALIZATION_STALL("class-initialization-stall", "one class initializer waits while ten threads await that class"),
        ALL("all", "representative instances of every scenario category in one JVM");

        private final String cliName;
        private final String description;

        Scenario(String cliName, String description) {
            this.cliName = cliName;
            this.description = description;
        }

        private static Scenario fromCli(String value) {
            String normalized = value.toLowerCase(Locale.ROOT);
            for (Scenario scenario : values()) {
                if (scenario.cliName.equals(normalized)) {
                    return scenario;
                }
            }
            throw new IllegalArgumentException("Unknown scenario '" + value + "'. Use --list.");
        }
    }

    private static final class Config {
        private Scenario scenario = Scenario.ALL;
        private int snapshots = DEFAULT_SNAPSHOTS;
        private long intervalMs = DEFAULT_INTERVAL_MS;
        private long warmupMs = DEFAULT_WARMUP_MS;
        private Path output;
        private Path jcmd;
        private boolean portable = true;
        private boolean useJcmd;
        private boolean hold;
        private boolean help;
        private boolean list;

        private static Config parse(String[] args) {
            Config config = new Config();
            for (int i = 0; i < args.length; i++) {
                String arg = args[i];
                if ("--help".equals(arg) || "-h".equals(arg)) {
                    config.help = true;
                } else if ("--list".equals(arg)) {
                    config.list = true;
                } else if ("--portable".equals(arg)) {
                    config.portable = true;
                } else if ("--hold".equals(arg)) {
                    config.hold = true;
                } else if (arg.startsWith("--scenario=")) {
                    config.scenario = Scenario.fromCli(arg.substring("--scenario=".length()));
                } else if ("--scenario".equals(arg)) {
                    config.scenario = Scenario.fromCli(nextValue(args, ++i, arg));
                } else if (arg.startsWith("--snapshots=")) {
                    config.snapshots = parseInt(arg.substring("--snapshots=".length()), "snapshots");
                } else if ("--snapshots".equals(arg)) {
                    config.snapshots = parseInt(nextValue(args, ++i, arg), "snapshots");
                } else if (arg.startsWith("--interval-ms=")) {
                    config.intervalMs = parseLong(arg.substring("--interval-ms=".length()), "interval-ms");
                } else if ("--interval-ms".equals(arg)) {
                    config.intervalMs = parseLong(nextValue(args, ++i, arg), "interval-ms");
                } else if (arg.startsWith("--warmup-ms=")) {
                    config.warmupMs = parseLong(arg.substring("--warmup-ms=".length()), "warmup-ms");
                } else if ("--warmup-ms".equals(arg)) {
                    config.warmupMs = parseLong(nextValue(args, ++i, arg), "warmup-ms");
                } else if (arg.startsWith("--output=")) {
                    config.output = Path.of(arg.substring("--output=".length()));
                } else if ("--output".equals(arg)) {
                    config.output = Path.of(nextValue(args, ++i, arg));
                } else if (arg.startsWith("--jcmd=")) {
                    config.jcmd = Path.of(arg.substring("--jcmd=".length()));
                    config.useJcmd = true;
                    config.portable = false;
                } else if ("--jcmd".equals(arg)) {
                    config.jcmd = Path.of(nextValue(args, ++i, arg));
                    config.useJcmd = true;
                    config.portable = false;
                } else {
                    throw new IllegalArgumentException("Unknown option '" + arg + "'.");
                }
            }
            if (config.snapshots < 1) {
                throw new IllegalArgumentException("snapshots must be at least 1");
            }
            if (config.intervalMs < 0 || config.warmupMs < 0) {
                throw new IllegalArgumentException("interval-ms and warmup-ms cannot be negative");
            }
            return config;
        }

        private static String nextValue(String[] args, int index, String option) {
            if (index >= args.length) {
                throw new IllegalArgumentException(option + " requires a value");
            }
            return args[index];
        }

        private static int parseInt(String value, String name) {
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(name + " must be an integer: " + value);
            }
        }

        private static long parseLong(String value, String name) {
            try {
                return Long.parseLong(value);
            } catch (NumberFormatException e) {
                throw new IllegalArgumentException(name + " must be an integer: " + value);
            }
        }

        private static String usage() {
            return String.join(System.lineSeparator(), Arrays.asList(
                    "Usage: java -cp out com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner [options]",
                    "",
                    "  --scenario NAME       Scenario (default: all); use --list for names",
                    "  --snapshots N         Number of snapshots (default: 1)",
                    "  --interval-ms N       Delay between snapshots (default: 1000)",
                    "  --warmup-ms N         Delay before first snapshot (default: 500)",
                    "  --output FILE         Write snapshots to FILE instead of stdout",
                    "  --portable            Use ThreadMXBean formatting (default)",
                    "  --jcmd PATH           Opt in to jcmd/jcmd.exe for this capture",
                    "  --hold                Start the scenario, print READY with the PID, and wait",
                    "  --list                List all scenarios",
                    "  --help                Show this help"));
        }
    }

    private static final class ClassInitializationCoordinator {
        private static volatile CountDownLatch initializerEntered = new CountDownLatch(1);
        private static volatile CompletableFuture<Void> blocker = new CompletableFuture<Void>();

        private static void reset() {
            initializerEntered = new CountDownLatch(1);
            blocker = new CompletableFuture<Void>();
        }
    }

    private static final class ClassInitializationTarget {
        private static final Object VALUE = initialize();

        private static Object initialize() {
            ClassInitializationCoordinator.initializerEntered.countDown();
            ClassInitializationCoordinator.blocker.join();
            return new Object();
        }

        private static void touch() {
            allocationFence(VALUE);
        }
    }

    private static volatile Object classInitializationBlackhole;

    private static void allocationFence(Object value) {
        classInitializationBlackhole = value;
    }
}

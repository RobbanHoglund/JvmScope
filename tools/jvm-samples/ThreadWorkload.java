import java.io.*;
import java.lang.management.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.*;

/** Java 7 API/source compatible. Only this collector's child JVM is inspected. */
public final class ThreadWorkload {
    private static final CountDownLatch RELEASE = new CountDownLatch(1);
    private static final CountDownLatch INIT_STARTED = new CountDownLatch(1);
    private static final List<Thread> WORKERS = new ArrayList<Thread>();
    private static volatile long checksum;
    private static void park() {
        try { RELEASE.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
    private static Thread start(String name, Runnable task) {
        Thread t = new Thread(task, "matrix-" + name);
        t.setDaemon(true); WORKERS.add(t); t.start(); return t;
    }
    private static void state(Thread t, Thread.State expected) throws Exception {
        long deadline = System.nanoTime() + 5000000000L;
        while (t.getState() != expected) {
            if (!t.isAlive() || System.nanoTime() > deadline) throw new IllegalStateException(t.getName() + ": " + t.getState());
            Thread.sleep(10);
        }
    }
    private static String q(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }
    private static class StalledInitialization {
        static { INIT_STARTED.countDown(); park(); }
    }
    private static void initialize() {
        try { Class.forName("ThreadWorkload$StalledInitialization"); } catch (Exception e) { throw new RuntimeException(e); }
    }
    public static void main(String[] args) throws Exception {
        Thread cpu = start("cpu-hot", new Runnable() { public void run() {
            for (;;) { long sum = 0; for (int i = 1; i < 100000; i++) sum += i * (long)i; checksum = sum; }
        }});
        state(cpu, Thread.State.RUNNABLE);
        Thread parked = start("parked", new Runnable() { public void run() { park(); }});
        state(parked, Thread.State.WAITING);
        Thread sleeper = start("sleeping", new Runnable() { public void run() {
            try { Thread.sleep(60000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }});
        state(sleeper, Thread.State.TIMED_WAITING);
        final Object monitor = new Object();
        final CountDownLatch held = new CountDownLatch(1);
        Thread owner = start("monitor-owner", new Runnable() { public void run() { synchronized (monitor) { held.countDown(); park(); } }});
        if (!held.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Monitor owner missing");
        Thread waiter = start("monitor-waiter", new Runnable() { public void run() { synchronized (monitor) { park(); } }});
        state(owner, Thread.State.WAITING); state(waiter, Thread.State.BLOCKED);
        final ReentrantLock lock = new ReentrantLock();
        final CountDownLatch locked = new CountDownLatch(1);
        Thread lockOwner = start("lock-owner", new Runnable() { public void run() { lock.lock(); try { locked.countDown(); park(); } finally { lock.unlock(); } }});
        if (!locked.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Lock owner missing");
        Thread lockWaiter = start("lock-waiter", new Runnable() { public void run() { lock.lock(); try { park(); } finally { lock.unlock(); } }});
        state(lockOwner, Thread.State.WAITING); state(lockWaiter, Thread.State.WAITING);
        start("initializer", new Runnable() { public void run() { initialize(); }});
        if (!INIT_STARTED.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("Initializer missing");
        start("init-waiter", new Runnable() { public void run() { initialize(); }});
        final Object a = new Object(), b = new Object();
        final CountDownLatch bothHeld = new CountDownLatch(2);
        start("deadlock-a", new Runnable() { public void run() { synchronized (a) { bothHeld.countDown(); try { bothHeld.await(); } catch (InterruptedException e) { return; } synchronized (b) { park(); } } }});
        start("deadlock-b", new Runnable() { public void run() { synchronized (b) { bothHeld.countDown(); try { bothHeld.await(); } catch (InterruptedException e) { return; } synchronized (a) { park(); } } }});
        ThreadMXBean mx = ManagementFactory.getThreadMXBean();
        long deadline = System.nanoTime() + 5000000000L;
        while (mx.findMonitorDeadlockedThreads() == null) {
            if (System.nanoTime() > deadline) throw new IllegalStateException("Deadlock not confirmed by JVM");
            Thread.sleep(10);
        }
        Thread.sleep(100);
        PrintWriter out = new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[0]), "UTF-8"));
        out.println("{\"threads\":[");
        for (int i = 0; i < WORKERS.size(); i++) {
            Thread t = WORKERS.get(i); ThreadInfo info = mx.getThreadInfo(t.getId());
            out.print((i == 0 ? "" : ",") + "{\"name\":" + q(t.getName()) + ",\"state\":" + q(info.getThreadState().name()) + ",\"id\":" + t.getId());
            out.print(",\"lockOwner\":" + (info.getLockOwnerName() == null ? "null" : q(info.getLockOwnerName())) + "}");
        }
        out.println("],\"deadlocked\":[\"matrix-deadlock-a\",\"matrix-deadlock-b\"]}"); out.close();
        if (System.getProperty("java.vm.name", "").toLowerCase(Locale.ROOT).contains("openj9")) {
            // Official OpenJ9 API: javaDumpToFile(String) returns the actual path.
            String actual = (String) Class.forName("com.ibm.jvm.Dump").getMethod("javaDumpToFile", String.class).invoke(null, args[1]);
            if (!new File(actual).getCanonicalFile().equals(new File(args[1]).getCanonicalFile()))
                throw new IOException("OpenJ9 wrote the javacore outside the requested sample path");
        }
        System.out.println("READY"); System.out.flush();
        Thread.sleep(60000); // Safety bound for a collector that disappears.
    }
}

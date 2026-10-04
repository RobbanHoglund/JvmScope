package com.robbanhoglund.jvmscope.samples.threaddump;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.locks.ReentrantLock;

/** Standalone, isolated workloads for the public TDA library. Requires Java 21+. */
public final class ThreadLibraryScenarios {
    private static final CountDownLatch RELEASE = new CountDownLatch(1);
    private static final List<Thread> THREADS = new ArrayList<>();
    private static volatile boolean running = true;
    private static volatile long checksum;

    private ThreadLibraryScenarios() { }

    private static void computePrimes() {
        while (running) {
            long sum = 0;
            for (int candidate = 2; candidate < 20_000; candidate++) {
                boolean prime = true;
                for (int divisor = 2; divisor * divisor <= candidate; divisor++) {
                    if (candidate % divisor == 0) { prime = false; break; }
                }
                if (prime) sum += candidate;
            }
            // Publish completed work so the compiler cannot eliminate the computation.
            checksum = sum;
        }
    }

    private static void awaitRelease() {
        try { RELEASE.await(); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private static void sleep() {
        try { Thread.sleep(45_000); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
    }

    private static Thread start(String name, boolean virtual, Runnable task) {
        Thread thread = virtual ? Thread.ofVirtual().name(name).unstarted(task) : new Thread(task, name);
        if (!virtual) thread.setDaemon(true);
        THREADS.add(thread);
        thread.start();
        return thread;
    }

    private static void waitForState(Thread thread, Thread.State... expected) throws InterruptedException {
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!List.of(expected).contains(thread.getState())) {
            if (!thread.isAlive() || System.nanoTime() > deadline) throw new IllegalStateException(thread.getName() + " did not reach " + List.of(expected));
            Thread.sleep(1);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1 || !(args[0].equals("cpu") || args[0].equals("virtual"))) {
            throw new IllegalArgumentException("Usage: ThreadLibraryScenarios cpu|virtual");
        }
        boolean virtual = args[0].equals("virtual");
        String prefix = virtual ? "example-virtual-" : "example-";
        Thread cpu = start(prefix + "cpu-hot-worker", virtual, ThreadLibraryScenarios::computePrimes);
        Thread parked = start(prefix + "parked-worker", virtual, ThreadLibraryScenarios::awaitRelease);
        Thread sleeping = start(prefix + "sleeping-worker", virtual, ThreadLibraryScenarios::sleep);
        waitForState(cpu, Thread.State.RUNNABLE);
        waitForState(parked, Thread.State.WAITING);
        // JDK-8312498: before 21.0.4, timed-parked virtual threads report WAITING.
        if (virtual && Runtime.version().feature() == 21 && Runtime.version().update() < 4)
            waitForState(sleeping, Thread.State.TIMED_WAITING, Thread.State.WAITING);
        else waitForState(sleeping, Thread.State.TIMED_WAITING);
        if (virtual) {
            ReentrantLock lock = new ReentrantLock();
            CountDownLatch held = new CountDownLatch(1);
            Thread owner = start(prefix + "lock-owner", true, () -> {
                lock.lock();
                try { held.countDown(); awaitRelease(); } finally { lock.unlock(); }
            });
            if (!held.await(5, java.util.concurrent.TimeUnit.SECONDS)) throw new IllegalStateException("Lock owner did not start");
            Thread waiter = start(prefix + "lock-waiter", true, () -> {
                lock.lock();
                try { awaitRelease(); } finally { lock.unlock(); }
            });
            waitForState(owner, Thread.State.WAITING);
            waitForState(waiter, Thread.State.WAITING);
        }
        System.out.println("READY " + args[0] + " pid=" + ProcessHandle.current().pid());
        System.out.flush();
        // The collector stops only this child. A forgotten manual run also stops itself.
        try { Thread.sleep(45_000); }
        finally {
            running = false;
            RELEASE.countDown();
            for (Thread thread : THREADS) thread.interrupt();
            for (Thread thread : THREADS) thread.join(1_000);
        }
        System.out.println("Completed checksum=" + checksum);
    }
}

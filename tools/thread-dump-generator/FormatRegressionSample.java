import java.util.concurrent.CountDownLatch;
import java.util.concurrent.locks.ReentrantLock;

/** Controlled JDK 21+ process used by capture-parser-samples.mjs. No application data. */
class FormatRegressionSample {
    private static final Object MONITOR = new Object();
    private static final CountDownLatch HELD = new CountDownLatch(1);

    private static void pause() {
        try { Thread.sleep(60_000); } catch (InterruptedException ignored) { }
    }

    private static void reenter() {
        synchronized (MONITOR) {
            HELD.countDown();
            pause();
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("--mounted")) {
            CountDownLatch running = new CountDownLatch(1);
            Thread.ofVirtual().name("sample-virtual-mounted").start(() -> {
                running.countDown();
                while (true) Thread.onSpinWait();
            });
            running.await();
            System.out.println("READY");
            pause();
            return;
        }
        Thread owner = new Thread(() -> {
            synchronized (MONITOR) { reenter(); }
        }, "sample-owner");
        owner.setDaemon(true);
        owner.start();
        HELD.await();
        Thread waiter = new Thread(() -> {
            synchronized (MONITOR) { }
        }, "sample-waiter");
        waiter.setDaemon(true);
        waiter.start();
        Thread virtual = Thread.ofVirtual().name("sample-virtual-parked").start(FormatRegressionSample::pause);
        Thread quoted = new Thread(FormatRegressionSample::pause, "sample-\"quoted\"");
        quoted.setDaemon(true);
        quoted.start();
        // JDK 26+ file dumps report the AQS blocker's owner. Keep a controlled
        // pair in new-version fixtures without changing the older excerpts.
        ReentrantLock sync = new ReentrantLock();
        CountDownLatch syncHeld = new CountDownLatch(1);
        Thread syncOwner = new Thread(() -> {
            sync.lock();
            try { syncHeld.countDown(); pause(); } finally { sync.unlock(); }
        }, "sample-sync-owner");
        syncOwner.setDaemon(true);
        syncOwner.start();
        syncHeld.await();
        Thread syncWaiter = new Thread(() -> {
            sync.lock();
            try { } finally { sync.unlock(); }
        }, "sample-sync-waiter");
        syncWaiter.setDaemon(true);
        syncWaiter.start();
        while (waiter.getState() != Thread.State.BLOCKED
                || virtual.getState() != Thread.State.TIMED_WAITING
                || quoted.getState() != Thread.State.TIMED_WAITING
                || syncWaiter.getState() != Thread.State.WAITING) Thread.sleep(1);
        System.out.println("READY");
        pause();
    }
}

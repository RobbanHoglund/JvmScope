import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import javax.management.ObjectName;

/** Independent monitor owner; dump files must not already exist. Requires JDK 25. */
class CarrierProbe {
    private static volatile boolean running = true;

    public static void main(String[] args) throws Exception {
        Path directory = Path.of(args[0]).toAbsolutePath();
        Files.createDirectories(directory);
        Object monitor = new Object();
        CountDownLatch held = new CountDownLatch(1);
        Thread owner = Thread.ofVirtual().name("audit-virtual-owner").start(() -> {
            synchronized (monitor) {
                held.countDown();
                while (running) Thread.onSpinWait();
            }
        });
        try {
            held.await();
            Thread waiter = Thread.ofPlatform().daemon().name("audit-platform-waiter").start(() -> {
                synchronized (monitor) { }
            });
            long deadline = System.nanoTime() + 5_000_000_000L;
            while (waiter.getState() != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.sleep(1);
            if (waiter.getState() != Thread.State.BLOCKED) throw new AssertionError("Waiter did not block");
            String classic = (String) ManagementFactory.getPlatformMBeanServer().invoke(
                new ObjectName("com.sun.management:type=DiagnosticCommand"), "threadPrint",
                new Object[]{new String[]{"-e", "-l"}}, new String[]{String[].class.getName()});
            Files.writeString(directory.resolve("carrier-classic.txt"), classic);
            ManagementFactory.getPlatformMXBean(com.sun.management.HotSpotDiagnosticMXBean.class).dumpThreads(
                directory.resolve("carrier-json.json").toString(),
                com.sun.management.HotSpotDiagnosticMXBean.ThreadDumpFormat.JSON);
        } finally {
            running = false;
            owner.join();
        }
    }
}

import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;
import javax.management.ObjectName;

class ConditionProbe {
    public static void main(String[] args) throws Exception {
        ReentrantLock lock = new ReentrantLock();
        Condition condition = lock.newCondition();
        Thread waiter = Thread.ofPlatform().daemon().name("audit-uninterruptible-condition").start(() -> {
            lock.lock();
            try { condition.awaitUninterruptibly(); }
            finally { lock.unlock(); }
        });
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (waiter.getState() != Thread.State.WAITING && System.nanoTime() < deadline) Thread.sleep(1);
        if (waiter.getState() != Thread.State.WAITING || !lock.tryLock()) throw new AssertionError("Condition did not release lock");
        lock.unlock();
        Path directory = Path.of(args[0]).toAbsolutePath();
        Files.createDirectories(directory);
        String classic = (String) ManagementFactory.getPlatformMBeanServer().invoke(
            new ObjectName("com.sun.management:type=DiagnosticCommand"), "threadPrint",
            new Object[]{new String[]{"-e", "-l"}}, new String[]{String[].class.getName()});
        Files.writeString(directory.resolve("condition-classic.txt"), classic);
        ManagementFactory.getPlatformMXBean(com.sun.management.HotSpotDiagnosticMXBean.class).dumpThreads(
            directory.resolve("condition.json").toString(), com.sun.management.HotSpotDiagnosticMXBean.ThreadDumpFormat.JSON);
    }
}

import java.io.PrintWriter;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;

/** A bounded, deliberate allocation workload; never run inside a user application. */
public final class GcWorkload {
    private static volatile Object sink;

    public static void main(String[] args) throws Exception {
        List<byte[]> retained = new ArrayList<byte[]>();
        for (int phase = 0; phase < 4; phase++) {
            for (int i = 0; i < 2500; i++) {
                byte[] block = new byte[64 * 1024];
                block[0] = (byte) i;
                sink = block;
                if (i % 125 == 0) {
                    retained.add(block);
                    Thread.sleep(8);
                }
            }
            System.gc();
            Thread.sleep(100);
        }
        // Deliberately exhaust this small child VM to capture a real pressure
        // sequence and its recovery. Release retained objects before reporting.
        boolean exhausted = false;
        try {
            while (true) retained.add(new byte[256 * 1024]);
        } catch (OutOfMemoryError expected) {
            exhausted = true;
            retained.clear();
            sink = null;
        }
        System.gc();
        Thread.sleep(100);
        try (PrintWriter out = new PrintWriter(args[0], "UTF-8")) {
            out.println("runtime=" + System.getProperty("java.runtime.version"));
            out.println("vendor=" + System.getProperty("java.vendor"));
            out.println("vm=" + System.getProperty("java.vm.name"));
            out.println("pressureReached=" + exhausted);
            for (GarbageCollectorMXBean bean : ManagementFactory.getGarbageCollectorMXBeans()) {
                out.println("collector=" + bean.getName() + "|count=" + bean.getCollectionCount() + "|timeMs=" + bean.getCollectionTime());
            }
        }
    }
}

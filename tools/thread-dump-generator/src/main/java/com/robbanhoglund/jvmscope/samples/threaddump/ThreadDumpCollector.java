package com.robbanhoglund.jvmscope.samples.threaddump;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Captures one or more real HotSpot thread dumps from another JVM.
 *
 * <p>The target process stays independent from the attach operation, which makes
 * mixed deadlock/AQS scenarios reliable and keeps the captured data identical to
 * what operators obtain from {@code jcmd PID Thread.print -e -l}.</p>
 */
public final class ThreadDumpCollector {
    private static final DateTimeFormatter SNAPSHOT_TIME = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

    private ThreadDumpCollector() {
    }

    public static void main(String[] args) throws Exception {
        Config config;
        try {
            config = Config.parse(args);
        } catch (IllegalArgumentException error) {
            System.err.println("Error: " + error.getMessage());
            System.err.println(Config.usage());
            System.exit(2);
            return;
        }

        if (config.help) {
            System.out.println(Config.usage());
            return;
        }

        Path jcmd = config.jcmd != null ? config.jcmd : findJcmd();
        if (jcmd == null || !Files.isRegularFile(jcmd)) {
            throw new IOException("jcmd was not found; pass --jcmd PATH from the JDK being tested");
        }

        StringBuilder result = new StringBuilder();
        for (int snapshot = 0; snapshot < config.snapshots; snapshot++) {
            if (snapshot > 0) {
                Thread.sleep(config.intervalMs);
            }
            OffsetDateTime capturedAt = OffsetDateTime.now();
            String dump = capture(jcmd, config.pid, config.timeoutMs);
            result.append(capturedAt.format(SNAPSHOT_TIME)).append('\n')
                    .append(normalizeDump(dump).trim()).append("\n\n");
        }
        if (result.length() > 0) {
            result.setLength(result.length() - 1);
        }
        writeResult(result.toString(), config.output);
    }

    private static String capture(Path jcmd, String pid, long timeoutMs) throws Exception {
        Process process = new ProcessBuilder(
                jcmd.toString(), pid, "Thread.print", "-e", "-l")
                .redirectErrorStream(true)
                .start();
        StringBuffer output = new StringBuffer();
        Thread reader = new Thread(() -> {
            try {
                output.append(new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
            } catch (IOException ignored) {
                // A timed-out process can close the stream while the reader is active.
            }
        }, "thread-dump-collector-output-reader");
        reader.setDaemon(true);
        reader.start();

        boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        if (!finished) {
            process.destroyForcibly();
            reader.join(2_000L);
            throw new IOException("jcmd timed out after " + timeoutMs + " ms for PID " + pid);
        }
        reader.join(2_000L);
        if (reader.isAlive()) {
            throw new IOException("jcmd output reader did not finish for PID " + pid);
        }
        String text = output.toString();
        if (process.exitValue() != 0) {
            throw new IOException("jcmd exited with " + process.exitValue() + ": " + compact(text));
        }
        if (!text.contains("Full thread dump")) {
            throw new IOException("jcmd returned no full thread dump: " + compact(text));
        }
        return text;
    }

    private static String compact(String text) {
        String normalized = String.valueOf(text).replaceAll("\\s+", " ").trim();
        return normalized.length() <= 500 ? normalized : normalized.substring(0, 500) + "…";
    }

    private static String normalizeDump(String text) {
        return String.valueOf(text)
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replaceAll("(?m)[ \\t]+$", "");
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

    private static final class Config {
        private String pid;
        private int snapshots = 1;
        private long intervalMs = 1_500L;
        private long timeoutMs = 20_000L;
        private Path output;
        private Path jcmd;
        private boolean help;

        private static Config parse(String[] args) {
            Config config = new Config();
            for (int index = 0; index < args.length; index++) {
                String arg = args[index];
                if ("--help".equals(arg) || "-h".equals(arg)) {
                    config.help = true;
                } else if (arg.startsWith("--pid=")) {
                    config.pid = arg.substring("--pid=".length());
                } else if ("--pid".equals(arg)) {
                    config.pid = nextValue(args, ++index, arg);
                } else if (arg.startsWith("--snapshots=")) {
                    config.snapshots = parseInt(arg.substring("--snapshots=".length()), "snapshots");
                } else if ("--snapshots".equals(arg)) {
                    config.snapshots = parseInt(nextValue(args, ++index, arg), "snapshots");
                } else if (arg.startsWith("--interval-ms=")) {
                    config.intervalMs = parseLong(arg.substring("--interval-ms=".length()), "interval-ms");
                } else if ("--interval-ms".equals(arg)) {
                    config.intervalMs = parseLong(nextValue(args, ++index, arg), "interval-ms");
                } else if (arg.startsWith("--timeout-ms=")) {
                    config.timeoutMs = parseLong(arg.substring("--timeout-ms=".length()), "timeout-ms");
                } else if ("--timeout-ms".equals(arg)) {
                    config.timeoutMs = parseLong(nextValue(args, ++index, arg), "timeout-ms");
                } else if (arg.startsWith("--output=")) {
                    config.output = Path.of(arg.substring("--output=".length()));
                } else if ("--output".equals(arg)) {
                    config.output = Path.of(nextValue(args, ++index, arg));
                } else if (arg.startsWith("--jcmd=")) {
                    config.jcmd = Path.of(arg.substring("--jcmd=".length()));
                } else if ("--jcmd".equals(arg)) {
                    config.jcmd = Path.of(nextValue(args, ++index, arg));
                } else {
                    throw new IllegalArgumentException("Unknown option '" + arg + "'.");
                }
            }
            if (!config.help && (config.pid == null || !config.pid.matches("[1-9][0-9]*"))) {
                throw new IllegalArgumentException("pid must be a positive numeric process id");
            }
            if (config.snapshots < 1) {
                throw new IllegalArgumentException("snapshots must be at least 1");
            }
            if (config.intervalMs < 0L || config.timeoutMs < 1L) {
                throw new IllegalArgumentException("interval-ms cannot be negative and timeout-ms must be positive");
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
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException(name + " must be an integer: " + value);
            }
        }

        private static long parseLong(String value, String name) {
            try {
                return Long.parseLong(value);
            } catch (NumberFormatException error) {
                throw new IllegalArgumentException(name + " must be an integer: " + value);
            }
        }

        private static String usage() {
            return String.join(System.lineSeparator(), Arrays.asList(
                    "Usage: java -cp out com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector [options]",
                    "",
                    "  --pid PID             Target JVM process id (required)",
                    "  --snapshots N         Number of snapshots (default: 1)",
                    "  --interval-ms N       Delay between completed captures (default: 1500)",
                    "  --timeout-ms N        Per-jcmd timeout (default: 20000)",
                    "  --output FILE         Write snapshots to FILE instead of stdout",
                    "  --jcmd PATH           jcmd/jcmd.exe from the JDK under test",
                    "  --help                Show this help"));
        }
    }
}

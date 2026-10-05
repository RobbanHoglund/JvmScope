package com.robbanhoglund.jvmscope.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/** Static TLS/TDA delivery only. No file uploads, registry API or filesystem routes. */
public final class SlimServer implements AutoCloseable {
    private static final byte[] HEALTH = "{\"status\":\"UP\",\"application\":\"JvmScope\"}\n".getBytes(StandardCharsets.UTF_8);
    private static final Set<String> PAGES = Set.of("/index.html", "/jvmscope/tls.html", "/jvmscope/tda.html",
        "/knowledge/index.html", "/knowledge/thread-dumps.html", "/knowledge/thread-counters.html",
        "/knowledge/virtual-threads.html", "/knowledge/string-interning.html", "/knowledge/string-memory.html",
        "/knowledge/object-headers.html", "/knowledge/gc-memory.html", "/knowledge/upgrade-checklist.html");
    private static final Pattern HASHED_ASSET = Pattern.compile("/assets/(?:js|css)/[^/]+-[A-Za-z0-9_-]{8,}\\.(?:js|css)");
    private final HttpServer server;
    private final ThreadPoolExecutor workers;
    private final Map<String, Asset> assets;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CountDownLatch stopped = new CountDownLatch(1);
    private final AtomicLong lastIoWarning = new AtomicLong(System.nanoTime() - TimeUnit.SECONDS.toNanos(30));

    record Asset(String path, long length, String digest, String mime, long gzipLength, String gzipDigest) {
        String etag(boolean gzip) { return '"' + (gzip ? gzipDigest : digest) + '"'; }
    }

    record Config(String host, int port, boolean stdinControl) {
        static Config parse(String[] args, Map<String, String> environment) {
            String host = environment.getOrDefault("HOST", "0.0.0.0");
            String port = environment.getOrDefault("PORT", "23873");
            boolean control = false;
            for (String arg : args) {
                if (arg.startsWith("--host=")) host = arg.substring(7);
                else if (arg.startsWith("--port=")) port = arg.substring(7);
                else if (arg.equals("--stdin-control")) control = true;
                else throw new IllegalArgumentException("Unknown argument: " + arg);
            }
            if (host.isBlank() || host.chars().anyMatch(Character::isISOControl)) {
                throw new IllegalArgumentException("HOST must be a non-empty bind address.");
            }
            if (!port.matches("[0-9]{1,5}")) throw new IllegalArgumentException("PORT must be an integer between 1 and 65535.");
            int number = Integer.parseInt(port);
            if (number < 1 || number > 65535) throw new IllegalArgumentException("PORT must be between 1 and 65535.");
            return new Config(host, number, control);
        }
    }

    static {
        // Bound transport resources as well as handler threads. Values are seconds.
        System.setProperty("jdk.httpserver.maxConnections", "64");
        // Keep-alive slots share the same bound as total connections. A lower
        // idle cap closes reused client connections during bursty asset loads.
        System.setProperty("sun.net.httpserver.maxIdleConnections", "64");
        System.setProperty("sun.net.httpserver.idleInterval", "15");
        System.setProperty("sun.net.httpserver.maxReqTime", "10");
        System.setProperty("sun.net.httpserver.maxRspTime", "30");
        System.setProperty("sun.net.httpserver.maxReqHeaderSize", "16384");
    }

    SlimServer(InetSocketAddress address) throws IOException {
        assets = loadAssets();
        server = HttpServer.create(address, 32);
        workers = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32),
            Thread.ofPlatform().name("slim-http-", 0).factory(), new ThreadPoolExecutor.CallerRunsPolicy());
        server.setExecutor(workers);
        server.createContext("/", this::handle);
    }

    static Map<String, Asset> loadAssets() throws IOException {
        try (InputStream input = resource("/web/assets.index");
             BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            Map<String, Asset> result = new HashMap<>();
            for (String line; (line = reader.readLine()) != null;) {
                String[] parts = line.split("\t", -1);
                if (parts.length != 6 || !allowedPath(parts[0]) || !parts[2].matches("[a-f0-9]{64}")
                        || !parts[3].matches("[a-z]+/[a-z0-9.+-]+(?:; charset=utf-8)?")) {
                    throw new IOException("Invalid packaged asset index.");
                }
                long length = Long.parseLong(parts[1]), gzipLength = Long.parseLong(parts[4]);
                if (length < 0 || gzipLength < 0 || gzipLength > length
                        || (gzipLength > 0 ? !parts[5].matches("[a-f0-9]{64}") : !parts[5].equals("-"))) {
                    throw new IOException("Invalid packaged asset length or encoding.");
                }
                Asset asset = new Asset(parts[0], length, parts[2], parts[3], gzipLength, parts[5]);
                if (result.putIfAbsent(asset.path(), asset) != null) throw new IOException("Duplicate packaged asset.");
                // Fail before opening a port if the immutable package is incomplete.
                try (InputStream ignored = resource("/web" + asset.path())) { }
                if (gzipLength > 0) try (InputStream ignored = resource("/web" + asset.path() + ".gz")) { }
            }
            if (!result.keySet().containsAll(PAGES)) throw new IOException("Both TLS and TDA pages must be packaged.");
            return Map.copyOf(result);
        } catch (NumberFormatException exception) {
            throw new IOException("Invalid packaged asset number.", exception);
        }
    }

    private static boolean allowedPath(String path) {
        return (PAGES.contains(path) || path.startsWith("/assets/"))
            && !path.toLowerCase(java.util.Locale.ROOT).contains("dockerutils")
            && path.matches("/[A-Za-z0-9_./-]+")
            && List.of(path.split("/", -1)).stream().skip(1).noneMatch(segment -> segment.isEmpty() || segment.startsWith("."));
    }

    private static InputStream resource(String path) throws IOException {
        InputStream input = SlimServer.class.getResourceAsStream(path);
        if (input == null) throw new IOException("Missing packaged asset: " + path);
        return input;
    }

    void start() { server.start(); }
    int port() { return server.getAddress().getPort(); }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            exchange.getResponseHeaders().set("Referrer-Policy", "strict-origin-when-cross-origin");
            String method = exchange.getRequestMethod();
            if (!method.equals("GET") && !method.equals("HEAD")) {
                exchange.getResponseHeaders().set("Allow", "GET, HEAD");
                exchange.getResponseHeaders().set("Connection", "close");
                reply(exchange, 405, "Method not allowed\n");
                return;
            }
            String length = exchange.getRequestHeaders().getFirst("Content-Length");
            if ((length != null && !length.equals("0")) || exchange.getRequestHeaders().containsKey("Transfer-Encoding")) {
                exchange.getResponseHeaders().set("Connection", "close");
                reply(exchange, 413, "Request bodies are not supported\n");
                return;
            }
            String path = exchange.getRequestURI().getPath();
            if (path == null || path.length() > 2048 || path.indexOf('\\') >= 0 || path.indexOf('%') >= 0
                    || path.chars().anyMatch(Character::isISOControl)
                    || List.of(path.split("/", -1)).stream().anyMatch(segment -> segment.equals(".") || segment.equals(".."))) {
                reply(exchange, 400, "Invalid path\n");
                return;
            }
            if (path.equals("/health")) {
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                write(exchange, HEALTH);
                return;
            }
            if (path.equals("/")) path = "/index.html";
            if (path.equals("/javautils/tls.html") || path.equals("/javautils/tda.html")) {
                String query = exchange.getRequestURI().getRawQuery();
                exchange.getResponseHeaders().set("Location", path.replace("/javautils/", "/jvmscope/")
                    + (query == null ? "" : "?" + query));
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                exchange.sendResponseHeaders(308, -1);
                return;
            }
            Asset asset = assets.get(path);
            if (asset == null) { reply(exchange, 404, "Not found\n"); return; }
            boolean gzip = asset.gzipLength() > 0 && acceptsGzip(exchange.getRequestHeaders().getOrDefault("Accept-Encoding", List.of()));
            String etag = asset.etag(gzip);
            exchange.getResponseHeaders().set("Content-Type", asset.mime());
            exchange.getResponseHeaders().set("Cache-Control", HASHED_ASSET.matcher(path).matches()
                ? "public, max-age=31536000, immutable" : "no-cache");
            exchange.getResponseHeaders().set("ETag", etag);
            if (asset.gzipLength() > 0) exchange.getResponseHeaders().set("Vary", "Accept-Encoding");
            if (gzip) exchange.getResponseHeaders().set("Content-Encoding", "gzip");
            if (matchesEtag(exchange.getRequestHeaders().getOrDefault("If-None-Match", List.of()), etag)) {
                exchange.sendResponseHeaders(304, -1);
                return;
            }
            long size = gzip ? asset.gzipLength() : asset.length();
            exchange.getResponseHeaders().set("Content-Length", Long.toString(size));
            if (method.equals("HEAD")) { exchange.sendResponseHeaders(200, -1); return; }
            try (InputStream input = resource("/web" + path + (gzip ? ".gz" : ""))) {
                exchange.sendResponseHeaders(200, size == 0 ? -1 : size);
                if (size > 0) input.transferTo(exchange.getResponseBody());
            }
        } catch (IOException exception) {
            // A disconnected/slow client is contained to its exchange; do not log
            // user-controlled paths or flood logs with connection resets.
            long now = System.nanoTime(), previous = lastIoWarning.get();
            if (now - previous >= TimeUnit.SECONDS.toNanos(30) && lastIoWarning.compareAndSet(previous, now)) {
                System.err.println("HTTP exchange ended: " + exception.getClass().getSimpleName() + " (warnings limited to one per 30 seconds)");
            }
        }
    }

    static boolean acceptsGzip(List<String> headers) {
        double explicit = -1, wildcard = -1;
        for (String header : headers) for (String item : header.split(",")) {
            String[] parts = item.trim().split(";", -1);
            String encoding = parts[0].trim();
            if (!encoding.equalsIgnoreCase("gzip") && !encoding.equals("*")) continue;
            double quality = 1;
            for (int i = 1; i < parts.length; i++) {
                String parameter = parts[i].trim();
                if (parameter.startsWith("q=")) {
                    String value = parameter.substring(2);
                    quality = value.matches("(?:0(?:\\.[0-9]{0,3})?|1(?:\\.0{0,3})?)") ? Double.parseDouble(value) : 0;
                } else quality = 0;
            }
            if (encoding.equalsIgnoreCase("gzip")) explicit = quality;
            else wildcard = quality;
        }
        return (explicit < 0 ? wildcard : explicit) > 0;
    }

    static boolean matchesEtag(List<String> headers, String etag) {
        return headers.stream().flatMap(header -> List.of(header.split(",")).stream()).map(String::trim)
            .anyMatch(tag -> tag.equals("*") || tag.equals(etag) || tag.equals("W/" + etag));
    }

    private static void reply(HttpExchange exchange, int status, String text) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Length", Integer.toString(bytes.length));
        exchange.sendResponseHeaders(status, exchange.getRequestMethod().equals("HEAD") ? -1 : bytes.length);
        if (!exchange.getRequestMethod().equals("HEAD")) exchange.getResponseBody().write(bytes);
    }

    private static void write(HttpExchange exchange, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Length", Integer.toString(bytes.length));
        exchange.sendResponseHeaders(200, exchange.getRequestMethod().equals("HEAD") ? -1 : bytes.length);
        if (!exchange.getRequestMethod().equals("HEAD")) exchange.getResponseBody().write(bytes);
    }

    @Override public void close() {
        if (!closed.compareAndSet(false, true)) return;
        server.stop(3);
        workers.shutdown();
        stopped.countDown();
    }

    public static void main(String[] args) throws Exception {
        Config config = Config.parse(args, System.getenv());
        SlimServer app = new SlimServer(new InetSocketAddress(config.host(), config.port()));
        Runtime.getRuntime().addShutdownHook(new Thread(app::close, "slim-shutdown"));
        app.start();
        if (config.stdinControl()) {
            // A private inherited pipe is used only by the local supervisor.
            // No public HTTP shutdown endpoint is registered.
            Thread.ofPlatform().name("slim-local-control").daemon().start(() -> {
                try {
                    BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
                    for (String line; (line = reader.readLine()) != null;) {
                        if (line.equals("stop")) { app.close(); return; }
                    }
                } catch (IOException ignored) { }
            });
        }
        System.out.println("JvmScope slim server ready: http://" + config.host() + ":" + app.port());
        app.stopped.await();
    }
}

package com.robbanhoglund.jvmscope.server;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.zip.GZIPInputStream;

/** Real socket/HTTP integration checks; no runtime or test dependencies. */
public final class SlimServerTest {
    private static int checks;
    private static String origin;
    private static HttpClient client;

    private static void check(boolean condition, String description) {
        checks++;
        if (!condition) throw new AssertionError(description);
    }

    private static HttpResponse<byte[]> request(String method, String path, String... headers) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create(origin + path)).timeout(Duration.ofSeconds(5));
        if (headers.length > 0) builder.headers(headers);
        return client.send(builder.method(method, HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String header(HttpResponse<?> response, String name) {
        return response.headers().firstValue(name).orElse("");
    }

    private static int raw(int port, String target, String headers, String body) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 2000);
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(("GET " + target + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" + headers + "\r\n" + body).getBytes(StandardCharsets.UTF_8));
            String reply = new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (reply.isEmpty()) return 0; // JDK drops oversized headers/start lines before invoking the handler.
            return Integer.parseInt(reply.split(" ", 3)[1]);
        } catch (java.net.SocketException reset) { return 0; }
    }

    public static void main(String[] args) throws Exception {
        var defaults = SlimServer.Config.parse(new String[0], Map.of());
        check(defaults.port() == 23873 && defaults.host().equals("0.0.0.0"), "deployment defaults");
        var overridden = SlimServer.Config.parse(new String[] {"--port=23874", "--host=127.0.0.1", "--stdin-control"}, Map.of("PORT", "32000"));
        check(overridden.port() == 23874 && overridden.stdinControl(), "CLI overrides deployment environment");
        check(SlimServer.Config.parse(new String[0], Map.of("PORT", "34567")).port() == 34567, "Railway PORT");
        for (String port : List.of("", "0", "-1", "65536", "NaN", " 23873", "9999999999999")) {
            try { SlimServer.Config.parse(new String[0], Map.of("PORT", port)); throw new AssertionError("Accepted bad port: " + port); }
            catch (IllegalArgumentException expected) { checks++; }
        }
        try { SlimServer.Config.parse(new String[] {"--unknown"}, Map.of()); throw new AssertionError("Accepted unknown option"); }
        catch (IllegalArgumentException expected) { checks++; }

        var app = new SlimServer(new InetSocketAddress("127.0.0.1", 0));
        int port = app.port();
        origin = "http://127.0.0.1:" + port;
        app.start();
        try (var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            client = http;
            var health = request("GET", "/health");
            check(health.statusCode() == 200 && new String(health.body(), StandardCharsets.UTF_8).contains("\"status\":\"UP\""), "real health response");
            check(new String(health.body(), StandardCharsets.UTF_8).contains("\"application\":\"JvmScope\""), "JvmScope health identity");
            check(header(health, "Cache-Control").equals("no-store"), "health never cached");
            for (String path : List.of("/", "/index.html")) {
                var landing = request("GET", path);
                check(landing.statusCode() == 200 && new String(landing.body(), StandardCharsets.UTF_8).contains("Java Knowledge Base"), "toolbox and knowledge landing page");
            }
            var assets = SlimServer.loadAssets();
            for (var notice : Map.of("LICENSE", "JvmScope-LICENSE.txt", "NOTICE", "JvmScope-NOTICE.txt",
                    "THIRD-PARTY-NOTICES.md", "THIRD-PARTY-NOTICES.txt").entrySet()) {
                String path = "/assets/legal/" + notice.getValue();
                check(assets.containsKey(path), "project legal asset packaged: " + path);
                try (var bundled = SlimServerTest.class.getResourceAsStream("/META-INF/" + notice.getKey())) {
                    check(bundled != null, "standalone JAR notice packaged: " + notice.getKey());
                    check(Arrays.equals(bundled.readAllBytes(), request("GET", path).body()), "JAR and delivered notices match");
                }
            }
            for (String analyzer : List.of("tda", "tls")) {
                String legacy = "/javautils/" + analyzer + ".html";
                String canonical = "/jvmscope/" + analyzer + ".html";
                for (String method : List.of("GET", "HEAD")) {
                    var redirect = request(method, legacy + "?cpuProfile=sensitive&search=a%3Fb");
                    check(redirect.statusCode() == 308, "legacy analyzer redirect " + method);
                    check(header(redirect, "Location").equals(canonical + "?cpuProfile=sensitive&search=a%3Fb"), "legacy query retained");
                    check(header(redirect, "Cache-Control").equals("no-store") && redirect.body().length == 0, "redirect has no body/cache");
                }
                check(assets.containsKey(canonical) && !assets.containsKey(legacy), "only canonical page packaged");
            }
            check(assets.keySet().stream().noneMatch(path -> path.contains("dockerutils") || path.contains("utils.html")), "package excludes full app");
            for (var asset : assets.values()) {
                var response = request("GET", asset.path() + "?cache=test");
                check(response.statusCode() == 200, "GET " + asset.path());
                check(response.body().length == asset.length(), "identity length");
                check(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(response.body())).equals(asset.digest()), "identity bytes/hash");
                check(header(response, "Content-Type").equals(asset.mime()), "MIME");
                check(header(response, "X-Content-Type-Options").equals("nosniff"), "no MIME sniffing");
                var head = request("HEAD", asset.path());
                check(head.statusCode() == 200 && head.body().length == 0 && header(head, "Content-Length").equals(Long.toString(asset.length())), "HEAD parity");
                check(request("GET", asset.path(), "If-None-Match", "W/" + header(response, "ETag")).statusCode() == 304, "weak conditional revalidation");
                check(request("GET", asset.path(), "If-None-Match", "\"stale\"").statusCode() == 200, "stale cache fetches current bytes");
                if (asset.path().endsWith(".html")) check(header(response, "Cache-Control").equals("no-cache"), "HTML revalidation");
                if (asset.path().startsWith("/assets/js/") && !asset.path().endsWith("d3.min.js")) check(header(response, "Cache-Control").equals("public, max-age=31536000, immutable"), "fingerprinted script cached immutably");
                if (asset.gzipLength() > 0) {
                    var gzip = request("GET", asset.path(), "Accept-Encoding", "br, gzip;q=0.5");
                    check(header(gzip, "Content-Encoding").equals("gzip") && gzip.body().length == asset.gzipLength(), "gzip encoding/length");
                    try (var zipped = new GZIPInputStream(new ByteArrayInputStream(gzip.body()))) {
                        check(Arrays.equals(zipped.readAllBytes(), response.body()), "compressed asset same content");
                    }
                    check(!header(gzip, "ETag").equals(header(response, "ETag")), "ETags distinguish representations");
                    check(request("GET", asset.path(), "Accept-Encoding", "gzip", "If-None-Match", header(response, "ETag")).statusCode() == 200, "identity ETag cannot validate compressed bytes");
                    check(request("GET", asset.path(), "Accept-Encoding", "gzip", "If-None-Match", header(gzip, "ETag")).statusCode() == 304, "gzip conditional");
                    check(header(request("GET", asset.path(), "Accept-Encoding", "*;q=1, gzip;q=0"), "Content-Encoding").isEmpty(), "explicit gzip refusal overrides wildcard");
                }
            }
            for (String path : List.of("/api/images", "/dockerutils/index.html", "/utils.html", "/web/assets.index", "/assets.index", "/javautils/missing.html", "/jvmscope/missing.html", "/.git/config", "/health/")) {
                var response = request("GET", path);
                check(response.statusCode() == 404 && header(response, "Cache-Control").equals("no-store"), "unpublished path " + path);
                check(request("HEAD", path).body().length == 0, "error HEAD has no body");
            }
            var post = request("POST", "/jvmscope/tls.html");
            check(post.statusCode() == 405 && header(post, "Allow").equals("GET, HEAD"), "uploads/mutations rejected");
            check(raw(port, "/health", "Content-Length: 4\r\n", "test") == 413, "GET bodies rejected without parsing");
            check(raw(port, "/health", "Transfer-Encoding: chunked\r\n", "0\r\n\r\n") == 413, "chunked bodies rejected");
            for (String path : List.of("/assets/../health", "/assets/%2e%2e/health", "/assets/%252e%252e/health", "/assets/%5csecret", "/assets/%00secret", "/" + "x".repeat(2050))) {
                check(raw(port, path, "", "") == 400, "unsafe path rejected " + path.substring(0, Math.min(50, path.length())));
            }
            check(raw(port, "/health", "X-Large: " + "x".repeat(20000) + "\r\n", "") == 0, "transport rejects oversized headers");
            check(raw(port, "/" + "x".repeat(20000), "", "") == 0, "transport bounds request line before URI parsing");
            // A bad client or unrelated missing asset must not poison other exchanges.
            List<CompletableFuture<HttpResponse<byte[]>>> concurrent = new ArrayList<>();
            for (int i = 0; i < 32; i++) concurrent.add(client.sendAsync(HttpRequest.newBuilder(URI.create(origin + (i % 2 == 0 ? "/health" : "/missing"))).build(), HttpResponse.BodyHandlers.ofByteArray()));
            for (int i = 0; i < concurrent.size(); i++) check(concurrent.get(i).get().statusCode() == (i % 2 == 0 ? 200 : 404), "concurrent request containment");
            var largest = assets.values().stream().max(java.util.Comparator.comparingLong(SlimServer.Asset::length)).orElseThrow();
            // Exercise repeated keep-alive reuse with large responses, rather
            // than only one batch of tiny health responses.
            for (int round = 0; round < 4; round++) {
                concurrent.clear();
                for (int i = 0; i < 32; i++) concurrent.add(client.sendAsync(HttpRequest.newBuilder(URI.create(origin + largest.path())).header("Accept-Encoding", "gzip").build(), HttpResponse.BodyHandlers.ofByteArray()));
                for (var pending : concurrent) {
                    var response = pending.get();
                    check(response.statusCode() == 200 && response.body().length == largest.gzipLength(), "burst responses not truncated");
                    check(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(response.body())).equals(largest.gzipDigest()), "burst gzip integrity");
                }
            }
            check(request("GET", "/health").statusCode() == 200, "server remains healthy after bad traffic");
        } finally { app.close(); app.close(); }
        try (var socket = new java.net.ServerSocket()) { socket.setReuseAddress(true); socket.bind(new InetSocketAddress("127.0.0.1", port)); checks++; }
        // Assert the JDK really enforces its connection setting; checking a
        // property string would miss an unsupported/wrong property name.
        try (var limited = new SlimServer(new InetSocketAddress("127.0.0.1", 0))) {
            limited.start();
            List<Socket> sockets = new ArrayList<>();
            try {
                for (int i = 0; i < 80; i++) {
                    var socket = new Socket();
                    try {
                        socket.connect(new InetSocketAddress("127.0.0.1", limited.port()), 2000);
                        socket.setSoTimeout(300);
                        sockets.add(socket);
                    } catch (java.net.ConnectException refused) {
                        socket.close();
                        // Windows may refuse an excess connection before its
                        // handshake finishes, instead of returning EOF later.
                        if (i < 64) throw refused;
                        checks++;
                    }
                }
                check(sockets.size() >= 64, "allowed connections accepted");
                Thread.sleep(100); // Let the real accept loop process the queued connections.
                for (int i = 64; i < sockets.size(); i++) {
                    try { check(sockets.get(i).getInputStream().read() == -1, "connections above 64 rejected"); }
                    catch (java.net.SocketException reset) { checks++; }
                }
                try { sockets.getFirst().getInputStream().read(); throw new AssertionError("allowed connection closed prematurely"); }
                catch (java.net.SocketTimeoutException accepted) { checks++; }
            } finally { for (Socket socket : sockets) socket.close(); }
        }
        System.out.println("PASS: " + checks + " real-server/configuration assertions; port released after graceful shutdown.");
    }
}

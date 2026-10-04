import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.security.KeyStore;
import java.util.Collections;

/** Loopback-only TLS fixture producer. Compiled with --release 8. */
public class TlsRegressionSample {
    public static void main(String[] args) throws Exception {
        boolean server = args[0].equals("server");
        String scenario = args[3];
        KeyStore keys = KeyStore.getInstance("JKS");
        try (InputStream in = new FileInputStream(args[1])) { keys.load(in, "fixture-only".toCharArray()); }
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        km.init(keys, "fixture-only".toCharArray());
        KeyStore trusted = keys;
        if (!server && scenario.equals("untrusted")) {
            trusted = KeyStore.getInstance("JKS");
            trusted.load(null, null);
        }
        TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tm.init(trusted);
        SSLContext context = SSLContext.getInstance("TLS");
        boolean noClientKey = !server && (scenario.equals("optional-client-auth") || scenario.equals("required-client-auth"));
        context.init(noClientKey ? new KeyManager[0] : km.getKeyManagers(), tm.getTrustManagers(), null);
        Thread.currentThread().setName(server ? "sample-server" : "sample-client");
        if (server) {
            try (SSLServerSocket listener = (SSLServerSocket) context.getServerSocketFactory().createServerSocket(0, 5, InetAddress.getLoopbackAddress())) {
                listener.setEnabledProtocols(new String[]{args[2]});
                listener.setSoTimeout(15000);
                if (scenario.equals("optional-client-auth")) listener.setWantClientAuth(true);
                if (scenario.equals("required-client-auth") || scenario.equals("mutual")) listener.setNeedClientAuth(true);
                try (PrintWriter portFile = new PrintWriter(args[4])) { portFile.println(listener.getLocalPort()); }
                for (int i = 0; i < (scenario.equals("resumption") ? 2 : 1); i++) {
                    try (SSLSocket socket = (SSLSocket) listener.accept()) { exchange(socket, true); }
                    catch (Exception e) { e.printStackTrace(); }
                }
            }
        } else {
            for (int i = 0; i < (scenario.equals("resumption") ? 2 : 1); i++) {
                try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket(InetAddress.getLoopbackAddress(), Integer.parseInt(args[4]))) {
                    socket.setEnabledProtocols(new String[]{args[2]});
                    SSLParameters parameters = socket.getSSLParameters();
                    parameters.setServerNames(Collections.singletonList(new SNIHostName("localhost")));
                    socket.setSSLParameters(parameters);
                    exchange(socket, false);
                } catch (Exception e) { e.printStackTrace(); }
            }
        }
    }

    private static void exchange(SSLSocket socket, boolean server) throws Exception {
        socket.setSoTimeout(10000);
        socket.startHandshake();
        if (server) {
            socket.getOutputStream().write(42);
            if (socket.getInputStream().read() != 42) throw new IOException("Loopback echo failed");
        } else {
            if (socket.getInputStream().read() != 42) throw new IOException("Loopback echo failed");
            socket.getOutputStream().write(42);
        }
        System.out.println("RESULT=" + socket.getSession().getProtocol() + "," + socket.getSession().getCipherSuite());
    }
}

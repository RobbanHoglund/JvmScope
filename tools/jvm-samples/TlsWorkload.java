import javax.net.ssl.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.util.*;

/** Java 7 compatible, loopback only; oracle output is separate from JSSE evidence. */
public final class TlsWorkload {
    private static PrintWriter oracle;
    private static void identity() {
        for (String key : new String[]{"java.version", "java.runtime.version", "java.vendor", "java.vm.name", "java.vm.version", "os.name", "os.arch"})
            System.out.println(key + "=" + System.getProperty(key));
    }
    public static void main(String[] args) throws Exception {
        if (args[0].equals("identity")) { identity(); return; }
        if (args[0].equals("probe")) {
            identity(); SSLContext c = SSLContext.getDefault();
            System.out.println("provider=" + c.getProvider().getName() + " " + c.getProvider().getVersion());
            System.out.println("protocols=" + Arrays.toString(c.getDefaultSSLParameters().getProtocols())); return;
        }
        boolean server = args[0].equals("server");
        String scenario = args[3];
        oracle = new PrintWriter(new OutputStreamWriter(new FileOutputStream(args[5]), "UTF-8"), true);
        KeyStore keys = KeyStore.getInstance("JKS");
        InputStream in = new FileInputStream(args[1]); try { keys.load(in, "fixture-only".toCharArray()); } finally { in.close(); }
        KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        km.init(keys, "fixture-only".toCharArray());
        KeyStore trusted = keys;
        if (!server && scenario.equals("untrusted")) {
            trusted = KeyStore.getInstance("JKS");
            InputStream other = new FileInputStream(args[6]);
            try { trusted.load(other, "fixture-only".toCharArray()); } finally { other.close(); }
        }
        TrustManagerFactory tm = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()); tm.init(trusted);
        SSLContext context = SSLContext.getInstance("TLS");
        boolean noKey = !server && (scenario.equals("optional-client-auth") || scenario.equals("required-client-auth"));
        context.init(noKey ? new KeyManager[0] : km.getKeyManagers(), tm.getTrustManagers(), null);
        Thread.currentThread().setName(server ? "matrix-server" : "matrix-client");
        int count = scenario.equals("resumption") ? 2 : 1;
        if (server) {
            SSLServerSocket listener = (SSLServerSocket) context.getServerSocketFactory().createServerSocket(0, 5, InetAddress.getByName("127.0.0.1"));
            listener.setEnabledProtocols(new String[]{args[2]}); listener.setSoTimeout(10000);
            if (scenario.equals("optional-client-auth")) listener.setWantClientAuth(true);
            if (scenario.equals("required-client-auth") || scenario.equals("mutual")) listener.setNeedClientAuth(true);
            PrintWriter port = new PrintWriter(args[4]); port.println(listener.getLocalPort()); port.close();
            System.out.println("READY"); System.out.flush();
            try { for (int i = 0; i < count; i++) { SSLSocket s = (SSLSocket) listener.accept(); exchange(s, true); } }
            finally { listener.close(); }
        } else for (int i = 0; i < count; i++) {
            SSLSocket s = (SSLSocket) context.getSocketFactory().createSocket(InetAddress.getByName("127.0.0.1"), Integer.parseInt(args[4]));
            s.setEnabledProtocols(new String[]{args[2]}); exchange(s, false);
        }
        oracle.close();
    }
    private static void exchange(SSLSocket socket, boolean server) throws Exception {
        try {
            socket.setSoTimeout(8000); socket.startHandshake();
            // Server speaks first. A TLS 1.3 client must read the peer's post-Finished
            // alert before attempting application output, which can instead fail
            // with a Broken pipe and never expose the certificate_required alert.
            if (server) { socket.getOutputStream().write(42); if (socket.getInputStream().read() != 42) throw new IOException("Invalid echo response"); }
            else { if (socket.getInputStream().read() != 42) throw new IOException("Invalid echo greeting"); socket.getOutputStream().write(42); }
            oracle.println("SUCCESS|" + socket.getSession().getProtocol() + "|" + socket.getSession().getCipherSuite());
        } catch (IOException e) { oracle.println("FAILURE|" + e.getClass().getName() + "|" + e.getMessage()); e.printStackTrace(); }
        finally { socket.close(); }
    }
}

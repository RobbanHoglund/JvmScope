jdk17-recovered-read-timeout.txt is a local loopback capture made on 2026-10-14
with OpenJDK 17.0.20+8-1-24.04-Ubuntu and javax.net.debug=ssl,handshake.
The fixture uses a disposable self-signed CN=localhost RSA certificate.
No production service or private key is included.

Reproduction: based on tools/tls-log-generator/TlsRegressionSample.java,
configure TLSv1.2, delay the server's startHandshake by 600 ms, and set the
client SO_TIMEOUT to 100 ms. Retry startHandshake after SocketTimeoutException
(up to 20 times), then set SO_TIMEOUT to 5000 ms and exchange byte 42 in both
directions. Print RESULT only after that echo succeeds. The original log has
six read timeouts, both Finished observations and the successful RESULT line.

This capture guards against treating a recoverable timeout as terminal failure.

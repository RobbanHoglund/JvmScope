> Historical verification record from the predecessor application. Product names and results below describe that earlier build; see the repository README for current JvmScope verification. Command paths below reflect the earlier layout; current launch, build and capture scripts live in `scripts/`.

# Local slim verification — 2026-10-02

Implemented locally in the predecessor repository.
`git pull --ff-only` completed before implementation. The checks below were
completed locally before publication; no deployment was performed during this
verification. This report covers the working diff plus new
slim server/build/config/launch/test files. Generated `build/`, `.run/`, installed
dependencies and existing unrelated application code are excluded from source
review; their executable outputs were used for the checks below.

## Actual verification

| Boundary / command | Result |
| --- | --- |
| `gradlew.bat -p slim assembleSlim -x npmInstall` | Slim frontend, Java server and linked runtime built. 545 existing/new Node checks passed. |
| `gradlew.bat -p slim assembleSlim -x npmInstall -x npmBuild` | Final package rebuilt; 489 real HTTP/socket/configuration assertions passed. |
| `npm run test:slim:ui` | 88 cases passed against the packaged Java runtime/JAR, at 1440×900 and 1366×768. Includes TDA, TLS evidence, timestamps, filtering, keyboard/dialog/clipboard behavior, branding/navigation and no-upload behavior. |
| `npm run build:ci` | Full production bundle built; 545 Node checks and 88 full-version browser cases passed. Full portal/Docker entry points retained. |
| `gradlew.bat test -x npmInstall -x npmBuild` | All 34 existing backend tests passed. |
| `node slim/test/lifecycle.mjs` | Occupied port, cancellation during build, invalid JDK preparation, concurrent/repeated start, unexpected server death, graceful/repeated stop and full-profile isolation passed. |
| `node scripts/local-dev.integration.mjs` | All four full-profile lifecycle scenarios passed. Full app restarted afterward. |
| `node --test scripts/local-dev.test.mjs` | 11 cases passed, including independent build outputs/ports, mutual exclusion, failed/cancelled installation and concurrent recovery of an abandoned install lock. |
| Packaged `run.ps1`, invalid `PORT=0` | Real linked JVM failure propagated; caller's absent and pre-existing `JAVA_TOOL_OPTIONS` values preserved. |
| Bash wrappers from a different directory; PowerShell stop/start/repeated start | Passed using Git Bash and real fixed-port server processes. Final slim and full profiles are both running. |
| `node slim/test/measure.mjs` | Real linked runtime honored HOST/PORT environment without CLI port overrides. All 1,280 requests with 32 concurrent workers returned correct lengths/SHA-256. |
| `git diff --check` | Passed. |

HTTP checks include every packaged resource and both encodings, MIME/HEAD,
HTML revalidation, immutable fingerprinted scripts, representation-specific
ETags, weak/stale validators, unpublished API/portal/Docker paths, rejected
mutations/bodies, encoded traversal, overlong paths, oversized headers/request
lines, concurrent errors mixed with valid requests and port release. A separate
server with 80 raw TCP connections proves the actual limit of 64; this test does
not merely inspect a property string. Both packaged modules were confirmed with
`runtime/bin/java --list-modules`.

## Measurements

Windows x64, Amazon Corretto 25.0.3, linked `java.base` + `jdk.httpserver`.
Latest run: 2026-10-02 10:55 UTC. Numbers include the packaged static frontend.
The tested application JAR SHA-256 is
`e6fcd6ccaf65af1c74449f3acadf18996ff298c583216e310f3d56414cfdf5e6`.

| Measure | Value |
| --- | --- |
| Application JAR | 673,904 bytes (658 KiB) |
| Linked runtime | 32,687,705 bytes (31.2 MiB) |
| Complete package | 33,362,342 bytes (31.8 MiB) |
| New JVM process → successful HTTP health | 389 / 364 / 327 ms |
| Idle working set / private memory | 56.9 / 45.8 MiB |
| After load working set / private memory | 78.6 / 62.7 MiB |
| Process peak working set in latest run | 83.6 MiB |
| Load | 1,280 GETs, 32 concurrent workers, 177,159,936 decoded bytes, 1,387 ms |

Other runs peaked around 69–84 MiB. These are Windows process counters, not
Linux/container memory accounting. Startup excludes Gradle/npm/jlink and does
not flush the OS file cache. Load is a short asset-delivery burst, not an extended
soak test. The browser, dev supervisor, build processes and OS memory are not
included. A full-backend snapshot is retained in `.run/slim-measurements/latest.json`
but is not an equivalent workload comparison. Do not infer a precise production
minimum or cost from these local measurements.

## System review and fixes

The changed contract is a second, independently packaged static TLS/TDA service.
The full API/server and parser logic are independent of this packaging.
Vite entry points and build outputs differ in slim mode. Shared navigation
omits the portal and Docker links from the slim pages; both analyzers share
the same start-panel behavior. Frontend tests retain separate full portal and
slim navigation expectations. The server has no
upload/write/API endpoint, persistent state, registry access or scheduled work.

Build producers are Vite → generated resource index/gzip files → immutable JAR
→ jlink package/container. Read consumers are the two HTML pages, hashed and
stable asset URLs, browser caches and health probes. All are covered at actual
HTTP/browser boundaries. The resource allowlist fails packaging for unexpected
entry points/MIME types and refuses incomplete packages before listening.
Generated cleanup paths are checked against the canonical project build root.

Launcher producers/consumers include both Bash/PowerShell wrapper pairs,
profile-specific state/logs and fixed ports, authenticated private control
endpoints, npm preparation, Gradle child trees, runtime readiness, cancellation,
unexpected process exits and idempotent stop/restart. Both profiles share
`node_modules`; their dependency preparation is serialized and interrupted
installation markers are reconciled by either launcher. Separate recovery
exclusion prevents competing stale-lock recoverers from removing an active
owner's lock. Unrelated/live owners are not killed.

A separate adversarial review identified and fixed:

- **P1 / VERIFIED_RUNTIME / HIGH confidence / LOW fix risk:** the first total
  connection setting used the unsupported `sun.net.httpserver.maxConnections`
  name. The supported `jdk.httpserver.maxConnections` setting is now exercised
  with 80 real sockets and bounded at 64.
- **P2 / VERIFIED_RUNTIME / HIGH confidence / LOW fix risk:** a smaller idle
  connection cap truncated reused connections in repeated Node-client asset
  bursts. Idle capacity now shares the total 64-connection bound. Repeated
  large-response and full-integrity load tests pass afterward.
- **P2 / VERIFIED_STATIC / HIGH confidence / LOW fix risk:** competing recovery
  paths could race while deleting abandoned dependency locks. Recovery is now
  serialized; failed/cancelled actions and competing recovery are tested.
- **P2 / VERIFIED_STATIC, VERIFIED_RUNTIME after fix / HIGH confidence / LOW
  fix risk:** default JVM options in the packaged PowerShell script would persist
  in the caller and restrict later full-app launches. Defaults are now passed as
  arguments to that JVM; absence/existing values are preserved in real launches.
- **P3 / VERIFIED_STATIC / HIGH confidence / LOW fix risk:** repeated disconnected
  clients could flood stderr. Exchange warnings now omit client paths and are
  rate-limited to one per 30 seconds.

No unresolved blocking local findings remain in the reviewed scope. This is
not production/GA validation of the Linux distribution.

## Remaining limits and deployment consequences

- Docker and WSL are not installed here. The Linux Dockerfile has been reviewed
  against current official image tags, JVM module/platform requirements and
  Railway's configuration/binding documentation. It was **not built or run during
  the local verification above**. The subsequent Railway verification below
  covers the Linux build, startup and HTTP delivery. Runtime UID inspection,
  platform SIGTERM handling, browser suites and actual memory/CPU limits still
  need verification on Linux before GA.
- 128 MiB remains a target. Production concurrency, slow clients, prolonged load,
  platform restart/backoff behavior and cgroup memory accounting remain unverified.
  The JDK HTTP server is a minimal HTTP implementation; this is a narrow static
  service behind Railway's HTTPS proxy, not a general backend replacement.
- HTML and stable assets revalidate; only fingerprinted JS/CSS have long immutable
  caching. During rolling replacement, stale HTML can request a retired hashed
  asset. Reload resolves the new package; previous generations are not retained.
- Port 23873 has a different browser origin. Existing full-app preferences/file
  permissions are not migrated. There is no server-side trace data to repair,
  backfill or retain. Existing full-app Docker/OCI behavior is outside this rewrite.
- Direct npm/Gradle installation commands are not managed by the dev launcher's
  lock. Run these sequentially with local development builds. Do not rebuild or
  replace a running slim package. If recovery itself is forcibly interrupted,
  inspect the recorded PID before removing its recovery lock; that rare path
  intentionally fails rather than deleting an uncertain live owner.
- No GraalVM/native build, database, persistent volume or automatic deployment
  was introduced. Runtime/OS security updates require rebuilding the image.

Primary references: [JDK HTTP server properties and scope](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/module-summary.html),
[OpenJDK server implementation](https://github.com/openjdk/jdk/blob/jdk-25%2B36/src/jdk.httpserver/share/classes/sun/net/httpserver/ServerImpl.java),
[Railway config reference](https://docs.railway.com/config-as-code/reference),
[Railway custom config files](https://docs.railway.com/config-as-code).
Timeout units were checked against the actual linked runtime bytecode as well
as OpenJDK source; this JVM converts its request/response values from seconds.

## Railway follow-up — 2026-10-02

The predecessor deployment completed successfully.

The initial GitHub deployment selected Railpack's Java 21 and the root Spring
Boot build. It failed at `bootJar` because the project requires Java 25.
The service had no configured Dockerfile or Railway config file. This was a
build-selection error, not a failure of the slim server.

The predecessor production service was configured with
`RAILWAY_DOCKERFILE_PATH=slim/Dockerfile`, `/health` with a 30-second timeout,
and `ON_FAILURE` with three retries. Its repository root and empty custom
build/start commands are preserved. A fresh deployment from the GitHub source
selected `DOCKERFILE` / `slim/Dockerfile`; redeploying the previous failed
deployment had reused its original build configuration.

| Verified boundary | Result |
| --- | --- |
| Linux Node build stage | All 545 Node tests passed; slim Vite bundle built. |
| Linux Java 25 build stage | `assembleSlim` passed, including all 489 real-server/configuration assertions and graceful test-server shutdown. |
| Final Debian container on Railway | Started the linked JVM and server on `0.0.0.0:8080`, using Railway's injected `PORT` and the image's JVM settings. Deployment health check passed. |
| Public HTTPS `/health` and `/` | HTTP 200 with `status=UP`; root redirects to `/javautils/tls.html`. |
| Public TLS and TDA pages | HTTP 200 with the expected `Java TLS log analyzer` and `Java Thread Dump Analyzer` titles. |
| Nine referenced HTML/JS/CSS/SVG resources | Every downloaded identity response matched its SHA-256 ETag. |
| Public JavaScript gzip and conditional GET | Gzip decompressed to the same bytes, had its own correct SHA-256 ETag, and identity revalidation returned HTTP 304. |

These observations refer to the predecessor's public service.
This changes deployment settings for this service only. The local full/slim
launchers and their fixed ports are unaffected. There is no persistent server
data to migrate or repair. Browser data belongs to the new HTTPS origin.

This is a successful Linux deployment and HTTP smoke check, not a production
load test or completion of the remaining GA checks above. No memory/CPU limit
was changed, and a 128 MiB container minimum remains unverified.

## Constrained Linux image gate, 2026-10-02

The predecessor's `container-ga` job passed in its original CI pipeline.
It built `slim/Dockerfile` and ran three disposable Linux x64 containers with
128 MiB memory, no additional swap, 0.5 CPU and a 64-process limit. It verified
the actual cgroup limits, UID 10001 and read-only runtime. TLS/TDA parsing remains
in Chromium outside the JVM/container.

| Check | Observed result |
| --- | --- |
| Three starts through `/health` | 943, 764, 788 ms, including Docker launch |
| Concurrent static delivery | 32 workers, 72,988 successful requests in 60.6 seconds |
| Integrity | Every response length and SHA-256 matched the packaged asset index |
| Highest sampled cgroup memory | 74,862,592 bytes (71.4 MiB), sampled once per second |
| Browser gate under container limits | 110 Chromium cases passed, desktop and laptop, TLS and TDA |
| Three actual Docker SIGTERM stops | 183, 136, 272 ms; exit 0/143 accepted, forced exit 137 rejected |
| OOM/restart failures | None observed |

The CI artifact `constrained-container-evidence` contains the report, container
logs and any browser failure evidence. These results supersede the earlier
unverified Linux image/UID/SIGTERM/browser/128 MiB short-load items above.
They do not certify a universal minimum or production soak: this is one
architecture/image and one minute of load. Sampled memory is not an exact peak
between samples. Railway service quotas, deployment/restart policy and long
production workloads still require operational sizing; this test changed no
Railway configuration and made no request to the live deployment.

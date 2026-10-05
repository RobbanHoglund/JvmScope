# JvmScope slim

The sole Java application for **JvmScope · Java TLS Log Analyzer** and **JvmScope · Java Thread Dump
Analyzer**. Both tools analyze files entirely in the browser. The server only
delivers their static files and `/health`; it never receives trace contents.

The application includes TLS and TDA and has no external Java libraries. Spring
Boot delivery and Docker/OCI image analysis have been removed. The optional Vite
frontend preview also includes a utilities page. The Java package serves the
home page, both analyzers and the static Java Knowledge Base. Navigation links
switch between them. The root now opens home instead of redirecting to TLS;
direct analyzer links are unchanged.
Both analyzer pages use `analyzer-shell.css` for their UI font and header layout,
with a teal handshake symbol for TLS and a blue thread symbol for TDA.

## Local development

Build requirements: JDK 25 and Node.js 24/npm. A matching JDK is needed for
`jlink`; the generated runtime belongs to the OS/architecture that built it.

From the repository root:

```powershell
.\scripts\start.ps1
.\scripts\stop.ps1
```

```bash
bash ./scripts/start.sh
bash ./scripts/stop.sh
```

Open <http://127.0.0.1:23873/jvmscope/tls.html> or
<http://127.0.0.1:23873/jvmscope/tda.html>. The port is fixed. An occupied port
fails startup without killing its owner. Repeated starts/stops are safe. The
older `start-slim` / `stop-slim` names address the same process and state.
Logs are in `.run/jvmscope-slim/`. Stop requests a graceful server shutdown over
a private inherited pipe, with a bounded fallback for the launcher's own process.
There is no HTTP shutdown endpoint.

The launcher serializes dependency preparation and repairs interrupted
installs through a shared marker. An abandoned install lock is recovered only
after its owner PID has ended; live or invalid owners are never killed. A crash
in the brief recovery step itself leaves a `.run/frontend-install.lock.recovery`
file and fails a later start after a bounded wait. Inspect the PID in that file
before manually removing it. Direct `npm ci` and Gradle dependency-install tasks
are separate operations; run those sequentially with development builds.
Stop slim before rebuilding or replacing its running package, especially on
Windows where the JVM holds its JAR/runtime files open.

## Portable package

```powershell
.\scripts\gradlew.bat build
.\slim\build\package\scripts\run.ps1 --host=127.0.0.1 --port=23873
```

```bash
bash ./scripts/gradlew build
./slim/build/package/scripts/run.sh --host=127.0.0.1 --port=23873
```

The standalone `-p slim assembleSlim` command remains supported and produces
the same package as the root build.

Distribute `slim/build/package/`: `app.jar`, `runtime/`, `scripts/run.sh`, `scripts/run.ps1`.
No installed JDK, Node, npm, database, volume or Docker daemon is required to
run that package on a matching platform. The linked runtime contains only
`java.base` and `jdk.httpserver`. Default JVM settings are 8 MiB initial heap,
64 MiB maximum heap, Serial GC and 256 KiB thread stacks. Heap is only one part
of process memory; a 64 MiB heap does not mean a 64 MiB total memory requirement.

`HOST` defaults to `0.0.0.0`; `PORT` defaults to `23873`. `--host=` and `--port=`
override these environment values. The dev launcher explicitly binds loopback.
Packaged launch scripts apply the default JVM settings only if `JAVA_TOOL_OPTIONS` is unset.
Container JVM settings can be replaced with that environment variable.

## Railway container

Railway remains the Java/container deployment target. The separate
[GitHub Pages build](../docs/GITHUB-PAGES.md) can run alongside it without changing
this package, service configuration or health endpoint.

```bash
docker build -t jvmscope-slim .
docker run --rm -p 23873:23873 --memory=128m --cpus=0.5 jvmscope-slim
```

The root `Dockerfile` builds Slim and is detected by Railway without Railpack
language detection. This also works after the Gradle wrapper has moved to
`scripts/`. Configure the slim Railway service as follows:

- Keep the service root at the repository root; the Dockerfile needs both
  `frontend/` and `slim/` in its build context.
- Leave `RAILWAY_DOCKERFILE_PATH` unset, or set it to `Dockerfile` if an explicit
  path is needed. The root recipe is the default.
- Leave custom build/start commands empty. The image provides its entry point.
- Set the deployment health check to `/health`, with a 30-second timeout.
- Use the `ON_FAILURE` restart policy with three retries.

Start a new deployment from the configured GitHub source after changing these
settings. A redeploy of the previous deployment can reuse its original build
configuration. Confirm that the build uses `Dockerfile` and runs
`scripts/gradlew -p slim assembleSlim`. The root Gradle build delegates to this
same application; neither path builds a Spring Boot JAR.

`slim/Dockerfile` remains available for existing services configured with
`RAILWAY_DOCKERFILE_PATH=slim/Dockerfile`. Both recipes have the same build
directives, checked by the launcher tests; CI builds the root recipe. This is
intentional compatibility duplication, not a second runtime configuration.

`slim/railway.toml` is retained for services already using that legacy config
file. Railway has deprecated Config as Code; new services cannot opt into it.
Do not rely on selecting that file to configure a new service. See
[Dockerfile detection and custom paths](https://docs.railway.com/builds/dockerfiles)
and [legacy configuration support](https://docs.railway.com/config-as-code).

The server listens on `0.0.0.0` and honors Railway's `PORT`. Configure the public
domain's target port to match the service port. HTTPS is terminated by Railway;
the internal listener is HTTP. See
[port binding](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond).

Node, npm, Gradle and the full JDK exist only in build stages. The final image
uses a Debian base, the linked runtime and application JAR, and runs as UID/GID
10001. SIGTERM invokes the server's three-second graceful shutdown. There are
no outbound registry requests, persistent data, authentication sessions or
background jobs. Updating the app/runtime requires rebuilding the image;
the image tags track JDK/OS security updates and are not immutable digests.

128 MiB is a validation target, not a guaranteed minimum. The `container-ga` CI
job builds the real Linux image and verifies 128 MiB without swap and 0.5 CPU,
three cold starts, non-root/read-only operation, 60 seconds of concurrent checked
asset requests, both analyzer browser suites and SIGTERM shutdown. Run it locally
on a Linux Docker host with `docker build -t jvmscope-slim:ga .`
then `node scripts/slim/container-ga.mjs` after installing the frontend browser-test
dependencies. The host requires Docker, Node, Chromium's dependencies and unzip.
Evidence is retained in the `constrained-container-evidence` CI artifact. See
[verification and measurements](VERIFICATION.md) for what was actually tested.

## Verification

```powershell
.\scripts\gradlew.bat -p slim check
cd frontend
npm run test:slim:ui
```

Build `assembleSlim` before the browser suite so it tests the exact linked
runtime/JAR. `check` includes real socket tests for every packaged resource,
gzip/ETag/HEAD behavior, unsupported routes/methods/bodies, traversal rejection,
concurrent requests and graceful shutdown. The same desktop/laptop TLS/TDA
browser cases run against the frontend preview and the packaged application.
Application navigation includes home, TLS/TDA and the knowledge base. The
optional preview utilities page is excluded from the Java package.

```bash
node scripts/slim/lifecycle.mjs
node scripts/slim/measure.mjs
```

The lifecycle smoke test requires the fixed application port to be free and
leaves the application stopped. It checks canonical and alias names, upgrade
cleanup, cancellation, occupied ports and failures. Measurements launch an
isolated server. No test uses the user's live browser capture.

## Delivery contract and limits

Only indexed resources inside the JAR are public; no filesystem directories
are mounted. Requests have bounded connection/header/worker counts and timeouts.
Unsupported methods and request bodies are rejected. Fingerprinted JS/CSS can
be cached for a year; HTML and stable filenames revalidate on every use. Gzip
and identity have separate SHA-256 ETags. A missing file does not affect other
requests. This is a static asset service, not a replacement backend framework.

TLS/TDA file handles, browser preferences and histories belong to their browser
origin. Existing data at port 23872 is not migrated to 23873. A rolling deploy
can return 404 for an old hashed asset requested after its previous instance
has gone away; reload to fetch current HTML/assets. No service worker or
persistent server cache is involved. High connection pressure can cause
backpressure/timeouts; production concurrency sizing still needs Linux testing.

Do not add upload endpoints or registry functionality to this server without
revisiting the runtime, request limits and data-handling contract.

# Development and verification

Run commands from the repository root unless specified otherwise. JDK 25 and
Node.js 24 are the tested build baseline; Gradle is supplied by the wrapper in
`scripts/`. Vite 8 also accepts Node 20.19+ or 22.12+, but CI uses Node 24.

## Layout

| Path | Purpose |
| --- | --- |
| `frontend/jvmscope/` | Analyzer HTML entry points |
| `frontend/assets/javautils/` | Browser analysis, UI and shared styles; internal directory name retained |
| `frontend/public/` | Vendored D3 and static legal notices |
| `frontend/test/` | Node tests, controlled fixtures and Chromium browser tests |
| `slim/src/` | The sole Java server and real HTTP tests, without external libraries |
| `slim/build/package/` | Generated portable package with linked Java runtime |
| `scripts/` | All launch/build/capture/verification commands |
| `tools/` | Source programs used to create controlled JVM examples |
| `testdata/` | Controlled larger thread-dump fixtures and provenance |
| `docs/` | Current guides, roadmap and dated verification records |

Both analyzers use `/jvmscope/`. Legacy `/javautils/tda.html` and `/javautils/tls.html`
redirect with their query strings retained. The Java server serves the
tool-selection home page at `/` (HTTP 200). Docker/OCI image analysis is not part
of JvmScope; container packaging remains.

## Launchers and ports

| Start / stop (PowerShell) | Start / stop (Bash) | Port |
| --- | --- | --- |
| `./scripts/start.ps1`, `./scripts/stop.ps1` | `bash scripts/start.sh`, `bash scripts/stop.sh` | 23873 |
| `./scripts/start-slim.ps1`, `./scripts/stop-slim.ps1` (aliases) | `bash scripts/start-slim.sh`, `bash scripts/stop-slim.sh` (aliases) | Same server, 23873 |

The fixed ports are defined in `scripts/local-dev-config.mjs`. Standard and alias
names share `.run/jvmscope-slim/` state/logs and manage only processes owned by
this checkout. Cancellation or service failure stops that launch's children.
Existing port owners are preserved. During an upgrade, start/stop also gracefully
stop an authenticated former `.run/jvmscope/` supervisor; invalid or unresponsive
live state fails safely. Logs and browser data are not deleted or migrated.

Start checks frontend dependencies, runs tests, builds the linked package, and
starts one Java process. Dependency installation is serialized by the launcher;
avoid direct `npm ci` or Gradle install tasks concurrently with start/build.
Stop before rebuilding a running JAR/runtime, especially on Windows. See the
[server guide](../slim/README.md) for interrupted-install recovery.

Port 23872 is reserved for optional frontend-only development:

```bash
npm run dev --prefix frontend
```

Vite supplies its own static files without a Java backend or analysis API proxy.
The optional frontend preview includes portal pages; the Java package includes
the home page, TLS/TDA and the Java Knowledge Base. Browser preferences and
permissions belong to each origin; changing from 23872 to 23873 does not migrate
them. Reload discards an in-memory session.

## Build and test

PowerShell uses `./scripts/gradlew.bat`; Bash uses `bash ./scripts/gradlew`.

```bash
npm ci --prefix frontend
bash ./scripts/gradlew build -x npmInstall
# Compatible standalone build of the same application:
bash ./scripts/gradlew -p slim assembleSlim -x npmInstall
```

Root build/check/test delegate to the dependency-free `slim` project. Node
parser/model/session/launcher tests run before frontend packaging. Java `check`
runs real socket tests without JUnit, including every packaged asset's bytes,
MIME, HEAD, gzip and ETag. No Spring Boot JAR or Maven runtime dependency is built.
The root LICENSE, NOTICE and THIRD-PARTY-NOTICES.md also ship as web assets,
JAR metadata and portable-package root files. Verify the root copies with
`node scripts/project-legal.mjs --check-package slim/build/package`.

Install Chromium once, then test the exact package:

```bash
cd frontend
npx playwright install chromium
npm run test:slim:ui
# Optional frontend-preview regressions:
npm run build
npx playwright test --config test/tls/playwright.config.js
```

Application frontend output is `slim/build/frontend/`; optional preview output is
`build/frontend/`; GitHub Pages output is `build/pages/`. Keep these separate. Browser tests use isolated loopback
servers and fresh contexts, not the user's running app/capture. They cover desktop
1440 × 900 and laptop 1366 × 768. No mobile support claim is made. Linux CI
installs Chromium OS dependencies with `--with-deps`. Failure evidence is ignored
under `.run/`.

The separate [Pages workflow](../.github/workflows/github-pages.yml) requires
Node/Chromium only. `npm run build:pages --prefix frontend` runs the shared Node
tests and builds for `/JvmScope/`; `npm run test:pages:ui --prefix frontend`
tests an exact-case static server without a Vite fallback. Manual runs on `main`
publish after verification. See [the Pages guide](GITHUB-PAGES.md).

The [CI workflow](../.github/workflows/analyzer-tests.yml) also builds the actual
Linux image and runs `node scripts/slim/container-ga.mjs`. This needs a Linux Docker
host, Node, Chromium dependencies and unzip. It exercises a 128 MiB / 0.5 CPU
container, non-root/read-only operation, startup, concurrent assets, both analyzer
browser suites and SIGTERM. CI artifacts record the result.

Optional launcher checks require port 23873 to be free and leave JvmScope stopped:

```bash
node scripts/local-dev.integration.mjs
# The same suite, through its retained compatibility entry point:
node scripts/slim/lifecycle.mjs
```

## Fixtures and changes

Keep private captures outside the repository or in ignored `captures/`. Never
submit production logs/dumps in tests, issues, screenshots or browser traces.
Use [examples](EXAMPLES.md) and [sample provenance](../testdata/README.md).
Real JVM evidence and synthetic cases must be labelled accurately. Preserve
original IDs/counters/source spans.

Parser/model changes need focused assertions and a real browser integration
check. Shared CSS changes need both analyzers checked. Session changes must
preserve cancellation, ordering, rejected-input recovery and process boundaries.
Missing counters must never become zero measurements. See [TDA tests](../frontend/test/tda/README.md)
and [TLS tests](../frontend/test/tls/README.md) for detailed contracts.

# JvmScope initial snapshot — 2026-10-03

> Historical migration record. The current application has one dependency-free
> Java server; use [development](DEVELOPMENT.md) and [Spring removal](SPRING-REMOVAL.md)
> for current build commands and ports.

## Scope and contracts

The initial snapshot includes tracked source and controlled fixtures from the
predecessor, with no predecessor Git history. Three operational thread dumps
were excluded entirely. The tests for class-initialization waiters and
header-only VM threads now use a new synthetic fixture. An obsolete identifier
check for the removed files was removed; parser and diagnostic tests remain.

Production Java packages now start with `com.robbanhoglund.jvmscope`. The slim
server is in `.server`, and the standalone scenario generator is in
`.samples.threaddump`. Package directories, imports, entry points, JAR manifests,
launch readiness markers, test processes, documentation and container image
names were checked together.

The visible identity is JvmScope. TLS summary exports and slim's health
`application` label now identify JvmScope; `status=UP` is unchanged. Launcher
state lives under `.run/jvmscope/` or `.run/jvmscope-slim/` in this checkout.
Existing `/javautils/` URLs, fixed ports 23871/23872/23873, API request/response
schemas, analysis logic, workers and session data formats are retained. TDA/TLS
captures remain in the browser. The old checkout and its running preview were
not modified or stopped. No server data migration is required.

## Full build correction

A source-only build reproduced a predecessor packaging defect: Vite wrote
directly into Gradle's resource output, and the first `processResources` run
deleted those unowned files before packaging. A successful Gradle build could
therefore produce a JAR without the analyzer pages.

Full Vite output is now `build/frontend/`; `processResources` copies it into
`static/`. Gradle and Vite have separate output directories. Slim's independent
output and packaging are unchanged. Full and slim builds can still coexist.
CI now builds and tests the Spring backend in addition to the frontend before
running the full browser suite.

## Local verification

- 634 Node tests passed across Docker, TDA, TLS and launcher suites.
- 34 Java backend tests passed after the package migration.
- 520 real HTTP/configuration assertions passed for the slim server, including
  its health identity, byte hashes, caching, malformed requests and shutdown.
- 164 full and 164 slim Chromium cases passed on desktop/laptop sizes. Four full
  identity/compatibility cases were rechecked after moving the Vite output.
- The actual Spring Boot JAR passed 24 loopback HTTP checks for health, packaged
  pages, referenced assets, input validation and registry-host rejection.
- Launcher smoke checks passed startup cancellation, preparation failure,
  concurrent starts, readiness and release of both fixed ports.
- The renamed generator compiled and produced two real snapshots that TDA
  parsed successfully. Original controlled runtime fixtures were retained as
  captured, including their historical self-authored package names.
- Source-only packaging checks reproduced the missing-assets defect and
  confirmed the corrected output contains the analyzer pages.
- A separate comparison against the source blobs confirmed the analysis logic
  was not rewritten during migration. Public-file scanning covered archives
  and decoded content. Gitleaks found three intentional fake authorization
  strings in Docker security tests and no identified live credential.

## Limits

The final Linux image and its constrained container gate were not rerun locally;
Docker was unavailable on this machine. Historical deployment reports are
labelled accordingly and do not certify a deployment of this snapshot. CI must
run after the new repository is pushed.

One isolated cold-build attempt hit a transient Windows `EPERM` opening the
dependency-lock test file; its retry and the normal suites passed. This migration
does not change the lock implementation.

Ignore rules now exclude local captures, common credential files and diagnostic
artifacts from Git and the Docker context. Ignore rules and secret scanning do
not establish fixture ownership: review the provenance of every new capture.
The project license remains to be selected before an open-source release.

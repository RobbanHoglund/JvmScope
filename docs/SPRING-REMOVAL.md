# Spring removal — 2026-10-03

## Current application contract

JvmScope has one Java implementation: the dependency-free static server under
`slim/src/`. Root `build`, `check` and `test` delegate to that project. The existing
standalone `-p slim assembleSlim` build remains supported, including Docker's
build path. The portable package remains at `slim/build/package/`.

The root Spring application, controller, properties, five Spring tests, Java
runtime dependencies and Boot/dependency-management plugins have been removed.
There is no alternative Spring JAR, backend service or Actuator endpoint. The
real HTTP/configuration tests in `slim` cover the sole application's delivery.

Standard `scripts/start.*` / `stop.*` and retained `start-slim.*` / `stop-slim.*`
aliases share one supervisor, one linked Java child, `.run/jvmscope-slim/` state,
and fixed port **23873**. Optional Vite development on 23872 serves frontend
files only and has no Java backend or analysis API proxy.

## System consequences and upgrade behavior

- Root build, standalone build, local wrappers, portable launchers, Docker and CI
  all deliver the same Java server. CI retains frontend-preview regression tests
  as an additional browser build target, not a second Java distribution.
- TLS/TDA routes, legacy query-preserving redirects, health checks, static asset
  limits, cache/gzip/ETag behavior, shutdown and Railway `HOST`/`PORT` handling
  retain the existing server's contracts.
- Start/stop detect the former `.run/jvmscope/` state. They validate its checkout
  and token and request graceful shutdown through its authenticated supervisor,
  which stops its owned children. Invalid/unresponsive live state fails safely;
  no process is guessed from a port or killed because it is another Java process.
- Dependency installation retains interrupted-install markers from both old
  launcher paths. Canonical/alias concurrent starts use the same exclusive lock.
  Failure, cancellation and unexpected child exit release the owned state/port.
- Browser analysis, diagnostics, session identity, CPU metrics, source evidence
  and shared CSS behavior are unchanged. Recognition/highlighting of Spring
  frames in analyzed applications remains supported.
- Moving local use from 23872 to 23873 changes the browser origin. Permissions,
  preferences, file handles and in-memory sessions are not migrated. Existing
  tabs and deployed images keep their old code until rebuilt/reloaded.
- Source removal does not patch previously distributed Spring binaries or rewrite
  Git history. Old ignored build artifacts were removed by the clean build here;
  other checkouts should stop the old app and run Gradle `clean` before packaging.
  Prior dependency-advisory and notice findings remain historical evidence in
  [publication review](PUBLICATION-REVIEW.md).

## Verification

The clean root build and retained standalone launcher builds passed on Windows
x64 with JDK 25.0.3+9.

| Check | Result |
| --- | --- |
| Node parser/model/session/catalog/launcher cases | 605 passed |
| Real Java HTTP/configuration suite | 1030 assertions passed, including all indexed assets and legal texts |
| Packaged Chromium desktop/laptop suite | 210 passed |
| Optional Vite frontend preview build/navigation/startup suite | Build passed; 14 browser cases passed |
| Launcher lifecycle | Seven cases passed: invalid legacy state, upgrade/occupied port, cancellation, invalid JDK, concurrent aliases, unexpected exit, graceful/repeated stop |
| Actual script wrappers | All eight PowerShell/Git Bash wrappers passed from outside the repository root; alias PID identity checked; final app left running on 23873 |
| Runtime/dependency/package inspection | No external Java dependencies; no Spring/Boot classes; java.base + jdk.httpserver only; notices retained; previous root backend build outputs absent |
| Documentation | 49 local links/anchors across nine guides resolved with correct case; git diff --check passed |

The separate adversarial pass checked the sole package and all callers, former
launch state, alias races, safe cancellation/failure containment, cache/legal
asset delivery and retained Spring frame recognition. It also exercised null
legacy state, an invalid token, zero PID, an unresponsive live PID and a stale
dead owner. Rejection/cleanup preserved the active application supervisor and
its healthy listener.

Linux Docker is unavailable on this host. The container recipes are unchanged;
the standalone path they use passed locally. The earlier pushed container CI
result is historical evidence, not a new container run of this change.
Use GitHub Actions to verify the updated checks on the current commit before
deploying. Repository visibility and the pending project license/contribution
policy are not changed by the runtime removal.

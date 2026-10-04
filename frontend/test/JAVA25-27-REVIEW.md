> Historical verification record from the predecessor application. Product names and results below describe that earlier build; see the repository README for current JvmScope verification. Command paths below reflect the earlier layout; current launch, build and capture scripts live in `scripts/`.

# TDA/TLS help and Java 25–27 verification — 2026-10-03

Reviewed from synchronized `main` at `dfb6806`. This follow-up updates current
guides and extends runtime evidence; older GA reports remain dated assessments.
No parser, diagnostic rule, shared CSS, backend API or session behavior changed.

## Actual runtime evidence

| Runtime, Windows x64 | TDA | TLS |
| --- | --- | --- |
| Amazon Corretto 25.0.3+9 | Classic `Thread.print -e -l`, file plain/JSON, mounted virtual/carrier | TLS 1.2/1.3, resumption, mutual/optional/required client authentication, untrusted client, compact/expanded output |
| OpenJDK 26.0.2.1+1-7 | Classic, file plain/JSON with parking-owner reports | Same eight endpoint-pair scenarios as Java 25 |
| OpenJDK 27+35-2325 GA | Classic, file plain, default JSON v2, compatibility JSON v1, mounted virtual/carrier | Same eight scenarios, including default TLS 1.3 X25519MLKEM768 hybrid exchange |

TDA retains its 21 controlled runtime excerpts. TLS adds 32 complete console
streams (eight scenarios × two endpoints × two JVM versions), bringing the
catalog to 70. Both integration catalogs enumerate exact filenames and fail on
missing or untested captures. Fixture filenames alone are not version evidence:
the actual runtime build and capture procedure are recorded in the
[TDA guide](tda/README.md), [26/27 source review](tda/JDK26-27-REVIEW.md) and
[TLS guide](tls/README.md).

The official Java 26/27 portable archive SHA-256 hashes were checked again before
running. The existing TLS generator compiled with the installed JDK 25 using
`--release 8`, launched each endpoint on the specified runtime, used an ephemeral
loopback listener and removed temporary key stores/classes. It did not force an
older TLS named group. JVM diagnostics, timestamps, IDs and public certificate
data were retained; only the fixture producer's `RESULT=` markers were removed.

## Relevant format changes

The existing TDA adapters already handle the Java 26 parking owner and Java 27
numeric JSON fields/carrier IDs. Java 27 compatibility v1 remains supported.
Unsafe numeric IDs are rejected; IDs exceeding JavaScript's safe integer range
must remain strings. Modern file dumps do not supply CPU/allocation counters.
Per-thread lock observations are not an atomic deadlock snapshot.
[Oracle's numeric-field announcement](https://inside.java/2026/05/20/quality-heads-up/)
and the pinned OpenJDK comparisons are detailed in the [TDA source review](tda/JDK26-27-REVIEW.md).

The Java 25, 26 and 27 SSLLogger implementations retain the seven-field compact
wrapper, expanded field names, hexadecimal thread IDs and the `kk` clock pattern
(1–24). Java 27 changes logging-option internals and supplies larger hybrid
key-share bodies; the existing record parser accepts both. Expanded output is
diagnostic text, not a guaranteed JSON interchange format.
[OpenJDK 25 SSLLogger](https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/sun/security/ssl/SSLLogger.java),
[OpenJDK 26 SSLLogger](https://github.com/openjdk/jdk/blob/jdk-26-ga/src/java.base/share/classes/sun/security/ssl/SSLLogger.java),
[OpenJDK 27 SSLLogger](https://github.com/openjdk/jdk/blob/jdk-27-ga/src/java.base/share/classes/sun/security/ssl/SSLLogger.java).

Java 27's successful captured ServerHello selects X25519MLKEM768 while the
negotiated protocol remains TLS 1.3 and the cipher remains TLS_AES_256_GCM_SHA384.
The parser and source navigation preserve that evidence. The application does
not expose or diagnose a separate negotiated-key-group field.

## Help-guide corrections

- TDA: formats and Java versions, collection commands, missing counters,
  independently observed locks, JSON v2/v1, browser-local processing.
- TDA: Add versus Replace filter behavior, CPU timeline interval meaning,
  distinct monitor/synchronizer counts, CPU hover versus Details information.
- TDA: left Overview/Locks/History panel and central dump, source/snapshot context,
  literal search and keyboard controls, color hints and reset behavior, exact raw
  copy, separate raw-evidence tab and its lifecycle.
- TDA: recurring RUNNABLE stacks describe recurrence; recurrence alone does not
  establish a hot code path or useful application progress.
- TLS: Java 8–27 format families with real 25–27 verification, correct JVM option
  placement/output capture, expanded-output limits, Java 27 hybrid records,
  capture replacement and in-memory lifetime.
- Current fixture/generator/root READMEs now match the runtime catalog and raw-tab
  UI. Older reports have follow-up links rather than rewritten historical claims.

Both live Help dialogs and their existing interpretation sections were checked
against their controls and call sites. LayerLens has inline import/search help
instead of a Help guide; those labels match its browser-side registry import and
structured search. It is excluded from the slim package and from Java dump/log
compatibility claims.

## System consequences and limits

Help HTML is built into both the full frontend and slim Java distribution. Every
new runtime capture is consumed by parser/detail integration expectations, the
analysis/timeline model and exact sequence/source-span tests. No production-data
repair, persistence migration or upload endpoint is involved. Existing sessions
in already open tabs retain the old guide until reloaded; reloading clears their
in-memory inputs. The user's preview is left running and its session is not
automatically reloaded.

This evidence verifies specific HotSpot/SunJSSE builds on Windows x64, not every
vendor patch, platform or browser. OpenJ9 javacores, custom logger wrappers,
Netty/OpenSSL/other TLS providers and reliable correlation of arbitrarily merged
process or async-engine logs remain outside scope. Neither a missing TDA rule nor
an observed local TLS Finished exchange proves application health. Keep unrelated
JVM captures separate for thread histories and keep TLS endpoint/process logs
separate for interpretation.

## Verification

- `npm run build`: 629 Node tests passed, including 332 TDA unit, 27 TDA
  integration, 96 TLS unit and 92 TLS integration tests; full Vite build passed.
- Slim Vite build and `gradlew -p slim assembleSlim -x npmBuild`: passed,
  including 519 real Java-server/configuration assertions. `npmBuild` was excluded
  only because the just-tested sources had already been built in slim mode.
- Existing Playwright suites: 154 full and 154 slim cases passed, covering both
  desktop (1440 × 900) and laptop (1366 × 768), with no retries.
- Focused Playwright CLI checks: both Help dialogs at both viewports, every TDA
  guide topic link, reachable footers/focus restoration, all nine Java 25–27 TDA
  classic/plain/JSON imports and nine real TLS compact/expanded/required-auth
  imports passed; no unhandled browser errors.
- A separate adversarial pass checked post-Finished rejection on all three JVM
  versions, local/remote alert origins, negotiated TLS 1.3 versus compatibility
  ServerHello fields, Java 27 hybrid bodies, exact source spans across all 70 TLS
  streams, unsafe/absent TDA IDs/counters, missing/reversed/equal clocks, mixed
  process histories and partial source batches. Existing edge-case suites remained
  green; the added real-log assertions exercise the shared UI parser.
- Code/documentation `git diff --check` passed with raw runtime fixtures excluded.
  The new JVM streams deliberately retain JSSE's trailing spaces, mixed
  space/tab indentation and final blank lines; normalizing those to satisfy a
  source-code whitespace check would alter the evidence. No
  parser/diagnostic/shared-style fixes were needed.

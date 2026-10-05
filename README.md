# JvmScope

**Java thread dumps and TLS logs, investigated locally in your browser.**

[![Analyzer release checks](https://github.com/RobbanHoglund/JvmScope/actions/workflows/analyzer-tests.yml/badge.svg)](https://github.com/RobbanHoglund/JvmScope/actions/workflows/analyzer-tests.yml)

JvmScope helps you follow a handshake, investigate a blocked thread, and compare
what changed between JVM snapshots. It links diagnostic observations to the
original evidence instead of treating a missing diagnostic as proof of health.

| Thread Dump Analyzer (TDA) | TLS Log Analyzer |
| --- | --- |
| Add files and pasted dumps to one session | Inspect Java JSSE client or server traces |
| Compare snapshots, thread histories and measured CPU activity | Follow observed handshake messages and alerts |
| Explore monitor deadlocks, contention and dependency graphs | Inspect certificate facts and failure explanations |
| Inspect virtual threads and reported carrier relationships | Filter by time period, host, SNI, direction and outcome |
| Read highlighted stacks beside thread details | Navigate from the inspector to original log lines |
| Follow snapshot-local blocking patterns and export selected findings | Keep partial or contradictory outcomes qualified |

The home page also links to a **Java Knowledge Base** with eight source-backed
articles, local search/version/topic filters and a scoped upgrade comparison.
It distinguishes documented JVM capabilities, actual collection fields and the
generated analyzer evidence below. It does not certify every vendor/update or
recommend tuning flags from a thread dump.

Within TDA's existing dependency map, choose **Follow a blocking pattern** to
inspect unique direct/indirect dependents per snapshot. Priority is explained
by observed dependent count and comparable recurrence; no relations from
different snapshots are combined into a deadlock. **Add to report** captures
one snapshot or the pattern's observed snapshots, with raw references and
editable user notes. Preview and review sensitive content before local Markdown
or HTML export. Findings retain their original evidence when inputs change;
reload removes them. Table filters are recorded context, not exclusions from
blocking evidence. [Implementation and verification](docs/JVMSCOPE-HO-001.md).

Both tools include searchable Help and a **Browse examples** library: 15 thread
examples and 20 TLS examples. Try the four-snapshot CPU-hot program, virtual
workers, a monitor deadlock, or TLS trust and client-authentication failures
without supplying a private capture. [Example guide and provenance](docs/EXAMPLES.md).

## Privacy and scope

Your dump/log contents stay in the browser. Both analyzers run in disposable browser
workers; Clear or replacement inputs terminate pending analysis. The Java server delivers static
files and health checks; it has no upload or analysis API. There is no AI service,
analytics SDK, database, or remote CDN required by the analyzers. Example files
are downloaded from the application server and then analyzed locally.

Sessions live in browser memory and disappear on reload. Raw-evidence tabs,
clipboard copying and exports happen through the corresponding controls.
Raw-view display preferences can be stored in local storage. Browser extensions
and your own hosting/access logs remain outside JvmScope's control.

The UI targets **desktop and laptop**. Large captures are limited by browser
memory and result-transfer costs. TLS tables display up to 200 interactions per page;
filters and timelines use the complete capture. The verified formats are
HotSpot thread dumps and SunJSSE debug traces. OpenJ9 javacores, JFR, GC logs,
Netty/OpenSSL traces and arbitrarily merged processes are outside the current scope.

## Java input compatibility

The target is Java **7–27**. The table describes evidence checked into the
repository and replayed by tests; it is not a certification of every vendor,
patch release, operating system or diagnostic option.

**Captured** = tests replay real controlled JVM output. **Synthetic** = a
representative format fixture, without a real-runtime compatibility claim.
**Unverified** = part of the target, without runtime evidence in this repository.

<!-- JVM-SAMPLES:START -->
### Automated capture evidence

Generated from imported, revalidated captures. Counts cover exact builds and scenarios,
not all patch releases, operating systems or vendors. Earlier fixtures are listed below.

| Java | TDA verified cases | TLS verified cases | TDA distributions | TLS distributions |
| --- | ---: | ---: | --- | --- |
| 7 | 3 | 36 | zulu | zulu |
| 8 | 12 | 324 | [9 distributions](docs/JVM-SAMPLE-RESULTS.md) | [10 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 9 | 2 | 24 | oracle_open_jdk, zulu | oracle_open_jdk, zulu |
| 10 | 3 | 36 | liberica, oracle_open_jdk, zulu | liberica, oracle_open_jdk, zulu |
| 11 | 12 | 336 | [12 distributions](docs/JVM-SAMPLE-RESULTS.md) | [13 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 12 | 4 | 96 | liberica, oracle_open_jdk, sap_machine, zulu | liberica, oracle_open_jdk, sap_machine, zulu |
| 13 | 4 | 96 | liberica, oracle_open_jdk, sap_machine, zulu | liberica, oracle_open_jdk, sap_machine, zulu |
| 14 | 4 | 96 | liberica, oracle_open_jdk, sap_machine, zulu | liberica, oracle_open_jdk, sap_machine, zulu |
| 15 | 5 | 120 | [5 distributions](docs/JVM-SAMPLE-RESULTS.md) | [5 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 16 | 7 | 216 | [7 distributions](docs/JVM-SAMPLE-RESULTS.md) | [8 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 17 | 19 | 504 | [15 distributions](docs/JVM-SAMPLE-RESULTS.md) | [16 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 18 | 7 | 216 | [7 distributions](docs/JVM-SAMPLE-RESULTS.md) | [8 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 19 | 7 | 216 | [7 distributions](docs/JVM-SAMPLE-RESULTS.md) | [8 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 20 | 9 | 264 | [9 distributions](docs/JVM-SAMPLE-RESULTS.md) | [10 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 21 | 74 | 504 | [15 distributions](docs/JVM-SAMPLE-RESULTS.md) | [16 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 22 | 40 | 288 | [10 distributions](docs/JVM-SAMPLE-RESULTS.md) | [11 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 23 | 36 | 264 | [9 distributions](docs/JVM-SAMPLE-RESULTS.md) | [10 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 24 | 36 | 264 | [9 distributions](docs/JVM-SAMPLE-RESULTS.md) | [10 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 25 | 64 | 432 | [15 distributions](docs/JVM-SAMPLE-RESULTS.md) | [16 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 26 | 28 | 216 | [7 distributions](docs/JVM-SAMPLE-RESULTS.md) | [8 distributions](docs/JVM-SAMPLE-RESULTS.md) |
| 27 | 40 | 240 | [6 distributions](docs/JVM-SAMPLE-RESULTS.md) | [7 distributions](docs/JVM-SAMPLE-RESULTS.md) |

[Exact builds, providers, formats and unsuccessful attempts](docs/JVM-SAMPLE-RESULTS.md).
[Run or import the manual capture workflow](docs/JVM-SAMPLES.md).
<!-- JVM-SAMPLES:END -->

<details>
<summary>Earlier controlled fixtures (before the automated workflow)</summary>

### Earlier controlled fixtures

This historical baseline predates the automated vendor capture workflow. Newer
evidence is in the generated table above. The baseline remains replayed by the
original test suites; it does not establish vendor-wide coverage.

| Java release | Thread dumps | TLS / JSSE logs |
| --- | --- | --- |
| 7 | Unverified | Unverified |
| 8 | Synthetic classic format | Captured: legacy 8u252 and compact 8u504 |
| 9–10 | Unverified | Unverified |
| 11 | Unverified | Captured: TLS 1.3 |
| 12–16 (including 15, 16) | Unverified | Unverified |
| 17 | Synthetic classic format | Captured: TLS 1.3 |
| 18–20 | Unverified | Unverified |
| 21 | Captured: classic, file text, JSON | Captured: TLS 1.3 |
| 22 | Unverified | Unverified |
| 23–24 | Captured: classic, file text, JSON | Captured: TLS 1.3 |
| 25 | Captured: classic, file text/JSON, mounted virtual threads, CPU sequence | Captured: TLS 1.2/1.3, authentication, resumption, trust failures, expanded output |
| 26 | Captured: classic, file text/JSON, parking-owner reports | Captured: same eight scenario pairs as Java 25 |
| 27 | Captured: classic, file text, JSON v2/v1, mounted virtual threads | Captured: same eight scenario pairs, including hybrid key-exchange records |

[JDK 27 reached GA on 15 September 2026](https://openjdk.org/projects/jdk/27/).
Actual builds and capture procedures are recorded in the
[TDA tests](frontend/test/tda/README.md#format-coverage) and
[TLS tests](frontend/test/tls/README.md#runtime-samples).
Completing missing release coverage is tracked in the [roadmap](docs/TODO.md).

</details>

Missing measurements remain unavailable, rather than becoming zero. Modern
file dumps do not provide CPU/allocation counters; measured CPU timelines need
comparable adjacent classic snapshots. Per-thread file-dump lock observations
are not an atomic, JVM-confirmed deadlock snapshot. Legacy JSSE traces have
weaker correlation than modern thread-tagged records. Keep unrelated JVMs and
TLS endpoints in separate sessions/captures.

CPU/allocation rates use the finer consistent timestamp or thread elapsed interval.
Collector timestamps are separate from JVM sampling timestamps. Conflicting clocks
retain counter deltas but suppress rates; coarse estimates are labelled and cannot
establish CPU/allocation heat. Missing ServerHello is reported as missing evidence,
not proof of wire order. Conflicting TLS records on one thread remain unknown;
thread identity alone cannot resolve every interleaved connection.

## Run locally

Build requirements: **JDK 25**, **Node.js 24** (the CI baseline), npm, and a modern
desktop browser. Older Java *input* does not mean the server runs on Java 7 or 8.

PowerShell:

```powershell
.\scripts\start.ps1
# Stop when finished:
.\scripts\stop.ps1
```

Bash (Linux, macOS or Git Bash):

```bash
bash ./scripts/start.sh
# Stop when finished:
bash ./scripts/stop.sh
```

Open [Thread dumps](http://127.0.0.1:23873/jvmscope/tda.html) or
[TLS logs](http://127.0.0.1:23873/jvmscope/tls.html).
Start installs dependencies when needed, runs frontend tests, builds the package,
and starts the server in the background. The port is fixed; an occupied port
fails startup without stopping its owner. Launchers only stop their own processes.

The older `start-slim` / `stop-slim` script names are aliases for the same server.
There is one Java application for local use and deployment; it has no Spring
Boot or external Java library dependencies. [Development and tests](docs/DEVELOPMENT.md).

## Package and deploy

The application contains a dependency-free Java HTTP server, the frontend, and
a linked Java 25 runtime. Build a portable package on its target OS/architecture
with `scripts/gradlew build` (PowerShell: `.\scripts\gradlew.bat build`).
The existing `-p slim assembleSlim` command builds the same package. The resulting
`slim/build/package/` runs on a matching platform without an installed JDK or Node.
There are currently no tagged binary releases; build from source.

The root `Dockerfile` builds Slim for Railway or another container host:

```bash
docker build -t jvmscope .
docker run --rm -p 23873:23873 jvmscope
```

On Railway, keep the service root at the repository root and leave custom
build/start commands empty. The server honors `PORT`; health is `/health`.
[Packaging, runtime requirements and Railway settings](slim/README.md).

CI checks the real Linux container under **128 MiB / 0.5 CPU**, including both
analyzers and graceful shutdown. This is a tested configuration, not a universal
minimum-memory guarantee. Java heap and browser-analysis memory are separate.

### GitHub Pages alongside Railway

A separate static build supports GitHub Pages while Railway continues to use
the existing container. The **GitHub Pages** Actions workflow verifies pushes
on `main`; publication requires a manual run on `main`. Private source
repositories need an eligible GitHub plan, and the published site is normally public.

```bash
npm run build:pages --prefix frontend
npm run preview:pages --prefix frontend
```

The local Pages preview opens at `http://127.0.0.1:23874/JvmScope/`. Its independent
`build/pages/` output contains only the analyzers, approved examples and static
assets. User captures stay in the browser on both hosts.
[Setup, verification and the parallel-hosting comparison](docs/GITHUB-PAGES.md).

## Quality and documentation

Release checks run parser/diagnostic/session tests, controlled runtime fixtures,
frontend-preview and packaged-application desktop/laptop browser suites, real Java HTTP-server checks, and
the constrained Linux container gate on pushes to `main` and manual workflow runs.
See [verification and release limits](docs/PUBLICATION-REVIEW.md).

- [Documentation index](docs/README.md): current guides and historical evidence.
- [Examples](docs/EXAMPLES.md): symptoms, provenance and capture programs.
- [Development](docs/DEVELOPMENT.md): builds, tests, ports and repository layout.
- [Scripts](scripts/README.md): launch, stop, capture and verification commands.
- [Roadmap](docs/TODO.md): future analyzers and remaining compatibility work.
- [Sample provenance](testdata/README.md): controlled captures and private-data rules.

## License and issue reports

JvmScope is licensed under [Apache-2.0](LICENSE), with attribution in [NOTICE](NOTICE).
Third-party components and bundled Java runtimes retain their own licenses;
see [third-party notices](THIRD-PARTY-NOTICES.md).

JvmScope is developed and maintained solely by RobbanHoglund. Report bugs,
documentation errors or feature suggestions through
[GitHub Issues](https://github.com/RobbanHoglund/JvmScope/issues).
**External code and documentation contributions are not accepted; pull requests
are disabled.** See the [issue reporting policy](CONTRIBUTING.md) and
[private security reporting](SECURITY.md). Never attach production dumps,
logs or credentials to public issues.

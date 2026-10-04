# Collect and maintain JVM compatibility evidence

The **Capture JVM samples** GitHub Actions workflow is manually invoked. It is
an occasional capture job, not a Java installation matrix on every commit.
It runs standalone controlled programs and the same JavaScript parsers,
temporal analysis and thread dependency graph used in the browser.

## Run a capture

Open **Actions → Capture JVM samples → Run workflow**, select `main`, then choose:

- `versions`: `all`, `7,8,17`, or `27` for a new-release check.
- `vendors`: `all` or catalog IDs such as `zulu,temurin,corretto,semeru`.
- `material`: `all`, `tda`, or `tls`.

The checked-in [manifest](../tools/jvm-samples/matrix.json) is the bounded target
inventory: Java 7–27 and 17 distributions. This does not mean every historical
patch, commercial JVM, vendor or OS is tested. Extend the manifest when the target
changes. The collection platform is Linux x64/glibc; Windows can also run the
local collector against installed JDKs, with its actual platform recorded.

1. The prepare job queries the [Foojay Disco catalog](https://github.com/foojayio/discoapi)
   for one latest available **GA** JDK per selected major and distribution. It
   records the exact package ID, version, download URL and publisher/catalog checksum.
   The catalog's `x64`, `amd64` and `x86_64` labels are accepted as the same
   architecture. EA, JavaFX, musl and other platforms are excluded. Catalog errors are reported
   separately from missing packages.
2. Each available JDK gets an isolated job. A supplied catalog checksum is checked,
   and the downloaded bytes always receive a SHA-256 hash. Older catalogs sometimes
   provide SHA-1/MD5 or no checksum: reports disclose the verification method;
   a locally computed SHA-256 is not claimed to be a publisher-verified checksum.
   Downloads and redirects must use HTTPS. A checksum mismatch fails the job.
   Then `actions/setup-java` installs that exact archive. A separate Java 8 compiler
   produces the Java 7 compatible workload bytecode; Java 7 uses its own compiler.
   Modern virtual-thread code is compiled by the JVM under test. JvmScope itself
   still builds and runs on Java 25; no application toolchain change is needed.
3. The collector only attaches to child processes it created. Child environments
   contain only selected OS/locale/path prerequisites, so CI tokens, injected JVM
   options and private proxy credentials cannot enter a javacore. TDA captures three
   complete classic snapshots containing waiting/sleeping threads, monitor and
   ReentrantLock contention, a stalled initializer, a JVM-confirmed monitor
   deadlock and CPU work. `ThreadMXBean` supplies an independent state/ownership
   oracle. Java 21+ also captures complete text/JSON file dumps and virtual workers;
   Java 27+ additionally captures its JSON v1 compatibility mode.
4. TLS uses an ephemeral test certificate and a loopback-only server. Enabled
   TLS 1.2/1.3 protocols exercise success, trust failure, mutual authentication,
   optional/required client certificates and two connections using one SSLContext.
   The last scenario attempts session reuse; the validator verifies both observed
   connections, not a universal guarantee that the provider resumed them. The
   handshake/echo result supplies an oracle separate from JSSE log interpretation.
   Security policy is not weakened to enable obsolete protocols. Existing older
   TLS 1.0/1.1 fixtures remain in their original tests.
5. Four jobs run concurrently, with fail-fast disabled and per-job timeouts.
   Scenario failures are isolated; remaining captures still run. Runtime identity
   is collected before TLS initialization, so a broken crypto provider does not
   prevent independent thread-dump capture. The report job
   includes unavailable runtimes, discovery/capture/validation errors and jobs with
   missing artifacts. A partial run must never be read as complete coverage.

Cancelling the entire workflow can prevent its final report job from completing.
The plan and artifacts from already finished runtime jobs remain downloadable;
rerun the selected subset, or download those artifacts and use `aggregate` locally
to account explicitly for missing jobs. A cancelled run is never complete coverage.

The workflow has read-only repository permissions. It creates artifacts and a
job summary; it does **not** commit, open a PR or push automatically. A new workflow
must first be on the default branch to appear in GitHub's manual-run UI.
The full capture uses GitHub-hosted runner minutes; subset runs cost less.
The matrix limit is 256 available runtimes. Exceeding it fails visibly and requires
separate subset runs rather than silently dropping entries.

## Import results and update README

Download the **jvm-sample-bundle** artifact into an ignored `.run/` directory:

```powershell
gh run download RUN_ID --name jvm-sample-bundle --dir .run/jvm-import-RUN_ID
node scripts/jvm-samples.mjs import --bundle .run/jvm-import-RUN_ID
node scripts/jvm-samples.mjs check
npm test --prefix frontend
git diff -- README.md docs/JVM-SAMPLE-RESULTS.md testdata/jvm-samples
```

Review and commit the changed fixtures, report JSON, README and detailed results.
The README is generated from **imported evidence**, not from a green job badge or
the requested target list. An artifact by itself does not change the repository's
matrix. Failed attempts are retained in the detailed report, while only verified
samples become permanent fixtures. Raw failures and temporary workload files,
including public-test keystores, stay in artifacts with 30-day retention. JVM
archives are excluded from artifacts and never committed.

The importer replays every supposedly verified capture, checks byte hashes,
rejects duplicate conflicting IDs and unsafe paths, and validates the entire
bundle before writing. Existing evidence is immutable. An interrupted write can
be retried with the same artifact; matching files are kept and docs regenerated.
Separate/new runs create new IDs and do not discard previous verified coverage.
Review partial runs before import; importing their statuses does not make their
failed cases verified. Only import artifacts from a trusted run of this repository.
Historical discovery and capture failures remain attached to their producing
revision. Runtime/tool initialization failures are separate from parser failures;
an identical retry can succeed on another runner without any parser change.

Ordinary `npm test` and release CI replay the permanent captures and reject stale
generated README/results. They do not download JVMs. When a Java release arrives,
extend the target manifest and rerun that version and relevant vendors. This checks
input compatibility, not whether JvmScope's Java 25 server can run on that old JDK.

TLS replay checks diagnostic families against the controlled scenario and endpoint
role. An untrusted client must report trust evidence; the other endpoint may only
observe a remote rejection or socket abort. A protocol-version error cannot stand
in for a trust failure. Client-authentication cases also require CertificateRequest
and a client Certificate message, a presented subject for mutual authentication,
and an explicit empty certificate list for TLS 1.3 cases without a client certificate.
Incomplete or contradictory evidence fails validation instead of being counted as
verified. Capture jobs retain per-case validation errors; imports validate the
entire bundle before writing any evidence or updating the generated matrix.

## Local pilot

Use a Java 8 compiler plus the runtime being tested (absolute JDK home paths):

```powershell
node scripts/jvm-samples.mjs local --major 25 --vendor corretto `
  --java-home "C:\path\to\jdk25" --compiler-home "C:\path\to\jdk8" `
  --run-id local-pilot-001 --output .run/jvm-pilot-001
node scripts/jvm-samples.mjs import --bundle .run/jvm-pilot-001
```

`--material tda` or `--material tls` limits collection. Reusing a run ID/output
directory is rejected; give a retry a new run ID. Local reports have installed
runtime identity, source hashes and actual commands, but no catalog/download
checksum claim. CI reports also record the producing Git commit and run identity.

## Interpretation limits

SunJSSE and HotSpot remain the declared parser scope. OpenJ9 controlled javacores
are captured and recorded as **unsupported format**; IBM JSSE is also recorded
separately, rather than treated as successful HotSpot/SunJSSE evidence. Adding
either parser requires separate implementation and regression tests.
OpenJ9 javacores use its documented
[`javaDumpToFile(String)` API](https://eclipse.dev/openj9/docs/api/jdk8/platform/jvm/com/ibm/jvm/Dump.html);
the collector disables fallback paths and checks the actual output path.

Old classic dumps without CPU counters are valid inputs, but measured CPU rates
remain unavailable. Older file JSON lacks state/virtual flags; verification checks
the available names/stacks and does not invent fields. File-dump lock observations
do not certify an atomic deadlock. Exact source builds/providers/formats, actual
commands, transformations, per-case expectations and SHA-256 hashes are retained
in `testdata/jvm-samples/*.json`. Earlier manual fixtures remain covered by their
existing suites and are explicitly separate from this workflow's evidence.

The virtual workload accepts the older Java 21 `WAITING` report for sleeping
virtual threads before 21.0.4 ([JDK-8312498](https://www.oracle.com/java/technologies/javase/21all-relnotes.html)).
This is a readiness accommodation in the generator, not a parser state rewrite.

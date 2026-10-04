# Public-release readiness — 2026-10-04

## Current contract

JvmScope analyzes HotSpot thread dumps and SunJSSE TLS traces locally in browser
workers. The [README](../README.md) defines Java input support, real versus
synthetic evidence, desktop/laptop scope and interpretation limits. The Java
server has no upload or analysis API. There is one dependency-free Java 25
application; the optional Pages delivery is static.

The project license is [Apache-2.0](../LICENSE), with attribution in
[NOTICE](../NOTICE). The [issue reporting policy](../CONTRIBUTING.md) welcomes
bug reports, documentation corrections and feature suggestions. Development
is handled solely by RobbanHoglund; external code/documentation contributions
are not accepted and GitHub pull requests are disabled. [SECURITY.md](../SECURITY.md)
describes private reporting and the supported branch. These policies do not
promise support response times or certify every Java vendor/patch/browser.

## Verification and boundaries

The reviewed `f47c86b` baseline passed
[Analyzer release checks](https://github.com/RobbanHoglund/JvmScope/actions/runs/37194165404)
and [Pages verification](https://github.com/RobbanHoglund/JvmScope/actions/runs/37194165442):

- 655 Node tests and revalidation of 441 imported JVM reports.
- 232 Chromium desktop/laptop cases against each of the frontend preview, real
  Java package and actual Linux container; 44 strict-static Pages cases.
- 1,044 real Java HTTP/configuration assertions.
- A non-root/read-only Linux container at 128 MiB / 0.5 CPU, including startup,
  concurrent assets, both analyzers and graceful shutdown.

Those counts describe that baseline, not every future revision. Publication
changes additionally require current checks for legal-notice packaging, Pages
byte/hash/HTTP delivery and the Java server. The final review must use Actions
results for the exact revision being published.

Publication preparation on 2026-10-04 passed 656 Node tests, replay of the same
441 JVM reports, 44 Pages browser cases and 1,089 real Java HTTP/configuration
assertions. An isolated portable package passed its root-license byte checks.
This includes negative cases for missing/replaced licenses and stale notices.
The earlier package staging attempt encountered a locked local runtime DLL;
the complete package was then built in an isolated output directory, and the
existing local application's health remained UP.

The history review covered 16 reachable commits and 6,303 unique blobs. No live
credential was identified; three scanner findings were intentional fake values
in removed Docker-analysis tests. A fresh npm audit reported no known advisories.
Pattern scanning is not a guarantee of absence. The source checkout contains
controlled JVM evidence, not production captures. Keep private captures out of
issues, tests, screenshots and workflow artifacts.

Automated browser evidence is Chromium; Firefox/WebKit are not certified.
Windows local and Linux CI evidence exist; macOS packaging is not independently
verified. Captures remain subject to browser memory/transfer limits. Missing
metrics stay unavailable. The generated Java matrix reports exact controlled
runtime builds, rather than universal vendor compatibility.

## Legal-notice delivery

The root LICENSE, NOTICE and THIRD-PARTY-NOTICES.md are the canonical sources.
Every Vite target emits their exact bytes under `assets/legal/`. The Pages
allowlist and verifier require them and reject changed notices even if the
manifest was regenerated. Pages links the project license from its home page.
The Java resource index serves those same assets; `META-INF/` contains copies
for standalone JAR distribution. Portable packages and containers include the
root files and retain the actual vendor's complete runtime legal tree.

`node scripts/project-legal.mjs --check-package slim/build/package` checks the
portable root notices. Parser outcomes, sample bytes, sessions, shared styles,
ports and existing route contracts are outside this change. Existing deployed
images and open browser tabs require rebuilding/redeployment or reload to receive
new assets; source changes do not retroactively change old distributions.

## Complete before public visibility

1. Verify the final revision's tests and publication payload. Review all reachable
   branches/tags and publication artifacts. Private details must also be removed
   from any reachable older commits, not only the current file.
2. Coordinate a history rewrite with anyone using another clone. Keep recovery
   backups outside the public repository. Never merge an old branch back into
   the cleaned history. A force push does not guarantee deletion of GitHub cached
   commit views, old artifacts or other clones; complete erasure may require
   GitHub Support. See [GitHub's history-removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
3. Make repository visibility public only as a separate owner-authorized action.
   Public visibility exposes source, history and repository activity. Check
   historical Actions artifacts as part of the same boundary.

## Repository participation and publication controls

Issues remain enabled and pull requests are disabled through GitHub's repository
feature settings. Only the owner has write access. Issue templates offer bug
reports and feature suggestions; security findings follow SECURITY.md instead
of a public issue. The analyzer and Pages workflows verify pushes to `main` and
manual runs. No external pull-request workflow or automatic closing bot is needed.
The Apache-2.0 license continues to permit independent use and forks.

## Configure when public

GitHub Free supports the following controls on public repositories. They are
not claimed active while this repository remains private:

- Keep the owner as the only writer. After finalizing the initial history,
  protect `main` against force pushes/deletion while retaining owner direct
  pushes. Do not require pull requests or another reviewer's approval: pull
  requests are intentionally disabled. Verify successful `analyzers`,
  `container-ga` and Pages `build` checks on the exact revision before a release.
- Enable private vulnerability reporting and verify the form linked in SECURITY.md.
- Keep Actions repository permissions read-only and prevent Actions from
  approving pull requests. Preserve the disabled pull-request setting when
  changing visibility; issue reporters receive no write or workflow privileges.
- Enable GitHub Actions as the Pages source, restrict the `github-pages`
  environment to `main`, and run the existing manual publication workflow.
- Check live HTTPS navigation, direct links/reload, local files, multi-snapshot
  sessions, clipboard, raw tabs, Help and exports. Confirm the deployed revision
  with `build-info.json`. Keep Railway running during the comparison.

[Pages instructions](GITHUB-PAGES.md) describe publication and hosting differences.
The dated [2026-10-03 review](PUBLICATION-REVIEW-2026-10-03.md) records the original
baseline, former Spring findings and older test gaps; it is historical evidence,
not the current support matrix or remaining release blockers.

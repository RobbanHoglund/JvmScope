# GitHub Pages alongside Railway

JvmScope has two independent delivery targets. Railway continues to run the
existing Java container. GitHub Pages serves only static HTML, scripts, styles,
icons, legal notices and the approved example library. Both use the same TDA/TLS
analysis code and analyze user captures in browser workers.

The Pages workflow is available after these changes reach `main`. A successful
local build does not enable Pages or publish a website.

## Enable and publish

1. Keep the existing Railway service and its Docker settings unchanged.
2. Complete the [publication review](PUBLICATION-REVIEW.md) before making source
   public. GitHub Free supports Pages from a public repository; a private source
   repository requires an eligible paid plan. Visibility is a separate owner decision.
3. Select **GitHub Actions** as the Pages build/deployment source. Keep the
   `github-pages` environment restricted to `main`; existing approval rules apply.
4. Open **Actions → GitHub Pages → Run workflow**, select **main** and run it.
   The job builds and tests before uploading a verified `build/pages/` artifact.
5. The deployment job reports its URL. For this repository, the default address
   is `https://robbanhoglund.github.io/JvmScope/`. Direct tools are under
   `/JvmScope/jvmscope/tda.html` and `/JvmScope/jvmscope/tls.html`.

Pushes to `main` run build/verification **without publishing**.
Only manual runs on `main` publish. A failed build/test prevents deployment and
leaves an earlier published site in place. Publications are queued instead of
cancelling an in-flight deployment. No custom secret or Java runtime is needed.

A Pages website is normally public even when its source repository is private.
Do not treat a private repository as access control for the published application.
See GitHub's [Pages availability and visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)
and [custom workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Hosting terms, account limits and any Actions charges remain account-specific.

## Local build and preview

Node.js 24/npm and Chromium are the test baseline. Run from the repository root:

```bash
npm ci --prefix frontend
npm run build:pages --prefix frontend
npm exec --prefix frontend -- playwright install chromium
npm run test:pages:ui --prefix frontend
npm run preview:pages --prefix frontend
```

The preview uses `http://127.0.0.1:23874/JvmScope/` and binds only to loopback.
Stop it with Ctrl+C. It does not reuse or stop the Java app on port 23873.
It is a strict static server: exact path case, GET/HEAD, no API, proxy or SPA
fallback. This prevents Vite preview from hiding missing-file/routing errors.

| Build | Output | URL prefix | Host |
| --- | --- | --- | --- |
| Java/Railway | `slim/build/frontend/` → packaged JAR | `/` | JDK HTTP server |
| Optional Vite preview | `build/frontend/` | `/` | Vite |
| GitHub Pages | `build/pages/` | `/JvmScope/` | Static host |

The repository name's case matters. To build for another static prefix, use
`node scripts/build-pages.mjs --base /OtherProject/`. The test fixture reads that
base from the artifact. The convenience preview command uses `/JvmScope/`.

## Publication boundary and verification

Pages contains both analyzer pages and a small tool-selection home page. It
excludes the optional portal/utils page, Java code, runtime binaries, private
captures, reports, source maps and the repository's full JVM test archive.
The build checks an explicit file allowlist, requires both worker bundles and
matches each packaged example against the public catalog's SHA-256 hashes.
Filesystem links and unrecognized files fail the build.
The project license and notices are required under `assets/legal/` and checked
byte-for-byte against the root sources, in addition to manifest verification.

`build-info.json` identifies the source commit and base path. For a local build
with uncommitted edits, the revision identifies the base commit rather than the
uncommitted changes; CI builds use the checked-out workflow commit.
`manifest.json` records payload paths, byte lengths and SHA-256 hashes, excluding
its own hash. `node scripts/build-pages.mjs --check` rechecks this boundary and
all HTML asset links before publication. These checks protect packaging; they
do not replace reviewing source changes for secrets or unsafe browser behavior.

Browser tests exercise both tools, all named examples, independent files in one
TDA session, clipboard input, help, raw tabs, JSON thread details, TLS investigation,
worker paths and PNG export at desktop and laptop sizes. Hosting tests verify
every payload file via real HTTP GET/HEAD and assert that synthetic private
content is absent from request URLs, headers, bodies and browser storage.

Pages has no `/health` or legacy `/javautils/` redirects. Its project root opens
the tool chooser; Railway's root still redirects to TLS. The Java host's gzip,
ETag and security headers are not reproduced by the local static test server;
GitHub controls production static headers and caching. Analysis does not require
cross-origin isolation. The apps use system fonts and bundled D3, without a CDN.

Sessions are in memory and cannot move between Railway and Pages. Display
preferences also belong to each browser origin. Other Pages projects on the same
`robbanhoglund.github.io` origin share browser storage/security origin; a project
path is not isolation. User captures are never placed in local storage by JvmScope.
Hosting request/access logs and browser extensions are outside the application's
control. An example download requests only the approved static example file.

## Compare for one or two weeks

Keep Railway running throughout the comparison. For each manual Pages release,
record its `build-info.json` revision and compare against Railway's deployment
revision. If `main` has moved since the last manual publication, the sites may
show different versions until Pages is published again.

Check the same public examples, a local file, a multi-snapshot session, search,
timeline filters, details, raw tabs, help and graph export on both addresses.
Reload and direct links must work without a server analysis endpoint. Do not
submit private captures as workflow artifacts or bug reports.

If Pages has a problem, keep using Railway and publish a reviewed fix manually.
Reverting a shared application commit also affects Railway's next deployment;
coordinate that change rather than assuming the two hosts have separate source.
At the end of the comparison, choose hosting deliberately. This workflow does
not remove Railway, change repository visibility or schedule a shutdown.

The earlier [feasibility study](GITHUB-PAGES-FEASIBILITY.md) is a dated record of
the isolated prototype and its original test counts, not the current workflow.

## Implementation verification — 2026-10-04

The implementation passed 655 Node tests, replay of 441 imported JVM reports,
44 strict-static Pages browser tests and 232 existing frontend-preview browser
tests. Eight Pages-only cases are intentionally skipped in the preview suite.
An isolated build of the updated Railway frontend/JAR passed 1,044 real Java
HTTP/configuration assertions. The running local Java app was preserved.
The new workflow passed actionlint; both root selection cards were also checked
visually at laptop size. The artifact contains 55 files, about 2.4 MB.

A separate second pass challenged wrong-case and legacy paths, missing assets,
root-based links, incomplete workers/examples, modified or duplicated manifest
entries, stale metadata, unexpected files and filesystem links. Network/storage
checks used synthetic content; no private capture was used or published.

The shared change is build-time navigation and output selection. Java routes,
Docker packaging, launcher ports, parsing rules, session state and sample bytes
retain their existing contracts. Pages adds its own root page and URL prefix.
Existing legacy bookmarks on Pages are not repaired with redirects. The local
static checks do not establish GitHub CDN headers, account eligibility or a
successful live deployment; those require the publication job and live checks.

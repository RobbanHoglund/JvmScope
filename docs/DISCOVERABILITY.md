# JvmScope public discovery

The GitHub Pages build (`scripts/build-pages.mjs`) publishes five static,
English-language pages alongside the existing analyzer entry points:

- `java-thread-dump-analyzer.html`: product capabilities, scope, privacy and setup links.
- `java-tls-log-analyzer.html`: SunJSSE input formats, workflow and evidence limits.
- `java-gc-log-analyzer.html`: GC input formats, collectors, file limit and annotation caveats.
- `guides/analyze-java-thread-dump.html`: capture and investigation walkthrough.
- `guides/java-deadlock-analysis.html`: a monitor-deadlock example and evidence limits.

These pages are rendered at build time by `scripts/discovery-pages.mjs`. Their
content is readable without JavaScript; the analyzer itself requires JavaScript.
Claims follow the README compatibility matrix, Java Knowledge Base and checked-in
runtime evidence. Do not turn a targeted release range into vendor certification,
RUNNABLE into measured CPU usage, or sampled graph cycles into JVM confirmation.
Browser privacy statements do not apply to optional evidence sharing with AI hosts.

## Crawl access and publication

The artifact includes `sitemap.xml` with absolute production URLs for the home,
product, guides and knowledge articles. It deliberately excludes captures, build
metadata and generated asset URLs. Canonicals and social metadata use the GitHub
Pages production origin and selected base. No analytics or third-party script is
added. Structured data describes the visible product, with no invented ratings,
endorsements or download counts.

A project-level `https://robbanhoglund.github.io/JvmScope/robots.txt` **cannot**
control crawler access. The effective file is
`https://robbanhoglund.github.io/robots.txt`, owned by the user-site deployment,
not this project. A live check on **2026-11-06** returned **HTTP 404** for that
root URL. No robots.txt exclusion rules were served in that response. A missing
robots.txt is not itself a crawl blocker: RFC 9309 section 2.3.1.3 permits
crawlers to access resources when robots.txt is unavailable (including HTTP 404).
No root-site creation or robots.txt deployment is required for this change.
This check does not establish search indexing, ranking or the absence of other
access restrictions. Recheck the live root response if hosting policy changes.

Reference: [Robots Exclusion Protocol, RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3).

If a root robots file is added later, inspect all its rules before modifying it. To explicitly permit
OpenAI search access to this project, an appropriate root-level rule is:

```text
User-agent: OAI-SearchBot
Allow: /JvmScope/

Sitemap: https://robbanhoglund.github.io/JvmScope/sitemap.xml
```

Integrate this with existing rules; do not overwrite unrelated site policy.
A specific user-agent group does not inherit a wildcard group’s restrictions;
preserve any applicable exclusions in the specific group too.
Allowing OAI-SearchBot is separate from allowing GPTBot/model training.
See [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots).
Search inclusion, recommendations and ranking are not guaranteed.

After merge, use the existing **GitHub Pages → Run workflow → main** publication
flow. The workflow currently checks PRs and main pushes but deploys only when
manually dispatched on main. Confirm the live canonical URLs and sitemap after
that publication. Optionally verify the site in Google Search Console and Bing
Webmaster Tools and submit the sitemap there. Such account operations and any
root-site edits are separate from this branch.

## Validation

```sh
npm ci --prefix frontend
npm run build:pages --prefix frontend
npm run test:pages:ui --prefix frontend
node scripts/build-pages.mjs --check
```

The artifact allowlist and manifest cover the new files. Strict link checks run
against the packaged HTML; HTTP tests cover GET/HEAD delivery. Browser journeys
exercise navigation, keyboard focus, disclosure content and narrow layouts with
JavaScript disabled. Existing Pages journeys retain analyzer/worker coverage.

VS Code, Codex and standalone Java packages do not import the discovery renderer;
this is documentation for the Pages publication, not a release of those packages.

## Website presentation and regression checks

The Pages target shares its navigation and theme through `scripts/website-shell.mjs`.
The landing page, product pages, guides, analyzers and knowledge base follow the
system theme by default. A visitor can choose System, Light or Dark in the header.
Only that display preference is stored (`jvmscope.website.theme`); no capture is
stored by the theme code. If storage is unavailable, the selection works for the
current page. Without JavaScript the static pages remain readable and use the
system color scheme; the theme control is hidden.

The palette is applied only to Pages HTML. Java/slim, VS Code and Codex do not
receive this shell or its theme script. Browser analysis sessions remain local
and in memory; moving between tools does not preserve their loaded captures.

`website-experience.spec.js` exercises navigation through all three analyzers,
loaded samples, a thread stack, knowledge navigation and all product pages. It
also checks explicit overrides against the opposite system theme, reload, live
system changes, storage denial and static content at 320, 390 and 768 pixels.
A 400-thread capture-and-clear case guards against global knowledge-style
selectors slowing analyzer updates. Knowledge styling uses the Pages-only
`data-site-page` attribute instead of a document-wide descendant search.
Analyzer investigation views remain intended for desktop/laptop screens.

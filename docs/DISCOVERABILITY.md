# JvmScope public discovery

The GitHub Pages build (`scripts/build-pages.mjs`) publishes three static,
English-language pages alongside the existing analyzer entry points:

- `java-thread-dump-analyzer.html`: product capabilities, scope, privacy and setup links.
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
not this project. This change does not deploy or modify that site and does not
claim that its current rules or search indexes have been verified.

If a root robots file exists, inspect its rules before modifying it. To permit
OpenAI search access to this project, an appropriate root-level rule is:

```text
User-agent: OAI-SearchBot
Allow: /JvmScope/

Sitemap: https://robbanhoglund.github.io/JvmScope/sitemap.xml
```

Integrate this with existing rules; do not overwrite unrelated site policy.
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

# VS Code delivery: two stages

The desktop extension is generally available (GA). Version 1.0.0 removes the
remaining Preview metadata and listing text. The stages below describe the
implemented architecture and the remaining integration roadmap.

## Stage 1 — working offline extension

Implemented in `extensions/vscode` on top of the existing frontend. One extension
opens separate TDA and TLS panels. It is packaged as an installable VSIX. Building
does not publish to Marketplace or start a Java/HTTP server.

| Area | Implementation |
| --- | --- |
| Analysis | Existing parsers, rules, uncertainty handling and report models |
| Worker execution | Vite inline workers for webviews; ordinary same-origin workers for the website |
| Input | Explicit user-selected files via `workspace.fs`, or the active in-memory editor |
| UI | Shared webviews, searchable help, bundled examples and knowledge pages |
| Host operations | Fixed message protocol for file dialogs, clipboard, raw evidence, exports and documentation links |
| Isolation | Media-only `localResourceRoots`, default-deny CSP, no arbitrary command execution or requested filesystem paths |
| Lifetime | One in-memory panel per analyzer, no automatic persistence; disposable analysis workers |
| Distribution | Reproducible VSIX build and CI artifact, with repository licensing included |

Native file imports preserve the selection order supplied by VS Code. TDA can
compare multiple snapshots; TLS requires a single file. Command imports replace
an analyzer's current input; the in-view Add/Replace control applies to TDA's file
picker and Paste. No source file is modified by analysis.

**Raw dump** opens the shared evidence workspace inside the analyzer webview,
with **Exact** first and selected for every new evidence view. This displays the
complete selected snapshot text. **Annotated** adds thread filters, lock inspection
and links to Details or the dependency graph. Search works in both modes. Returning
to an existing view preserves its current mode, filter and search; display preferences
such as wrapping survive new views, but the initial mode is always Exact.
It retains the webview's CSP and live theme.
Copy uses the native clipboard. **Open as text** is an explicit action for a
read-only virtual text document. Both views belong to the selected snapshot and
are invalidated when it changes or the analysis closes. These are captured
evidence, not a live source editor; source navigation validates original-file
coordinates separately.

The package is a desktop extension. Remote/virtual file providers are accessed
through VS Code APIs without assuming a local filesystem path. Installed-package
CI covers Windows, macOS and Linux. Real remote SSH/Codespaces environments are
not yet covered by that matrix; browser-hosted VS Code (`vscode.dev`) is not supported.

## Stage 2 — deeper editor integration

Version 1.1 adds optional **Analyze with AI** in both analyzer headers. The shared
evidence builder copies the existing analysis model and its qualifications into
a bounded, editable preview. It does not run a second rule engine. TDA scopes the
summary to the selected snapshot; TLS scopes it to the selected interaction (or
an explicitly limited overview). Full raw text is excluded unless requested.

The host protocol accepts only the fixed provider IDs `copilot`, `codex` and
`claude`, with a 256 KiB UTF-8 input bound. Discovery does not activate assistants,
authenticate or request inference. A user-initiated Copilot action selects an
available model through `vscode.lm`, checks its token budget and supports
cancellation. Its output goes to a separate Markdown editor and never rewrites
JvmScope's findings. Only one model request runs at a time. The dialog polls
per-panel job state and exposes Cancel, progress and provider errors. Job IDs
scope cancellation to the owning panel and request. Closing the dialog or
invalidating its evidence cancels the pending work. Every provider await races
against cancellation, with a three-minute total deadline; late results cannot
open an editor or clear a newer job. Error notification dismissal never holds
the job lock.

Codex uses the documented `chatgpt.openSidebar` command after copying the reviewed
prompt. Claude uses its documented `/open` URI without prompt data in the URL;
the clipboard avoids platform URL-size limits. Users paste and submit in those
assistants. No private chat API, shell command, credential reuse or automatic
submission is assumed. Provider accounts and organizational permissions remain
the responsibility of the chosen extension. Detection is limited to assistants
available in the current VS Code window/extension host.

The evidence builders, cancellation/error paths and public launcher boundaries
have unit coverage; packaged browser journeys cover the preview, exact edited
payload, themes, narrow layouts and capture replacement. The installed-extension
CI also exercises real native notification promises, progress cancellation and the response editor with a deterministic provider boundary, without an account. **Live authenticated Copilot inference
and interactive Codex/Claude handoff require a manual smoke test with those
extensions enabled; CI does not submit real diagnostic data or consume quota.**

Integration references (checked 2026-10-17):
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [Codex IDE commands](https://developers.openai.com/codex/ide/commands)
- [Claude Code VS Code integration](https://code.claude.com/docs/en/vs-code#launch-a-vs-code-tab-from-other-tools)

Version 0.2 introduced source navigation and host theme adaptation.
Thread details select their original physical range; TLS event/raw links select
the original log line. Native per-panel registries resolve opaque IDs to captured
URIs and compare normalized content digests before highlighting. They recheck
after opening the editor, reject stale content, and revoke replaced/cleared inputs.
No arbitrary URI from a webview is accepted. Samples and pasted text have no link.

Both analyzers follow live VS Code theme variables, including high-contrast light
and dark, and stack their layouts in narrow panels. Browser tests cover all four
theme families at 600px with contrast/focus checks; these use representative
palettes rather than certifying every third-party theme. The standalone website
and report export palettes remain independent.

The Knowledge Base retains a single webview with an in-memory Back/Forward
history. Returning restores each page's controls, search, scroll and focus;
the article's Knowledge base link restores prior results when available.
The native Open Knowledge Base command resumes the current reading session.
Explicit article links still apply their requested route/version/fragment, and
readiness is reported only after the knowledge navigation listener is installed.
History is bounded to 30 entries and is discarded when the tab closes.

Version 0.3 added a native Activity Bar tree: files → snapshots → threads and
file → TLS interactions → observed events. Branches request at most 100 labels
and opaque keys at a time from the existing webviews. Clicking a node reveals its
owning panel and selects the exact object. Every successful analysis publishes a
new revision; replacement, clear and panel disposal invalidate old nodes and
in-flight replies. Rejected TDA input preserves the previous analysis and tree.

TLS tree labels reuse the outcome/uncertainty models, and event branches reuse
the inspector's observed-sequence model. Ambiguous legacy grouping has no
attributable event children. The native host does not parse captures or invent
additional findings. Tree metadata is transient and contains no raw stack/log
blocks. The extension's read-only `getAnalysisItems(analyzer, parentId?)` API
exposes this same paged metadata for editor integrations and extension-host tests.

Remaining roadmap:
3. **Problems diagnostics:** surface only evidence-backed findings, with source
   ranges and qualified wording; unsupported/missing input is not a clean bill of health.
4. **Refresh:** offer explicit reanalysis and optional file watching with cancellation,
   debouncing and a visible stale-analysis state.
5. **Accessibility:** extend real VS Code keyboard and screen-reader coverage.
6. **Session handling:** restore view preferences separately from sensitive capture
   contents; persistence of raw logs requires an explicit design and user choice.
7. **Release matrix:** extend the installed-package checks to real remote workspaces
   and verify Marketplace installation and signed artifacts after publication.

Avoid duplicating analysis logic in the extension host. Any new rule or change of
meaning belongs in the shared models with JVM-fixture and UI regression coverage.

## Verification

- Existing frontend tests remain the analysis-rule gate.
- Extension unit tests cover native-message validation, limits, dirty/virtual
  documents, packaged asset paths, CSP and route restrictions. Sidebar tests cover
  pagination, duplicate names, revision changes, disposal and invalid replies.
- Browser tests load the production extension assets with the same CSP, inline
  workers and a simulated host transport. CI extracts the validated VSIX and sets
  `VSCODE_TEST_EXTENSION_ROOT` to its `extension` directory, so these tests use
  the delivered host modules and webview assets. They cover TDA/TLS results, host actions,
  exact sidebar selections, hidden filters, bundled examples and stale requests.
- Extension-host tests run inside a real isolated VS Code, activating commands,
  loading real captures in both webviews, comparing snapshots, reading an
  unsaved editor, selecting original evidence, rejecting a changed document and
  navigating the native sidebar across hidden retained webviews. This catches webview-resource/CSP differences that mocks cannot.
- `VS Code extension checks` builds and uploads the VSIX without publishing it.
- The actual VSIX must have `preview: false`, no `Preview` gallery flag and no
  pre-release channel property. The package validator rejects regressions.

## Release and Marketplace publication

Version 1.0.0 is the stable baseline for
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Breaking changes to
documented commands or the public `getAnalysisItems` API require a new major;
compatible features use a minor and compatible bug fixes use a patch. Correcting
incorrect findings is a bug fix, even when the displayed findings change. The
internal webview message protocol is not a public integration API.

The `preview` manifest field controls the Marketplace Preview badge independently
of the version number. A stable GA package uses `preview: false` and is built
without `--pre-release`.

After merging a release, download and unzip the `jvmscope-vscode` artifact from the
successful **VS Code extension checks** run on main. Publish that validated VSIX as
a new stable version of the existing **RobbanHoglund.jvmscope** extension using the
publisher account. Building or merging alone does not update Marketplace metadata.
Users must then install the new version to receive the updated package metadata.

Primary API references:
- https://code.visualstudio.com/api/references/extension-manifest
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/working-with-extensions/testing-extension
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension

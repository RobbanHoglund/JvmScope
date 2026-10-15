# VS Code delivery: two stages

## Stage 1 — working offline extension

Implemented in `extensions/vscode` on top of the existing frontend. One extension
opens separate TDA and TLS panels. It is packaged as an installable VSIX; the first
iteration does not publish to Marketplace or start a Java/HTTP server.

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

The raw snapshot viewer is a read-only virtual text document, owned by its
analyzer panel. It is invalidated when the capture changes or closes. It is not a
live source editor and does not claim that line numbers still match an edited
source file.

The package is a desktop extension. Remote/virtual file providers are accessed
through VS Code APIs without assuming a local filesystem path. Real remote
SSH/Codespaces environments and all operating systems are not yet certified by
this initial Linux integration run.

## Stage 2 — deeper editor integration

The 0.2 preview implements source navigation and host theme adaptation.
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

The 0.3 preview adds a native Activity Bar tree: files → snapshots → threads and
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
7. **Release matrix:** exercise Windows/macOS/Linux and remote workspaces; verify
   the Marketplace publisher, icon, listing, release channels and signed artifacts.

Avoid duplicating analysis logic in the extension host. Any new rule or change of
meaning belongs in the shared models with JVM-fixture and UI regression coverage.

## Verification

- Existing frontend tests remain the analysis-rule gate.
- Extension unit tests cover native-message validation, limits, dirty/virtual
  documents, packaged asset paths, CSP and route restrictions. Sidebar tests cover
  pagination, duplicate names, revision changes, disposal and invalid replies.
- Browser tests load the production extension assets with the same CSP, inline
  workers and a simulated host transport; they cover TDA/TLS results, host actions,
  exact sidebar selections, hidden filters, bundled examples and stale requests.
- Extension-host tests run inside a real isolated VS Code, activating commands,
  loading real captures in both webviews, comparing snapshots, reading an
  unsaved editor, selecting original evidence, rejecting a changed document and
  navigating the native sidebar across hidden retained webviews. This catches webview-resource/CSP differences that mocks cannot.
- `VS Code extension checks` builds and uploads the VSIX without publishing it.

Primary API references:
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/working-with-extensions/testing-extension
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension

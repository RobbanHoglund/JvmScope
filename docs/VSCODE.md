# VS Code delivery: two stages

The desktop extension is generally available (GA). Version 1.0.0 removes the
remaining Preview metadata and listing text. The stages below describe the
implemented architecture and the remaining integration roadmap.

## Stage 1 — working offline extension

Implemented in `extensions/vscode` on top of the existing frontend. One extension
opens separate TDA, TLS and GC panels. It is packaged as an installable VSIX. Building
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
a bounded, editable preview. It does not run a second rule engine. TDA defaults
to the selected snapshot and also offers the current series or a custom subset
of up to 20 snapshots from the existing analyzer process group. It preserves
capture order, source labels, identity qualifications and actual CPU interval
endpoints, including when an endpoint is outside the selection. Names alone
never establish thread identity. Missing PIDs, resets, incomplete collections,
gaps and excerpt omissions remain explicit limitations. Multiple observations
do not establish uninterrupted blocking or elapsed duration. TLS scopes it to the
selected interaction (or an explicitly limited overview). Full raw text is
excluded unless requested.

The host protocol accepts only the fixed provider IDs `copilot`, `codex` and
`claude`, with a 256 KiB UTF-8 input bound. Discovery does not activate assistants,
authenticate or request inference. A user-initiated Copilot action selects an
available model through `vscode.lm`, checks its token budget and supports
cancellation. Its output goes to a formatted report beside the analyzer and never rewrites
JvmScope's findings. Only one model request runs at a time. The dialog polls
per-panel job state and exposes Cancel, progress and provider errors. Job IDs
scope cancellation to the owning panel and request. Closing the dialog or
invalidating its evidence cancels the pending work. Every provider await races
against cancellation, with a three-minute total deadline; late results cannot
open an editor or clear a newer job. Error notification dismissal never holds
the job lock. Completion closes the review without explicitly refocusing the
analyzer; reopening it restores the exact reviewed prompt without sending again.
Errors and cancellation keep the review open. The saved review lives only in
memory and is cleared by manual close or evidence invalidation.

The reviewed prompt requests a concise summary and optional top-level Markdown
callouts (`[!CRITICAL]`, `[!WARNING]`, `[!IMPORTANT]`, `[!NOTE]`). The renderer
decorates only these explicit markers (plus the standard CAUTION/TIP aliases),
never diagnostic keywords or code examples. It adds local SVGs to at most three
callouts and keeps a textual priority plus **AI assessment** on each. The
original response is retained for copy, save and source actions; HTML remains
disabled. These are model-provided priorities, not additional parser findings.

A separate **JvmScope findings** section carries up to three existing analyzer
priorities from the selected evidence. A confirmed JVM deadlock therefore gets a
critical icon even when the answer contains no Markdown callouts. Repeated cycle
counts are per snapshot, never summed as distinct deadlocks. TLS failure, ambiguous
grouping and incomplete outcomes remain distinct. Severity prioritizes inspection
and does not prove production impact. Secondary priorities are collapsed.

This bounded, validated display context is copied at submission and passed only to
the local result view, never appended to the exact reviewed model prompt. Editing
the prompt adds a visible qualification that these findings still refer to the
original selection. Dynamic strings render as text with fixed local SVGs. Copy,
save and source actions export the original model response and metadata, as before.

Evidence summaries use up to 40,000 characters, reserving 35,000 for optional raw
text and space for instructions within the 80,000-character review limit. JSON is
never cut mid-record. Optional thread/stack detail is reduced, while every reported
deadlock edge (including unresolved mappings), mapped participant stack excerpts,
and measured CPU-hot identities, thresholds and intervals are preserved. Finding
counts and excerpt coverage remain explicit; oversized minimum evidence is
rejected. TLS overviews prioritize failures, uncertain grouping and incomplete
outcomes among up to 20 interactions, retain classified failure events and label
capture-wide outcome counts separately from the excerpt.
Optional raw excerpts share 35,000 characters with individual snapshot labels.
An oversized selection is rejected before handoff. The exact edited prompt still
passes the provider's token-budget check; these bounds do not guarantee it fits
every model.

Codex uses the documented `chatgpt.openSidebar` command after copying the reviewed
prompt. Claude uses its documented `/open` URI without prompt data in the URL;
the clipboard avoids platform URL-size limits. Users paste and submit in those
assistants. No private chat API, shell command, credential reuse or automatic
submission is assumed. Provider accounts and organizational permissions remain
the responsibility of the chosen extension. Detection is limited to assistants
available in the current VS Code window/extension host.

The evidence builders, cancellation/error paths and public launcher boundaries
have unit coverage; packaged browser journeys cover the preview, exact edited
payload, themes, narrow layouts, capture replacement and explicit model reselection
after a core-only rejection. The installed-extension CI also exercises real native
notification promises, progress cancellation, internal-alias filtering and the
response webview with a deterministic provider boundary, without an account. **Live authenticated Copilot inference
and interactive Codex/Claude handoff require a manual smoke test with those
extensions enabled; CI does not submit real diagnostic data or consume quota.**

Integration references (checked 2026-10-17):
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [Codex IDE commands](https://developers.openai.com/codex/ide/commands)
- [Claude Code VS Code integration](https://code.claude.com/docs/en/vs-code#launch-a-vs-code-tab-from-other-tools)

### Analysis prompts

The evidence builder supplies an explicit kind to `aiPrompt`; the analyzer and
the actual selection determine the instructions. Filenames, raw capture text and
user-edited scope labels cannot select a profile. Missing or unknown kinds fail
before handoff instead of falling back to mixed diagnostic instructions.

| Selection | Analysis instructions |
| --- | --- |
| One thread snapshot | Explain captured thread states, every reported deadlock cycle, lock dependencies and measured CPU qualifications. Do not infer a trend or blocked duration from one capture. Identify findings that depend on other loaded snapshots. |
| Multiple thread snapshots | Add comparisons using qualified identities and process boundaries, actual CPU interval endpoints, counter resets and missing captures. Count cycles per snapshot; repeated stacks or waits do not prove continuous blocking. |
| One TLS interaction | Follow the observed JSSE handshake, endpoint role/direction, negotiated settings, alerts and certificate/authentication evidence. Keep grouping uncertainty, incomplete capture, normal closure and post-handshake errors distinct. |
| TLS capture overview | Add comparisons of the included interactions, while distinguishing capture-wide counts from the bounded excerpt that prioritizes failures and uncertainty. Do not infer a failure rate from that biased excerpt or a shared cause from identical error text. |

The thread instructions contain no TLS diagnosis rules, and the TLS instructions
contain no thread-state, CPU or deadlock diagnosis rules. TLS guidance distinguishes
offered and negotiated settings, TLS 1.2/1.3 and resumed handshakes, certificate
trust and peer identity, and client authentication. It asks for certificate dates
to be assessed against reliable capture time and rejects bypassing verification
or weakening algorithms as a fix. Thread guidance distinguishes monitor blocking
from synchronizer waits, cumulative CPU time from rates, and endpoint state from
work over a measured interval; it preserves platform/virtual-thread coverage.

Only the response format, evidence attribution, uncertainty, severity labels and
untrusted-data rules are shared. Changing the selection or raw-evidence option
rebuilds the visible review with the appropriate profile. The provider receives
exactly the final reviewed text, including user edits; no extra diagnostic
instructions are appended after review.

Regression tests use a real three-snapshot Java capture and real JSSE logs from
Java 8, 11 and 25, including TLS 1.2 mutual authentication, TLS 1.3 success,
required-client-authentication failure and untrusted-server failure. They cover
non-adjacent selections, uncertain grouping, excerpt bias, raw opt-in, unsupported
kinds and the maximum prompt budget. Packaged browser journeys verify selection
changes and exact reviewed submissions for both analyzers. These tests verify the
prompt and handoff contract, not a model's compliance or diagnostic accuracy.

Technical references checked 2026-10-18:
- [Java 25 Thread.State](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html)
- [Java 25 ThreadMXBean](https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html)
- [Java 25 JSSE reference guide](https://docs.oracle.com/en/java/javase/25/security/java-secure-socket-extension-jsse-reference-guide.html)
- [TLS 1.3, RFC 8446](https://www.rfc-editor.org/rfc/rfc8446.html)

### Copilot model selection

The stable `selectChatModels({ vendor: 'copilot' })` API can return internal
models as well as user-facing chat models. Its consumer `LanguageModelChat`
objects do not expose the provider-side `isUserSelectable` flag. JvmScope excludes
the known `copilot-dictation-cleanup-nano`, `copilot-dictation-cleanup-luna`,
`copilot-utility-small` and `copilot-utility` aliases. These are internal helpers;
the dictation aliases reject extension requests with “only available to VS Code core”.

There is deliberately no model-name or family allowlist. In particular, Copilot
can publish `gpt-5.6-luna` either as an ordinary model or as a core-only dictation
alias, so its ID alone cannot establish access. If a selected model explicitly
rejects access as core-only, JvmScope removes that vendor/ID/version from the
picker for the current session and offers another choice with the reviewed prompt
unchanged. It never sends to the replacement model until the user chooses it.
This handles errors at request start, in the response stream and wrapped causes.
Consent, quota, policy and network failures remain ordinary visible errors and
never trigger a model switch. An internal-only catalog explains the limitation
and leaves Copy prompt available. The implementation neither probes models with
background requests nor impersonates the VS Code core request initiator.

Compatibility source (checked 2026-10-17):
[Copilot model registration and core-only request checks](https://github.com/microsoft/vscode/blob/main/extensions/copilot/src/extension/conversation/vscode-node/languageModelAccess.ts),
[extension-host consumer model API](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostLanguageModels.ts),
and [stable API declarations](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts).
Provider IDs and error wording are not a public compatibility contract; recheck
these boundaries when updating Copilot support. The authenticated release smoke
test must verify that the actual account's picker excludes the internal aliases,
an allowed model opens a formatted report, and cancellation and access-denied
retries leave the prompt usable in both analyzers.

### AI response rendering

`AiResults` presents each completed answer in an independent in-memory webview.
The job waits for its rendering acknowledgement; cancellation while the view is
loading disposes it, and late asset reads cannot create a new tab. Completed
reports keep their original snapshot when the analyzer changes. Closing a report
releases its data; recreating a hidden webview receives the same host-held answer.
No answer is written to disk or webview persistent state automatically.

The dedicated `ai-result.html` entry is built only for VS Code and is not part of
the analyzer/knowledge navigation allowlist. Its local Markdown renderer is
markdown-it 15.0.2 with HTML disabled, images replaced by text and links restricted
to credential-free HTTP(S). Link targets are inert attributes until an explicit
click passes host validation. There are no executable code blocks, external
images, command URIs, local-file links or network calls to render an answer.
The existing default-deny webview CSP and media-only resource roots still apply.

The report uses VS Code theme variables, keyboard-visible focus and local scroll
regions for wide tables/code. Copy, save and source actions use the host-held
original Markdown, never replacement text supplied by the webview. Saving asks
for a destination; opening source creates an ordinary editable Markdown document.
Packaged browser tests check both analyzer journeys, themes, narrow widths,
rendering of malicious markup, exact exports and recovery from action failures.
Native CI waits for the installed report's real render acknowledgement.

Renderer reference: [markdown-it safety guidance](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md).

### Existing editor integration

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

The listing's short description comes from `extensions/vscode/package.json` and
its Details page from `extensions/vscode/README.md`. Keep the overview concise;
the detailed controls live in [the user guide](VSCODE-USAGE.md). Listing screenshots
are PNG documentation assets under `docs/images/vscode`, with provenance recorded
there. Their HTTPS URLs pin the image commit so deleting a merged branch cannot
break published images. Refresh those URLs when updating screenshots, label
illustrative AI answers and validate the packaged README with the package gate.

Primary API references:
- https://code.visualstudio.com/api/references/extension-manifest
- https://code.visualstudio.com/api/extension-guides/webview
- https://code.visualstudio.com/api/working-with-extensions/testing-extension
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension

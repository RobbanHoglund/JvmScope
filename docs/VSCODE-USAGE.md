# JvmScope VS Code user guide

Detailed controls, evidence handling, AI options and troubleshooting for the desktop extension.
See the [feature overview and quick start](../extensions/vscode/README.md) to get started.

## Install from VSIX

1. Download the `jvmscope-vscode` artifact from the branch's **VS Code extension checks** workflow and unzip it.
2. In VS Code, run **Extensions: Install from VSIX…** and select the downloaded `jvmscope-<version>.vsix`.
3. Open the Command Palette and run **JvmScope: Open Java Thread Dump Analyzer** or **JvmScope: Open Java TLS Log Analyzer**.

Alternatively, build the package using the instructions below. Requires VS Code
**1.110 or later** on desktop (Windows, macOS or Linux). Browser-hosted VS Code
(`vscode.dev`) is not supported.

## Analyze captures

- Use the **blue thread-tree** and **teal shield** buttons at the top-right of an
  editor's tab bar to open or focus the Java thread dump and TLS analyzers.
  Their tooltips name each tool; the icons adapt to light and dark themes.
- Right-click a capture in Explorer and choose **Analyze as Java Thread Dump** or **Analyze as Java TLS Log**.
  Context menus and the Command Palette use plain text labels; the thread-tree and
  shield icons identify the analyzers on toolbar buttons.
- Select several thread dump files to compare snapshots. TLS analysis opens one log at a time.
- Run either **Analyze as…** command from the Command Palette to analyze the active editor, including unsaved changes and untitled documents.
- Inside an analyzer, use **Choose dumps / Choose log** to open the native file picker, or try the bundled examples.
- **Raw dump** opens JvmScope's evidence workspace inside the analysis tab. **Exact** is first and is the default for new evidence views, showing the complete snapshot text. Choose **Annotated** for thread filters, lock inspection and links to Details/Graph. Search works in both modes; returning to an existing view keeps its current mode. **Open as text** opens the complete snapshot in a read-only VS Code editor. Copy controls use the VS Code clipboard. Findings and graph exports use a Save dialog.
- TDA leads with the highest-priority finding and an **Inspect threads** action. Snapshot totals distinguish missing CPU measurements from measured zero; **Snapshot context & coverage** retains full timing and measurement details.
- **Columns: Analysis** keeps thread evidence and Details within a narrow editor. **All technical columns** exposes counters, IDs and priorities without changing the sort. **Reapply filters** updates the table, not the source file.
- The CPU timeline covers the whole capture. Its ranked table compares the selected interval with peak CPU and measured-interval counts. Select a thread for duration and timing details; **Clear selection** resets the highlight.
- In Annotated raw evidence, **Investigation candidates** means threads with wait/lock evidence, not proven faults. Filter counts are threads; search follows the selected view. **Copy snapshot** always copies the complete selected snapshot, including when filtered.
- In TLS **Investigate**, drag the divider between the table and details to resize them.
  You can also focus it with Tab and use Left/Right, Shift for larger steps, or Home/End
  for the limits. Double-click resets the split. The width is remembered; narrow editors
  stack the panes. Capture totals stay above the timeline, with filtered counts near the table.

Imports are UTF-8 text/JSON, limited to **64 MiB total per import** and **50 files**.
The limits bound file transfer, not analysis complexity. Choose smaller captures
if memory use becomes excessive. Inputs are analyzed on demand: later edits to a
file do not silently change the current analysis. A new **Analyze as…** command
replaces that analyzer's input; TDA's in-view Add/Replace control still applies to
its file picker and Paste actions.

## Browse analyses in the sidebar

Use **View → Open View…**, type **JvmScope**, and select **JvmScope Analyses**.
You can also select the **JvmScope icon (J in a magnifying glass)** in the Activity Bar or run
**JvmScope: Open Analysis Sidebar** from the Command Palette.
The monochrome icon follows the current theme, including high-contrast themes.

The **JvmScope Analyses** view's **…** menu offers **Open Java Thread Dump Analyzer**,
**Open Java TLS Log Analyzer** and **Open Knowledge Base**. The toolbar's blue tree and
teal shield icons and the two analyzer roots open the same analyzers.

Select **Knowledge base** in the sidebar to open the bundled Java guides and references,
or run **JvmScope: Open Knowledge Base** from the Command Palette. The website's navigation
row is omitted inside VS Code; the standalone app keeps it. Capture actions and Help
remain inside each analyzer, and opening the knowledge base preserves loaded analyses.

Knowledge articles share one tab. **Back / Forward** (or **Alt+Left / Alt+Right**)
restore the previous page's search, choices and reading position. **Knowledge base**
returns to the previous article results when available. Reopening Knowledge Base
from the sidebar or Command Palette resumes the current article. Reading history
is held only in the open webview's memory and is discarded when that tab closes.

- **Java thread dumps:** expand a source file, then a snapshot, then its threads.
  Select a thread to open its details in the correct snapshot, even when names repeat.
- **Java TLS logs:** expand the file, an interaction, then its observed events.
  Select an event to show and highlight it in the investigation sequence. This
  switches to investigation mode and clears table filters if they hide that interaction.
- Long branches show 100 items at a time; expand **More (…)** for the next page.
  The sidebar shows the whole loaded analysis, independently of table filters.
- Clear, replace or close an analyzer to update its tree. An invalid TDA replacement
  preserves the existing analysis. Old items cannot select objects in a new capture.

The tree uses the same uncertainty qualifications as the analyzers. In particular,
ambiguous legacy TLS grouping does not produce a single-connection event sequence.
Items represent captured observations; they are not live JVM threads or connections.
The sidebar also works with bundled examples and pasted captures.

## Navigate to source

Thread details offer **Open source in VS Code**. In TLS, use **Open source**, a
sequence event line number, or a raw-log line number. These open the original
capture beside the analysis and select the evidence lines, including the correct
snapshot in files containing multiple dumps. This navigates the capture, not Java
application source code.

Links are available for files and editor documents imported through VS Code.
Examples and pasted captures have no original-document link. If the document
contents change, navigation asks you to analyze it again before selecting lines.
Clearing/replacing the input or closing the panel revokes its source links.

## Optional AI analysis

Load a capture and choose **Analyze with AI** beside Help. Review or edit the
prompt and evidence before continuing. TDA defaults to the current snapshot;
choose **Current series** or **Choose snapshots…** to compare up to 20 snapshots
from its process group in one request. Known JVM process boundaries are kept
separate; missing process IDs cannot confirm that captures share a JVM. TLS uses
the selected interaction, or a bounded capture overview if none is selected.
The summary includes JvmScope's findings, qualifications and selected stack or
event excerpts. Full raw text is excluded by default; **Include raw evidence
excerpt** adds up to 35,000 characters, shared across the selected snapshots,
and rebuilds the prompt. Changing the selection also replaces prompt edits.
The summary keeps every selected snapshot, reported deadlock cycle and measured
CPU-hot thread evidence, with explicit excerpt coverage. Oversized selections ask
you to choose fewer snapshots. TLS overviews prioritize failed, uncertain and
incomplete interactions instead of only the start of the log.

Analysis instructions follow your tool and selection. Thread analysis focuses on
states, locks, deadlocks and measured CPU evidence, with comparison rules when
multiple snapshots are selected. TLS analysis focuses on handshake progress,
alerts, certificates and negotiated settings, with separate guidance for one
interaction and a capture overview. Both request evidence references, explicit
uncertainty and the same readable report format. The text you review is exactly
what is submitted or copied.

The report shows **JvmScope findings** separately from the AI response, including
a critical icon for a confirmed deadlock regardless of the model's formatting.
Severity indicates analyzer priority, not proven application impact. Counts are
per snapshot. Up to three priorities are shown, with secondary ones collapsed.
If you edit the prompt, a note identifies the findings as referring to the original
selection. These local labels add nothing to the text sent to the provider;
copy/save/source export the original AI response.

After a successful Copilot response, the review dialog closes to reveal the
analyzer beside the report. **Analyze with AI** reopens the reviewed prompt
without resending it. Closing the review manually or changing the capture clears
it. Errors and cancellation keep the dialog open for editing and retry.

| Installed assistant | Action |
| --- | --- |
| GitHub Copilot Chat | **Analyze with Copilot** offers available chat models. The response opens as a formatted report beside the analyzer. Progress and errors appear in the AI dialog. Cancel there or from the progress notification. |
| OpenAI Codex | **Copy and open Codex** copies the reviewed prompt and opens its sidebar. Paste, review and send in Codex. |
| Claude Code | **Copy and open Claude Code** copies the reviewed prompt and opens a Claude tab. Paste, review and send there. |
| None / another assistant | **Copy prompt** remains available for manual use. |

JvmScope uses the installed assistant and its account; it does not ask for API
keys or install assistants. A provider's sign-in, consent, plan, quota or
organization policy can still restrict access. Reopen the dialog after enabling
an extension. Codex and Claude handoff does not automatically submit a request or
return an answer inside JvmScope. Their models are not assumed to be available
through the Copilot API. Model responses never change parser findings.

The response view renders headings, lists, tables, quotes and code blocks using
your VS Code theme. **Copy response**, **Save…** and **Open Markdown**
retain the original answer with its model and scope. Reports stay in memory until
their tabs close; saving is explicit. AI-supplied HTML is displayed as text,
embedded images are omitted, and web links open only when clicked. Commands and
local-file links in model output cannot be opened by this view.

The prompt requests a short summary followed by facts, inferences, hypotheses
and next checks. Explicit priority callouts have text labels and at most three
status icons per report. Each label says **AI assessment**: the renderer never
assigns severity from keywords or changes JvmScope's findings. Model formatting
can vary; ordinary Markdown still renders normally.

The Copilot picker omits known internal dictation and utility models. If Copilot
rejects another model as reserved for VS Code, choose another model in the picker;
your reviewed prompt is preserved. JvmScope never switches models or submits to a
replacement without your choice. If no usable model remains, use **Copy prompt**
in Copilot Chat. Sign-in, consent, quota and network errors still require resolving
the reported problem before retrying.

Copilot requests have a three-minute limit, including time spent choosing a model
or approving access. **Cancel analysis** releases the request even if the provider
stops responding. Closing the AI dialog, changing the evidence or closing the
analyzer cancels its current request. Errors leave the prompt available to edit,
retry or copy; dismissing the VS Code error notification is not required to retry.
Cancellation cannot retract evidence already submitted to the provider.

## Privacy and scope

Capture parsing and rules run in the VS Code extension host and its webviews.
JvmScope has no telemetry, background workspace scan or JVM process execution. A remote workspace
can read a selected capture through VS Code's filesystem API; its contents must
then be transferred to the UI to display and analyze it. Documentation links open
in your browser only when clicked.

Optional AI analysis is a separate, explicit sharing action. Copilot receives the
exact reviewed prompt after you choose a model. Codex/Claude receive clipboard
text when you paste and send it in their chat. The chosen assistant may transmit
the evidence to its provider under your account settings. Names, hosts, paths,
stack traces and secrets are **not automatically anonymized**; inspect the
editable preview. JvmScope does not save prompts to the workspace, logs or browser
storage. Clipboard contents and assistant chat history follow their own lifetimes.
The standalone web app does not expose this VS Code integration.

Sessions are held in memory, survive switching editor tabs, and disappear when
the analyzer panel is closed or VS Code reloads. Raw evidence is invalidated when
its owning capture is cleared/replaced or its panel closes. Exports can contain
sensitive diagnostic data; review them before saving or sharing.

The sidebar and both analyzers follow VS Code's theme, including light, dark,
high-contrast dark and high-contrast light. Run **Preferences: Color Theme** to
switch themes; open analyzers update immediately. Both analyzers also adapt to
narrow editor splits. The standalone application and exported reports retain
their own palettes. Raw dump opens the evidence workspace in Exact mode; its
**Open as text** action opens the native read-only editor.
The verified inputs are HotSpot thread dumps and SunJSSE traces; missing fields
remain unknown. This extension adds no additional JVM/vendor compatibility claim.

## If an analysis view fails to open

If loading times out, run the corresponding **JvmScope: Open…** command again.
JvmScope recreates a failed view while retaining successfully loaded analyzer views.

The message **Could not register service worker… The document is in an invalid state**
comes from VS Code's webview startup, before JvmScope's page runs. JvmScope does
not register a service worker. A fresh analysis panel cannot repair VS Code's
shared service-worker state.

1. Save your work, close **all** VS Code windows, and start VS Code again.
2. If the same error persists on a standard Windows installation, close VS Code
   completely and rename `%APPDATA%\Code\Service Worker` to an unused backup name,
   such as `Service Worker.backup-20261016`. Then restart VS Code. This resets
   the shared webview cache, so other extensions' webviews are affected too.
   Insiders, portable installations and custom user-data directories use different paths.
3. If it still fails, include **Help → About** and the relevant error from
   **Developer: Toggle Developer Tools → Console** in a bug report.

The host error and cache workaround are documented in
[Microsoft's VS Code issue #247035](https://github.com/microsoft/vscode/issues/247035).

## Develop and test

From the repository root, with Node.js 24:

```sh
npm ci --prefix frontend
npm ci --prefix extensions/vscode
npm run build --prefix extensions/vscode
npm test --prefix extensions/vscode
npx --prefix frontend playwright install chromium
npx --prefix frontend playwright test --config extensions/vscode/test/playwright.config.mjs
npm run test:integration --prefix extensions/vscode
npm run package --prefix extensions/vscode
```

On headless Linux, wrap the extension-host command in `xvfb-run -a`.
The integration runner downloads the pinned minimum VS Code version into an
isolated test directory. CI installs the same packaged VSIX on Linux, Windows
and macOS, and also tests the current stable VS Code on Linux. To test a package
locally, set `VSCODE_VSIX=build/vscode/jvmscope-1.2.2.vsix` before running
`test:integration` (path relative to the repository root). Python 3 can also check
the archive and rewritten Marketplace links with
`python3 extensions/vscode/test/package.py`. Set `VSCODE_VERSION` to test another release, or
`VSCODE_EXECUTABLE` to use an existing test installation. It never uses your normal
VS Code profile or installed extensions.

For interactive development after building:

```sh
code --extensionDevelopmentPath="$PWD/extensions/vscode"
```

The `.vsix` is written under `build/vscode/`. Generated webview assets are excluded
from git and rebuilt from the shared frontend. The package has no production npm
dependencies. No Marketplace publication is performed by these commands or CI.
Merging to main does not update the Marketplace listing or installed extensions.
See [release and Marketplace publication](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE.md#release-and-marketplace-publication).


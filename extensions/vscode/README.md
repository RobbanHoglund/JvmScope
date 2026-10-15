# JvmScope — Java Thread Dumps & TLS Logs for VS Code

Investigate **Java thread dumps** and **Java TLS/SSL logs (JSSE)** inside VS Code, using the
same analysis engines as JvmScope's browser application. No Java installation,
server, account or external analysis service is needed.

This is the **0.3 native sidebar preview**. The two analyzers are bundled webviews with native
file opening, clipboard, read-only raw evidence and export dialogs. The package
also contains the searchable help, examples and knowledge base.

## Install the preview

1. Download the `jvmscope-vscode` artifact from the branch's **VS Code extension checks** workflow and unzip it.
2. In VS Code, run **Extensions: Install from VSIX…** and select `jvmscope-0.3.1.vsix`.
3. Open the Command Palette and run **JvmScope: Open Java Thread Dump Analyzer** or **JvmScope: Open Java TLS Log Analyzer**.

Alternatively, build the package using the instructions below. Requires VS Code
**1.110 or later** on desktop. Browser-hosted VS Code (`vscode.dev`) is not included
in this first version.

## Analyze captures

- Right-click a capture in Explorer and choose **🧵 Analyze as Java Thread Dump** or **🔒 Analyze as Java TLS Log**.
- Select several thread dump files to compare snapshots. TLS analysis opens one log at a time.
- Run either **Analyze as…** command from the Command Palette to analyze the active editor, including unsaved changes and untitled documents.
- Inside an analyzer, use **Choose dumps / Choose log** to open the native file picker, or try the bundled examples.
- **Raw dump** opens exact snapshot text in a read-only VS Code editor. Copy controls use the VS Code clipboard. Findings and graph exports use a Save dialog.

Imports are UTF-8 text/JSON, limited to **64 MiB total per import** and **50 files**.
The limits bound file transfer, not analysis complexity. Choose smaller captures
if memory use becomes excessive. Inputs are analyzed on demand: later edits to a
file do not silently change the current analysis. A new **Analyze as…** command
replaces that analyzer's input; TDA's in-view Add/Replace control still applies to
its file picker and Paste actions.

## Browse analyses in the sidebar

Open **JvmScope** in the Activity Bar, or run **JvmScope: Open Analysis Sidebar**.
The two roots open the Java thread dump and Java TLS analyzers. The view's toolbar
also opens either analyzer.

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

## Privacy and scope

Captures stay in the VS Code extension host and its webviews. There is no upload,
telemetry, background workspace scan or JVM process execution. A remote workspace
can read a selected capture through VS Code's filesystem API; its contents must
then be transferred to the UI to display and analyze it. Documentation links open
in your browser only when clicked.

Sessions are held in memory, survive switching editor tabs, and disappear when
the analyzer panel is closed or VS Code reloads. Raw evidence is invalidated when
its owning capture is cleared/replaced or its panel closes. Exports can contain
sensitive diagnostic data; review them before saving or sharing.

Both views follow VS Code light, dark and high-contrast themes and adapt to narrow
editor splits. The standalone application and exported reports retain their own
palettes. Raw snapshots still open in the native read-only editor.
The verified inputs are HotSpot thread dumps and SunJSSE traces; missing fields
remain unknown. This extension adds no additional JVM/vendor compatibility claim.

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
isolated test directory. Set `VSCODE_VERSION` to test another release, or
`VSCODE_EXECUTABLE` to use an existing test installation. It never uses your normal
VS Code profile or installed extensions.

For interactive development after building:

```sh
code --extensionDevelopmentPath="$PWD/extensions/vscode"
```

The `.vsix` is written under `build/vscode/`. Generated webview assets are excluded
from git and rebuilt from the shared frontend. The package has no production npm
dependencies. No Marketplace publication is performed by these commands or CI.
The manifest's publisher identifier must be verified against the actual publisher
account before a public release.

## Next stage

Further work can add carefully scoped Problems diagnostics, opt-in refresh after
edits, and session serialization with clear privacy choices. These features should use
the same parsers and rule models; a dump observation must never become a stronger
claim merely because it appears in VS Code. See [the implementation plan](../../docs/VSCODE.md).

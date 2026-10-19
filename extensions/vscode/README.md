# JvmScope — Java Threads, TLS & GC for VS Code

Investigate **Java thread dumps**, **TLS/SSL logs from Java's JSSE** and **HotSpot
garbage collection logs** inside VS Code. Visualize deadlocks, compare snapshots,
follow handshakes and inspect GC pauses and heap pressure on a timeline.

The built-in analyzers run **locally and offline**, with no Java installation,
server or account required. Optional AI assistance uses your chosen assistant
and its account, after you review the evidence to share. JvmScope also has a
[standalone browser application](https://github.com/RobbanHoglund/JvmScope).

## What you can do

| Tool | Investigate |
| --- | --- |
| **Thread dumps** | Thread states, lock owners and JVM-reported deadlock cycles with interactive graphs. Compare snapshots and inspect CPU intervals when the capture contains usable measurements. |
| **TLS logs** | Observed handshake stages, alerts, certificates and negotiated settings. Filter interactions and inspect the exact log evidence, with uncertainty kept visible. |
| **Garbage collection** | Java 8–27 HotSpot logs: heap, stop-the-world pauses and concurrent activity on separate timeline tracks. Annotated review points link to original evidence, with seven real collector samples and a GC guide. |
| **Optional AI** | Review one snapshot or a selected series, one TLS interaction or a capture overview. Use an in-app Copilot report or copy a reviewed prompt to Codex or Claude Code. |
| **Evidence and guides** | Search exact raw captures, jump to source lines, export findings and graphs, and browse bundled examples and the knowledge base. |

## Get started

1. Install **JvmScope — Java Threads, TLS & GC** (`RobbanHoglund.jvmscope`)
   from Extensions. Run **JvmScope: Open Analysis Sidebar** from the Command Palette.
2. Open the **Java Thread Dump Analyzer**, **Java TLS Log Analyzer** or **Java
   Garbage Collection Log Analyzer** from the sidebar. Choose or drop a capture,
   or try **Full sample** (threads/TLS) or **Load sample** (GC).
3. Inspect the highlighted finding, graph or handshake sequence. Use **Raw dump**
   in thread analysis or **Raw log** in TLS to check the underlying evidence.

You can also right-click a capture in Explorer and choose **Analyze as Java
Thread Dump**, **Analyze as Java TLS Log**, or **Analyze as Java GC Log**. Select several thread dump files
to compare snapshots.

**Drag and drop:** Drop files onto **Java thread dumps**, **Java TLS logs** or
**Java garbage collection** in the JvmScope sidebar. This uses native VS Code
file dropping without a modifier key. To drop from VS Code's Explorer or an
editor tab directly into an analyzer view, **hold Shift while dragging and
dropping**; otherwise VS Code can open the capture as a text editor. External
files from Windows Explorer/Finder can be dropped anywhere inside the analyzer.
TLS and GC accept one log per import; thread analysis accepts multiple captures.

**Requirements:** VS Code **1.110 or later** on Windows, macOS or Linux. The desktop
extension is generally available (GA); `vscode.dev` is not supported. Light, dark
and high-contrast themes are supported, including narrow editor splits.

## Optional AI analysis

Choose **Analyze with AI** in the thread or TLS analyzer. GC analysis is local
and does not currently offer AI handoff. Review or edit the prompt before
continuing; the instructions follow the analysis tool and your selection.
Thread analysis can include the current snapshot, its series or a custom subset
of up to 20 snapshots. TLS uses the selected interaction or a bounded overview.

| Installed assistant | What happens |
| --- | --- |
| **GitHub Copilot Chat** | Choose an available model. Its answer opens as a formatted report beside the analyzer. |
| **OpenAI Codex** | **Copy and open Codex** copies the reviewed prompt and opens the sidebar. Paste and submit it there. |
| **Claude Code** | **Copy and open Claude Code** copies the reviewed prompt and opens a Claude tab. Paste and submit it there. |
| **Another assistant** | Use **Copy prompt** for manual review and submission. |

The exact reviewed text is sent or copied. Raw excerpts are optional and off by
default; summaries can still contain thread names, hosts, paths and stack excerpts.
Data is **not automatically anonymized**, and the chosen assistant may send it to
its provider. Its sign-in, plan, quota and organization policy apply.

Copilot reports separate **JvmScope findings** from **AI assessment**. AI answers
can be wrong and do not change the analyzer's findings. Codex and Claude handoff
does not return a report inside JvmScope. See the
[AI usage guide](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE-USAGE.md#optional-ai-analysis)
for selection limits, cancellation and troubleshooting.

## See it in action

These are captures of the packaged analyzer views using bundled example data.

### Follow a deadlock cycle

Switch between JVM-reported cycles and follow each thread's wait and ownership
edges. Select a thread in the graph to inspect its captured stack.

![Thread analysis showing two reported deadlock cycles and the selected cycle's thread-to-lock graph](https://raw.githubusercontent.com/RobbanHoglund/JvmScope/c02c70e1b2bf0f74538dc091aa4c798d75313998/docs/images/vscode/thread-deadlocks.png)

### Investigate a TLS failure

Filter the capture and inspect produced/consumed events, alert direction and
source lines together. Incomplete handshakes and uncertain grouping stay explicit.

![TLS investigation in a light theme with an interaction timeline, failure list and selected handshake events](https://raw.githubusercontent.com/RobbanHoglund/JvmScope/c02c70e1b2bf0f74538dc091aa4c798d75313998/docs/images/vscode/tls-investigation.png)

### Read an AI-assisted summary

Analyzer findings retain their own severity indicators alongside the formatted
response. Copy, save or open the original response as Markdown.

![AI report summary with a confirmed analyzer deadlock, separate AI response and a qualified warning](https://raw.githubusercontent.com/RobbanHoglund/JvmScope/c02c70e1b2bf0f74538dc091aa4c798d75313998/docs/images/vscode/ai-report-example.png)

*The AI screenshot uses an illustrative response for the bundled thread sample,
not a live model result. Actual answers vary by model and evidence.*

## Privacy and capture support

JvmScope does not upload captures during built-in analysis, run JVM processes,
scan your workspace in the background or collect telemetry. AI sharing and
exports are explicit actions. In remote workspaces, selected files are read
through VS Code and transferred to the analysis view.

The extension analyzes saved captures, rather than attaching to a running JVM.
Verified inputs include HotSpot thread dumps and SunJSSE traces; missing evidence
remains unknown. Imports accept UTF-8 text/JSON, up to **50 files** and **64 MiB in
total per import**. TLS opens one log at a time. Sessions remain in memory until
the analyzer closes or VS Code reloads.

## Guides and support

- [Detailed usage](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE-USAGE.md): sidebar navigation, exact/annotated raw evidence, CPU comparisons, source links and AI controls.
- [Install from VSIX](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE-USAGE.md#install-from-vsix) for offline installation or testing a branch build.
- [Troubleshoot a view that will not open](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE-USAGE.md#if-an-analysis-view-fails-to-open).
- [Development and package checks](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE-USAGE.md#develop-and-test).
- [Architecture and release documentation](https://github.com/RobbanHoglund/JvmScope/blob/main/docs/VSCODE.md).
- [Report an issue](https://github.com/RobbanHoglund/JvmScope/issues). Include the extension/VS Code versions and reproduction steps; remove sensitive capture data first.

**License:** Apache-2.0.

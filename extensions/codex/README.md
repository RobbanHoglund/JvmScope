# JvmScope for Codex — local preview 0.4.1

Analyze Java thread dumps, SunJSSE TLS logs and HotSpot GC logs using the same engines as the JvmScope web application and VS Code extension. Includes a Java knowledge base, TLS explanations, public samples and source-line evidence. This is an independently developed local plugin, not an OpenAI-approved directory listing.

## Install the packaged plugin

The build produces two different archives:

| Archive | Purpose |
| --- | --- |
| `jvmscope-codex-plugin-0.4.1.zip` | Single plugin with `plugin.json`, `mcp.json`, skills and bundled server at its root; for clients accepting plugin ZIP imports. |
| `jvmscope-codex-0.4.1.zip` | Complete local marketplace for the folder-based installation below. Do not upload this archive to a single-plugin import dialog. |

For the desktop **Add plugin / New plugin** file picker, select the **single-plugin** archive without unpacking it. The maintainer verified the 0.2.2 import and interactive report in a real desktop conversation. In that session, removing the older installed plugin before importing the replacement resolved a generic import error; this is an observed workaround, not a guarantee for every client. Start a fresh local conversation after updating. Do not remove the MCP configuration: the analysis tools depend on it. Public-directory eligibility is separate from personal import.

1. Install **Node.js 22 or later** and ensure `node --version` works in the desktop app's environment. No Java runtime, npm install, API key or running web server is needed to use the packaged plugin.
2. Download the `jvmscope-codex` artifact from a successful **Codex plugin checks** GitHub Actions run. Unzip the artifact, then unzip `jvmscope-codex-0.4.1.zip` into a permanent folder, for example `C:\Tools\JvmScope-Codex` or `~/Tools/JvmScope-Codex`. Keep `.agents` and `plugins` together; `.agents` may be hidden in Finder.
3. Add that **extracted marketplace folder** using a current Codex CLI:
   ```sh
   codex plugin marketplace add "/absolute/path/to/JvmScope-Codex"
   codex plugin marketplace list
   ```
   On Windows, use your absolute Windows folder path in the quoted argument.
4. Restart the ChatGPT desktop app, open its Plugins directory, select **JvmScope Local Plugins**, and install **JvmScope**. Start a fresh **local** Codex conversation. The CLI command registers the catalog; it is not proof that the plugin has been installed/enabled in the desktop app.
5. Ask: **Try the bundled Java deadlock example and show its interactive report.** The first starter also runs the bundled example immediately. Then try TLS and GC samples. For your own files, attach/select captures or supply absolute paths available to the local host. For a sequence, specify capture order.

If your client lacks the documented plugin marketplace commands, update it. As a diagnostic fallback, any compatible local MCP host can launch `node /absolute/path/to/plugins/jvmscope/server/server.mjs` using stdio. That tests the tools only, not plugin/skill discovery. Never run the server with `npx` or install packages automatically during analysis.

## Data and limits

- The MCP process reads explicitly supplied file paths or its fixed bundled example when the user requests the demo. It does not scan directories, connect to JVMs, run shell commands, write captures, send HTTP requests or call an AI API.
- Paths may refer to any regular file readable by the local process. The host must obtain authorization for selected files; this server is not a filesystem sandbox. Network-mounted files remain subject to the operating system's behavior.
- Tool results include names, paths, findings and requested source lines and are visible to the AI host. Local parsing is **not offline AI** and does not imply automatic redaction.
- UTF-8 text only; gzip and binary input are rejected. At most 50 thread files and 64 MiB combined per analysis; TLS/GC accept one file. Two workers maximum, 512 MiB old-generation heap per worker, 60-second deadline. Large inputs may require smaller intervals.
- Results are paged and bounded to 512 KiB; evidence ranges are at most 200 lines / 24,000 JSON characters. Analysis must be rerun if the source SHA-256 changes. Keep files stable while analyzing.
- Thread snapshot comparison retains the shared engine's process/timestamp/counter checks. GC sessions are analyzed independently. GC pause budget defaults to 200 ms, a review threshold rather than a JVM requirement.
- Thread analysis includes an optional MCP Apps report with status cards, per-snapshot deadlock graphs, multiple cycle selection and hash-checked source evidence. Compatible host support must be tested in your client; text analysis remains available. Full TLS/GC visualizations remain in the existing application and VS Code extension.
- Cached reports last at most 10 minutes, with up to 12 reports per MCP connection. Overview rendering, comparison and cached snapshot pagination use this cache without rereading or reparsing captures. Selected-thread details reuse cached measurements and read/hash the selected capture once for up to five verified stack ranges, without rerunning the parser. Additional snapshots are cached when their serialized array fits within 2 Mi characters; otherwise only the requested page is retained and a cache miss is explicit. Public pages retain the 512 KiB response guard. Source clicks always recheck the file hash. Read/analysis timings exclude AI and transport latency. Reports are not exported automatically.

## Build and test from source

From the repository root:

```sh
npm ci --prefix extensions/codex
npm run package --prefix extensions/codex
npm test --prefix extensions/codex
npx --prefix extensions/codex playwright install chromium
npm run test:ui --prefix extensions/codex
codex plugin marketplace add "/absolute/path/to/JvmScope/build/codex-marketplace"
```

The build bundles the official MCP SDK, input validation and existing frontend analysis engines. It copies skill/manifest/assets and public samples into `build/codex-marketplace`. The marketplace ZIP includes that complete directory; the single-plugin ZIP contains only the plugin directory's contents. No generated parser fork or runtime npm installation is required. Do not add the unbuilt Git repository as a marketplace: the distribution directory is generated by the build.

Tests launch the emitted server from a relocated installation with no `node_modules` or source tree nearby, using the official MCP client. CI runs the same packaged tests on Linux, Windows and macOS. The maintainer confirmed desktop import, report rendering and source interaction for 0.2.2. Desktop screenshots of 0.3.0 confirmed the snapshot 3 graph and cited lock addresses match the displayed capture. Desktop screenshots of 0.3.1 confirmed the compact report and comparison render, while exposing a redundant overview during stack follow-ups. Version 0.4.1 is covered by packaged protocol and sandboxed host tests, including a privately supplied no-findings capture; its updated overview still needs a desktop smoke test. Protocol tests do not simulate Codex reasoning.

## Publication path

Local distribution works without public directory approval. Public submissions containing local MCP servers currently require OpenAI partner eligibility and organization allowlisting. This repository does not publish or submit automatically. Prepare identity verification, final listing/privacy/support materials and required review evidence after desktop acceptance. The VS Code extension retains its independent version and release pipeline.

Verified documentation (2026-10-23):
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/desktop-only
- https://developers.openai.com/plugins/deploy/submission

## 0.4.1 useful reports without findings

- A snapshot without prioritized findings now shows parsed record and Java-state counts, a state distribution and a searchable thread list. The list includes ordinary threads and header-only VM records, independently of rate leaders or finding participants. Clicking a record opens its exact verified stack/source through the existing focused report.
- Distinguish records with Java states from header-only VM records in the UI and model-visible summary. Unknown Java states remain unknown. A genuinely VM-only capture has an explicit coverage explanation. An empty findings section becomes an explanatory message; no findings is not proof of health.
- The list retains up to 200 records in source order, displayed 25 at a time. Search and state filters operate only on the retained subset, with total/omitted counts visible. Records beyond this bound require original-source inspection. All parsed records contribute to the summary and state counts. Rate-leader selection and analysis rules are unchanged.
- Keep one-snapshot limits visible: interval CPU/allocation rates, wait duration and progress cannot be established. Existing cumulative counters remain in the verified source. Java RUNNABLE does not measure CPU use; see [Java 25 Thread.State](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html).
- Write ZIP archives to a temporary file, flush and verify CRCs, then replace the destination. An interrupted/failed build preserves the previous package; failure-injection tests cover write and integrity-check errors.

Validation: 50 package/data/protocol tests and 29 browser journeys. A synthetic Java 25 fixture reproduces 20 Java-state records plus two header-only VM records, no prioritized findings and a synchronous HTTP wait. Tests cover VM source inspection outside rate leaders, changed hashes, exact identities for duplicate names, HTML-like labels, bounded search, both themes/languages and narrow layouts. A separately supplied capture was also exercised privately through the packaged MCP server and browser; it is not included in the repository or distribution. Shared web/VS Code parser and analyzer code is unchanged.

Desktop check: import the 0.4.1 single-plugin ZIP and start a fresh local conversation. Analyze a capture with no prioritized findings: confirm visible counts, state distribution and the thread list. Search for a thread, filter by state, open its stack, then return to the overview. For a native/VM-only capture, confirm the explicit missing-Java-data explanation. Also try a deadlock sample to verify the graph remains prominent.

## 0.4.0 selected-thread follow-ups

- `render_thread_details` presents one to five exact thread identities from one cached snapshot, with CPU/allocation rates, baseline interval, a prominent Java source location and expandable verified source. It does not repeat the full snapshot findings or deadlock graph. Initial evidence is bounded to 60 lines per thread; deeper stacks page through the existing identity- and hash-checked source tool.
- Follow-ups about named threads or the stacks behind a comparison use this single call. Already returned evidence can support a short interpretation without another widget. The skill preserves allocation intervals and avoids treating thread names, selected frames or stack call sites as proof of method implementation or diagnosis.
- Comparison charts start directly below the interval and metric controls. Interval summary cards and detailed coverage remain available in a keyboard-accessible disclosure below the chart. Missing rates, omitted row counts and allocation uncertainty remain visible.
- Batch evidence reads and hashes the capture once. Exact report/snapshot/thread identity, source bounds, changed hashes and public payload limits remain enforced. Source labels are plain text. Recorded-frame highlights use package-name heuristics and may include library code.

Validation: 45 package/data/protocol tests and 25 sandboxed browser journeys pass. Added checks cover focused navigation, one read with zero parser runs, long-stack paging, changed captures, malformed identity selections, untrusted labels, unavailable measurements, narrow/wide layouts, both themes and English/Swedish. An isolated skill trial selected all three requested identities in one focused call and returned a short Swedish explanation without another overview or duplicated full stacks. Shared web/VS Code analyzers and versions are unchanged by these refinements.

Reproduce the selected-thread transport benchmark after packaging:

```sh
node extensions/codex/test/benchmark-thread-details.mjs
```

On 2026-10-26, Node 24.22.1 in the Linux test environment, seven alternating trials measured median 495 ms for three individual source reads plus an overview, versus 239 ms for one selected-thread call. Model-facing content totaled 11,928 versus 9,715 JSON characters. This is a reproducible comparison of tool workflows, not a reconstruction of the desktop trace. It excludes model reasoning and desktop rendering and does not explain the observed 38–60 second conversation times.

Desktop check: import the 0.4.0 single-plugin ZIP and start a fresh local conversation. Analyze `real-java-all-3-snapshots.txt`, compare CPU/allocation, then request the allocation-hot thread and the two highest-CPU threads in snapshot 3. Verify three selected cards with rates for interval 2 → 3, source locations 634/532, expandable stacks and no repeated deadlock overview. Test navigation back to the comparison and snapshot, both themes and a narrow window. A brief interpretation follow-up should reuse existing evidence.

## 0.3.1 compact report refinements

- Findings start as compact, keyboard-accessible overviews. Expand a row for the full description, qualifications, recommendations, original diagnostics and source actions. Source evidence collapses with its finding.
- Group observed contention with a possible bottleneck interpretation only when complete lock-ID sets match and the exact waiting-thread identities are present in the inferred dependency. Equal counts, names, partial lists or unrelated waiters do not establish a relationship. Both original severities and all evidence remain available; no analyzer rules change.
- Selected thread controls name the exact source range instead of asking the user to select an already selected thread. Long stack frames show the reported Java file and line first, with the complete original frame under expansion.
- Keep snapshot identity visible; move host-editor guidance and parsing timings to Report information. The local-parsing/AI-host notice remains visible.

Validation: 40 package/data/protocol tests and 21 browser journeys pass, including all earlier comparison and source-scope regressions. Inspect narrow/wide, dark/light, English/Swedish layouts and verify keyboard expansion, linked owner/waiter sources, compact stack references and report information in the desktop smoke test. Shared web/VS Code analyzers and versions are unchanged.

## 0.3.0 snapshot comparison and evidence

- Switch between snapshot details and a visual CPU/allocation comparison. Adjacent intervals appear side by side, with accessible clickable bars, English/Swedish labels, light/dark themes and narrow layouts. CPU is per thread relative to one logical CPU. Allocation bands retain lower and upper bounds, rounded outwards; unchanged rounded counters are not displayed as proven zero.
- Select a comparison cell to inspect baseline and endpoint source independently or open its exact snapshot. Graph headings, source panels and contextual evidence results identify the snapshot. `read_thread_evidence` validates reportId, snapshot index, thread sourceKey, physical range and source hash. `render_thread_report` can focus a named snapshot/thread. The host editor and older widgets cannot be synchronized through ordinary chat file links; citations must include their snapshot.
- Reuse `render_thread_report(reportId, view="comparison", offset=0, limit=4)` for follow-ups. Cached page changes and comparisons never rerun the parser. The model receives a compact bounded row set; the interactive report retains more rows. Both disclose omitted counts. Invalid or unmatched measurements stay unavailable.
- Keep the existing shared analyzers and web/VS Code code unchanged. The cache is per connection, bounded and expires after ten minutes. Expired reports and uncached pages require analysis again; changed-source evidence is rejected.

Reproduce the follow-up transport benchmark after packaging:

```sh
node extensions/codex/test/benchmark-comparison.mjs
```

On 2026-10-25 with Node 24.22.1, seven Linux trials measured a median 122 ms for analyze-and-render versus 4 ms for cached comparison. The model comparison contained 18,244 JSON characters versus 89,985 for the complete retained measurement data (roughly 80% less). This measures packaged stdio MCP work only. It does not identify the cause of the observed 3m13s desktop response or predict model/UI latency.

Validation includes 37 package/data/protocol tests and 17 browser journeys. It covers real three-snapshot measurements, source identity mismatches, changed hashes, cache bounds/expiry, both interval endpoints, ambiguous identity, outward rounding, null metrics, keyboard operation and narrow light/dark layouts. A separate skill trial retained allocation bounds and produced a short Swedish comparison without duplicating the chart.

Desktop check: import the 0.3.0 standalone ZIP into a fresh local conversation. Analyze `real-java-all-3-snapshots.txt`, select snapshot 3 and inspect a thread. Ask to compare CPU/allocation: confirm a cached comparison report, then inspect both endpoint buttons and the focused snapshot link. Ordinary chat source links should explicitly say which snapshot they describe. Repeat with Swedish and English, narrow/wide windows and both themes.

## Earlier 0.2.2 refinements

- A single snapshot omits the snapshot selector and repeated-observation explanation. A one-item page from a longer series retains navigation.
- Graph cards show explicitly held locks and the awaited lock. Ownership comes from the shared parser's matched thread block; missing evidence is labeled as unestablished. Released `Object.wait()` monitors remain excluded. Up to two held locks appear per card, with additional counts disclosed and source inspection available.
- Successful report replies lead with the diagnostic conclusion and next check. Explicit rendering errors still receive a text fallback; the plugin does not claim to observe the host display.
- `show_thread_example` combines fixed-sample analysis, hash-checked source evidence and report presentation in one MCP call. The skill avoids duplicate analysis, evidence, knowledge and rendering calls for this demo. TLS/GC tools and the shared detection engines are unchanged.

Reproduce the transport measurement after packaging:

```sh
node extensions/codex/test/benchmark-demo.mjs
```

On 2026-10-24, Node 24.22.1 in the Linux test environment, seven trials of the relocated package measured median 97 ms for four separate calls (list, analyze, source, render) and 53 ms for the combined call. Connection startup was 122 ms; the first demo call was 80 ms. These measurements exclude model reasoning and host UI rendering; they cannot predict the 47-second desktop conversation time. The dependable improvement is eliminating three model/tool round trips.

## Earlier 0.2.1 fixes and desktop smoke test

- Keep graph labels at readable CSS sizes at 390, 640, 735 and 1060 px, with separate two- and three-participant cycle views. Resizing preserves open source evidence.
- Show cycles and matched threads for the selected snapshot, separately from snapshots with observed cycles. Repeated findings are not counted as distinct incidents. The shared summary fix also reaches the web application and VS Code 2.1.2.
- Restore exact source ranges for standard HotSpot text dumps, including the real three-snapshot example. JSON records without exact ranges still have no fabricated line numbers.
- Choose English or Swedish explicitly from the conversation, with an in-report language selector. Localized findings retain their evidence qualifications; original diagnostics remain available under details. Give a short accompanying AI answer and a clear example option when no capture is selected.

Install the updated single-plugin ZIP and start a fresh local conversation. Ask to try the bundled deadlock example. Confirm that `show_thread_example` is called once and a report labeled as a synthetic example appears. The short reply should explain the finding and next check without a speculative visibility caveat. Own captures still use `analyze_thread_dumps` followed by `render_thread_report`. Select a thread and verify its hash-checked source lines. Try a real multi-snapshot file, both cycles, narrow/wide views, light/dark themes and the language selector. If only text appears, use the concise text fallback and record the client version. The automated browser harness is not the Codex desktop application.

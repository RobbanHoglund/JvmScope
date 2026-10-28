# JvmScope for Codex — local preview 0.5.1

Analyze Java thread dumps, SunJSSE TLS logs and HotSpot GC logs using the same engines as the JvmScope web application and VS Code extension. Includes a Java knowledge base, TLS explanations, public samples and source-line evidence. This is an independently developed local plugin, not an OpenAI-approved directory listing.

## Install the packaged plugin

The build produces two different archives:

| Archive | Purpose |
| --- | --- |
| `jvmscope-codex-plugin-0.5.1.zip` | Single plugin with `plugin.json`, `mcp.json`, skills and bundled server at its root; for clients accepting plugin ZIP imports. |
| `jvmscope-codex-0.5.1.zip` | Complete local marketplace for the folder-based installation below. Do not upload this archive to a single-plugin import dialog. |

For the desktop **Add plugin / New plugin** file picker, select the **single-plugin** archive without unpacking it. The maintainer verified the 0.2.2 import and interactive report in a real desktop conversation. In that session, removing the older installed plugin before importing the replacement resolved a generic import error; this is an observed workaround, not a guarantee for every client. Start a fresh local conversation after updating. Do not remove the MCP configuration: the analysis tools depend on it. Public-directory eligibility is separate from personal import.

1. Install **Node.js 22 or later** and ensure `node --version` works in the desktop app's environment. No Java runtime, npm install, API key or running web server is needed to use the packaged plugin.
2. Download the `jvmscope-codex` artifact from a successful **Codex plugin checks** GitHub Actions run. Unzip the artifact, then unzip `jvmscope-codex-0.5.1.zip` into a permanent folder, for example `C:\Tools\JvmScope-Codex` or `~/Tools/JvmScope-Codex`. Keep `.agents` and `plugins` together; `.agents` may be hidden in Finder.
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
- Thread analysis starts with a compact MCP Apps summary: the assessment, next check, input context and critical findings. Open analysis for per-snapshot deadlock graphs, thread inventories, comparison and hash-checked source evidence. Compatible host support must be tested in your client; text analysis remains available. Full TLS/GC visualizations remain in the existing application and VS Code extension.
- Cached reports last at most 10 minutes, with up to 12 reports per MCP connection. Overview rendering, comparison and cached snapshot pagination use this cache without rereading or reparsing captures. Each selected-thread inspection or presentation reuses cached measurements and reads/hashes the selected capture once for up to five verified stack ranges, without rerunning the parser. When new evidence is needed for an AI follow-up, inspect first, then present the assessment; presentation rechecks the hash so a changed capture cannot silently reuse the earlier evidence. Additional snapshots are cached when their serialized array fits within 2 Mi characters; otherwise only the requested page is retained and a cache miss is explicit. Public pages retain the 512 KiB response guard. Source clicks always recheck the file hash. Read/analysis timings exclude AI and transport latency. Reports are not exported automatically.

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

Tests launch the emitted server from a relocated installation with no `node_modules` or source tree nearby, using the official MCP client. CI runs the same packaged tests on Linux, Windows and macOS. Version 0.5.1 passes 61 package/data/protocol tests and 62 sandboxed browser journeys locally. Two fresh independent model trials also exercised the skill across an initial analysis and a stack follow-up, in Swedish and English. Their actual assessments and final answers are retained as public synthetic-fixture recordings and replayed through fresh MCP calls in separate persistent report panels. CI replays those recordings; it does not rerun the model. The browser host is a protocol harness, not the Codex desktop app. Actual desktop behavior for 0.5.1 remains unverified here.

## Publication path

Local distribution works without public directory approval. Public submissions containing local MCP servers currently require OpenAI partner eligibility and organization allowlisting. This repository does not publish or submit automatically. Prepare identity verification, final listing/privacy/support materials and required review evidence after desktop acceptance. The VS Code extension retains its independent version and release pipeline.

Verified documentation (2026-10-23):
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/desktop-only
- https://developers.openai.com/plugins/deploy/submission

## 0.5.1 answer the question and show the requested stack

The maintainer's 0.5.0 screenshot showed separate report tabs, a chat reply that merely pointed to the report, a collapsed requested stack, two large unavailable metrics and ambiguous return controls. The previous tests covered protocol rendering but did not establish a usable complete conversation in that host layout.

- Provide the diagnostic conclusion, material uncertainty and next check in chat as well as the report. The skill and tool replies no longer instruct the assistant to suppress this concise answer. Full tables and stack blocks remain in the report unless requested as text.
- Open selected-thread stacks immediately, including when the host opens a new full analysis panel. Users can still collapse a stack, page long evidence and preserve its state across compact/expanded views.
- Replace two unavailable rate cards with one measurement qualification when neither rate exists. Keep actual rates, genuine zeroes, allocation bounds and measurement scope unchanged.
- Distinguish **All threads · snapshot N** (navigate to the snapshot) from **Compact view** (change presentation). Preserve the assessments and state of separately opened reports.

Validation on 2026-10-28: 61 Node tests and 62 browser journeys pass. Regression checks were observed failing before the corresponding fixes. Fresh independent Swedish and English two-turn skill trials both produced substantive final chat answers. Browser replay checks the actual packaged server, two persistent report panels, immediate stack visibility, assessment scope and round-trip navigation. Screenshots of the replay in dark/light themes, a compact summary and a 390 px focused view were inspected. Skill metadata validation passes. Each bug has its own commit with related regressions; version/documentation changes are separate.

Desktop acceptance still required: import **jvmscope-codex-plugin-0.5.1.zip**, start a fresh local conversation and analyze a capture. Then ask **Show the stack for main and explain what it is waiting for** (or the Swedish equivalent). The chat should answer the question and the opened report should show the stack without a disclosure click. Switch between the older overview and the follow-up tab, use **All threads**, then **Compact view** and reopen. Assessments must stay with their report/selection. Old conversation messages keep the version that originally rendered them. These automated checks do not certify the real desktop's tab placement or display-mode handling.

## 0.5.0 compact chat summary and opened analysis

- The inline card shows one scoped assessment and next check, file/snapshot context and an **Open analysis** action. Critical JVM-reported cycles and partial-input warnings remain visible. Thread lists, charts, stacks, filters and snapshot navigation are rendered only in the opened analysis surface, with no nested scrolling in the summary. A focused follow-up gets its own compact assessment.
- Prefer the standard MCP Apps `ui/request-display-mode` when the host advertises the requested mode. Feature-detect the optional `window.openai.requestDisplayMode` compatibility helper otherwise. Declare inline/fullscreen support in both initialization and resource metadata. Respect the actual returned mode and host context; do not assume a product name implies fullscreen support.
- When expansion is unavailable, refused, errors or times out, explicitly expand in place with a **Back to summary** action. Native close refusal stays visible instead of claiming the view closed. Opening/closing preserves the same analysis DOM and its selected snapshot/thread, comparison controls, filters, disclosures and loaded evidence; it does not rerun the parser or make tool calls.
- A host theme or display change cannot cancel pending navigation. A source response can finish while the analysis is collapsed, without leaving a permanent loading notice on return. Scope/hash checks and stale-navigation guards remain in force.
- Remove the second conclusion/next-check block when an AI assessment is present. Label the supporting observation **Analysis evidence**. Increase state badge readability and display single-snapshot measurement limits as neutral context. Keep the full original assessment without text truncation; unusually long assessments can make the summary taller.

Validation: 61 Node tests and 57 browser journeys pass, including 15 new complete-surface journeys. Existing detail tests now enter through **Open analysis**. New checks cover compact default height and absence of deep controls, native/unsupported/refused/failed/timed-out expansion, host-initiated modes, compatibility helper, close refusal, English/Swedish, light/dark and 390/735 px layouts, critical findings, partial/empty inputs, long untrusted text, exact assessment scope, focused follow-ups and in-flight source/navigation across collapse. Shared analyzers and VS Code files are unchanged.

Desktop acceptance: import **jvmscope-codex-plugin-0.5.0.zip** and start a new local conversation. Analyze a capture and confirm the short card first. Open analysis, select a thread, expand its stack, return to the summary and reopen; the same detail should remain. Try a follow-up and the bundled deadlock sample. The actual Codex host may open fullscreen or keep the analysis inline; both paths are intentional. Old messages retain their previous widgets. No desktop-native fullscreen or conversation-panel behavior is claimed as verified by these automated tests.

Implementation references: [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), [display modes](https://developers.openai.com/plugins/reference), and [UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines). Standard display request/response and capability shapes were checked against the official `@modelcontextprotocol/ext-apps` 2.0.4 schema; it is not added as a runtime dependency.

## 0.4.6 preserve assessments through navigation and failures

- A snapshot overview focused on a specific thread now uses a separate assessment scope. It cannot overwrite the snapshot-wide conclusion or follow a different graph participant.
- Only the latest current navigation response can replace the report. Delayed responses and errors from previous clicks cannot undo a newer thread/snapshot choice or a new host assessment.
- Snapshot and comparison navigation retrieves the matching cached assessment without rereading or reparsing captures. If a page is outside the bounded cache, the existing reanalysis fallback now explicitly renders the requested view/page/language instead of dropping comparison mode. Hosts without interactive tools retain local navigation over the delivered data.
- The 512 KiB result/page payload guards now measure UTF-8 bytes, including non-ASCII capture text. A rejected oversized presentation cannot replace or evict an accepted cached assessment.

Validation: each reported failure was reproduced against the prior implementation before adding the fix. New protocol and browser regressions cover thread/snapshot/view isolation, deliberately reordered responses, cached assessment restoration, no-tools navigation, cache-miss recovery, multibyte payload limits and rejected presentation rollback. All 61 package/data/protocol/cache tests and 42 sandboxed browser journeys pass. The dependency audit reports no vulnerabilities. The shared analysis engines and VS Code extension are unchanged; all four 0.4.5 workflows passed before these Codex-only fixes.

Desktop check: import the 0.4.6 single-plugin ZIP into a fresh conversation. Ask the same main-thread follow-up, switch between overview/comparison and threads, and confirm that the assessment stays above its matching evidence. Also click two different threads quickly; the latest selection should remain visible. Automated tests use a sandboxed MCP Apps host, not the full Codex desktop application.

## 0.4.5 keep explicit snapshot focus on its requested page

- Reject a report request when its explicit `snapshotIndex` is outside the page selected by `offset`/`limit`. Previously, a request for snapshot 3 with a page containing only snapshot 1 could silently display snapshot 1 and cache the supplied assessment under that wrong snapshot. Validation now runs before assessment storage, including for comparison views and empty pages.
- Keep valid focus on any snapshot within a page, ordinary pagination and unfocused empty-page navigation unchanged. No parsing, finding or measurement rules change.

Validation: reproduced the failure against the packaged 0.4.4 MCP server, then verified the rejection and correct focus/assessment identity through both cache and packaged-protocol regressions. All 57 package/data/protocol tests and 34 sandboxed browser journeys pass. The review also checked the initial and focused assessment flows, language/theme layouts, source hash checks, archive integrity and build provenance. The 0.4.4 Codex, VS Code, analyzer and Pages CI workflows all passed before this additional guard; CI runs again for 0.4.5.

Desktop check: use the 0.4.4 follow-up sequence below with the 0.4.5 package. For a series, select different snapshots and confirm that the displayed context and source belong to the selected snapshot. Automated MCP Apps tests do not reproduce the full desktop host.

## 0.4.4 complete selected-thread explanations

- Separate stack inspection from presentation. The new `inspect_thread_details` tool returns verified lines and cached measurements without opening a widget. The assistant reads this evidence before calling `render_thread_details`, which now requires a nonempty assessment and next check. The focused report puts them above the selected-thread cards. There are twelve read-only MCP tools.
- If the conversation already contains the necessary verified evidence, present the focused assessment directly. Otherwise inspect, interpret, then render once. Recheck the capture hash before presentation; neither call reparses the capture. Preserve thread/snapshot identity, missing-not-zero rates, allocation bounds and source limits.
- Direct UI stack clicks use the inspection tool and remain one call. With no matching assessment, show an explicit evidence-only notice. When returning to the exact previously assessed selection, restore its assessment. An overview assessment is not passed off as a separate answer to a new focused question.
- The skill must answer the actual follow-up and cannot claim that an assessment is in the report merely because stack data was returned. Existing verified evidence can still support a direct text answer when no new view is requested. The shared web/VS Code engines and versions are unchanged.

Validation: 55 package/data/protocol tests and 34 sandboxed browser journeys pass. Independent two-turn trials returned a substantive Swedish answer from existing evidence, and inspected then rendered an English two-thread follow-up with its own required assessment.

Regression coverage includes the reported overview → explain main sequence, rejecting a missing/blank assessment, ensuring the inspection tool has no UI template, preserving selected identities and rejecting a source changed between inspection and presentation. Browser checks cover assessment placement above the stack, stack expansion, overview/selection return navigation and the evidence-only notice. The earlier 0.4.3 forward tests covered initial overviews but missed this follow-up path.

The current `benchmark-thread-details.mjs` exercises inspection plus presentation with a fixed test assessment. Historical 0.4.0 timings below describe the old single-call flow; they do not measure AI reasoning or predict desktop response time. The data-then-render pattern follows the [MCP Apps guidance](https://developers.openai.com/plugins/build/chatgpt-ui).

Desktop check: import 0.4.4, analyze a selected dump, then ask to show a focused explanation of main and whether it appears stuck. Confirm the AI assessment and next check above the stack, in the conversation language. Expand the source, return to the overview and reopen main. A direct click on a thread without its own assessment should say that the view is stack evidence. Automated host checks do not replace this desktop check.

## 0.4.3 AI conclusion at the top of the report

- Pass the assistant's actual diagnostic assessment and next check to the render tool in `conclusion`. The widget places it immediately below the report heading, before rule summaries, statistics, graphs and thread lists. Label it as AI interpretation, separate from analyzer findings. The previous snapshot summary alone did not control where the assistant's chat answer appeared.
- Keep each assessment bound to its report, view, exact snapshot set and selected-thread identities. Navigation restores the matching assessment; it never transfers one to unrelated evidence. Retain at most 24 assessments per report within the existing ten-minute cache lifetime. No analyzer rules, findings, source checks or web/VS Code versions change.
- Bound and validate both plain-text fields, reject extra keys and render with `textContent`. Match the conversation language when generating an assessment. A manual UI language switch labels the assessment's original language; it does not pretend to translate AI-authored text.
- Instruct the initial analysis flow to verify evidence, supply the assessment to the single render call and avoid repeating it after the widget. Focused/comparison reports also accept assessments already supported by evidence. If required evidence first arrives in a render response, preserve a qualified short text reply instead of guessing beforehand. The fixed one-call example retains its existing workflow.

Validation: 54 package/data/protocol tests and 33 sandboxed browser journeys pass, covering actual AI text before all detail content, English/Swedish, dark/light and narrow layouts, cache scope and expiry, navigation, malformed input and HTML-like text. Independent Swedish and English skill trials analyzed selected captures, verified source evidence and supplied their own assessment to a single render call. The browser harness verifies the widget, not the full Codex desktop application.

The data-then-render flow follows the [MCP Apps UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui). The plugin controls ordering inside its widget; the host controls chat-message placement.

Desktop check: import the 0.4.3 standalone ZIP and analyze the same selected capture in a fresh local conversation. Confirm an AI assessment and next check directly under the heading, with no repeated conclusion after the report. Try an English conversation, then navigate to another snapshot and back, and open a stack. Existing reports in old messages retain their original content.

## 0.4.2 conclusion-first thread reports

- Put the snapshot conclusion and next check before counts and the thread inventory. Preserve JVM-reported cycle counts and partial-capture qualifications. A cached selected-thread card shows its Java state, a recorded frame and the stack action. When no rules fire, a uniquely named `main` with the recorded parked `CompletableFuture.get` → `HttpClientImpl.send` chain receives a labeled stack observation. This is not a new finding or evidence of a stalled request, its duration, missing timeouts or an unhealthy server. Frame selection uses package names and can include library code; source inspection rechecks the file hash.
- Display eight thread rows initially. “Show all”/“Show fewer” operate on the retained subset of at most 200 records, without another tool call. Search, state filtering, total/omitted counts, VM records, exact identities and existing graphs remain available.
- Start analysis directly for an explicit request with a selected capture, including an empty “My request:” template. Keep the reply precise: “No JVM-reported deadlock in this snapshot”. Distinguish total records from Java-state and VM records. The tool language follows the conversation; manual English/Swedish switching is preserved through stack navigation.
- Report separate read/analysis, worker round-trip, cached-report preparation and local DOM-construction measurements under Report information. Worker round-trip includes read/analysis; do not add these overlapping measurements. DOM construction excludes layout/paint. Neither measures AI reasoning or the desktop host's display delay.

Validation: 52 package/data/protocol tests and 30 sandboxed browser journeys, including false-positive HTTP pattern cases, counts unchanged by observations, missing/duplicate identities, compact expansion/collapse, exact stack navigation, language changes, themes, narrow layouts and existing deadlock/comparison regressions. Shared web/VS Code parsers, rules and versions are unchanged. The previously supplied private capture also passes the overview/stack/filter smoke test and is not distributed. Independent skill trials started directly with an empty template field, verified source and rendered once in the conversation language; the English trial preserved the 20 Java-state / two VM-record distinction.

Reproduce the overview transport measurement after packaging:

```sh
node extensions/codex/test/benchmark-overview.mjs
```

On 2026-10-27 with Node 24.22.1 in the Linux test environment, seven trials on the synthetic 22-record fixture measured a median 440 ms for analysis, hash-checked `main` evidence and cached report presentation (three stdio tool calls). Connection startup was 583 ms. This is not a desktop latency measurement and does not explain or reproduce the reported 79 seconds in Codex.

The stack observation follows the recorded call chain, consistent with the [Java 25 HttpClient API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html); Java state labels retain the [Thread.State qualifications](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.State.html).

Desktop check: import the 0.4.2 standalone ZIP, analyze the same capture and confirm that the observation/next check appears above eight initial rows. Expand/collapse the list and open `main` directly from the conclusion. Try an English conversation, both themes, a narrow window, an ordinary thread and a deadlock sample. Automated host tests do not reproduce the full Codex desktop application.

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

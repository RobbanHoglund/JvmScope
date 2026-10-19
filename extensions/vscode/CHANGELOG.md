# Changelog

## 2.1.1 — Reliable Capture Drops

- Handle external file drops across the entire thread, TLS and GC analyzer pages, before VS Code forwards them to its editor overlay.
- Read Explorer/editor URI drops through VS Code, preserving multiple thread captures, unsaved editor contents and source navigation. Document the Shift gesture for internal workbench drags.
- Accept native drops onto all three analyzers in the JvmScope sidebar without a modifier key, with validation, cancellation and clear errors.
- Add regression coverage for all three tools, full URI lists, host routing, file limits and failed imports.

## 2.1.0 — GC Timeline Navigation

- Give the GC timeline more space with a compact summary, responsive chart height and collapsible details. Add a draggable whole-segment pause overview, explicit visible-range scope, readable signal explanations and a complete paginated findings list.

- Open GC finding details directly from numbered chart markers and review diamonds. Cluster markers open the first finding immediately and expose the other findings in the detail panel, with keyboard support.

## 2.0.0 — Garbage Collection Log Analyzer

- Resolve the VSIX filename from the manifest throughout packaging and cross-platform CI, so version bumps cannot leave extraction and installation pointing at an older package.
- Major feature release introducing GC analysis alongside thread dumps and TLS logs. Includes the final timeline, accessibility and knowledge-base review improvements.

- Add a third analyzer for Sun/OpenJDK HotSpot Java 8–27 logs: upload/drop, separate heap/pause/concurrent timeline tracks, zoom, review annotations and exact source evidence.
- Distinguish JVM pressure signals from configurable pause budgets, informational explicit GC and qualified occupancy heuristics. Keep concurrent cycles and allocation stalls out of stop-the-world totals.
- Add GC commands, colored SVG icons, native sidebar navigation, web navigation and a source-backed GC knowledge guide.
- Improve GC event zoom, add theme-aware keyboard-accessible tooltips and distinguish review diamonds from pause duration. Show heap observations, a segment-wide interpretation and a clearer event inspector with expandable log evidence.
- Put the seven collector samples next to Load sample, including Serial, modern Parallel and historical CMS. Preserve elapsed days and calendar dates in long-capture labels, with synthetic multi-day scale regressions.
- Bundle seven authentic collector samples and replay real isolated JVM captures from every major Java release 8–27, with provenance, hashes and independent MXBean count checks.
- Test malformed input, cancellation, source navigation, keyboard use, four themes and narrow layouts. GC analysis remains fully local; AI is still available only for thread/TLS analysis.

## 1.2.2 — Analysis-specific AI prompts

- Give thread dumps and TLS logs separate diagnostic instructions. Select distinct guidance for one thread snapshot, a snapshot series, one TLS interaction and a TLS capture overview.
- Qualify thread-state and CPU interpretations, snapshot identity and deadlock counts. Qualify JSSE handshake outcomes, endpoint direction, certificate/authentication evidence and biased overview excerpts.
- Keep the shared report format and exact reviewed-prompt handoff. Reject unsupported evidence types instead of silently using generic instructions.
- Add regressions using real Java captures and packaged analyzer journeys, including scope changes, optional raw evidence, exact Copilot submissions and maximum prompt size.
- Keep TLS capture filters, open menus and timeline surfaces consistent with the VS Code theme, including light and high-contrast themes.
- Refresh the extension listing with a shorter quick start, analyzer screenshots and accurate local/AI privacy guidance. Move detailed controls and troubleshooting into the linked user guide.

## 1.2.1 — Reliable AI evidence and severity indicators

- Show a critical icon for confirmed Java deadlocks in the analyzer and a separate JvmScope findings section in the AI report, even when the model returns plain text. Keep analyzer priority distinct from AI assessment and application impact. Show up to three priorities, with secondary ones collapsed.
- Preserve every reported deadlock cycle, unresolved participant mappings, matched participant stack excerpts and measured CPU-hot thread IDs, rates, thresholds and interval qualifications. Keep all findings in the real three-snapshot example instead of dropping its second cycle and CPU evidence.
- Use valid bounded JSON for both analyzers; reject an oversized minimum with a recoverable review message. Prioritize late TLS failures and uncertain/incomplete interactions, retain classified failure events and share optional raw excerpts across included interactions.
- Retain reviewed prompt privacy: local display metadata is never appended to the model request. Edited prompts are labelled, completed reports keep their original findings, and copy/save/source still export the original AI response.
- Add real-capture regressions, plain-response report journeys, metadata validation, four-theme and narrow-layout checks, safe rendering and exact-export coverage.

## 1.2.0 — AI snapshot comparisons and clearer priorities

- Choose the current thread snapshot, its whole process group, or a custom subset of up to 20 snapshots in one reviewed AI request. Keep capture order, actual CPU interval endpoints, source references and thread identity qualifications.
- Share the evidence budget across selected snapshots, label reduced detail and reject oversized selections without silently omitting captures. Raw excerpts remain optional.
- Close the prompt dialog after a successfully rendered answer so the analyzer is visible beside it. Reopen the exact reviewed prompt without resending; errors and cancellation remain editable.
- Replace the chat-bubble action icon with a compact AI sparkle. Render explicit critical, warning, important and note callouts with text labels and at most three local SVG status icons per report, respecting VS Code themes. Their priority is labelled as an AI assessment and never changes parser findings.
- Request a concise summary and shorter paragraphs, improve narrow-panel reading size and simplify Copy response / Save… actions. Original Markdown exports are preserved.
- Add regression coverage for process boundaries, snapshot subsets, counter resets, budget limits, exact handoff, successful review reopening, explicit callout rendering and themed layouts.

## 1.1.3 — Readable AI responses

- Open completed Copilot answers in a formatted report beside the analyzer, with readable headings, lists, tables, quotes and code blocks instead of showing Markdown source by default.
- Follow the active VS Code theme, including high contrast, and keep long code and tables within narrow editor panels.
- Add Copy Markdown, Save Markdown and Open Markdown actions using the original response and its model/scope metadata.
- Render model output without executable HTML, embedded images or command/file links. External web links open only when clicked; nothing is fetched to render an answer.
- Test formatted output, exact exports, cancellation, four themes and narrow layouts in both analyzer journeys, plus the installed VSIX webview.

## 1.1.2 — Copilot model selection

- Exclude Copilot's internal dictation and utility aliases from the model picker, fixing the “only available to VS Code core” error for dictation models.
- If another model rejects an extension request as core-only, preserve the reviewed prompt and offer a new explicit choice. Remember the rejected model for the session; never switch models automatically.
- Keep consent, quota and network errors visible without retrying another model, and explain when only internal models are available.
- Add unit regressions, both packaged analyzer journeys and a real VS Code host check for the internal-model catalog.

## 1.1.1 — Recoverable Copilot requests

- Release failed AI jobs immediately, without waiting for an error notification to be dismissed.
- Show Copilot progress and provider errors in the AI dialog, keep Analyze disabled during the request and add Cancel analysis.
- Release cancelled or timed-out requests even when a provider does not respond, ignore late results and cancel when the reviewed evidence changes or its dialog closes.
- Add regressions using the packaged controller in both analyzer dialogs and real VS Code notification/progress APIs.

## 1.1.0 — Optional AI analysis

- Add an editable AI evidence preview for the selected thread snapshot or TLS interaction, preserving analyzer qualifications and marking excerpt limits.
- Analyze through installed Copilot Chat using its available models, token budgets and cancellation support; open the response in a separate Markdown editor.
- Detect installed Codex and Claude Code and offer explicit Copy and open handoff, with manual copy available for other assistants.
- Keep raw evidence optional, clear reviewed prompts when captures change, and explain provider sharing separately from local parsing.

## 1.0.0 — General availability

- Show sidebar expand arrows only when an analyzer has captured items; empty roots remain direct tool launchers.
- Move keyboard focus to the selected Help topic in both analyzers; Escape returns to Help without changing the loaded capture or page URL.
- Preserve Knowledge Base browsing in one retained tab, with Back/Forward history and restoration of search, version/format choices, result filters, scroll and focus. Reopening Knowledge Base resumes the current article.
- Use host selection and focus colors for the active knowledge search match, including light and high-contrast themes.
- Keep knowledge-base section links inside the current VS Code webview, preserving search, Java/format selections and keyboard focus.
- Remove the Preview badge from the desktop extension and update the listing and installation documentation to describe the GA release.
- Validate stable release metadata in the actual VSIX, including the Marketplace gallery flags and pre-release channel property.
- Clarify that merging to main builds the release artifact; a new Marketplace version must be published separately.

## 0.3.14 — Compact TLS capture header

- Keep the complete TLS capture filename beside its label on a dedicated wrapping row, with tighter header spacing. Restore at least six complete interaction rows at 1366 × 768 with capture analysis collapsed.
- Extend the layout regression to an uploaded capture with a long filename and count only rows fully inside both the table and the browser viewport.

## 0.3.13 — Visible capture names and finding graphs

- Show complete capture names on their own wrapping row in both analyzers, including narrow editors and zoomed views.
- Retain acquisition waits when held-lock ownership cannot be matched. Show qualified JVM owner IDs without drawing unsupported ownership arrows; keep condition waits, latch waits and generic parks out of ownerless acquisition chains.
- Open the graph for the priority lock-contention, lock-bottleneck or class-initialization finding automatically. Add a direct Show graph action and preserve intentional panel collapse while filtering the same snapshot.

## 0.3.12 — Deadlock graphs at first glance

- Open confirmed deadlock evidence automatically for each new snapshot and show the first cycle immediately.
- Select other cycles through separate buttons with participant counts; show one graph at a time and retain the selected cycle while filtering or refreshing the current snapshot.
- Make the Deadlocks shortcut open the panel and move keyboard focus there in one action. Keep lock addresses and relationship details collapsed until requested.

## 0.3.11 — Identifiable diagram update

- Give the inline deadlock, lock-contention and class-initialization diagrams a distinct extension version and VSIX filename, so the installed update can be verified.
- Run webview browser regressions against the modules and assets extracted from the actual VSIX in CI.

## 0.3.10 — Focused thread investigation

- Restore deadlock diagrams as the primary view, with clickable thread cards, explicit lock nodes and complete return arrows based on resolved JVM-reported owners. Retain relationship details below each graph.
- Show lock-contention and class-initialization dependencies inline. Keep unknown owners unresolved, expose every waiter through disclosure, and adapt graph layout to narrow editors and all VS Code theme families.
- Keep explicit class-initialization waits separate in recurring stack clusters and preserve case-sensitive Java class identities in the dependency graph.
- Preserve complete confirmed deadlock cycles in compact graphs, retain room for other contention, count all omitted waits, search every parsed frame, and render class-initialization arrowheads.
- Add Recurring stacks and Dependency map shortcuts, exclusive trend filtering, readable responsive cluster cards, visible density controls and a reveal-all action. Distinguish waiting from ownership with solid/dashed edges and place flow labels outside the main arrows.
- Remove emoji prefixes from the Analyze commands. Reuse the toolbar's themed thread-tree and shield SVGs in their command definitions; native context menus and the Command Palette retain plain text labels.
- Lead with the strongest finding and explicit counts for cycles, threads and CPU measurement coverage. Keep full metadata in a disclosure.
- Deadlock relationships show the JVM-reported owner for every participant; missing mappings remain unknown.
- Default to analysis columns, retain technical columns and sort context, and keep Details reachable in narrow editors.
- Compare CPU intervals in a ranked table with selected-snapshot scope, duration, timing basis and Clear selection.
- Simplify Annotated filters, label wait/lock evidence as investigation candidates, clarify Copy/search/print scope and show only relevant Display settings.
- Keep secondary panels compact, prevent header overlap and correct selected CPU hover contrast across host themes. Add related unit, real-sample and browser regressions.

## 0.3.9 — Exact-first raw evidence

- Put Exact before Annotated and start every new raw evidence view in Exact, including upgrades with an old Annotated preference. Keep the current mode when returning to an existing view.
- Preserve wrapping and line-number preferences, structured filtering, search, Details/Graph return and complete-snapshot clipboard/editor actions.
- Correct selected mode/filter hover contrast, raw-line hover and line-number colors across VS Code theme families.
- Add browser regressions for default mode, legacy preferences, keyboard order and raw evidence theme states. Record the four-view TDA UI/UX review and remaining design priorities.

## 0.3.8 — View startup recovery and clearer sidebar icon

- Recreate timed-out views on the next Open command, ignore late messages from failed views, and clean up failed page reads. Preserve healthy analyzer sessions.
- Document recovery for VS Code service-worker startup errors; this extension cannot repair the host service-worker cache.
- Replace the small face outline with a simple J inside a magnifying glass, adapted to the current theme.

## 0.3.7 — Recognizable Activity Bar avatar

- Replace the generic connected-node sidebar icon with a simplified outline of the JvmScope avatar.
- Keep the sidebar icon monochrome and theme-controlled, including high-contrast themes, while retaining the full-color listing and editor-tab avatar.

## 0.3.6 — Structured raw thread evidence

- Open Raw dump inside the analysis tab with the shared Annotated/Exact workspace, search, thread filters, lock inspection and Details/Graph navigation.
- Keep the complete read-only text editor available through an explicit Open as text action.
- Follow live host themes, support narrow tabs, preserve native clipboard behavior and retire evidence when its snapshot changes.
- Add browser regressions for raw evidence, navigation, replacement and theme/layout behavior; correct the compact TLS check for its new Highlights count.

## 0.3.5 — TLS investigation workspace

- Improve small evidence text and selected-row contrast across VS Code themes.
- Keep capture totals in one place, show filtered counts when relevant, and tone down file actions after loading a capture.
- Resize the TLS table and inspector by dragging their divider or using arrow keys, with saved widths and stacked panes in narrow editors.
- Cover filtering, pagination, resizing, keyboard controls and theme behavior with browser regression tests.

## 0.3.4 — Native navigation

- Remove the repeated website navigation row from VS Code views, while keeping it in the standalone application.
- Add a permanent Knowledge base shortcut to the sidebar, its … menu and the Command Palette.
- Keep capture actions, samples, Paste and Help in their analyzer views.

## 0.3.3 — Analyzer shortcuts

- Name the sidebar view JvmScope Analyses so it is easy to find through View → Open View….
- Add both analyzer commands to the sidebar's … menu alongside the existing toolbar icons.
- Add direct analyzer buttons to the editor tab bar, using blue thread-tree and teal shield SVG icons.
- Use light/dark icon variants in both the editor and sidebar toolbars.

## 0.3.2 — Publication review

- Retire TLS evidence and diagnostic dialogs when their capture is replaced or cleared.
- Fix bundled knowledge article navigation, Java version filters, related links and search fragments in VS Code.
- Apply host themes to home and knowledge surfaces, including light and high-contrast themes.
- Keep knowledge filters and articles usable in narrow editors and browser windows.
- Fix the Marketplace documentation link and validate the actual VSIX contents.
- Install the same release package in real VS Code on Linux, Windows and macOS; cover the minimum and current stable VS Code versions.

## 0.3.1 — Analyzer menu symbols

- Add emoji prefixes to the two Analyze commands in context menus and the Command Palette (removed in 0.3.10).

## 0.3.0 — Native analysis sidebar preview

- Add the JvmScope Activity Bar view with source files, snapshots, threads, TLS interactions and observed events.
- Open exact thread details and highlight TLS events from the tree, including objects hidden by table filters.
- Load branches in pages of 100 items and invalidate stale selections when analyses change or close.
- Reuse existing TLS uncertainty and event models; keep captures in the owning webviews.
- Add model, native tree/protocol, production webview and real VS Code integration tests.

## 0.2.2 — Clear Java positioning

- Identify Java explicitly in the extension title, description, documentation and commands.
- Categorize the extension under Programming Languages and Visualization.

## 0.2.1 — Extension icon

- Use the supplied avatar as the extension listing and analysis-tab icon.

## 0.2.0 — Editor integration preview

- Open thread evidence and TLS event/raw lines in the original source editor.
- Preserve physical line ranges across snapshots, JSON, mounted virtual threads and CRLF input.
- Reject stale or revoked source links; examples and pasted text have no original-file link.
- Follow VS Code light, dark and high-contrast themes, with layouts for narrow editor splits.
- Add source registry, parser, webview/theme and real extension-host navigation regression tests.

## 0.1.0 — Stage 1 preview

- Package the existing thread dump and TLS analyzers as offline VS Code webviews.
- Add Command Palette, Explorer and editor context actions, including unsaved editor input and multiple thread dumps.
- Integrate native file selection, clipboard, read-only raw evidence and save dialogs.
- Bundle examples, help and the knowledge base; retain the existing analysis rules.
- Add protocol/package tests, CSP browser tests, real extension-host tests and VSIX build artifacts.

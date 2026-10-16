# TDA UI/UX review — 16 October 2026

## Assessment and scope

JvmScope already exposes useful evidence and unusually careful qualifications. The
main usability gap is deciding **what to investigate first, what each number counts,
and which snapshot or interval a statement describes**. Adding more colors or icons
would not solve these problems. The next design iteration should reduce competing
information and make the path from finding to evidence shorter.

Reviewed four supplied VS Code screenshots: collapsed overview (`100729`), expanded
deadlocks (`100755`), expanded charts (`100832`), and Annotated raw evidence (`100905`).
The review follows the corresponding code on main at
`af756ac0f6844fc9edc1ab2133e9a089a95b7805`, then checks the fixes on this branch.
The screenshots are not copied into the repository because they contain unrelated
workspace information.

Evidence labels used below:

- **Confirmed:** visible in the screenshots and/or established in rendering/model code.
- **Reproduced:** exercised against a built application in browser tests.
- **Recommendation:** a design judgment to validate with users, not a proven defect.

This is a UI/UX review with targeted functional regression checks. It is not a new
Java-specification audit, an accessibility certification, or a complete Marketplace
release sign-off. Browser tests emulate the VS Code bridge and representative theme
variables; they do not run an installed desktop VS Code instance locally.

## Changes included in this branch

| Change | Result | Verification |
| --- | --- | --- |
| Exact is first and the initial Raw dump mode | A newly created evidence view immediately displays the complete selected snapshot text. Old saved `mode: annotated` values cannot override this. | Fresh and legacy-preference browser regressions in standalone and VS Code; button order, `aria-pressed`, keyboard activation, text equality and snapshot changes. |
| Preserve active investigation state | Existing views keep their selected mode when reused or revisited from Details/Graph. Wrap and line-number preferences survive new views. | Reopening and graph-return tests, including native tab closure and creation of another snapshot's workspace. |
| Correct Raw dump host-theme contrast | Selected mode/filter controls keep a matched foreground/background pair on hover. Line numbers and line hover use host colors instead of dark standalone colors. | Reproduced light-theme selected-button contrast around 1.11:1 before the fix; checks now require at least 4.5:1 for the tested text in four representative palettes at 1366px and 600px. |


| Counts, coverage and priority | Overview leads with the highest-priority finding; cycles, mapped thread blocks and thread-filter counts use separate units. CPU findings show unavailable when reliable interval evidence is absent. Full coverage and precision remain in a disclosure. | Unit cases for missing, estimated, zero and partial CPU evidence; browser finding focus preserves existing filters. |
| Compact deadlock evidence | Each row names its JVM-reported owner, including the closing relationship when reported. Cycle actions sit beside the heading. Missing mappings remain unknown. | Closing-owner, cycle inspector and Details browser regression. |
| Task-focused thread table | Analysis columns are the default; all technical columns remain selectable. Sort and scope stay explicit. Details is reachable and technical horizontal scrolling does not move the controls. | Narrow editor, column-switch, pointer/keyboard, sorting, paging and exact-identity regressions. |
| CPU comparison | Whole-capture scope, selected-snapshot availability, interval duration/timestamps, a ranked comparison table and Clear selection. Unsafe rates remain absent rather than plotted as zero. | Existing interval safety/keyboard tests plus selection/reset regression. Selected CPU hover contrast is checked in all four host palette families. |
| Annotated controls | Common exclusive filters show thread counts; specialist filters move into More lock filters. Investigation candidates no longer claims confirmed faults. Copy/search/print scope and mode-specific settings are explicit. | Filter/search/copy, Display menu, Exact/Annotated and theme regressions. |
| Overview layout | Compact secondary panels expand to full width. Capture title wraps without overlap; filters live with their table. | 1560/1366/780/600px layout and expanded-panel checks. |

“Exact” refers to the parser's complete **selected snapshot text**, not a byte-for-byte
copy of an entire imported multi-snapshot file. Existing parsing may normalize line
endings and remove trailing snapshot separators. This change does not alter parsing.

## Original findings and implementation rationale

P1 means address before presenting the interface as ready for a broad general
audience; P2 means a meaningful workflow improvement; P3 is finishing work. These
are UX priorities, not claims about data loss or analyzer correctness. The core changes below are now implemented as summarized above. Optional future
ideas, such as small-multiple CPU plots or a second adjacent deadlock inspector,
remain design options rather than release requirements.

### 1. P1 — Counts need explicit entities and scope

**Confirmed, images 1, 2 and 4.** The sample shows `1 critical problem`, `2 deadlock
cycles`, and `5 Deadlocks`. These are different quantities: the smart-analysis model
creates one confirmed-deadlock finding containing all cycles, the deadlock panel
counts cycles, and Raw dump counts deadlocked thread blocks. The numbers need not
disagree, but their labels currently make them appear to.

Use these labels consistently:

| Current presentation | Proposed presentation |
| --- | --- |
| 1 critical problem detected | 1 critical finding · 2 deadlock cycles · 5 involved threads |
| Raw outline: Deadlocks 5 | Deadlocked threads 5 |
| Raw outline: Class init waits 10 | Threads awaiting class initialization 10 |
| Raw outline: Unresolved 7 | Threads with owner not observed 7 |
| Snapshot totals: CPU HOT 0 | CPU findings: unavailable — no preceding interval, when that is the actual coverage state |

Do not substitute “unavailable” indiscriminately for zero. Use measured coverage
and diagnostic status to distinguish “assessed, none found” from “cannot assess”.
In other captures participant mappings may be incomplete; label mapped thread
blocks separately from JVM-reported participants and retain mapping warnings.

**Acceptance:** a reader can reconcile findings, cycles, threads and relationships
without opening Help. Each count identifies its unit and whether it covers the
selected snapshot, the whole capture or the filtered view.

**Code evidence:** `tda/smart-analysis.js:addDeadlockFinding`,
`tda.js:renderDeadlockPanel`, `tda/raw-dump-model.js:buildRawDumpModel`, and
`tda/raw-dump-view.js:renderOutline` under `frontend/assets/javautils/`.

### 2. P1 — “Problems” overstates the raw-evidence classification

**Confirmed, image 4.** `Problems 29` is a count of thread blocks selected by a broad
evidence predicate. It includes blocked threads, lock holders with waiters,
synchronizer parking, and class-initialization relationships. It is not the number
of smart-analysis findings or 29 proven application defects. `Owner not observed`
is evidence absence, not proof of a missing owner or a deadlock.

Rename the category to **Threads with wait/lock evidence**, or a shorter
**Investigation candidates** with a visible explanation. Reserve red for confirmed
deadlock evidence and severity-assessed findings. Present ordinary thread states
and relationship roles as neutral information; preserve text labels alongside color.
Do not fix this by changing analysis thresholds merely to reduce visual noise.

**Acceptance:** selecting the category explains why a thread is included and does
not promote normal parking/holding into a confirmed incident. The count remains
distinct from the prioritized findings count.

**Code evidence:** `tda/raw-dump-model.js:buildThreadBlock` and `buildLockIndex`.

### 3. P1 — The overview does not establish a clear investigation priority

**Confirmed layout; recommendation, image 1.** Capture actions, snapshot controls,
filters, a long uppercase metrics line, repeated timestamps and source counts all
precede the diagnostic panels. Five nearly equal disclosure rows then compete for
attention. The critical issue is collapsed, and the table initially shows CPU-time
leaders rather than the deadlocked threads.

Keep one compact context row: **source · snapshot 1/3 · readable time**. Show a small
set of meaningful summary values, with coverage and remaining metrics in a details
disclosure. Retain timezone and full timestamp precision in an accessible detail or
copy action. Consolidate duplicated “Time valid” and source/snapshot counts.

Give the strongest finding a concrete preview and action, for example
**“Confirmed deadlock · 2 cycles · Inspect 5 threads”**. Do not silently replace a
user's table sort/filter. Scope a finding action explicitly and show the resulting
filter with a clear reset control. Keep upload/session actions available, but reduce
their emphasis after a capture is loaded.

**Acceptance:** at a normal laptop viewport a new user can identify the selected
capture, the highest-priority finding and the next evidence action without scrolling.
Zero metrics and routine input instructions do not dominate that first screen.

**Code evidence:** `tda.js:renderStats`, `renderSmartAnalysisPanel`,
`renderTableRows`; `frontend/jvmscope/tda.html` header and panel order.

### 4. P2 — Deadlock presentation should expose the complete cycle

**Confirmed, image 2.** The cards provide useful waiting/holding/blocked-by evidence.
However, arrows connect adjacent cards and a final `↺` glyph implies the closing
edge. It does not draw the actual last-thread-to-first-thread relationship. Wide
empty space separates the cards from the cycle-level action. Two small cycles
consume most of the remaining viewport.

Use a compact cycle diagram or a labeled relationship list that explicitly connects
each waiter to the observed owner, including the closing edge. Put **Inspect cycle**
beside the cycle heading and keep full lock IDs available for selection/copy. A
selected thread can expose its evidence in an adjacent inspector on wide screens
and below the relationship list on narrow screens. Do not infer ownership to make
the diagram look complete when the report has missing mappings.

**Acceptance:** users can follow the entire circular wait without matching hex IDs
mentally; the same relationships are available as text and by keyboard. Selecting
evidence and returning preserves the cycle and thread context.

**Code evidence:** `tda.js:renderDeadlockCard`; the existing dependency graph offers
thread/resource navigation that can be reused.

### 5. P1 — CPU evidence needs a visible time scope and availability state

**Confirmed, images 1 and 3.** The selected snapshot is #1, whose measured CPU delta
has no preceding sample. The timeline shows intervals D1→D2 and D2→D3 across the
capture. Its high peaks and the header's zero CPU-hot findings therefore do not
establish an arithmetic defect. They currently require the reader to infer this
difference in scope.

The graph uses equally spaced interval categories (`scalePoint`), not elapsed time
on a proportional axis. That is valid, but a connected line can suggest a continuous
CPU trace. State **“Average thread CPU during each sampled interval”** prominently,
show interval durations and readable end times in the selected-point summary, and
identify which snapshot a click will open. Preserve gaps for unsafe comparisons.
Do not imply that a high interval rate proves the stack at its endpoint consumed it.

**Acceptance:** snapshot #1 explicitly explains unavailable interval measurements;
users can identify start/end/duration of a point without relying only on hover. Gaps,
estimated evidence and observed low values remain distinct.

**Code evidence:** `tda/cpu-timeline.js:buildCpuTimelineModel`,
`tda/classification.js:evaluateMeasuredCpu`, `tda.js:renderCpuTimelineChart`.

### 6. P2 — Overlapping CPU series need a stronger comparison aid

**Confirmed, image 3.** Ten series mostly overlap in just two intervals. The legend
is a second dense collection of wrapped names and peaks. The pale lines are a
deliberate hover/selection state (`updateCpuTimelineEmphasis`), so the screenshot
alone is not evidence that all default lines have inadequate contrast.

Keep highlighting, but show **Selected thread: name · interval rate · peak** beside
the chart and a visible **Clear selection** action. Offer a compact ranked table
with thread name, selected-interval CPU, peak CPU and available-interval count. A
single-thread view or small multiples can follow if real users need it. Preserve
dash patterns and keyboard navigation; color alone should not identify a series.

**Acceptance:** users can compare the hottest threads despite overlapping paths and
long names. Clearing a pinned selection is discoverable without remembering that
clicking the same legend item again clears it.

### 7. P2 — The thread table needs a task-focused default column set

**Confirmed, image 1.** Many technical columns compete with the name, state and
evidence. Top frames extend beyond the visible edge. CPU time is cumulative, so
sorting by it is not the same task as finding current interval CPU consumption.

Default to **Thread, State, Findings, Wait/owner relationship, interval CPU when
available, Top frame, Details**. Offer cumulative counters, allocation, priorities,
IDs and daemon flags through a column selector or thread details. Keep identifier
columns available to experienced users. Use visible units and distinguish unavailable
from zero. Keep names and the main action reachable in a narrow split.

The nearby **Refresh** button only reapplies filters/sort and returns to page 1. It
does not read the file or collect another JVM sample. Remove it if redundant with
live filtering, or label it **Reapply filters**. Add an explicit source reload action
only if that behavior is implemented.

**Acceptance:** finding a blocked thread and opening its evidence does not require
horizontal scrolling. Search, chart filters and finding focus show their combined
effect, plus an obvious way back to all threads.

### 8. P2 — Annotated evidence needs less competing navigation

**Confirmed, image 4.** The native VS Code tree sits beside another outline. Inside
that outline, fourteen general filters precede the thread list. Most main cards are
collapsed and show roles instead of raw lines. This is useful structured analysis,
but previously violated the expectation created by the label **Raw dump**; the
Exact-first change addresses that immediate mismatch.

For Annotated, show a short set of common filters with counts and place specialist
lock predicates in an expandable **More filters** group. Keep counts tied to the
current snapshot and state whether filters are exclusive. Prioritize the thread
list over the filter catalogue and retain a visible selected-thread indicator.
Use **Raw dump · Snapshot 1/3** as the heading; move the full timestamp to metadata.

**Acceptance:** with the native sidebar open, a user can switch to Annotated, locate
a thread and inspect its lines without first scrolling past a full filter catalogue.
The native tree remains optional; the standalone app still has sufficient navigation.

### 9. P2 — Toolbar labels should expose action scope and relevant settings

**Confirmed in code, image 4.** Search follows visible evidence; Copy always copies
the complete canonical snapshot, even when Annotated is filtered. Standalone Print
uses the filtered structured view in Annotated. The distinction exists in titles or
implementation but is not clear in the short visible labels. Exact's Display menu
also offers outline/inspector/evidence-label options that do not affect Exact.

Use **Copy snapshot** and **Print current view**, retaining **Open as text** for the
native editor. In Exact, expose wrapping and line numbers; in Annotated, add the
relevant structure settings. Add a short visible search-scope cue when filtered.

**Acceptance:** users can predict what Copy/Print exports before invoking it. Every
visible setting changes the current view or explicitly says when it applies.

### 10. P3 — Tighten visual rhythm without making everything smaller

The dark palette and analyzer identity are coherent. The problem is the combination
of large panel surfaces with dense small text inside them, repeated separators and
far-right actions. Use a consistent spacing/type scale, normal case for routine
metadata, and fewer simultaneous badges. Preserve full source values through
selection, tooltips and explicit copy affordances rather than increasing truncation.

`Show details` is a CSS pseudo-element on the native summary, not a second button.
Keep the entire disclosure row interactive and keyboard accessible; do not add a
nested button solely to imitate its current appearance. Judge hit areas and contrast
from rendered elements, not screenshot pixels affected by scaling.

## Validation and comparison captures

The Exact regression failed against the old production bundle before the fix.
The selected CPU hover regression also reproduced low light-theme contrast (about
1.11:1) before its correction. The targeted checks now cover:

- 415 TDA unit tests, 35 TDA integration tests and 24 VS Code unit tests.
- 170 standalone TDA/CPU browser cases across desktop/laptop projects. The first
  broad pass had 158 passing cases; all 12 failed cases were corrected and rerun.
  These covered old hidden-chart/navigation assumptions and technical-column
  reachability, while retaining the assertions against unsafe CPU measurements.
- 29 VS Code browser cases, including the new triage, cycle, compact table, layout,
  CPU comparison and theme cases. Text contrast checks require at least 4.5:1 for
  the tested elements in representative light/dark/high-contrast palettes.
- Production webview/standalone builds and VSIX package validation.

Authentic before/after screenshots use the same built-in sample, snapshot 1/3,
1560×1000 viewport, fixed capture clock and representative VS Code dark palette.
The baseline is this PR's earlier commit `d0a417c` (0.3.9), which already includes
Exact-first. The Raw dump pair compares Annotated in both versions; an additional
Exact screenshot shows the default. These are actual rendered production webviews
with the host bridge emulated in Chromium, not mockups or screenshots of installed
VS Code. No private workspace material is included.

The theme measurements cover the tested elements and palettes, not every third-party
theme. Keyboard focus was exercised; a screen-reader review remains useful. No user
study was conducted. The analyzer's parsing and diagnostic rules are unchanged;
this iteration changes presentation, evidence navigation and measurement wording.

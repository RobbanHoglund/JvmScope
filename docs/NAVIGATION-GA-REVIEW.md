# Navigation review for VS Code 1.0.0

Reviewed 2026-10-17, before Marketplace publication. The navigation goal is that
opening evidence makes the destination clear, closing it returns to the opener,
and switching tools does not reset an active investigation.

## Corrected problems

| Problem | Change | Regression coverage |
| --- | --- | --- |
| Reopening Knowledge Base reset its page, and article links replaced the tab without a useful browsing history. | Keep a single reading tab with Back/Forward buttons and Alt+Left/Right outside form fields. Restore search, result filters, comparison/support choices, article version/format, scroll and focus. The Knowledge base link returns to prior results when available; the native launcher resumes the current article. | Reproduced the unexpected extra panel before the fix. Host tests verify tab reuse, explicit/invalid routes and startup recovery. A browser journey follows results → article → related article, moves Back/Forward, returns to results, branches to another article and checks that state, focus and the webview URL survive. |
| Selecting a Help topic scrolled the text but left keyboard focus in the contents menu. | Move focus to the selected heading without scrolling the outer page or changing its URL. Escape returns to Help. | Both analyzers failed the focus assertion before the fix. Packaged-webview and standalone Help tests now verify the destination and return focus. |
| Empty analyzer roots showed an expand arrow even though there were no children. | Show an expand arrow only after captured items exist. Empty roots remain clickable launchers. | A native-tree test fails before the fix and covers initial state, loading, Clear and disposal while preserving the launcher command. |

Each correction and its tests are in a separate commit.

## Journeys checked

| Journey | Expected behavior checked |
| --- | --- |
| Native sidebar / toolbar → analyzer | Opens or reveals the owning tool; independent analyzer sessions remain retained. |
| Sidebar → file / snapshot / thread or TLS event | Selects the exact item despite duplicate labels or active filters; obsolete items cannot target a replacement capture. |
| TDA finding → threads / graph → thread details | Reveals the relevant panel, maintains evidence scope and returns focus when details close. Multiple deadlock cycles remain selectable. |
| TDA raw evidence → details / dependency graph → raw evidence | Retains the selected evidence view, search and source context. Back to raw dump returns to the original workspace; Close returns to its opener. The standalone app's separate raw tab was also exercised. |
| TLS table → keyboard selection → inspector → full details | Keeps the selected interaction across table modes; previous/next and arrow navigation target the expected interaction; Escape returns to Full details. |
| Analyzer → Help → topic → Close | Keeps the capture, moves focus with topic navigation and restores the opener. |
| Knowledge Base → result → related guide → Back / Forward | Restores page-specific state and reading position in one tab. Both article and section links are exercised, including host-supplied routes. |
| Narrow editor / host themes | All knowledge pages fit 360/600 px checks. Four representative host palettes retain readable surfaces and focus controls; screenshots were visually inspected. |

## Verification

- Complete frontend chain: **801 tests passed**, with **441 existing runtime
  reports replayed**.
- Extension unit tests: **27 passed**.
- Rebuilt production webview suite: **41 passed**. The six Knowledge Base cases
  were also rerun after the final route/readiness refinements.
- Standalone Knowledge Base, Help and thread-table navigation: **36 passed**
  across desktop and laptop projects.
- Standalone raw evidence, thread-row activation and TLS keyboard/detail
  journeys: **6 passed** across those two projects.
- The final VSIX validation and new installed-VS-Code CI results are recorded on
  the PR so they can be tied to the published commit and archive.

## Scope and limits

Knowledge history is bounded to 30 entries, held only in the open VS Code
webview's memory and discarded when that tab closes. It does not persist raw
captures or search data in browser storage. Standalone pages continue to use
ordinary browser navigation; a full page reload starts a new analysis session.
The new retained-history behavior belongs to the VS Code Knowledge Base.

The browser tests use production host modules and CSP with a simulated transport.
They complement, rather than replace, the workflow's installed-extension tests.
This review does not claim screen-reader certification, every custom theme,
remote workspace coverage, or a completed Marketplace installation check.

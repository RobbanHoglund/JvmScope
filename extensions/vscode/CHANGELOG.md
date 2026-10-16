# Changelog

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

- Prefix Analyze as Java Thread Dump with 🧵 and Analyze as Java TLS Log with 🔒 so the two actions are easier to distinguish in context menus and the Command Palette.

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

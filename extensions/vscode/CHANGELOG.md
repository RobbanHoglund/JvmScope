# Changelog

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

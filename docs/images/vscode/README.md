# VS Code listing screenshots

Captured on 2026-10-18 from the built extension webviews using the Playwright host
fixture in `extensions/vscode/test/browser.spec.mjs`. The host supplies representative
VS Code theme variables; these images show the webview content, not a mock desktop
window. The standalone application and its exports have separate palettes.

| Image | Data and view |
| --- | --- |
| `thread-deadlocks.png` | Built-in thread sample, snapshot 1 of 3, first of two JVM-reported deadlock cycles. Element capture of the complete deadlock panel in a dark theme. |
| `tls-investigation.png` | Built-in comprehensive TLS example, interaction 35 selected, light theme at 1280 × 900. This is example data, not a production incident. |
| `ai-report-example.png` | Same thread sample and actual analyzer findings. The deterministic response comes from `extensions/vscode/test/fixtures/ai-response.md`; the displayed model name is “Illustrative response”. Captured through the summary and warning without cutting a paragraph. |

No live model request was made for the AI image. The listing labels it as an
illustrative response; it must not be presented as an endorsement or a benchmark
of any model. No image generation or pixel retouching was used.

Listing image URLs pin the commit containing these files so they continue to work
after the development branch is merged or deleted. Replace that revision when
refreshing the screenshots. They are hosted documentation assets, not webview
runtime resources, and are excluded from the VSIX.

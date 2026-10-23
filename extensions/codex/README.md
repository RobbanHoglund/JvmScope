# JvmScope for Codex — local preview 0.1.0

Analyze Java thread dumps, SunJSSE TLS logs and HotSpot GC logs using the same engines as the JvmScope web application and VS Code extension. Includes a Java knowledge base, TLS explanations, public samples and source-line evidence. This is an independently developed local plugin, not an OpenAI-approved directory listing.

## Install the packaged plugin

The build produces two different archives:

| Archive | Purpose |
| --- | --- |
| `jvmscope-codex-plugin-0.1.0.zip` | Single plugin with `plugin.json`, `mcp.json`, skills and bundled server at its root; for clients accepting plugin ZIP imports. |
| `jvmscope-codex-0.1.0.zip` | Complete local marketplace for the folder-based installation below. Do not upload this archive to a single-plugin import dialog. |

For the desktop **Add plugin / New plugin** file picker, try the **single-plugin** archive without unpacking it. Its structure and MCP runtime are tested, but acceptance by that upload service is not verified. ZIP import support does not by itself establish support for local stdio MCP servers. If the app rejects it, retain the detailed error if available and use the documented local marketplace route below. Do not remove the MCP configuration to make an upload pass: the analysis tools depend on it. Public-directory local MCP restrictions are separate from this personal import flow.

1. Install **Node.js 22 or later** and ensure `node --version` works in the desktop app's environment. No Java runtime, npm install, API key or running web server is needed to use the packaged plugin.
2. Download the `jvmscope-codex` artifact from a successful **Codex plugin checks** GitHub Actions run. Unzip the artifact, then unzip `jvmscope-codex-0.1.0.zip` into a permanent folder, for example `C:\Tools\JvmScope-Codex` or `~/Tools/JvmScope-Codex`. Keep `.agents` and `plugins` together; `.agents` may be hidden in Finder.
3. Add that **extracted marketplace folder** using a current Codex CLI:
   ```sh
   codex plugin marketplace add "/absolute/path/to/JvmScope-Codex"
   codex plugin marketplace list
   ```
   On Windows, use your absolute Windows folder path in the quoted argument.
4. Restart the ChatGPT desktop app, open its Plugins directory, select **JvmScope Local Plugins**, and install **JvmScope**. Start a fresh **local** Codex conversation. The CLI command registers the catalog; it is not proof that the plugin has been installed/enabled in the desktop app.
5. Ask: **Use JvmScope to list its sample files, analyze the thread deadlock example, and show the source evidence.** Then try TLS and GC samples. For your own files, supply absolute paths. For a sequence, specify capture order.

If your client lacks the documented plugin marketplace commands, update it. As a diagnostic fallback, any compatible local MCP host can launch `node /absolute/path/to/plugins/jvmscope/server/server.mjs` using stdio. That tests the tools only, not plugin/skill discovery. Never run the server with `npx` or install packages automatically during analysis.

## Data and limits

- The MCP process reads only explicitly supplied file paths. It does not scan directories, connect to JVMs, run shell commands, write captures, send HTTP requests or call an AI API.
- Paths may refer to any regular file readable by the local process. The host must obtain authorization for selected files; this server is not a filesystem sandbox. Network-mounted files remain subject to the operating system's behavior.
- Tool results include names, paths, findings and requested source lines and are visible to the AI host. Local parsing is **not offline AI** and does not imply automatic redaction.
- UTF-8 text only; gzip and binary input are rejected. At most 50 thread files and 64 MiB combined per analysis; TLS/GC accept one file. Two workers maximum, 512 MiB old-generation heap per worker, 60-second deadline. Large inputs may require smaller intervals.
- Results are paged and bounded to 512 KiB; evidence ranges are at most 200 lines / 24,000 JSON characters. Analysis must be rerun if the source SHA-256 changes. Keep files stable while analyzing.
- Thread snapshot comparison retains the shared engine's process/timestamp/counter checks. GC sessions are analyzed independently. GC pause budget defaults to 200 ms, a review threshold rather than a JVM requirement.
- Interactive timelines and graphs remain available in the existing JvmScope application and VS Code extension. This plugin version produces structured analysis and AI explanations.

## Build and test from source

From the repository root:

```sh
npm ci --prefix extensions/codex
npm run package --prefix extensions/codex
npm test --prefix extensions/codex
codex plugin marketplace add "/absolute/path/to/JvmScope/build/codex-marketplace"
```

The build bundles the official MCP SDK, input validation and existing frontend analysis engines. It copies skill/manifest/assets and public samples into `build/codex-marketplace`. The marketplace ZIP includes that complete directory; the single-plugin ZIP contains only the plugin directory's contents. No generated parser fork or runtime npm installation is required. Do not add the unbuilt Git repository as a marketplace: the distribution directory is generated by the build.

Tests launch the emitted server from a relocated installation with no `node_modules` or source tree nearby, using the official MCP client. CI runs the same packaged tests on Linux, Windows and macOS. Host plugin discovery and a real Codex conversation still require desktop acceptance; protocol tests do not claim to simulate Codex reasoning or pointer interactions.

## Publication path

Local distribution works without public directory approval. Public submissions containing local MCP servers currently require OpenAI partner eligibility and organization allowlisting. This repository does not publish or submit automatically. Prepare identity verification, final listing/privacy/support materials and required review evidence after desktop acceptance. The VS Code extension retains its independent version and release pipeline.

Verified documentation (2026-10-23):
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/deploy/desktop-only
- https://developers.openai.com/plugins/deploy/submission

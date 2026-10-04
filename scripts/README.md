# JvmScope scripts

Run the commands below from the repository root. Start and stop wrappers also
work from another directory when invoked by their full path.

| Purpose | PowerShell | Bash |
| --- | --- | --- |
| Start JvmScope | `./scripts/start.ps1` | `bash ./scripts/start.sh` |
| Stop JvmScope | `./scripts/stop.ps1` | `bash ./scripts/stop.sh` |
| Start (compatibility alias) | `./scripts/start-slim.ps1` | `bash ./scripts/start-slim.sh` |
| Stop (compatibility alias) | `./scripts/stop-slim.ps1` | `bash ./scripts/stop-slim.sh` |
| Run Gradle | `./scripts/gradlew.bat test` | `bash ./scripts/gradlew test` |
| Refresh controlled TDA samples | `./scripts/generate-thread-samples.ps1` | `bash ./scripts/generate-thread-samples.sh` |

All start/stop names control one Java server on fixed port **23873**.
No separate backend or Vite process is launched. Optional frontend-only Vite
development uses **23872**.
The launchers refuse occupied ports and stop only processes owned by this
checkout. `local-dev.mjs`, `local-dev-config.mjs` and `frontend-install.mjs`
provide their shared implementation.

Other commands:

- `bash scripts/build-frontend.sh`: build and test the frontend.
- `node scripts/generate-tls-examples.mjs`: regenerate the public synthetic TLS
  teaching logs from their canonical scenario source; see [examples](../docs/EXAMPLES.md).
- `node scripts/capture-parser-samples.mjs`: capture a controlled JVM process
  for parser fixtures; supply a JDK home and output directory.
- `node scripts/capture-thread-examples.mjs <jdk-home> [output-directory]`: real
  CPU-hot sequence and virtual-thread library captures from owned Java children.
- `node scripts/capture-tls-samples.mjs`: capture controlled loopback TLS
  fixtures; see the TLS test README for arguments.
- `node scripts/local-dev.integration.mjs`: application launcher lifecycle checks.
- `node scripts/slim/lifecycle.mjs`: compatibility entry point for the same checks.
- `node scripts/slim/measure.mjs`: measure the built slim package.
- `node scripts/slim/container-ga.mjs`: constrained image checks on Linux Docker.
- `node scripts/build-pages.mjs`: build and verify the separate static Pages artifact.
  `--check` verifies an existing artifact; `--base /OtherProject/` sets its URL prefix.
- `node scripts/preview-pages.mjs`: strict loopback Pages preview on port 23874.
  See [Pages setup and tests](../docs/GITHUB-PAGES.md).
- `node scripts/project-legal.mjs --check-package slim/build/package`: verify
  the portable package's license and notices against the root sources.
  The same sources supply every frontend build through Vite.

`package/run.sh` and `package/run.ps1` are distribution templates. `assembleSlim`
copies them into `slim/build/package/scripts/`; the package root holds `runtime/`
and `app.jar`, LICENSE, NOTICE and THIRD-PARTY-NOTICES.md. Invoke the copies in the built package, for example:

```powershell
./slim/build/package/scripts/run.ps1 --host=127.0.0.1 --port=23873
```

```bash
./slim/build/package/scripts/run.sh --host=127.0.0.1 --port=23873
```

Gradle wrapper metadata stays in `gradle/wrapper/`. Both Gradle projects configure
the wrapper task to regenerate its launch scripts here.

## JVM compatibility collection

`node scripts/jvm-samples.mjs` provides `discover`, `download`, `capture`,
`aggregate`, `import`, `render` and `check` for the manual JVM sample workflow.
`local` captures installed JDKs; `failure` records jobs that could not install a JDK.
See [the workflow guide](../docs/JVM-SAMPLES.md) for selectors, local pilots,
artifact import, provenance, retention and generated README checks.

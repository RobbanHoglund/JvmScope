$ErrorActionPreference = 'Stop'

& node (Join-Path $PSScriptRoot 'local-dev.mjs') stop
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

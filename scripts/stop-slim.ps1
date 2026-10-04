$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'local-dev.mjs') stop --slim
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

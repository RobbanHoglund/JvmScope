$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'local-dev.mjs') start --slim
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

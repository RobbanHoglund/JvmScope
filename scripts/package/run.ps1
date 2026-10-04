$ErrorActionPreference = 'Stop'
$slimPackageRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
# Pass defaults to this JVM only; do not change the caller's environment and
# accidentally restrict another Java application to a 64 MiB heap.
$slimJavaOptions = if ($env:JAVA_TOOL_OPTIONS) { @() } else { @('-Xms8m', '-Xmx64m', '-XX:+UseSerialGC', '-Xss256k') }
& (Join-Path $slimPackageRoot 'runtime/bin/java.exe') @slimJavaOptions --add-modules jdk.httpserver -jar (Join-Path $slimPackageRoot 'app.jar') @args
exit $LASTEXITCODE

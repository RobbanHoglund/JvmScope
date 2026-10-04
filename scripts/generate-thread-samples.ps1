param(
    [int]$Snapshots = 3,
    [int]$IntervalMs = 1500,
    [int]$WarmupMs = 800,
    [string]$JavaHome,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../tools/thread-dump-generator')).Path
$out = Join-Path $root 'out'
$testdata = Join-Path $root '../../testdata/thread-dumps'
$singleSample = Join-Path $testdata 'real-java-all-1-snapshot.txt'
$multiSample = Join-Path $testdata "real-java-all-$Snapshots-snapshots.txt"
$frontendSample = Join-Path $root '../../frontend/assets/javautils/tda/samples/real-java-all-3-snapshots.txt'

if ($JavaHome) {
    $resolvedJavaHome = (Resolve-Path -LiteralPath $JavaHome).Path
    $java = Join-Path $resolvedJavaHome 'bin/java.exe'
    $javac = Join-Path $resolvedJavaHome 'bin/javac.exe'
    $jcmd = Join-Path $resolvedJavaHome 'bin/jcmd.exe'
} else {
    $java = (Get-Command java).Source
    $javac = (Get-Command javac).Source
    $jcmd = if ($Portable) { $null } else { (Get-Command jcmd).Source }
}

New-Item -ItemType Directory -Force -Path $out, $testdata, (Split-Path $frontendSample) | Out-Null
$sources = Get-ChildItem (Join-Path $root 'src/main/java') -Recurse -Filter '*.java' |
    ForEach-Object { $_.FullName }
& $javac -encoding UTF-8 -d $out $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

if ($Portable) {
    & $java -cp $out com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner `
        --scenario all --snapshots 1 --warmup-ms $WarmupMs `
        --portable --output $singleSample
    if ($LASTEXITCODE -ne 0) { throw "portable single-snapshot runner failed with exit code $LASTEXITCODE" }

    & $java -cp $out com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner `
        --scenario all --snapshots $Snapshots --interval-ms $IntervalMs `
        --warmup-ms $WarmupMs --portable --output $multiSample
    if ($LASTEXITCODE -ne 0) { throw "portable multi-snapshot runner failed with exit code $LASTEXITCODE" }
} else {
    if (-not (Test-Path -LiteralPath $jcmd -PathType Leaf)) {
        throw "jcmd not found at $jcmd"
    }
    $token = [Guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "thread-scenario-$token.stdout"
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) "thread-scenario-$token.stderr"
    $process = Start-Process -FilePath $java -ArgumentList @(
        '-cp', $out,
        'com.robbanhoglund.jvmscope.samples.threaddump.ThreadScenarioRunner',
        '--scenario', 'all',
        '--warmup-ms', $WarmupMs,
        '--hold'
    ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    try {
        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 100
            $ready = (Test-Path -LiteralPath $stdoutPath -PathType Leaf) -and
                ((Get-Content -Raw -LiteralPath $stdoutPath -ErrorAction SilentlyContinue) -match 'READY')
        } while (-not $ready -and -not $process.HasExited -and (Get-Date) -lt $deadline)

        if (-not $ready) {
            $stderr = Get-Content -Raw -LiteralPath $stderrPath -ErrorAction SilentlyContinue
            throw "scenario runner did not become ready: $stderr"
        }

        & $java -cp $out com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector `
            --pid $process.Id --snapshots 1 --jcmd $jcmd --output $singleSample
        if ($LASTEXITCODE -ne 0) { throw "single-snapshot collector failed with exit code $LASTEXITCODE" }

        & $java -cp $out com.robbanhoglund.jvmscope.samples.threaddump.ThreadDumpCollector `
            --pid $process.Id --snapshots $Snapshots --interval-ms $IntervalMs `
            --jcmd $jcmd --output $multiSample
        if ($LASTEXITCODE -ne 0) { throw "multi-snapshot collector failed with exit code $LASTEXITCODE" }
    } finally {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id
        }
        $process.WaitForExit()
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

if ($Snapshots -eq 3) {
    Copy-Item -LiteralPath $multiSample -Destination $frontendSample -Force
} else {
    Write-Warning 'The frontend sample was not replaced because it requires exactly three snapshots.'
}
Write-Output "Generated $singleSample"
Write-Output "Generated $multiSample"

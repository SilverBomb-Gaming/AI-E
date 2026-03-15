param(
    [string]$ExpectedPython = '.\.venv\Scripts\python.exe'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$expectedPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ExpectedPython))

if (-not (Test-Path $expectedPath)) {
    Write-Output ("WARN | missing interpreter | {0}" -f $expectedPath)
    exit 1
}

$versionOutput = & $expectedPath --version 2>&1
$versionText = if ($LASTEXITCODE -eq 0 -and $versionOutput) { ($versionOutput | Select-Object -First 1) } else { 'unknown' }

Write-Output ("Interpreter: {0}" -f $expectedPath)
Write-Output ("Version: {0}" -f $versionText)
Write-Output ("Policy: PASS | AI-E approved interpreter matches repo-local .venv")
exit 0
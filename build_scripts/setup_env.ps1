Param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$venvPath = Join-Path $projectRoot ".venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "Creating virtual environment at $venvPath"
    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    $launcherArgs = @()
    if ($null -eq $pythonCmd) {
        $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
        if ($null -eq $pythonCmd) {
            throw "Python 3.11+ is required on PATH (python or py)."
        }
        $launcherArgs = @("-3.11")
    }
    & $pythonCmd.Source @launcherArgs "-m" "venv" $venvPath
}

$pythonExe = Join-Path $venvPath "Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "Virtual environment looks corrupted. Delete .venv and rerun this script."
}

if (-not $SkipInstall) {
    Write-Host "Upgrading pip inside $venvPath"
    & $pythonExe "-m" "pip" "install" "--upgrade" "pip"

    Write-Host "Installing requirements from requirements.txt"
    & $pythonExe "-m" "pip" "install" "-r" (Join-Path $projectRoot "requirements.txt")
}

$activateScript = Join-Path $venvPath "Scripts\Activate.ps1"
if (-not (Test-Path $activateScript)) {
    throw "Unable to locate Activate.ps1 inside .venv."
}

Write-Host "Activating virtual environment..."
. $activateScript
Write-Host "AI-E virtual environment is active. You're ready to run .\\.venv\\Scripts\\python.exe -m app.main" -ForegroundColor Green

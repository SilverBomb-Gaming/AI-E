Param(
    [switch]$UseIcon
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$pyinstallerExe = Join-Path $venvPath "Scripts\pyinstaller.exe"

if (-not (Test-Path $pythonExe)) {
    throw "Python virtual environment not found. Run 'python -m venv .venv' first."
}

& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r (Join-Path $projectRoot "requirements.txt")

$pyinstallerArgs = @(
    "--onefile",
    "--noconsole",
    "--name",
    "AI-E",
    (Join-Path $projectRoot "app\main.py")
)

$assetsPath = Join-Path $projectRoot "assets"
if (Test-Path $assetsPath) {
    $pyinstallerArgs += @("--add-data", "$assetsPath;assets")
}

if ($UseIcon) {
    $iconPath = Join-Path $projectRoot "assets\icon.ico"
    if (Test-Path $iconPath) {
        $pyinstallerArgs += @("--icon", $iconPath)
    }
}

& $pyinstallerExe @pyinstallerArgs

Write-Host "Build complete. Check the dist folder for AI-E.exe." -ForegroundColor Green

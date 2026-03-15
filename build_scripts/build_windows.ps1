Param(
    [switch]$UseIcon
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot ".venv"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"
$pyinstallerExe = Join-Path $venvPath "Scripts\pyinstaller.exe"
$buildArtifacts = Join-Path $projectRoot "build_artifacts"
$logPath = Join-Path $buildArtifacts "build_log.txt"

New-Item -ItemType Directory -Force -Path $buildArtifacts | Out-Null
New-Item -ItemType File -Force -Path $logPath | Out-Null

function Write-BuildLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Message"
    $entry | Out-File -FilePath $logPath -Encoding utf8 -Append
    Write-Host $Message
}

function Invoke-LoggedCommand {
    param(
        [string]$Description,
        [string]$Executable,
        [string[]]$Arguments
    )

    Write-BuildLog $Description
    $output = @()
    $exitCode = 0
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $Executable @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    if ($null -ne $output) {
        $output | Out-File -FilePath $logPath -Encoding utf8 -Append
        foreach ($line in $output) {
            if ($line) {
                Write-Host $line
            }
        }
    }
    if ($exitCode -ne 0) {
        throw "$Description failed with exit code $exitCode"
    }
}

function Remove-PathWithRetry {
    param(
        [string]$Path,
        [int]$Attempts = 5,
        [int]$DelaySeconds = 2
    )

    if (-not (Test-Path $Path)) {
        return
    }

    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            Remove-Item $Path -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            if ($i -eq $Attempts) {
                throw "Failed to remove $Path after $Attempts attempts. Last error: $_"
            }

            Write-BuildLog "Removal of $Path blocked (attempt $i/$Attempts). Waiting $DelaySeconds s before retry."
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

if (-not (Test-Path $pythonExe)) {
    throw "Python virtual environment not found. Restore the approved .venv or run '.\\build_scripts\\setup_env.ps1'."
}

try {
    Write-BuildLog "Starting AI-E build using $pythonExe"

    Invoke-LoggedCommand "Upgrading pip" $pythonExe @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-LoggedCommand "Installing requirements.txt" $pythonExe @("-m", "pip", "install", "-r", (Join-Path $projectRoot "requirements.txt"))

    $pyinstallerArgs = @(
        "--onefile",
        "--noconsole",
        "--name",
        "AI-E",
        "--collect-all",
        "PySide6",
        "--collect-all",
        "shiboken6",
        (Join-Path $projectRoot "app\main.py")
    )

    $buildDir = Join-Path $projectRoot "build"
    if (Test-Path $buildDir) {
        Write-BuildLog "Clearing previous build artifacts"
        Remove-PathWithRetry $buildDir
    }

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

    Invoke-LoggedCommand "Running PyInstaller" $pyinstallerExe $pyinstallerArgs

    $exePath = Join-Path $projectRoot "dist\AI-E.exe"
    if (-not (Test-Path $exePath)) {
        throw "PyInstaller did not create $exePath"
    }

    Write-BuildLog "Build complete. Output: $exePath"
    Write-Host "Build complete. Check the dist folder for AI-E.exe." -ForegroundColor Green
}
catch {
    Write-BuildLog "Build failed: $_"
    Write-Error $_
    exit 1
}

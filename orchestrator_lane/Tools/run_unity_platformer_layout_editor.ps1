[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $true)]
    [string]$ScenePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$LogPath,

    [Parameter(Mandatory = $false)]
    [string]$LayoutId = "platformer_layout",

    [Parameter(Mandatory = $false)]
    [string]$LayoutName = "Platformer Layout",

    [Parameter(Mandatory = $false)]
    [decimal]$GridStep = 0.5,

    [Parameter(Mandatory = $false)]
    [int]$TimeoutSec = 0
)

$ErrorActionPreference = "Stop"

function Resolve-UnityEditorPath {
    $envPath = [Environment]::GetEnvironmentVariable("UNITY_EDITOR_EXE", "Process")
    if ($envPath -and (Test-Path $envPath)) {
        return $envPath
    }

    $scriptRoot = $PSScriptRoot
    if (-not $scriptRoot) {
        $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    $pathFile = Join-Path $scriptRoot "unity_editor_path.txt"
    if (Test-Path $pathFile) {
        $filePath = (Get-Content $pathFile -ErrorAction Stop | Select-Object -First 1).Trim()
        if ($filePath -and (Test-Path $filePath)) {
            return $filePath
        }
    }

    $fallback = "D:\Program Files\Unity Hub\Editor\6000.2.8f1\Editor\Unity.exe"
    if (Test-Path $fallback) {
        return $fallback
    }

    throw "Unable to resolve Unity editor path. Set UNITY_EDITOR_EXE or create Tools\unity_editor_path.txt."
}

function Resolve-FullPath {
    param([string]$Path)

    if ([System.IO.Path]::IsPathRooted($Path)) {
        $resolved = [System.IO.Path]::GetFullPath($Path)
    }
    else {
        $resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
    }

    $directory = Split-Path -Parent $resolved
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    return $resolved
}

function Join-ArgumentList {
    param([string[]]$Values)

    return ($Values | ForEach-Object {
        if ($_ -match '[\s"]') {
            '"{0}"' -f ($_ -replace '"', '\\"')
        }
        else {
            $_
        }
    }) -join ' '
}

$resolvedProject = Resolve-FullPath -Path $ProjectPath
$resolvedScene = Resolve-FullPath -Path $ScenePath
$resolvedOutput = Resolve-FullPath -Path $OutputPath
$resolvedLog = Resolve-FullPath -Path $LogPath

if (-not (Test-Path $resolvedProject)) {
    throw "Project path not found: $resolvedProject"
}

if (-not (Test-Path $resolvedScene)) {
    throw "Scene path not found: $resolvedScene"
}

$unityExe = Resolve-UnityEditorPath

if (Test-Path $resolvedOutput) {
    Remove-Item $resolvedOutput -Force
}

Write-Host "[run_unity_platformer_layout_editor] Using Unity editor: $unityExe"
Write-Host "[run_unity_platformer_layout_editor] Project: $resolvedProject"
Write-Host "[run_unity_platformer_layout_editor] Scene: $resolvedScene"
Write-Host "[run_unity_platformer_layout_editor] Output: $resolvedOutput"

[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_MODE", "keyboard_mouse", "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_OUTPUT", $resolvedOutput, "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_SCENE", $resolvedScene, "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_LAYOUT_ID", $LayoutId, "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_LAYOUT_NAME", $LayoutName, "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_GRID_STEP", $GridStep.ToString([System.Globalization.CultureInfo]::InvariantCulture), "Process")
[Environment]::SetEnvironmentVariable("AIE_PLATFORMER_EXIT_ON_SAVE", "1", "Process")

$arguments = @(
    "-projectPath", $resolvedProject,
    "-executeMethod", "Babylon.CI.PlatformerLayoutCorrectionBootstrap.RunFromCommandLine",
    "-logFile", $resolvedLog
)

try {
    $argumentString = Join-ArgumentList -Values $arguments
    $process = Start-Process -FilePath $unityExe -ArgumentList $argumentString -PassThru -WindowStyle Normal -WorkingDirectory $resolvedProject
    if (-not $process) {
        throw "Failed to launch Unity process."
    }

    if ($TimeoutSec -gt 0) {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        while (-not $process.HasExited) {
            if ($stopwatch.Elapsed.TotalSeconds -ge $TimeoutSec) {
                try {
                    $process.Kill()
                }
                catch {
                    Write-Warning "Unable to kill Unity process after timeout: $_"
                }
                throw "Unity process exceeded timeout of ${TimeoutSec}s."
            }
            Start-Sleep -Seconds 1
        }
    }
    else {
        $process.WaitForExit()
    }

    $exitCode = $process.ExitCode
    Write-Host ("UNITY_EXIT_CODE={0}" -f $exitCode)
    if ($exitCode -ne 0) {
        Write-Host ("UNITY_EXIT_REASON=unity_exit_{0}" -f $exitCode)
        throw "Unity returned non-zero exit code $exitCode"
    }

    if (-not (Test-Path $resolvedOutput)) {
        throw "Correction payload not found at $resolvedOutput"
    }

    Write-Host "UNITY_EXIT_REASON=completed"
    Write-Host "[run_unity_platformer_layout_editor] Correction payload present at $resolvedOutput"
    exit 0
}
catch {
    Write-Host "UNITY_EXIT_CODE=1"
    Write-Host "UNITY_EXIT_REASON=launcher_failed"
    Write-Error $_
    exit 1
}
finally {
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_MODE", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_OUTPUT", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_CORRECTION_SCENE", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_LAYOUT_ID", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_LAYOUT_NAME", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_GRID_STEP", $null, "Process")
    [Environment]::SetEnvironmentVariable("AIE_PLATFORMER_EXIT_ON_SAVE", $null, "Process")
}
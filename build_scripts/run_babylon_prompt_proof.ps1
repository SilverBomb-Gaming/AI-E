[CmdletBinding()]
param(
    [string]$BabylonProjectPath,
    [string]$PromptText = "move zombie forward",
    [string]$ArtifactsRoot,
    [int]$TargetTicks = 120
)

$ErrorActionPreference = "Stop"

$aiERoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($BabylonProjectPath)) {
    $BabylonProjectPath = Join-Path (Split-Path -Parent $aiERoot) "BABYLON VER 2"
}
if ([string]::IsNullOrWhiteSpace($ArtifactsRoot)) {
    $ArtifactsRoot = Join-Path $aiERoot "runner_artifacts"
}
if ([string]::IsNullOrWhiteSpace($PromptText)) {
    throw "PromptText cannot be empty."
}
if ($TargetTicks -lt 1) {
    throw "TargetTicks must be at least 1."
}

$script:FailureReasons = New-Object 'System.Collections.Generic.List[string]'

function Add-Failure {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return
    }

    if (-not $script:FailureReasons.Contains($Message)) {
        $script:FailureReasons.Add($Message)
    }
}

function Assert-ScriptParameters {
    param(
        [string]$ScriptPath,
        [string[]]$RequiredParameters,
        [string]$Label
    )

    $command = Get-Command -Name $ScriptPath -ErrorAction Stop
    foreach ($requiredParameter in $RequiredParameters) {
        if (-not $command.Parameters.ContainsKey($requiredParameter)) {
            throw "$Label is missing required parameter '$requiredParameter': $ScriptPath"
        }
    }
}

function Resolve-FullPath {
    param(
        [string]$Path,
        [string]$BasePath
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "Path parameter cannot be empty."
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function New-RunDirectory {
    param([string]$RootPath)

    $stamp = Get-Date -Format "yyyyMMdd_HHmmss_fff"
    $runDirectory = Join-Path $RootPath ("{0}_babylon_prompt_proof" -f $stamp)
    $suffix = 1

    while (Test-Path $runDirectory) {
        $runDirectory = Join-Path $RootPath ("{0}_babylon_prompt_proof_{1:00}" -f $stamp, $suffix)
        $suffix += 1
    }

    New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
    return $runDirectory
}

function Get-OptionalProperty {
    param(
        $Object,
        [string]$Name,
        $Default = $null
    )

    if ($null -ne $Object -and $Object.PSObject.Properties.Name -contains $Name) {
        return $Object.$Name
    }

    return $Default
}

function New-ArtifactInfo {
    param(
        [string]$OriginalPath = '',
        [string]$EffectivePath = '',
        [string]$CopiedPath = $null,
        [bool]$Exists = $false,
        [string]$CopyStatus = 'not_resolved'
    )

    return [pscustomobject][ordered]@{
        original_path = $OriginalPath
        copied_path = $CopiedPath
        effective_path = $EffectivePath
        exists = $Exists
        copy_status = $CopyStatus
    }
}

function New-DirectArtifactInfo {
    param([string]$Path)

    return New-ArtifactInfo -OriginalPath $Path -EffectivePath $Path -Exists (Test-Path $Path) -CopyStatus 'direct'
}

function Invoke-PowerShellFile {
    param(
        [string]$ScriptPath,
        [hashtable]$NamedArguments
    )

    $argumentList = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath)
    foreach ($entry in $NamedArguments.GetEnumerator()) {
        $argumentList += "-$($entry.Key)"
        $argumentList += [string]$entry.Value
    }

    & powershell.exe @argumentList 2>&1 | Out-Host
    return [int]$LASTEXITCODE
}

function Try-ReadJsonFile {
    param(
        [string]$Path,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        Add-Failure "$Label path was empty."
        return $null
    }

    if (-not (Test-Path $Path)) {
        Add-Failure "$Label not found: $Path"
        return $null
    }

    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        Add-Failure "$Label could not be parsed: $($_.Exception.Message)"
        return $null
    }
}

function Test-IsUnderDirectory {
    param(
        [string]$Path,
        [string]$Directory
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $fullDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\\') + '\\'
    return $fullPath.StartsWith($fullDirectory, [System.StringComparison]::OrdinalIgnoreCase)
}

function Ensure-ArtifactInRunDirectory {
    param(
        [string]$Path,
        [string]$BasePath,
        [string]$RunDirectory,
        [string]$PreferredFileName
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return New-ArtifactInfo
    }

    $resolvedPath = Resolve-FullPath -Path $Path -BasePath $BasePath
    if (-not (Test-Path $resolvedPath)) {
        return New-ArtifactInfo -OriginalPath $resolvedPath -EffectivePath $resolvedPath -Exists $false -CopyStatus 'missing'
    }

    if (Test-IsUnderDirectory -Path $resolvedPath -Directory $RunDirectory) {
        return New-ArtifactInfo -OriginalPath $resolvedPath -EffectivePath $resolvedPath -Exists $true -CopyStatus 'direct'
    }

    $copiedPath = Join-Path $RunDirectory $PreferredFileName
    if ([System.IO.Path]::GetFullPath($resolvedPath).Equals([System.IO.Path]::GetFullPath($copiedPath), [System.StringComparison]::OrdinalIgnoreCase)) {
        return New-ArtifactInfo -OriginalPath $resolvedPath -EffectivePath $resolvedPath -Exists $true -CopyStatus 'direct'
    }

    Copy-Item -LiteralPath $resolvedPath -Destination $copiedPath -Force
    return New-ArtifactInfo -OriginalPath $resolvedPath -EffectivePath $copiedPath -CopiedPath $copiedPath -Exists $true -CopyStatus 'copied'
}

function ConvertTo-DoubleVector {
    param(
        $Value,
        [string]$Label
    )

    $items = @($Value)
    if ($items.Count -ne 3) {
        Add-Failure "$Label must contain exactly 3 numeric values."
        return $null
    }

    $values = New-Object 'System.Collections.Generic.List[double]'
    foreach ($item in $items) {
        try {
            $values.Add([double]$item)
        }
        catch {
            Add-Failure "$Label contained a non-numeric value."
            return $null
        }
    }

    return [double[]]$values.ToArray()
}

function Get-VectorDistance {
    param(
        [double[]]$From,
        [double[]]$To
    )

    $sum = 0.0
    for ($index = 0; $index -lt 3; $index++) {
        $delta = $To[$index] - $From[$index]
        $sum += ($delta * $delta)
    }

    return [Math]::Sqrt($sum)
}

function Get-MutationReference {
    param($RouterResult)

    $matches = @()
    foreach ($stepResult in @((Get-OptionalProperty -Object $RouterResult -Name 'per_step_results' -Default @()))) {
        if ([string](Get-OptionalProperty -Object $stepResult -Name 'probe_action_type' -Default '') -eq 'mutate_entity_transform') {
            $artifactPath = [string](Get-OptionalProperty -Object $stepResult -Name 'probe_artifact_path' -Default '')
            if (-not [string]::IsNullOrWhiteSpace($artifactPath)) {
                $matches += [pscustomobject][ordered]@{
                    source = 'per_step_results'
                    step_name = [string](Get-OptionalProperty -Object $stepResult -Name 'step_name' -Default '')
                    artifact_path = $artifactPath
                    log_path = [string](Get-OptionalProperty -Object $stepResult -Name 'probe_log_path' -Default '')
                }
            }
        }
    }

    if ($matches.Count -gt 0) {
        return $matches[$matches.Count - 1]
    }

    if ([string](Get-OptionalProperty -Object $RouterResult -Name 'delegated_probe_action_type' -Default '') -eq 'mutate_entity_transform') {
        $artifactPath = [string](Get-OptionalProperty -Object $RouterResult -Name 'delegated_probe_artifact_path' -Default '')
        if (-not [string]::IsNullOrWhiteSpace($artifactPath)) {
            return [pscustomobject][ordered]@{
                source = 'delegated_probe'
                step_name = ''
                artifact_path = $artifactPath
                log_path = [string](Get-OptionalProperty -Object $RouterResult -Name 'delegated_probe_log_path' -Default '')
            }
        }
    }

    return $null
}

$resolvedArtifactsRoot = Resolve-FullPath -Path $ArtifactsRoot -BasePath $aiERoot
New-Item -ItemType Directory -Force -Path $resolvedArtifactsRoot | Out-Null
$runDirectory = New-RunDirectory -RootPath $resolvedArtifactsRoot
$proofSummaryPath = Join-Path $runDirectory 'proof_summary.json'

$resolvedBabylonProjectPath = Resolve-FullPath -Path $BabylonProjectPath -BasePath $aiERoot
$promptScriptPath = Join-Path $resolvedBabylonProjectPath 'Tools\run_aie_prompt.ps1'
$playmodeScriptPath = Join-Path $resolvedBabylonProjectPath 'Tools\run_unity_scene_playmode_probe.ps1'

Write-Host ("START BabylonProjectPath='{0}' PromptText='{1}' ArtifactsRoot='{2}' TargetTicks={3}" -f $resolvedBabylonProjectPath, $PromptText, $resolvedArtifactsRoot, $TargetTicks)

$promptArtifactPath = Join-Path $runDirectory 'prompt_result.json'
$promptLogPath = Join-Path $runDirectory 'prompt_result.log'
$expectedRouterArtifactPath = Join-Path $runDirectory 'prompt_result.router_result.json'
$expectedRouterLogPath = Join-Path $runDirectory 'prompt_result.router.log'
$playmodeArtifactPath = Join-Path $runDirectory 'playmode_result.json'
$playmodeLogPath = Join-Path $runDirectory 'playmode_result.log'

$promptExitCode = $null
$playmodeExitCode = $null
$promptResult = $null
$routerResult = $null
$mutationResult = $null
$playmodeResult = $null
$mutationReference = $null
$sceneName = ''
$movementDistance = 0.0
$positionChanged = $false
$ticksObserved = 0
$playmodeAttempted = $false

$promptArtifactInfo = New-ArtifactInfo -EffectivePath $promptArtifactPath
$promptLogInfo = New-ArtifactInfo -EffectivePath $promptLogPath
$routerArtifactInfo = New-ArtifactInfo -EffectivePath $expectedRouterArtifactPath
$routerLogInfo = New-ArtifactInfo -EffectivePath $expectedRouterLogPath
$mutationArtifactInfo = New-ArtifactInfo
$mutationLogInfo = New-ArtifactInfo
$playmodeArtifactInfo = New-ArtifactInfo -EffectivePath $playmodeArtifactPath
$playmodeLogInfo = New-ArtifactInfo -EffectivePath $playmodeLogPath

try {
    if (-not (Test-Path $resolvedBabylonProjectPath)) {
        Add-Failure "BabylonProjectPath not found: $resolvedBabylonProjectPath"
    }
    if (-not (Test-Path $promptScriptPath)) {
        Add-Failure "Prompt entrypoint not found: $promptScriptPath"
    }
    if (-not (Test-Path $playmodeScriptPath)) {
        Add-Failure "Playmode probe entrypoint not found: $playmodeScriptPath"
    }

    if ($script:FailureReasons.Count -eq 0) {
        Assert-ScriptParameters -ScriptPath $promptScriptPath -RequiredParameters @('ProjectPath', 'PromptText', 'ArtifactPath', 'LogPath') -Label 'Prompt entrypoint'
        Assert-ScriptParameters -ScriptPath $playmodeScriptPath -RequiredParameters @('ProjectPath', 'SceneName', 'ArtifactPath', 'LogPath', 'TargetTicks') -Label 'Playmode probe entrypoint'
    }

    if ($script:FailureReasons.Count -eq 0) {
        $promptExitCode = Invoke-PowerShellFile -ScriptPath $promptScriptPath -NamedArguments ([ordered]@{
                ProjectPath = $resolvedBabylonProjectPath
                PromptText = $PromptText
                ArtifactPath = $promptArtifactPath
                LogPath = $promptLogPath
            })
        if ($promptExitCode -ne 0) {
            Add-Failure "Babylon prompt entrypoint exited with code $promptExitCode."
        }
    }

    $promptResult = Try-ReadJsonFile -Path $promptArtifactPath -Label 'prompt_result.json'
    $promptArtifactInfo = New-DirectArtifactInfo -Path $promptArtifactPath
    $promptLogInfo = New-DirectArtifactInfo -Path $promptLogPath

    $routerArtifactPath = $expectedRouterArtifactPath
    $routerLogPath = $expectedRouterLogPath
    if ($null -ne $promptResult) {
        if ([string](Get-OptionalProperty -Object $promptResult -Name 'status' -Default '') -ne 'success') {
            $promptMessage = [string](Get-OptionalProperty -Object $promptResult -Name 'message' -Default '')
            Add-Failure "prompt_result.json reported status '$([string]$promptResult.status)'. $promptMessage".Trim()
        }

        if ([string](Get-OptionalProperty -Object $promptResult -Name 'router_status' -Default '') -ne 'success') {
            $routerStatus = [string](Get-OptionalProperty -Object $promptResult -Name 'router_status' -Default '')
            Add-Failure "prompt_result.json reported router_status '$routerStatus'."
        }

        $routerArtifactPath = [string](Get-OptionalProperty -Object $promptResult -Name 'router_artifact_path' -Default $expectedRouterArtifactPath)
        $routerLogPath = [string](Get-OptionalProperty -Object $promptResult -Name 'router_log_path' -Default $expectedRouterLogPath)
    }

    $routerArtifactInfo = Ensure-ArtifactInRunDirectory -Path $routerArtifactPath -BasePath $resolvedBabylonProjectPath -RunDirectory $runDirectory -PreferredFileName 'prompt_result.router_result.json'
    $routerLogInfo = Ensure-ArtifactInRunDirectory -Path $routerLogPath -BasePath $resolvedBabylonProjectPath -RunDirectory $runDirectory -PreferredFileName 'prompt_result.router.log'
    $routerResult = Try-ReadJsonFile -Path $routerArtifactInfo.effective_path -Label 'prompt_result.router_result.json'

    if ($null -ne $routerResult) {
        if ([string](Get-OptionalProperty -Object $routerResult -Name 'status' -Default '') -ne 'success') {
            $routerMessage = [string](Get-OptionalProperty -Object $routerResult -Name 'message' -Default '')
            Add-Failure "prompt_result.router_result.json reported status '$([string]$routerResult.status)'. $routerMessage".Trim()
        }

        $sceneName = [string](Get-OptionalProperty -Object $routerResult -Name 'scene_name' -Default '')
        $mutationReference = Get-MutationReference -RouterResult $routerResult
        if ($null -eq $mutationReference) {
            Add-Failure 'Router artifact did not reference a mutate_entity_transform artifact.'
        }
    }

    if ($null -ne $mutationReference) {
        $mutationArtifactInfo = Ensure-ArtifactInRunDirectory -Path $mutationReference.artifact_path -BasePath $resolvedBabylonProjectPath -RunDirectory $runDirectory -PreferredFileName 'mutation_result.json'
        $mutationLogInfo = Ensure-ArtifactInRunDirectory -Path $mutationReference.log_path -BasePath $resolvedBabylonProjectPath -RunDirectory $runDirectory -PreferredFileName 'mutation_result.log'
        $mutationResult = Try-ReadJsonFile -Path $mutationArtifactInfo.effective_path -Label 'delegated mutation artifact'

        if ($null -ne $mutationResult) {
            if ([string](Get-OptionalProperty -Object $mutationResult -Name 'status' -Default '') -ne 'success') {
                $mutationMessage = [string](Get-OptionalProperty -Object $mutationResult -Name 'message' -Default '')
                Add-Failure "Delegated mutation artifact reported status '$([string]$mutationResult.status)'. $mutationMessage".Trim()
            }

            if ([string](Get-OptionalProperty -Object $mutationResult -Name 'action_type' -Default '') -ne 'mutate_entity_transform') {
                Add-Failure "Delegated mutation artifact action_type was '$([string](Get-OptionalProperty -Object $mutationResult -Name 'action_type' -Default ''))'."
            }

            $mutationSceneName = [string](Get-OptionalProperty -Object $mutationResult -Name 'scene_name' -Default '')
            if ([string]::IsNullOrWhiteSpace($sceneName)) {
                $sceneName = $mutationSceneName
            }
            elseif (-not [string]::IsNullOrWhiteSpace($mutationSceneName) -and $mutationSceneName -ne $sceneName) {
                Add-Failure "Delegated mutation artifact scene_name '$mutationSceneName' did not match router scene_name '$sceneName'."
            }

            $previousPosition = ConvertTo-DoubleVector -Value (Get-OptionalProperty -Object $mutationResult -Name 'previous_position' -Default @()) -Label 'delegated mutation artifact previous_position'
            $newPosition = ConvertTo-DoubleVector -Value (Get-OptionalProperty -Object $mutationResult -Name 'new_position' -Default @()) -Label 'delegated mutation artifact new_position'
            if ($null -ne $previousPosition -and $null -ne $newPosition) {
                $movementDistance = Get-VectorDistance -From $previousPosition -To $newPosition
                $positionChanged = $movementDistance -gt 0.0001
                if (-not $positionChanged) {
                    Add-Failure 'Delegated mutation artifact showed no zombie position change.'
                }
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($sceneName) -and (Test-Path $playmodeScriptPath)) {
        $playmodeAttempted = $true
        $playmodeExitCode = Invoke-PowerShellFile -ScriptPath $playmodeScriptPath -NamedArguments ([ordered]@{
                ProjectPath = $resolvedBabylonProjectPath
                SceneName = $sceneName
                ArtifactPath = $playmodeArtifactPath
                LogPath = $playmodeLogPath
                TargetTicks = $TargetTicks
            })
        if ($playmodeExitCode -ne 0) {
            Add-Failure "Babylon playmode probe exited with code $playmodeExitCode."
        }

        $playmodeResult = Try-ReadJsonFile -Path $playmodeArtifactPath -Label 'playmode_result.json'
    }
    else {
        Add-Failure 'Playmode probe was not run because the target scene could not be resolved.'
    }
}
catch {
    Add-Failure $_.Exception.Message
}

$playmodeArtifactInfo = New-DirectArtifactInfo -Path $playmodeArtifactPath
$playmodeLogInfo = New-DirectArtifactInfo -Path $playmodeLogPath

$playmodeStatus = [string](Get-OptionalProperty -Object $playmodeResult -Name 'status' -Default '')
$playmodeEnteredRaw = Get-OptionalProperty -Object $playmodeResult -Name 'entered' -Default $false
$playmodeEnteredFlag = $false
if ($playmodeEnteredRaw -is [bool]) {
    $playmodeEnteredFlag = $playmodeEnteredRaw
}
else {
    [void][bool]::TryParse([string]$playmodeEnteredRaw, [ref]$playmodeEnteredFlag)
}

$ticksObservedRaw = [string](Get-OptionalProperty -Object $playmodeResult -Name 'ticks_observed' -Default '0')
[void][int]::TryParse($ticksObservedRaw, [ref]$ticksObserved)

if ($null -ne $playmodeResult) {
    if ($playmodeStatus -notin @('ok', 'success')) {
        Add-Failure "playmode_result.json reported status '$playmodeStatus'."
    }
    if (-not $playmodeEnteredFlag) {
        Add-Failure 'playmode_result.json reported entered=false.'
    }
    if ($ticksObserved -lt $TargetTicks) {
        Add-Failure "playmode_result.json reported ticks_observed=$ticksObserved, below TargetTicks=$TargetTicks."
    }

    $playmodeScene = [string](Get-OptionalProperty -Object $playmodeResult -Name 'scene' -Default '')
    if (-not [string]::IsNullOrWhiteSpace($sceneName) -and -not [string]::IsNullOrWhiteSpace($playmodeScene) -and $playmodeScene -ne $sceneName) {
        Add-Failure "playmode_result.json scene '$playmodeScene' did not match expected scene '$sceneName'."
    }
}

$promptSucceeded = [bool](($promptExitCode -eq 0) -and $null -ne $promptResult -and ([string](Get-OptionalProperty -Object $promptResult -Name 'status' -Default '') -eq 'success'))
$routerSucceeded = [bool]($null -ne $routerResult -and ([string](Get-OptionalProperty -Object $promptResult -Name 'router_status' -Default '') -eq 'success') -and ([string](Get-OptionalProperty -Object $routerResult -Name 'status' -Default '') -eq 'success'))
$mutationSucceeded = [bool]($null -ne $mutationResult -and ([string](Get-OptionalProperty -Object $mutationResult -Name 'status' -Default '') -eq 'success') -and ([string](Get-OptionalProperty -Object $mutationResult -Name 'action_type' -Default '') -eq 'mutate_entity_transform'))
$playmodeEntered = [bool](($playmodeExitCode -eq 0) -and $null -ne $playmodeResult -and ($playmodeStatus -in @('ok', 'success')) -and $playmodeEnteredFlag)
$ticksRequirementMet = [bool]($null -ne $playmodeResult -and $ticksObserved -ge $TargetTicks)
$allPassed = $promptSucceeded -and $routerSucceeded -and $mutationSucceeded -and $positionChanged -and $playmodeEntered -and $ticksRequirementMet

$message = if ($allPassed) {
    'Proof passed.'
}
else {
    if ($script:FailureReasons.Count -eq 0) {
        Add-Failure 'One or more proof validations failed.'
    }
    ($script:FailureReasons -join ' | ')
}

$proofSummary = [pscustomobject][ordered]@{
    status = if ($allPassed) { 'success' } else { 'failure' }
    timestamp = [DateTime]::UtcNow.ToString('o')
    prompt_text = $PromptText
    target_ticks = $TargetTicks
    babylon_project_path = $resolvedBabylonProjectPath
    run_directory = $runDirectory
    prompt = [pscustomobject][ordered]@{
        exit_code = $promptExitCode
        status = [string](Get-OptionalProperty -Object $promptResult -Name 'status' -Default '')
        translated_command = [string](Get-OptionalProperty -Object $promptResult -Name 'translated_command' -Default '')
        router_status = [string](Get-OptionalProperty -Object $promptResult -Name 'router_status' -Default '')
        artifact = $promptArtifactInfo
        log = $promptLogInfo
    }
    router = [pscustomobject][ordered]@{
        status = [string](Get-OptionalProperty -Object $routerResult -Name 'status' -Default '')
        route_kind = [string](Get-OptionalProperty -Object $routerResult -Name 'route_kind' -Default '')
        scene_name = $sceneName
        artifact = $routerArtifactInfo
        log = $routerLogInfo
    }
    mutation = [pscustomobject][ordered]@{
        reference_source = [string](Get-OptionalProperty -Object $mutationReference -Name 'source' -Default '')
        step_name = [string](Get-OptionalProperty -Object $mutationReference -Name 'step_name' -Default '')
        status = [string](Get-OptionalProperty -Object $mutationResult -Name 'status' -Default '')
        action_type = [string](Get-OptionalProperty -Object $mutationResult -Name 'action_type' -Default '')
        object_name = [string](Get-OptionalProperty -Object $mutationResult -Name 'object_name' -Default '')
        previous_position = @(Get-OptionalProperty -Object $mutationResult -Name 'previous_position' -Default @())
        new_position = @(Get-OptionalProperty -Object $mutationResult -Name 'new_position' -Default @())
        position_changed = $positionChanged
        movement_distance = $movementDistance
        artifact = $mutationArtifactInfo
        log = $mutationLogInfo
    }
    playmode = [pscustomobject][ordered]@{
        attempted = $playmodeAttempted
        exit_code = $playmodeExitCode
        status = $playmodeStatus
        entered = $playmodeEnteredFlag
        ticks_observed = $ticksObserved
        artifact = $playmodeArtifactInfo
        log = $playmodeLogInfo
    }
    validations = [pscustomobject][ordered]@{
        prompt_succeeded = $promptSucceeded
        router_succeeded = $routerSucceeded
        mutation_succeeded = $mutationSucceeded
        zombie_position_changed = $positionChanged
        playmode_entered = $playmodeEntered
        ticks_requirement_met = $ticksRequirementMet
    }
    message = $message
}

$proofSummary | ConvertTo-Json -Depth 10 | Set-Content -Path $proofSummaryPath -Encoding UTF8

$finalResult = if ($allPassed) { 'pass' } else { 'fail' }
if (-not $allPassed) {
    Write-Host ("Proof failed: {0}" -f $message)
    if ([string](Get-OptionalProperty -Object $promptResult -Name 'router_status' -Default '') -eq 'failure') {
        Write-Host ("Router failure artifacts: router_result='{0}' router_log='{1}'" -f $routerArtifactInfo.effective_path, $routerLogInfo.effective_path)
    }
}
Write-Host ("FINAL result={0} proof_summary='{1}'" -f $finalResult, $proofSummaryPath)

if ($allPassed) {
    exit 0
}

exit 1

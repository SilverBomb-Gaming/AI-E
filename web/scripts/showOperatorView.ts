import { stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectGameProject, renderGameProjectSummary } from "../lib/aie/gameProjectInspector";
import { determineGameProgression, renderNextGameTask } from "../lib/aie/gameProgression";
import {
  executeNextAutonomousAction,
  renderActionExecutionResult,
} from "../lib/aie/actionExecutor";
import {
  autoRecordOutcomeForFeature,
  renderAutoRecordOutcome,
} from "../lib/aie/autoOutcomeRecording";
import {
  renderAutonomousExecutionLoop,
  runAutonomousExecutionLoop,
} from "../lib/aie/executionLoop";
import {
  generateAutoRetryTask,
  renderAutoRetryResult,
  renderRetrySuggestion,
  suggestRetryForLatestOutcome,
} from "../lib/aie/retryEngine";
import {
  recordOutcome,
  readOutcomeRecords,
  renderOutcomeRecord,
  renderOutcomeSummary,
  summarizeOutcomeLearning,
  type OutcomeResult,
  type OutcomeRecord,
} from "../lib/aie/outcomeLearning";
import {
  renderPostPlaytestFeatureSelectionReport,
  selectPostPlaytestFeature,
  type PostPlaytestFeatureEvidenceSnapshot,
  type PostPlaytestFeatureKnownOutcomeState,
} from "../lib/aie/postPlaytestFeatureSelector";
import {
  autoEvaluateUnityRuntime,
  discoverUnityLogCandidates,
  renderAutoEvaluation,
  renderUnityLogDiscovery,
} from "../lib/aie/runtimeSignals";
import {
  applyUnityPatchArtifact,
  buildExistingCameraFollowArtifact,
  generateCameraTuningArtifact,
  generateCameraTuningPreview,
  generateCameraFollowArtifact,
  generateGamePatchPlan,
  generateGameTask,
  generateJumpDiagnosticArtifact,
  generateJumpDiagnosticPreview,
  generateProductionMovementArtifact,
  generateUnityPatchArtifact,
  generateUnityPatchPreview,
  inspectCameraTuningStatus,
  inspectUnityPatchStatus,
  renderCameraTuningStatus,
  renderGamePatchPlan,
  renderGameTask,
  renderNextGameTaskExecutionResult,
  renderUnityPatchApplyResult,
  renderUnityPatchPreview,
  renderUnityPatchRollbackResult,
  renderUnityPatchStatus,
  rollbackUnityPatchArtifact,
} from "../lib/aie/gameTaskGenerator";
import { renderOperatorView, renderOperatorViewSummary, type OperatorViewState } from "../lib/aie/operatorView";
import type { OperatorViewSnapshot } from "../lib/aie/operatorView.types";
import {
  applyUnityCameraWiring,
  applyUnityBasicEnemy,
  applyUnityAttackFeedback,
  applyUnityFallRecovery,
  applyUnityPlaytestSessionMarker,
  applyUnityPlayerAttack,
  applyUnityVisualDebugFloor,
  inspectUnityAttackFeedbackStatus,
  inspectUnityBasicEnemyStatus,
  inspectUnityCameraWiringStatus,
  inspectUnityFallRecoveryStatus,
  inspectUnityPlaytestSessionMarkerStatus,
  inspectUnityPlayerAttackStatus,
  inspectUnitySceneWiring,
  inspectUnityVisualDebugStatus,
  repairUnityCameraWiring,
  renderUnityAttackFeedbackApplyResult,
  renderUnityAttackFeedbackRollbackResult,
  renderUnityAttackFeedbackStatus,
  renderUnityBasicEnemyApplyResult,
  renderUnityBasicEnemyRollbackResult,
  renderUnityBasicEnemyStatus,
  renderUnityFallRecoveryApplyResult,
  renderUnityFallRecoveryRollbackResult,
  renderUnityFallRecoveryStatus,
  renderUnityPlaytestSessionMarkerApplyResult,
  renderUnityPlaytestSessionMarkerRollbackResult,
  renderUnityPlaytestSessionMarkerStatus,
  renderUnityPlayerAttackApplyResult,
  renderUnityPlayerAttackRollbackResult,
  renderUnityPlayerAttackStatus,
  renderUnitySceneWiringApplyResult,
  renderUnitySceneWiringPreview,
  renderUnitySceneWiringRepairResult,
  renderUnitySceneWiringRollbackResult,
  renderUnitySceneWiringStatus,
  renderUnityVisualDebugApplyResult,
  renderUnityVisualDebugRollbackResult,
  renderUnityVisualDebugStatus,
  rollbackUnityAttackFeedback,
  rollbackUnityBasicEnemy,
  rollbackUnityCameraWiring,
  rollbackUnityFallRecovery,
  rollbackUnityPlaytestSessionMarker,
  rollbackUnityPlayerAttack,
  rollbackUnityVisualDebugFloor,
} from "../lib/aie/unitySceneWiring";
import { inspectUnityPlaytestRecovery, renderUnityPlaytestRecovery } from "../lib/aie/unityPlaytestRecovery";

type ShowOperatorViewOptions = {
  json: boolean;
  interactive: boolean;
  projectPath?: string;
  gameTaskPath?: string;
  nextGameTaskPath?: string;
  executeNextGameTaskPath?: string;
  executeNextActionPath?: string;
  recordOutcomePath?: string;
  autoRecordOutcomePath?: string;
  suggestRetryPath?: string;
  autoRetryPath?: string;
  runAutonomousLoopPath?: string;
  allowExecution?: boolean;
  autoEvaluatePath?: string;
  discoverRuntimeLogsPath?: string;
  learningSummaryPath?: string;
  featureSelectionReportPath?: string;
  featurePool?: string[];
  outcomeFeature?: string;
  outcomeResult?: OutcomeResult;
  outcomeObservation?: string;
  runtimeLogPath?: string;
  autoRecord?: boolean;
  cameraWiringPreviewPath?: string;
  applyCameraWiringPath?: string;
  cameraWiringStatusPath?: string;
  repairCameraWiringPath?: string;
  rollbackCameraWiringPath?: string;
  cameraTuningPreviewPath?: string;
  applyCameraTuningPath?: string;
  cameraTuningStatusPath?: string;
  rollbackCameraTuningPath?: string;
  applyVisualDebugFloorPath?: string;
  visualDebugStatusPath?: string;
  rollbackVisualDebugPath?: string;
  applyFallRecoveryPath?: string;
  fallRecoveryStatusPath?: string;
  rollbackFallRecoveryPath?: string;
  applyPlaytestSessionMarkerPath?: string;
  playtestSessionMarkerStatusPath?: string;
  rollbackPlaytestSessionMarkerPath?: string;
  applyBasicEnemyPath?: string;
  enemyStatusPath?: string;
  rollbackBasicEnemyPath?: string;
  applyPlayerAttackPath?: string;
  attackStatusPath?: string;
  rollbackPlayerAttackPath?: string;
  applyAttackFeedbackPath?: string;
  attackFeedbackStatusPath?: string;
  rollbackAttackFeedbackPath?: string;
  unityRecoveryPath?: string;
  gamePatchPath?: string;
  gamePatchPreviewPath?: string;
  applyGamePatchPath?: string;
  gamePatchStatusPath?: string;
  rollbackGamePatchPath?: string;
  diagnoseJumpPath?: string;
  diagnoseJumpPreviewPath?: string;
  applyDiagnoseJumpPath?: string;
  promoteDiagnosticPatchPath?: string;
};

function buildRecoveryGuidance(snapshot: Awaited<ReturnType<typeof inspectUnityPlaytestRecovery>>): string[] {
  if (snapshot.recommendedActions.length === 0) {
    return ["No recovery actions required."];
  }

  const guidance = snapshot.recommendedActions.map((action) => {
    const verb = action.action === "delete-file"
      ? "Delete accidental generated file"
      : action.action === "restore-file"
        ? "Restore tracked movement script"
        : "Inspect movement script";
    return `${verb}: ${action.path} (${action.reason})`;
  });

  guidance.push("Wait for Unity compile errors to clear.");
  guidance.push("Re-run patch preview or patch status after recovery is clean.");
  return guidance;
}

function buildPatchStatusRecoverySignal(snapshot: Awaited<ReturnType<typeof inspectUnityPlaytestRecovery>>): boolean {
  return snapshot.detectedIssues.accidentalGeneratedFiles.length === 0
    && snapshot.detectedIssues.duplicateClassRisks.length === 0;
}

function parseBooleanFlagValue(value: string, flagName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new Error(`${flagName} expects true or false.`);
}

function buildFollowupPatchRecoverySignal(snapshot: Awaited<ReturnType<typeof inspectUnityPlaytestRecovery>>): boolean {
  return buildPatchStatusRecoverySignal(snapshot);
}

function mapOutcomeRecordState(record: OutcomeRecord | undefined): PostPlaytestFeatureKnownOutcomeState {
  if (!record) {
    return "unseen";
  }

  if (record.result === "fail") {
    return "failing";
  }

  if (record.result === "pass") {
    return "passing";
  }

  return "unstable";
}

async function buildFeatureSelectionEvidenceSnapshots(
  projectPath: string,
  featurePool: string[],
): Promise<PostPlaytestFeatureEvidenceSnapshot[]> {
  const records = await readOutcomeRecords(projectPath);
  const reverseRecords = [...records].reverse();

  return featurePool.map((feature) => {
    const latestRecord = reverseRecords.find((record) => record.feature === feature);
    return {
      feature,
      latest_outcome: null,
      known_outcome_state: mapOutcomeRecordState(latestRecord),
    };
  });
}

type CameraFeatureExecutionReport = {
  outcome: "complete" | "already-applied" | "blocked";
  feature: "Camera Follow";
  created: string[];
  wired: string[];
  backups: string[];
  safeToOpenUnity: boolean;
  blockedReasons: string[];
};

export { autoRecordOutcomeForFeature, renderAutoRecordOutcome };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function renderCameraFeatureExecutionReport(report: CameraFeatureExecutionReport): string {
  const heading = report.outcome === "blocked"
    ? "FEATURE EXECUTION BLOCKED"
    : report.outcome === "already-applied"
      ? "FEATURE ALREADY APPLIED"
      : "FEATURE EXECUTION COMPLETE";

  const lines = [
    heading,
    "",
    `Feature: ${report.feature}`,
    "",
    "Created:",
    ...report.created.map((item) => `- ${item}`),
    "",
    "Wired:",
    ...report.wired.map((item) => `- ${item}`),
    "",
    "Backups:",
    ...report.backups.map((item) => `- ${item}`),
    "",
    `Safe To Open Unity: ${report.safeToOpenUnity ? "YES" : "NO"}`,
  ];

  if (report.blockedReasons.length > 0) {
    lines.push("", "Blocked Reasons:", ...report.blockedReasons.map((reason) => `- ${reason}`));
  }

  return lines.join("\n");
}

async function executeCameraFollowFeature(projectPath: string): Promise<CameraFeatureExecutionReport> {
  const snapshot = await inspectGameProject(projectPath);
  const recovery = await inspectUnityPlaytestRecovery(projectPath);
  const recoverySafe = buildFollowupPatchRecoverySignal(recovery);
  const cameraArtifact = await buildExistingCameraFollowArtifact(snapshot, "Assets/Scripts/CameraFollow.cs");
  const scriptExists = await pathExists(cameraArtifact.absoluteTargetPath);
  const metaExists = await pathExists(`${cameraArtifact.absoluteTargetPath}.meta`);
  const scriptBackupExists = await pathExists(`${cameraArtifact.absoluteTargetPath}.aie-backup`);
  const wiringStatusBefore = await inspectUnityCameraWiringStatus(projectPath, recoverySafe);

  if (scriptExists && metaExists && wiringStatusBefore.cameraFollowAttached && wiringStatusBefore.targetAssigned) {
    return {
      outcome: "already-applied",
      feature: "Camera Follow",
      created: [
        "Assets/Scripts/CameraFollow.cs",
        "Assets/Scripts/CameraFollow.cs.meta",
      ],
      wired: [
        "CameraFollow attached to Main Camera",
        "Target assigned to Player",
      ],
      backups: [
        scriptBackupExists ? "CameraFollow rollback marker" : "CameraFollow rollback marker missing",
        wiringStatusBefore.backupExists ? "Scene backup" : "Scene backup missing",
      ],
      safeToOpenUnity: wiringStatusBefore.safeToOpenUnityForCompileOrPlaytest,
      blockedReasons: [],
    };
  }

  const blockedReasons: string[] = [];
  if (!recoverySafe) {
    blockedReasons.push("Unity recovery guard did not report a safe state for camera feature execution.");
  }

  if (!scriptExists) {
    const generationArtifact = await generateCameraFollowArtifact(snapshot, "Assets/Scripts/CameraFollow.cs");
    const scriptApplyResult = await applyUnityPatchArtifact(
      generationArtifact,
      recoverySafe,
      buildRecoveryGuidance(recovery),
      true,
    );

    if (!scriptApplyResult.applied) {
      blockedReasons.push(...scriptApplyResult.blockedReasons);
    }
  }

  const wiringStatusAfterScript = await inspectUnityCameraWiringStatus(projectPath, recoverySafe);
  if (!(wiringStatusAfterScript.cameraFollowAttached && wiringStatusAfterScript.targetAssigned)) {
    const wiringApplyResult = await applyUnityCameraWiring(projectPath, recoverySafe);
    if (!wiringApplyResult.applied) {
      blockedReasons.push(...wiringApplyResult.blockedReasons);
    }
  }

  const finalWiringStatus = await inspectUnityCameraWiringStatus(projectPath, recoverySafe);
  const finalScriptExists = await pathExists(cameraArtifact.absoluteTargetPath);
  const finalMetaExists = await pathExists(`${cameraArtifact.absoluteTargetPath}.meta`);
  const finalScriptBackupExists = await pathExists(`${cameraArtifact.absoluteTargetPath}.aie-backup`);
  const finalBlockedReasons = blockedReasons.filter((reason, index, reasons) => reasons.indexOf(reason) === index);
  const complete = finalBlockedReasons.length === 0
    && finalScriptExists
    && finalMetaExists
    && finalWiringStatus.cameraFollowAttached
    && finalWiringStatus.targetAssigned;

  return {
    outcome: complete ? "complete" : "blocked",
    feature: "Camera Follow",
    created: [
      finalScriptExists ? "Assets/Scripts/CameraFollow.cs" : "Assets/Scripts/CameraFollow.cs missing",
      finalMetaExists ? "Assets/Scripts/CameraFollow.cs.meta" : "Assets/Scripts/CameraFollow.cs.meta missing",
    ],
    wired: [
      finalWiringStatus.cameraFollowAttached ? "CameraFollow attached to Main Camera" : "CameraFollow not attached to Main Camera",
      finalWiringStatus.targetAssigned ? "Target assigned to Player" : "Target not assigned to Player",
    ],
    backups: [
      finalScriptBackupExists ? "CameraFollow rollback marker" : "CameraFollow rollback marker missing",
      finalWiringStatus.backupExists ? "Scene backup" : "Scene backup missing",
    ],
    safeToOpenUnity: finalWiringStatus.safeToOpenUnityForCompileOrPlaytest,
    blockedReasons: finalBlockedReasons,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

function parseArgs(argv: string[]): ShowOperatorViewOptions {
  const options: ShowOperatorViewOptions = {
    json: false,
    interactive: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--interactive") {
      options.interactive = true;
      continue;
    }

    if (arg.startsWith("--project=")) {
      options.projectPath = arg.slice("--project=".length).trim() || undefined;
      continue;
    }

    if (arg === "--project") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --project");
      }
      options.projectPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--game-task=")) {
      options.gameTaskPath = arg.slice("--game-task=".length).trim() || undefined;
      continue;
    }

    if (arg === "--game-task") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --game-task");
      }
      options.gameTaskPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--next-game-task=")) {
      options.nextGameTaskPath = arg.slice("--next-game-task=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--execute-next-action=")) {
      options.executeNextActionPath = arg.slice("--execute-next-action=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--record-outcome=")) {
      options.recordOutcomePath = arg.slice("--record-outcome=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--auto-record-outcome=")) {
      options.autoRecordOutcomePath = arg.slice("--auto-record-outcome=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--suggest-retry=")) {
      options.suggestRetryPath = arg.slice("--suggest-retry=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--auto-retry=")) {
      options.autoRetryPath = arg.slice("--auto-retry=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--run-autonomous-loop=")) {
      options.runAutonomousLoopPath = arg.slice("--run-autonomous-loop=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--auto-evaluate=")) {
      options.autoEvaluatePath = arg.slice("--auto-evaluate=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--discover-runtime-logs=")) {
      options.discoverRuntimeLogsPath = arg.slice("--discover-runtime-logs=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--learning-summary=")) {
      options.learningSummaryPath = arg.slice("--learning-summary=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--feature-selection-report=")) {
      options.featureSelectionReportPath = arg.slice("--feature-selection-report=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--feature-pool=")) {
      options.featurePool = arg.slice("--feature-pool=".length)
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      continue;
    }

    if (arg.startsWith("--runtime-log=")) {
      options.runtimeLogPath = arg.slice("--runtime-log=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--allow-execution=")) {
      options.allowExecution = parseBooleanFlagValue(arg.slice("--allow-execution=".length), "--allow-execution");
      continue;
    }

    if (arg === "--auto") {
      options.autoRecord = true;
      continue;
    }

    if (arg === "--allow-execution") {
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        options.allowExecution = parseBooleanFlagValue(value, "--allow-execution");
        index += 1;
      } else {
        options.allowExecution = true;
      }
      continue;
    }

    if (arg.startsWith("--feature=")) {
      options.outcomeFeature = arg.slice("--feature=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--result=")) {
      const value = arg.slice("--result=".length).trim();
      options.outcomeResult = value ? value as OutcomeResult : undefined;
      continue;
    }

    if (arg.startsWith("--observation=")) {
      options.outcomeObservation = arg.slice("--observation=".length).trim() || undefined;
      continue;
    }

    if (arg === "--next-game-task") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --next-game-task");
      }
      options.nextGameTaskPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--execute-next-action") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --execute-next-action");
      }
      options.executeNextActionPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--record-outcome") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --record-outcome");
      }
      options.recordOutcomePath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--auto-record-outcome") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --auto-record-outcome");
      }
      options.autoRecordOutcomePath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--suggest-retry") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --suggest-retry");
      }
      options.suggestRetryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--auto-retry") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --auto-retry");
      }
      options.autoRetryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--run-autonomous-loop") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --run-autonomous-loop");
      }
      options.runAutonomousLoopPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--auto-evaluate") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --auto-evaluate");
      }
      options.autoEvaluatePath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--discover-runtime-logs") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --discover-runtime-logs");
      }
      options.discoverRuntimeLogsPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--learning-summary") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --learning-summary");
      }
      options.learningSummaryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--feature-selection-report") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --feature-selection-report");
      }
      options.featureSelectionReportPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--feature-pool") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --feature-pool");
      }
      options.featurePool = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      index += 1;
      continue;
    }

    if (arg === "--runtime-log") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --runtime-log");
      }
      options.runtimeLogPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--feature") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --feature");
      }
      options.outcomeFeature = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--result") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --result");
      }
      options.outcomeResult = value.trim() as OutcomeResult;
      index += 1;
      continue;
    }

    if (arg === "--observation") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --observation");
      }
      options.outcomeObservation = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--execute-next-game-task=")) {
      options.executeNextGameTaskPath = arg.slice("--execute-next-game-task=".length).trim() || undefined;
      continue;
    }

    if (arg === "--execute-next-game-task") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --execute-next-game-task");
      }
      options.executeNextGameTaskPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--unity-recovery=")) {
      options.unityRecoveryPath = arg.slice("--unity-recovery=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--camera-tuning-preview=")) {
      options.cameraTuningPreviewPath = arg.slice("--camera-tuning-preview=".length).trim() || undefined;
      continue;
    }

    if (arg === "--camera-tuning-preview") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --camera-tuning-preview");
      }
      options.cameraTuningPreviewPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-camera-tuning=")) {
      options.applyCameraTuningPath = arg.slice("--apply-camera-tuning=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-camera-tuning") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-camera-tuning");
      }
      options.applyCameraTuningPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--camera-tuning-status=")) {
      options.cameraTuningStatusPath = arg.slice("--camera-tuning-status=".length).trim() || undefined;
      continue;
    }

    if (arg === "--camera-tuning-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --camera-tuning-status");
      }
      options.cameraTuningStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--rollback-camera-tuning=")) {
      options.rollbackCameraTuningPath = arg.slice("--rollback-camera-tuning=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rollback-camera-tuning") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-camera-tuning");
      }
      options.rollbackCameraTuningPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-visual-debug-floor=")) {
      options.applyVisualDebugFloorPath = arg.slice("--apply-visual-debug-floor=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-visual-debug-floor") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-visual-debug-floor");
      }
      options.applyVisualDebugFloorPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-fall-recovery=")) {
      options.applyFallRecoveryPath = arg.slice("--apply-fall-recovery=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--apply-playtest-session-marker=")) {
      options.applyPlaytestSessionMarkerPath = arg.slice("--apply-playtest-session-marker=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--apply-basic-enemy=")) {
      options.applyBasicEnemyPath = arg.slice("--apply-basic-enemy=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--apply-player-attack=")) {
      options.applyPlayerAttackPath = arg.slice("--apply-player-attack=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--apply-attack-feedback=")) {
      options.applyAttackFeedbackPath = arg.slice("--apply-attack-feedback=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-fall-recovery") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-fall-recovery");
      }
      options.applyFallRecoveryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--apply-playtest-session-marker") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-playtest-session-marker");
      }
      options.applyPlaytestSessionMarkerPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--apply-basic-enemy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-basic-enemy");
      }
      options.applyBasicEnemyPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--apply-player-attack") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-player-attack");
      }
      options.applyPlayerAttackPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--apply-attack-feedback") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-attack-feedback");
      }
      options.applyAttackFeedbackPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--visual-debug-status=")) {
      options.visualDebugStatusPath = arg.slice("--visual-debug-status=".length).trim() || undefined;
      continue;
    }

    if (arg === "--visual-debug-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --visual-debug-status");
      }
      options.visualDebugStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--fall-recovery-status=")) {
      options.fallRecoveryStatusPath = arg.slice("--fall-recovery-status=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--playtest-session-status=")) {
      options.playtestSessionMarkerStatusPath = arg.slice("--playtest-session-status=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--enemy-status=")) {
      options.enemyStatusPath = arg.slice("--enemy-status=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--attack-status=")) {
      options.attackStatusPath = arg.slice("--attack-status=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--attack-feedback-status=")) {
      options.attackFeedbackStatusPath = arg.slice("--attack-feedback-status=".length).trim() || undefined;
      continue;
    }

    if (arg === "--fall-recovery-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --fall-recovery-status");
      }
      options.fallRecoveryStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--playtest-session-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --playtest-session-status");
      }
      options.playtestSessionMarkerStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--enemy-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --enemy-status");
      }
      options.enemyStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--attack-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --attack-status");
      }
      options.attackStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--attack-feedback-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --attack-feedback-status");
      }
      options.attackFeedbackStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--rollback-visual-debug=")) {
      options.rollbackVisualDebugPath = arg.slice("--rollback-visual-debug=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rollback-visual-debug") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-visual-debug");
      }
      options.rollbackVisualDebugPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--rollback-fall-recovery=")) {
      options.rollbackFallRecoveryPath = arg.slice("--rollback-fall-recovery=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--rollback-playtest-session-marker=")) {
      options.rollbackPlaytestSessionMarkerPath = arg.slice("--rollback-playtest-session-marker=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--rollback-basic-enemy=")) {
      options.rollbackBasicEnemyPath = arg.slice("--rollback-basic-enemy=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--rollback-player-attack=")) {
      options.rollbackPlayerAttackPath = arg.slice("--rollback-player-attack=".length).trim() || undefined;
      continue;
    }

    if (arg.startsWith("--rollback-attack-feedback=")) {
      options.rollbackAttackFeedbackPath = arg.slice("--rollback-attack-feedback=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rollback-fall-recovery") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-fall-recovery");
      }
      options.rollbackFallRecoveryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--rollback-playtest-session-marker") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-playtest-session-marker");
      }
      options.rollbackPlaytestSessionMarkerPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--rollback-basic-enemy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-basic-enemy");
      }
      options.rollbackBasicEnemyPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--rollback-player-attack") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-player-attack");
      }
      options.rollbackPlayerAttackPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--rollback-attack-feedback") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-attack-feedback");
      }
      options.rollbackAttackFeedbackPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--camera-wiring-preview=")) {
      options.cameraWiringPreviewPath = arg.slice("--camera-wiring-preview=".length).trim() || undefined;
      continue;
    }

    if (arg === "--camera-wiring-preview") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --camera-wiring-preview");
      }
      options.cameraWiringPreviewPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-camera-wiring=")) {
      options.applyCameraWiringPath = arg.slice("--apply-camera-wiring=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-camera-wiring") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-camera-wiring");
      }
      options.applyCameraWiringPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--camera-wiring-status=")) {
      options.cameraWiringStatusPath = arg.slice("--camera-wiring-status=".length).trim() || undefined;
      continue;
    }

    if (arg === "--camera-wiring-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --camera-wiring-status");
      }
      options.cameraWiringStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--repair-camera-wiring=")) {
      options.repairCameraWiringPath = arg.slice("--repair-camera-wiring=".length).trim() || undefined;
      continue;
    }

    if (arg === "--repair-camera-wiring") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --repair-camera-wiring");
      }
      options.repairCameraWiringPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--rollback-camera-wiring=")) {
      options.rollbackCameraWiringPath = arg.slice("--rollback-camera-wiring=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rollback-camera-wiring") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-camera-wiring");
      }
      options.rollbackCameraWiringPath = value.trim();
      index += 1;
      continue;
    }

    if (arg === "--unity-recovery") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --unity-recovery");
      }
      options.unityRecoveryPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--game-patch=")) {
      options.gamePatchPath = arg.slice("--game-patch=".length).trim() || undefined;
      continue;
    }

    if (arg === "--game-patch") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --game-patch");
      }
      options.gamePatchPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--game-patch-preview=")) {
      options.gamePatchPreviewPath = arg.slice("--game-patch-preview=".length).trim() || undefined;
      continue;
    }

    if (arg === "--game-patch-preview") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --game-patch-preview");
      }
      options.gamePatchPreviewPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-game-patch=")) {
      options.applyGamePatchPath = arg.slice("--apply-game-patch=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-game-patch") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-game-patch");
      }
      options.applyGamePatchPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--game-patch-status=")) {
      options.gamePatchStatusPath = arg.slice("--game-patch-status=".length).trim() || undefined;
      continue;
    }

    if (arg === "--game-patch-status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --game-patch-status");
      }
      options.gamePatchStatusPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--rollback-game-patch=")) {
      options.rollbackGamePatchPath = arg.slice("--rollback-game-patch=".length).trim() || undefined;
      continue;
    }

    if (arg === "--rollback-game-patch") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --rollback-game-patch");
      }
      options.rollbackGamePatchPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--diagnose-jump=")) {
      options.diagnoseJumpPath = arg.slice("--diagnose-jump=".length).trim() || undefined;
      continue;
    }

    if (arg === "--diagnose-jump") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --diagnose-jump");
      }
      options.diagnoseJumpPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--diagnose-jump-preview=")) {
      options.diagnoseJumpPreviewPath = arg.slice("--diagnose-jump-preview=".length).trim() || undefined;
      continue;
    }

    if (arg === "--diagnose-jump-preview") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --diagnose-jump-preview");
      }
      options.diagnoseJumpPreviewPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--apply-diagnose-jump=")) {
      options.applyDiagnoseJumpPath = arg.slice("--apply-diagnose-jump=".length).trim() || undefined;
      continue;
    }

    if (arg === "--apply-diagnose-jump") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --apply-diagnose-jump");
      }
      options.applyDiagnoseJumpPath = value.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--promote-diagnostic-patch=")) {
      options.promoteDiagnosticPatchPath = arg.slice("--promote-diagnostic-patch=".length).trim() || undefined;
      continue;
    }

    if (arg === "--promote-diagnostic-patch") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --promote-diagnostic-patch");
      }
      options.promoteDiagnosticPatchPath = value.trim();
      index += 1;
      continue;
    }
  }

  return options;
}

function renderNodesView(view: OperatorViewSnapshot): string {
  const lines = ["Nodes:"];

  if (view.nodes.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const node of view.nodes) {
    lines.push(`- ${node.id} [${node.status}] readiness: ${node.readiness} lastHealthCheck: ${node.lastHealthCheck}`);
  }

  return lines.join("\n");
}

function renderRoutingView(view: OperatorViewSnapshot): string {
  const lines = [
    "Routing:",
    `- lastSimulation: ${view.routing.lastSimulation ?? "none"}`,
    `- selectedNode: ${view.routing.selectedNode ?? "none"}`,
  ];

  if (view.routing.candidates.length === 0) {
    lines.push("- candidates: none");
    return lines.join("\n");
  }

  for (const candidate of view.routing.candidates) {
    lines.push(`- candidate ${candidate.nodeId} score: ${candidate.score}`);
  }

  return lines.join("\n");
}

function renderDispatchView(view: OperatorViewSnapshot): string {
  const lines = ["Dispatch Logs:"];

  if (view.dispatch.recent.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const entry of view.dispatch.recent) {
    lines.push(`- ${entry.intent} -> ${entry.targetNode} ${entry.result} at ${entry.timestamp}`);
  }

  return lines.join("\n");
}

function renderMenu(): string {
  return [
    "Operator View",
    "",
    "1. System Status",
    "2. Nodes",
    "3. Routing",
    "4. Dispatch Logs",
    "5. Exit",
  ].join("\n");
}

async function runInteractiveOperatorView(view: OperatorViewSnapshot): Promise<number> {
  const readline = createInterface({ input, output });

  try {
    let running = true;

    while (running) {
      console.log(renderMenu());
      const selection = (await readline.question("Select an option: ")).trim();

      switch (selection) {
        case "1":
          console.log(renderOperatorViewSummary(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "2":
          console.log(renderNodesView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "3":
          console.log(renderRoutingView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "4":
          console.log(renderDispatchView(view));
          await readline.question("Press Enter to return to menu.");
          break;
        case "5":
          running = false;
          break;
        default:
          console.log("Invalid selection. Choose 1-5.");
          await readline.question("Press Enter to return to menu.");
          break;
      }
    }

    return 0;
  } finally {
    readline.close();
  }
}

function buildDemoOperatorState(): OperatorViewState {
  return {
    nodes: [
      {
        node_id: "node-a",
        hostname: "validator-a",
        platform: "linux",
        status: "available",
        capabilities: ["inspection", "validation-check", "repo-scan"],
        last_seen_at: "2026-05-04T18:00:00.000Z",
      },
    ],
    healthSnapshots: [
      {
        node_id: "node-a",
        checked_at: "2026-05-04T18:01:00.000Z",
        status: "healthy",
        latency_ms: 12,
        uptime_seconds: 86400,
        load_average: 0.32,
        warnings: [],
        execution_ready: false,
      },
    ],
    readinessResults: [
      {
        node_id: "node-a",
        evaluated_at: "2026-05-04T18:02:00.000Z",
        readiness_status: "ready_candidate",
        reasons: [],
        required_capabilities: ["inspection"],
        missing_capabilities: [],
        health_status: "healthy",
        execution_ready: false,
      },
    ],
    routingResults: [
      {
        simulated: true,
        task_id: "task-x",
        required_capabilities: ["inspection"],
        selected_node_id: "node-a",
        candidate_nodes: ["node-a"],
        blocked_nodes: [],
        routing_allowed: false,
      },
    ],
    dispatchResults: [
      {
        dispatched: true,
        node_id: "node-a",
        task_id: "task-x",
        reason: "dispatched intent only",
      },
    ],
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(argv);
    const activeModes = [
      options.interactive ? "--interactive" : null,
      options.projectPath ? "--project" : null,
      options.gameTaskPath ? "--game-task" : null,
      options.nextGameTaskPath ? "--next-game-task" : null,
      options.executeNextActionPath ? "--execute-next-action" : null,
      options.recordOutcomePath ? "--record-outcome" : null,
      options.autoRecordOutcomePath ? "--auto-record-outcome" : null,
      options.suggestRetryPath ? "--suggest-retry" : null,
      options.autoRetryPath ? "--auto-retry" : null,
      options.runAutonomousLoopPath ? "--run-autonomous-loop" : null,
      options.autoEvaluatePath ? "--auto-evaluate" : null,
      options.discoverRuntimeLogsPath ? "--discover-runtime-logs" : null,
      options.learningSummaryPath ? "--learning-summary" : null,
      options.featureSelectionReportPath ? "--feature-selection-report" : null,
      options.executeNextGameTaskPath ? "--execute-next-game-task" : null,
      options.cameraTuningPreviewPath ? "--camera-tuning-preview" : null,
      options.applyCameraTuningPath ? "--apply-camera-tuning" : null,
      options.cameraTuningStatusPath ? "--camera-tuning-status" : null,
      options.rollbackCameraTuningPath ? "--rollback-camera-tuning" : null,
      options.applyVisualDebugFloorPath ? "--apply-visual-debug-floor" : null,
      options.visualDebugStatusPath ? "--visual-debug-status" : null,
      options.rollbackVisualDebugPath ? "--rollback-visual-debug" : null,
      options.applyFallRecoveryPath ? "--apply-fall-recovery" : null,
      options.fallRecoveryStatusPath ? "--fall-recovery-status" : null,
      options.rollbackFallRecoveryPath ? "--rollback-fall-recovery" : null,
      options.applyPlaytestSessionMarkerPath ? "--apply-playtest-session-marker" : null,
      options.playtestSessionMarkerStatusPath ? "--playtest-session-status" : null,
      options.rollbackPlaytestSessionMarkerPath ? "--rollback-playtest-session-marker" : null,
      options.applyBasicEnemyPath ? "--apply-basic-enemy" : null,
      options.enemyStatusPath ? "--enemy-status" : null,
      options.rollbackBasicEnemyPath ? "--rollback-basic-enemy" : null,
      options.applyPlayerAttackPath ? "--apply-player-attack" : null,
      options.attackStatusPath ? "--attack-status" : null,
      options.rollbackPlayerAttackPath ? "--rollback-player-attack" : null,
      options.applyAttackFeedbackPath ? "--apply-attack-feedback" : null,
      options.attackFeedbackStatusPath ? "--attack-feedback-status" : null,
      options.rollbackAttackFeedbackPath ? "--rollback-attack-feedback" : null,
      options.cameraWiringPreviewPath ? "--camera-wiring-preview" : null,
      options.applyCameraWiringPath ? "--apply-camera-wiring" : null,
      options.cameraWiringStatusPath ? "--camera-wiring-status" : null,
      options.repairCameraWiringPath ? "--repair-camera-wiring" : null,
      options.rollbackCameraWiringPath ? "--rollback-camera-wiring" : null,
      options.unityRecoveryPath ? "--unity-recovery" : null,
      options.gamePatchPath ? "--game-patch" : null,
      options.gamePatchPreviewPath ? "--game-patch-preview" : null,
      options.applyGamePatchPath ? "--apply-game-patch" : null,
      options.gamePatchStatusPath ? "--game-patch-status" : null,
      options.rollbackGamePatchPath ? "--rollback-game-patch" : null,
      options.diagnoseJumpPath ? "--diagnose-jump" : null,
      options.diagnoseJumpPreviewPath ? "--diagnose-jump-preview" : null,
      options.applyDiagnoseJumpPath ? "--apply-diagnose-jump" : null,
      options.promoteDiagnosticPatchPath ? "--promote-diagnostic-patch" : null,
    ].filter((value): value is string => value !== null);

    if (options.json && options.interactive) {
      throw new Error("Use either --json or --interactive, not both.");
    }

    if (activeModes.length > 1) {
      throw new Error(`Use only one mode at a time: ${activeModes.join(", ")}`);
    }

    if (options.gamePatchPreviewPath) {
      const snapshot = await inspectGameProject(options.gamePatchPreviewPath);
      const preview = await generateUnityPatchPreview(snapshot);

      if (options.json) {
        console.log(JSON.stringify(preview, null, 2));
        return 0;
      }

      console.log(renderUnityPatchPreview(preview));
      return 0;
    }

    if (options.diagnoseJumpPath || options.diagnoseJumpPreviewPath) {
      const targetPath = options.diagnoseJumpPreviewPath ?? options.diagnoseJumpPath;
      const snapshot = await inspectGameProject(targetPath);
      const preview = await generateJumpDiagnosticPreview(snapshot);

      if (options.json) {
        console.log(JSON.stringify(preview, null, 2));
        return 0;
      }

      console.log(renderUnityPatchPreview(preview));
      return 0;
    }

    if (options.cameraTuningPreviewPath) {
      const snapshot = await inspectGameProject(options.cameraTuningPreviewPath);
      const preview = await generateCameraTuningPreview(snapshot);

      if (options.json) {
        console.log(JSON.stringify(preview, null, 2));
        return 0;
      }

      console.log(renderUnityPatchPreview(preview));
      return 0;
    }

    if (options.cameraWiringPreviewPath) {
      const preview = await inspectUnitySceneWiring(options.cameraWiringPreviewPath);

      if (options.json) {
        console.log(JSON.stringify(preview, null, 2));
        return 0;
      }

      console.log(renderUnitySceneWiringPreview(preview));
      return 0;
    }

    if (options.applyGamePatchPath) {
      const snapshot = await inspectGameProject(options.applyGamePatchPath);
      const artifact = await generateUnityPatchArtifact(snapshot);
      const recovery = await inspectUnityPlaytestRecovery(options.applyGamePatchPath);
      const result = await applyUnityPatchArtifact(artifact, recovery.safeToResumePlaytest, buildRecoveryGuidance(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPatchApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyDiagnoseJumpPath) {
      const snapshot = await inspectGameProject(options.applyDiagnoseJumpPath);
      const artifact = await generateJumpDiagnosticArtifact(snapshot);
      const recovery = await inspectUnityPlaytestRecovery(options.applyDiagnoseJumpPath);
      const result = await applyUnityPatchArtifact(artifact, buildFollowupPatchRecoverySignal(recovery), buildRecoveryGuidance(recovery), true);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPatchApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyCameraTuningPath) {
      const snapshot = await inspectGameProject(options.applyCameraTuningPath);
      const artifact = await generateCameraTuningArtifact(snapshot);
      const recovery = await inspectUnityPlaytestRecovery(options.applyCameraTuningPath);
      const result = await applyUnityPatchArtifact(artifact, buildFollowupPatchRecoverySignal(recovery), buildRecoveryGuidance(recovery), true);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPatchApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.promoteDiagnosticPatchPath) {
      const snapshot = await inspectGameProject(options.promoteDiagnosticPatchPath);
      const artifact = await generateProductionMovementArtifact(snapshot);
      const recovery = await inspectUnityPlaytestRecovery(options.promoteDiagnosticPatchPath);
      const result = await applyUnityPatchArtifact(artifact, buildFollowupPatchRecoverySignal(recovery), buildRecoveryGuidance(recovery), true);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPatchApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyCameraWiringPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyCameraWiringPath);
      const result = await applyUnityCameraWiring(options.applyCameraWiringPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnitySceneWiringApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyVisualDebugFloorPath) {
      const result = await applyUnityVisualDebugFloor(options.applyVisualDebugFloorPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityVisualDebugApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyFallRecoveryPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyFallRecoveryPath);
      const result = await applyUnityFallRecovery(options.applyFallRecoveryPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityFallRecoveryApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyPlaytestSessionMarkerPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyPlaytestSessionMarkerPath);
      const result = await applyUnityPlaytestSessionMarker(options.applyPlaytestSessionMarkerPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPlaytestSessionMarkerApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyBasicEnemyPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyBasicEnemyPath);
      const result = await applyUnityBasicEnemy(options.applyBasicEnemyPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityBasicEnemyApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyPlayerAttackPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyPlayerAttackPath);
      const result = await applyUnityPlayerAttack(options.applyPlayerAttackPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityPlayerAttackApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.applyAttackFeedbackPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.applyAttackFeedbackPath);
      const result = await applyUnityAttackFeedback(options.applyAttackFeedbackPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.applied ? 0 : 1;
      }

      console.log(renderUnityAttackFeedbackApplyResult(result));
      return result.applied ? 0 : 1;
    }

    if (options.repairCameraWiringPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.repairCameraWiringPath);
      const result = await repairUnityCameraWiring(options.repairCameraWiringPath, buildFollowupPatchRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.repaired ? 0 : 1;
      }

      console.log(renderUnitySceneWiringRepairResult(result));
      return result.repaired ? 0 : 1;
    }

    if (options.gamePatchStatusPath) {
      const snapshot = await inspectGameProject(options.gamePatchStatusPath);
      const artifact = await generateUnityPatchArtifact(snapshot);
      const diagnosticArtifact = await generateJumpDiagnosticArtifact(snapshot);
      const productionArtifact = await generateProductionMovementArtifact(snapshot);
      const recovery = await inspectUnityPlaytestRecovery(options.gamePatchStatusPath);
      const gameplayStatus = await inspectUnityPatchStatus(artifact, buildPatchStatusRecoverySignal(recovery));
      const diagnosticStatus = await inspectUnityPatchStatus(diagnosticArtifact, buildPatchStatusRecoverySignal(recovery));
      const productionStatus = await inspectUnityPatchStatus(productionArtifact, buildPatchStatusRecoverySignal(recovery));
      const status = productionStatus.currentFileAppearsPatched
        ? productionStatus
        : diagnosticStatus.currentFileAppearsPatched
          ? diagnosticStatus
          : gameplayStatus;

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityPatchStatus(status));
      return 0;
    }

    if (options.cameraTuningStatusPath) {
      const snapshot = await inspectGameProject(options.cameraTuningStatusPath);
      const recovery = await inspectUnityPlaytestRecovery(options.cameraTuningStatusPath);
      const status = await inspectCameraTuningStatus(snapshot, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderCameraTuningStatus(status));
      return 0;
    }

    if (options.cameraWiringStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.cameraWiringStatusPath);
      const status = await inspectUnityCameraWiringStatus(options.cameraWiringStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnitySceneWiringStatus(status));
      return 0;
    }

    if (options.visualDebugStatusPath) {
      const status = await inspectUnityVisualDebugStatus(options.visualDebugStatusPath);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityVisualDebugStatus(status));
      return 0;
    }

    if (options.fallRecoveryStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.fallRecoveryStatusPath);
      const status = await inspectUnityFallRecoveryStatus(options.fallRecoveryStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityFallRecoveryStatus(status));
      return 0;
    }

    if (options.playtestSessionMarkerStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.playtestSessionMarkerStatusPath);
      const status = await inspectUnityPlaytestSessionMarkerStatus(options.playtestSessionMarkerStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityPlaytestSessionMarkerStatus(status));
      return 0;
    }

    if (options.enemyStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.enemyStatusPath);
      const status = await inspectUnityBasicEnemyStatus(options.enemyStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityBasicEnemyStatus(status));
      return 0;
    }

    if (options.attackStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.attackStatusPath);
      const status = await inspectUnityPlayerAttackStatus(options.attackStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityPlayerAttackStatus(status));
      return 0;
    }

    if (options.attackFeedbackStatusPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.attackFeedbackStatusPath);
      const status = await inspectUnityAttackFeedbackStatus(options.attackFeedbackStatusPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }

      console.log(renderUnityAttackFeedbackStatus(status));
      return 0;
    }

    if (options.rollbackGamePatchPath) {
      const snapshot = await inspectGameProject(options.rollbackGamePatchPath);
      const cameraArtifact = await buildExistingCameraFollowArtifact(snapshot);
      const cameraBackupExists = await pathExists(`${cameraArtifact.absoluteTargetPath}.aie-backup`);
      const artifact = cameraBackupExists
        ? cameraArtifact
        : await generateUnityPatchArtifact(snapshot);
      const result = await rollbackUnityPatchArtifact(artifact);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityPatchRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackCameraTuningPath) {
      const snapshot = await inspectGameProject(options.rollbackCameraTuningPath);
      const artifact = await generateCameraTuningArtifact(snapshot);
      const result = await rollbackUnityPatchArtifact(artifact);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityPatchRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackCameraWiringPath) {
      const result = await rollbackUnityCameraWiring(options.rollbackCameraWiringPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnitySceneWiringRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackVisualDebugPath) {
      const result = await rollbackUnityVisualDebugFloor(options.rollbackVisualDebugPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityVisualDebugRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackFallRecoveryPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.rollbackFallRecoveryPath);
      const result = await rollbackUnityFallRecovery(options.rollbackFallRecoveryPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityFallRecoveryRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackPlaytestSessionMarkerPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.rollbackPlaytestSessionMarkerPath);
      const result = await rollbackUnityPlaytestSessionMarker(options.rollbackPlaytestSessionMarkerPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityPlaytestSessionMarkerRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackBasicEnemyPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.rollbackBasicEnemyPath);
      const result = await rollbackUnityBasicEnemy(options.rollbackBasicEnemyPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityBasicEnemyRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackPlayerAttackPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.rollbackPlayerAttackPath);
      const result = await rollbackUnityPlayerAttack(options.rollbackPlayerAttackPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityPlayerAttackRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.rollbackAttackFeedbackPath) {
      const recovery = await inspectUnityPlaytestRecovery(options.rollbackAttackFeedbackPath);
      const result = await rollbackUnityAttackFeedback(options.rollbackAttackFeedbackPath, buildPatchStatusRecoverySignal(recovery));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.restored ? 0 : 1;
      }

      console.log(renderUnityAttackFeedbackRollbackResult(result));
      return result.restored ? 0 : 1;
    }

    if (options.gamePatchPath) {
      const snapshot = await inspectGameProject(options.gamePatchPath);
      const plan = await generateGamePatchPlan(snapshot);

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return 0;
      }

      console.log(renderGamePatchPlan(plan));
      return 0;
    }

    if (options.unityRecoveryPath) {
      const snapshot = await inspectUnityPlaytestRecovery(options.unityRecoveryPath);

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return 0;
      }

      console.log(renderUnityPlaytestRecovery(snapshot, resolve(fileURLToPath(import.meta.url), "..", "..", "..")));
      return 0;
    }

    if (options.gameTaskPath) {
      const snapshot = await inspectGameProject(options.gameTaskPath);
      const task = generateGameTask(snapshot);

      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return 0;
      }

      console.log(renderGameTask(task));
      return 0;
    }

    if (options.discoverRuntimeLogsPath) {
      const discovery = await discoverUnityLogCandidates(options.discoverRuntimeLogsPath);

      if (options.json) {
        console.log(JSON.stringify(discovery, null, 2));
        return 0;
      }

      console.log(renderUnityLogDiscovery(discovery));
      return 0;
    }

    if (options.autoEvaluatePath) {
      const evaluation = await autoEvaluateUnityRuntime(options.autoEvaluatePath, options.runtimeLogPath);

      if (options.json) {
        console.log(JSON.stringify(evaluation, null, 2));
        return 0;
      }

      console.log(renderAutoEvaluation(evaluation));
      return 0;
    }

    if (options.autoRecordOutcomePath) {
      const result = await autoRecordOutcomeForFeature(options.autoRecordOutcomePath, options.outcomeFeature, options.runtimeLogPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.status === "recorded" ? 0 : 1;
      }

      console.log(renderAutoRecordOutcome(result));
      return result.status === "recorded" ? 0 : 1;
    }

    if (options.suggestRetryPath) {
      const result = await suggestRetryForLatestOutcome(options.suggestRetryPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }

      console.log(renderRetrySuggestion(result));
      return 0;
    }

    if (options.autoRetryPath) {
      const result = await generateAutoRetryTask(options.autoRetryPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }

      console.log(renderAutoRetryResult(result));
      return 0;
    }

    if (options.runAutonomousLoopPath) {
      const result = await runAutonomousExecutionLoop(options.runAutonomousLoopPath, options.outcomeFeature, options.runtimeLogPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.status === "completed" ? 0 : 1;
      }

      console.log(renderAutonomousExecutionLoop(result));
      return result.status === "completed" ? 0 : 1;
    }

    if (options.recordOutcomePath) {
      if (!options.outcomeFeature) {
        throw new Error("--record-outcome requires --feature");
      }

      if (!options.autoRecord && (!options.outcomeResult || !["pass", "fail", "partial"].includes(options.outcomeResult))) {
        throw new Error("--record-outcome requires --result pass|fail|partial");
      }

      if (!options.autoRecord && !options.outcomeObservation) {
        throw new Error("--record-outcome requires --observation");
      }

      if (options.autoRecord) {
        const evaluation = await autoEvaluateUnityRuntime(options.recordOutcomePath, options.runtimeLogPath);
        const recorded = await recordOutcome(options.recordOutcomePath, {
          feature: options.outcomeFeature,
          action: "runtime signal extraction",
          result: evaluation.parsedResult.inferredResult,
          inferredResult: evaluation.parsedResult.inferredResult,
          observation: buildAutoOutcomeObservation(evaluation),
          consoleSignals: [
            ...evaluation.parsedResult.errors,
            ...evaluation.parsedResult.warnings,
            ...evaluation.parsedResult.gameplayEvents,
          ],
          evaluationSource: "runtime-auto",
          sessionKey: buildRuntimeAutoSessionKey(options.outcomeFeature, evaluation),
          sessionMode: evaluation.session.mode,
          selectedLogPath: evaluation.logPath,
          evaluatedLineCount: evaluation.evaluatedLineCount,
          gameplayEvents: evaluation.parsedResult.gameplayEvents,
          errors: evaluation.parsedResult.errors,
        });

        if (options.json) {
          console.log(JSON.stringify(recorded, null, 2));
          return 0;
        }

        console.log(renderOutcomeRecord(recorded));
        return 0;
      }

      const recorded = await recordOutcome(options.recordOutcomePath, {
        feature: options.outcomeFeature,
        result: options.outcomeResult,
        observation: options.outcomeObservation,
      });

      if (options.json) {
        console.log(JSON.stringify(recorded, null, 2));
        return 0;
      }

      console.log(renderOutcomeRecord(recorded));
      return 0;
    }

    if (options.learningSummaryPath) {
      const summary = await summarizeOutcomeLearning(options.learningSummaryPath);

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return 0;
      }

      console.log(renderOutcomeSummary(summary));
      return 0;
    }

    if (options.featureSelectionReportPath) {
      if (!options.featurePool || options.featurePool.length === 0) {
        throw new Error("--feature-selection-report requires --feature-pool with at least one feature.");
      }

      const evidence = await buildFeatureSelectionEvidenceSnapshots(options.featureSelectionReportPath, options.featurePool);
      const selection = selectPostPlaytestFeature({
        feature_pool: options.featurePool,
        feature_evidence: evidence,
      });

      if (options.json) {
        console.log(JSON.stringify(selection, null, 2));
        return 0;
      }

      console.log(renderPostPlaytestFeatureSelectionReport(selection));
      return 0;
    }

    if (options.nextGameTaskPath) {
      const snapshot = await inspectGameProject(options.nextGameTaskPath);
      const progression = await determineGameProgression(snapshot);

      if (options.json) {
        console.log(JSON.stringify(progression, null, 2));
        return 0;
      }

      console.log(renderNextGameTask(progression));
      return 0;
    }

    if (options.executeNextActionPath) {
      const result = await executeNextAutonomousAction(options.executeNextActionPath, options.allowExecution === true);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return result.status === "executed" || result.status === "preview" || result.status === "already-applied" ? 0 : 1;
      }

      console.log(renderActionExecutionResult(result));
      return result.status === "executed" || result.status === "preview" || result.status === "already-applied" ? 0 : 1;
    }

    if (options.executeNextGameTaskPath) {
      const snapshot = await inspectGameProject(options.executeNextGameTaskPath);
      const progression = await determineGameProgression(snapshot);

      if (progression.nextTask.requiredPatchType !== "camera-follow-script") {
        if (progression.signals.cameraExists) {
          const report = await executeCameraFollowFeature(options.executeNextGameTaskPath);

          if (options.json) {
            console.log(JSON.stringify(report, null, 2));
            return report.outcome === "blocked" ? 1 : 0;
          }

          console.log(renderCameraFeatureExecutionReport(report));
          return report.outcome === "blocked" ? 1 : 0;
        }

        const blockedResult = {
          executed: false,
          stage: progression.nextTask.stage,
          title: progression.nextTask.title,
          scriptName: progression.nextTask.scriptName,
          targetFile: progression.nextTask.targetFile,
          targetPath: resolve(snapshot.rootPath, progression.nextTask.targetFile),
          patchKind: "gameplay-update" as const,
          operation: progression.nextTask.executionPlan,
          backupPath: `${resolve(snapshot.rootPath, progression.nextTask.targetFile)}.aie-backup`,
          safeToOpenUnityForCompileOrPlaytest: false,
          blockedReasons: [`Automatic execution is not implemented yet for patch type ${progression.nextTask.requiredPatchType}.`],
        };

        if (options.json) {
          console.log(JSON.stringify(blockedResult, null, 2));
          return 1;
        }

        console.log(renderNextGameTaskExecutionResult(blockedResult));
        return 1;
      }

      const report = await executeCameraFollowFeature(options.executeNextGameTaskPath);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return report.outcome === "blocked" ? 1 : 0;
      }

      console.log(renderCameraFeatureExecutionReport(report));
      return report.outcome === "blocked" ? 1 : 0;
    }

    if (options.projectPath) {
      const snapshot = await inspectGameProject(options.projectPath);

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return 0;
      }

      console.log(renderGameProjectSummary(snapshot));
      return 0;
    }

    const state = buildDemoOperatorState();
    const view = renderOperatorView(state);

    if (options.json) {
      console.log(JSON.stringify(view, null, 2));
      return 0;
    }

    if (options.interactive) {
      return runInteractiveOperatorView(view);
    }

    console.log(renderOperatorViewSummary(view));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Operator view display failed: ${message}`);
    return 1;
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
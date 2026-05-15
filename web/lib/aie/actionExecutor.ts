import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { determineGameProgression, type GameProgressionResult } from "./gameProgression";
import {
  applyUnityPatchArtifact,
  generateCameraFollowArtifact,
  generateGameLoopArtifact,
  rollbackUnityPatchArtifact,
  type UnityPatchApplyResult,
  type UnityPatchArtifact,
  type UnityPatchRollbackResult,
} from "./gameTaskGenerator";
import { inspectGameProject, type GameProjectSnapshot } from "./gameProjectInspector";
import {
  readExecutionLoopRecords,
  runAutonomousExecutionLoop,
  type AutonomousExecutionLoopResult,
  type ExecutionLoopRecord,
} from "./executionLoop";
import { inspectUnityPlaytestRecovery, type UnityPlaytestRecoverySnapshot } from "./unityPlaytestRecovery";
import {
  applyUnityBasicEnemy,
  applyUnityGameLoopWiring,
  applyUnityPlayerAttack,
  generateBasicEnemyScriptArtifact,
  generatePlayerAttackScriptArtifact,
  applyUnityCameraWiring,
  inspectUnityBasicEnemyStatus,
  inspectUnityCameraWiringStatus,
  inspectUnityGameLoopStatus,
  inspectUnityPlayerAttackStatus,
  rollbackUnityBasicEnemy,
  rollbackUnityCameraWiring,
  rollbackUnityGameLoopWiring,
  rollbackUnityPlayerAttack,
  type UnityBasicEnemyApplyResult,
  type UnityBasicEnemyRollbackResult,
  type UnityBasicEnemyStatus,
  type UnityGameLoopApplyResult,
  type UnityGameLoopRollbackResult,
  type UnityGameLoopStatus,
  type UnityPlayerAttackApplyResult,
  type UnityPlayerAttackRollbackResult,
  type UnityPlayerAttackStatus,
  type UnitySceneWiringApplyResult,
  type UnitySceneWiringRollbackResult,
  type UnitySceneWiringStatus,
} from "./unitySceneWiring";

export type ExecutableAction = {
  type: "patch-script" | "create-script" | "modify-scene";
  description: string;
  targetFile?: string;
  safe: boolean;
};

type ResolvedExecutableAction = ExecutableAction & {
  executorKind:
    | "camera-follow-create-script"
    | "camera-follow-scene-wiring"
    | "basic-enemy-create-script"
    | "basic-enemy-scene-placement"
    | "player-attack-create-script"
    | "player-attack-scene-placement"
    | "game-loop-create-script"
    | "game-loop-scene-wiring";
};

export type ActionExecutionResultState = "blocked" | "preview" | "executed" | "already-applied";

export type ActionExecutionRecord = {
  id: string;
  timestamp: string;
  projectPath: string;
  sourceLoopFeature?: string;
  action?: ExecutableAction;
  result: ActionExecutionResultState;
  rollbackUsed: boolean;
  rollbackAvailable: boolean;
  backupPath?: string;
  reason: string;
};

export type ActionExecutionResult = {
  status: ActionExecutionResultState;
  projectPath: string;
  sourceLoopFeature?: string;
  action?: ExecutableAction;
  reason: string;
  rollbackUsed: boolean;
  rollbackAvailable: boolean;
  backupPath?: string;
  logPath: string;
  record: ActionExecutionRecord;
};

export type AutonomousRollbackCheckpointKind =
  | "unity-patch-artifact"
  | "camera-follow-scene"
  | "basic-enemy-scene"
  | "player-attack-scene"
  | "game-loop-scene";

export type AutonomousRollbackCheckpoint = {
  id: string;
  timestamp: string;
  projectPath: string;
  step: number;
  sourceLoopFeature?: string;
  action: ExecutableAction;
  rollbackKind: AutonomousRollbackCheckpointKind;
  targetFile?: string;
  backupPath?: string;
  rollbackCommand: string;
  checkpointReady: boolean;
  reason: string;
};

export type BoundedAutonomousExecutionChainStatus = "blocked" | "preview" | "completed";

export type BoundedAutonomousExecutionChainResult = {
  status: BoundedAutonomousExecutionChainStatus;
  projectPath: string;
  requestedSteps: number;
  executedSteps: number;
  results: ActionExecutionResult[];
  checkpoints: AutonomousRollbackCheckpoint[];
  reason: string;
  actionLogPath: string;
  checkpointLogPath: string;
};

export type AutonomousCheckpointRollbackResult = {
  status: "blocked" | "rolled-back";
  projectPath: string;
  checkpointId: string;
  checkpoint?: AutonomousRollbackCheckpoint;
  reason: string;
  actionLogPath: string;
  checkpointLogPath: string;
};

export type ActionExecutorDependencies = {
  inspectGameProject: (projectPath: string) => Promise<GameProjectSnapshot>;
  determineGameProgression: (snapshot: GameProjectSnapshot) => Promise<GameProgressionResult>;
  inspectUnityPlaytestRecovery: (projectPath: string) => Promise<UnityPlaytestRecoverySnapshot>;
  inspectUnityBasicEnemyStatus: (projectPath: string, recoverySafe: boolean) => Promise<UnityBasicEnemyStatus>;
  inspectUnityCameraWiringStatus: (projectPath: string, recoverySafe: boolean) => Promise<UnitySceneWiringStatus>;
  inspectUnityGameLoopStatus: (projectPath: string, recoverySafe: boolean) => Promise<UnityGameLoopStatus>;
  inspectUnityPlayerAttackStatus: (projectPath: string, recoverySafe: boolean) => Promise<UnityPlayerAttackStatus>;
  readExecutionLoopRecords: (projectPath: string) => Promise<ExecutionLoopRecord[]>;
  generateBasicEnemyScriptArtifact: (snapshot: GameProjectSnapshot, targetFile?: string) => Promise<UnityPatchArtifact>;
  generateCameraFollowArtifact: (snapshot: GameProjectSnapshot, targetFile?: string) => Promise<UnityPatchArtifact>;
  generateGameLoopArtifact: (snapshot: GameProjectSnapshot, targetFile?: string) => Promise<UnityPatchArtifact>;
  generatePlayerAttackScriptArtifact: (snapshot: GameProjectSnapshot, targetFile?: string) => Promise<UnityPatchArtifact>;
  applyUnityPatchArtifact: (
    artifact: UnityPatchArtifact,
    recoverySafe: boolean,
    recoveryGuidance: string[],
    allowExistingBackup?: boolean,
  ) => Promise<UnityPatchApplyResult>;
  applyUnityBasicEnemy: (projectPath: string, recoverySafe: boolean) => Promise<UnityBasicEnemyApplyResult>;
  applyUnityCameraWiring: (projectPath: string, recoverySafe: boolean) => Promise<UnitySceneWiringApplyResult>;
  applyUnityGameLoopWiring: (projectPath: string, recoverySafe: boolean) => Promise<UnityGameLoopApplyResult>;
  applyUnityPlayerAttack: (projectPath: string, recoverySafe: boolean) => Promise<UnityPlayerAttackApplyResult>;
  pathExists: (targetPath: string) => Promise<boolean>;
};

export type BoundedActionExecutorDependencies = ActionExecutorDependencies & {
  runAutonomousExecutionLoop: (projectPath: string, feature?: string, runtimeLogPath?: string) => Promise<AutonomousExecutionLoopResult>;
  rollbackUnityPatchArtifact: (artifact: UnityPatchArtifact) => Promise<UnityPatchRollbackResult>;
  rollbackUnityBasicEnemy: (projectPath: string, recoverySafe: boolean) => Promise<UnityBasicEnemyRollbackResult>;
  rollbackUnityCameraWiring: (projectPath: string) => Promise<UnitySceneWiringRollbackResult>;
  rollbackUnityGameLoopWiring: (projectPath: string, recoverySafe: boolean) => Promise<UnityGameLoopRollbackResult>;
  rollbackUnityPlayerAttack: (projectPath: string, recoverySafe: boolean) => Promise<UnityPlayerAttackRollbackResult>;
};

const ACTION_DIRECTORY = ".aie";
const ACTION_LOG_FILE = "actions.jsonl";
const CHECKPOINT_LOG_FILE = "action-checkpoints.jsonl";
const BASIC_ENEMY_TARGET_FILE = "Assets/Scripts/BasicEnemy.cs";
const CAMERA_FOLLOW_TARGET_FILE = "Assets/Scripts/CameraFollow.cs";
const GAME_LOOP_TARGET_FILE = "Assets/Scripts/GameLoopController.cs";
const PLAYER_ATTACK_TARGET_FILE = "Assets/Scripts/PlayerAttack.cs";

const defaultDependencies: BoundedActionExecutorDependencies = {
  inspectGameProject,
  determineGameProgression,
  inspectUnityPlaytestRecovery,
  inspectUnityBasicEnemyStatus,
  inspectUnityCameraWiringStatus,
  inspectUnityGameLoopStatus,
  inspectUnityPlayerAttackStatus,
  readExecutionLoopRecords,
  generateBasicEnemyScriptArtifact,
  generateCameraFollowArtifact,
  generateGameLoopArtifact,
  generatePlayerAttackScriptArtifact,
  applyUnityPatchArtifact,
  applyUnityBasicEnemy,
  applyUnityCameraWiring,
  applyUnityGameLoopWiring,
  applyUnityPlayerAttack,
  runAutonomousExecutionLoop,
  rollbackUnityPatchArtifact,
  rollbackUnityBasicEnemy,
  rollbackUnityCameraWiring,
  rollbackUnityGameLoopWiring,
  rollbackUnityPlayerAttack,
  pathExists,
};

function getActionLogPath(projectPath: string): string {
  return path.join(projectPath, ACTION_DIRECTORY, ACTION_LOG_FILE);
}

function getCheckpointLogPath(projectPath: string): string {
  return path.join(projectPath, ACTION_DIRECTORY, CHECKPOINT_LOG_FILE);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeFeature(value: string | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isCameraLoopFeature(feature: string | undefined): boolean {
  const normalized = normalizeFeature(feature);
  return normalized.includes("camera");
}

function isBasicEnemyLoopFeature(feature: string | undefined): boolean {
  const normalized = normalizeFeature(feature);
  return normalized.includes("basic enemy") || normalized.includes("enemy");
}

function isPlayerAttackLoopFeature(feature: string | undefined): boolean {
  const normalized = normalizeFeature(feature);
  return normalized.includes("player attack") || normalized.includes("attack");
}

function isGameLoopFeature(feature: string | undefined): boolean {
  const normalized = normalizeFeature(feature);
  return normalized.includes("game loop")
    || normalized.includes("win")
    || normalized.includes("lose")
    || normalized === "loop";
}

function buildRecoveryGuidance(snapshot: UnityPlaytestRecoverySnapshot): string[] {
  if (snapshot.recommendedActions.length === 0) {
    return ["No recovery actions required."];
  }

  const guidance = snapshot.recommendedActions.map((action) => {
    const verb = action.action === "delete-file"
      ? "Delete accidental generated file"
      : action.action === "restore-file"
        ? "Restore tracked movement script"
        : action.action === "move-folder-outside-assets"
          ? "Move legacy folder outside Assets"
          : action.action === "add-asmdef-exclusion"
            ? "Add asmdef exclusion strategy"
            : action.action === "add-compatibility-stubs"
              ? "Add compatibility stubs only if intentionally active"
              : "Inspect movement script";
    return `${verb}: ${action.path} (${action.reason})`;
  });

  guidance.push("Wait for Unity compile errors to clear.");
  guidance.push("Re-run patch preview or patch status after recovery is clean.");
  return guidance;
}

function buildFollowupPatchRecoverySignal(snapshot: UnityPlaytestRecoverySnapshot): boolean {
  return snapshot.detectedIssues.accidentalGeneratedFiles.length === 0
    && snapshot.detectedIssues.duplicateClassRisks.length === 0
    && snapshot.detectedIssues.legacyCompileRiskFiles.length === 0
    && snapshot.detectedIssues.legacyCompileCompatibilityIssues.length === 0;
}

function parseActionExecutionRecord(rawLine: string): ActionExecutionRecord | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as Partial<ActionExecutionRecord>;
  return {
    id: typeof parsed.id === "string" ? parsed.id : "",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
    projectPath: typeof parsed.projectPath === "string" ? parsed.projectPath : "",
    sourceLoopFeature: typeof parsed.sourceLoopFeature === "string" ? parsed.sourceLoopFeature : undefined,
    action: parsed.action,
    result: parsed.result === "preview" || parsed.result === "executed" || parsed.result === "already-applied" ? parsed.result : "blocked",
    rollbackUsed: parsed.rollbackUsed === true,
    rollbackAvailable: parsed.rollbackAvailable === true,
    backupPath: typeof parsed.backupPath === "string" ? parsed.backupPath : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

export async function readActionExecutionRecords(projectPath: string): Promise<ActionExecutionRecord[]> {
  const logPath = getActionLogPath(projectPath);

  try {
    const source = await readFile(logPath, "utf-8");
    return source
      .split(/\r?\n/)
      .map((line) => parseActionExecutionRecord(line))
      .filter((record): record is ActionExecutionRecord => record !== null);
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function recordActionExecution(projectPath: string, record: Omit<ActionExecutionRecord, "id" | "timestamp" | "projectPath">): Promise<ActionExecutionRecord> {
  const outputDirectory = path.join(projectPath, ACTION_DIRECTORY);
  const logPath = getActionLogPath(projectPath);
  await mkdir(outputDirectory, { recursive: true });

  const finalRecord: ActionExecutionRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    projectPath,
    ...record,
  };

  await appendFile(logPath, `${JSON.stringify(finalRecord)}\n`, "utf-8");
  return finalRecord;
}

function parseAutonomousRollbackCheckpoint(rawLine: string): AutonomousRollbackCheckpoint | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as Partial<AutonomousRollbackCheckpoint>;
  if (
    parsed.rollbackKind !== "unity-patch-artifact"
    && parsed.rollbackKind !== "camera-follow-scene"
    && parsed.rollbackKind !== "basic-enemy-scene"
    && parsed.rollbackKind !== "player-attack-scene"
    && parsed.rollbackKind !== "game-loop-scene"
  ) {
    return null;
  }

  return {
    id: typeof parsed.id === "string" ? parsed.id : "",
    timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
    projectPath: typeof parsed.projectPath === "string" ? parsed.projectPath : "",
    step: typeof parsed.step === "number" ? parsed.step : 0,
    sourceLoopFeature: typeof parsed.sourceLoopFeature === "string" ? parsed.sourceLoopFeature : undefined,
    action: parsed.action as ExecutableAction,
    rollbackKind: parsed.rollbackKind,
    targetFile: typeof parsed.targetFile === "string" ? parsed.targetFile : undefined,
    backupPath: typeof parsed.backupPath === "string" ? parsed.backupPath : undefined,
    rollbackCommand: typeof parsed.rollbackCommand === "string" ? parsed.rollbackCommand : "",
    checkpointReady: parsed.checkpointReady === true,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

export async function readAutonomousRollbackCheckpoints(projectPath: string): Promise<AutonomousRollbackCheckpoint[]> {
  const logPath = getCheckpointLogPath(projectPath);

  try {
    const source = await readFile(logPath, "utf-8");
    return source
      .split(/\r?\n/)
      .map((line) => parseAutonomousRollbackCheckpoint(line))
      .filter((checkpoint): checkpoint is AutonomousRollbackCheckpoint => checkpoint !== null);
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function recordAutonomousRollbackCheckpoint(
  projectPath: string,
  checkpoint: Omit<AutonomousRollbackCheckpoint, "id" | "timestamp" | "projectPath">,
): Promise<AutonomousRollbackCheckpoint> {
  const outputDirectory = path.join(projectPath, ACTION_DIRECTORY);
  const logPath = getCheckpointLogPath(projectPath);
  await mkdir(outputDirectory, { recursive: true });
  const checkpointId = randomUUID();

  const finalCheckpoint: AutonomousRollbackCheckpoint = {
    id: checkpointId,
    timestamp: new Date().toISOString(),
    projectPath,
    ...checkpoint,
    rollbackCommand: buildCheckpointRollbackCommand(projectPath, checkpointId),
  };

  await appendFile(logPath, `${JSON.stringify(finalCheckpoint)}\n`, "utf-8");
  return finalCheckpoint;
}

function resolveLoopFeatureForPatchType(requiredPatchType: GameProgressionResult["nextTask"]["requiredPatchType"]): string | undefined {
  if (requiredPatchType === "camera-follow-script") {
    return "camera-follow";
  }
  if (requiredPatchType === "basic-enemy-script") {
    return "basic-enemy";
  }
  if (requiredPatchType === "player-attack-script") {
    return "player-attack";
  }
  if (requiredPatchType === "game-loop-script") {
    return "game-loop";
  }
  return undefined;
}

function buildCheckpointRollbackCommand(projectPath: string, checkpointId: string): string {
  return `npm run operator:view -- --rollback-autonomous-checkpoint "${projectPath}" --checkpoint-id "${checkpointId}"`;
}

function buildCheckpointDraft(
  projectPath: string,
  step: number,
  result: ActionExecutionResult,
): Omit<AutonomousRollbackCheckpoint, "id" | "timestamp" | "projectPath"> {
  const targetFile = result.action?.targetFile;
  const normalizedFeature = normalizeFeature(result.sourceLoopFeature);
  const rollbackKind: AutonomousRollbackCheckpointKind = result.action?.type === "create-script"
    ? "unity-patch-artifact"
    : targetFile === "Assets/Scenes/EnemyAIDemo.unity" && normalizedFeature.includes("basic enemy")
      ? "basic-enemy-scene"
      : targetFile === "Assets/Scenes/EnemyAIDemo.unity" && normalizedFeature.includes("player attack")
        ? "player-attack-scene"
    : targetFile === "Assets/Scenes/EnemyAIDemo.unity" && normalizedFeature.includes("game loop")
      ? "game-loop-scene"
        : "camera-follow-scene";

  return {
    step,
    sourceLoopFeature: result.sourceLoopFeature,
    action: result.action ?? {
      type: "modify-scene",
      description: result.reason,
      targetFile,
      safe: false,
    },
    rollbackKind,
    targetFile,
    backupPath: result.backupPath,
    rollbackCommand: "",
    checkpointReady: Boolean(result.rollbackAvailable && result.backupPath && targetFile),
    reason: result.rollbackAvailable
      ? `Rollback checkpoint available after ${result.action?.type ?? "autonomous action"}.`
      : `Rollback checkpoint is unavailable after ${result.action?.type ?? "autonomous action"}.`,
  };
}

function buildPatchArtifactFromCheckpoint(projectPath: string, checkpoint: AutonomousRollbackCheckpoint): UnityPatchArtifact {
  const targetFile = checkpoint.targetFile;
  if (!targetFile) {
    throw new Error(`Checkpoint ${checkpoint.id} is missing a target file for patch rollback.`);
  }

  return {
    patchKind: "gameplay-update",
    operation: "create-new-script",
    targetFile,
    absoluteTargetPath: path.join(projectPath, targetFile),
    originalSha256: "checkpoint-backup",
    replacementSha256: "checkpoint-replacement",
    replacementCode: "",
    validationRules: {
      preserveClassName: path.basename(targetFile, path.extname(targetFile)),
      forbiddenClassNames: [],
      requireNoDuplicateMethods: true,
    },
    safety: {
      requiresCleanRecoveryState: true,
      createsBackupBeforeApply: true,
      noUnityExecution: true,
    },
  };
}

async function resolveNextExecutableAction(
  projectPath: string,
  dependencies: ActionExecutorDependencies,
): Promise<{
  status: "blocked" | "ready" | "already-applied";
  sourceLoopFeature?: string;
  action?: ResolvedExecutableAction;
  reason: string;
}> {
  const loopRecords = await dependencies.readExecutionLoopRecords(projectPath);
  const latestLoop = loopRecords.at(-1);
  if (!latestLoop) {
    return {
      status: "blocked",
      reason: "No autonomous loop summary found. Run --run-autonomous-loop first.",
    };
  }

  const snapshot = await dependencies.inspectGameProject(projectPath);
  const progression = await dependencies.determineGameProgression(snapshot);

  if (progression.nextTask.requiredPatchType === "camera-follow-script") {
    if (!isCameraLoopFeature(latestLoop.feature)) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: `Latest loop feature ${latestLoop.feature} does not map to camera-follow-script execution.`,
      };
    }

    const recovery = await dependencies.inspectUnityPlaytestRecovery(projectPath);
    const recoverySafe = buildFollowupPatchRecoverySignal(recovery);
    const cameraScriptAbsolutePath = path.join(snapshot.rootPath, CAMERA_FOLLOW_TARGET_FILE);
    const scriptExists = await dependencies.pathExists(cameraScriptAbsolutePath);
    const metaExists = await dependencies.pathExists(`${cameraScriptAbsolutePath}.meta`);
    const wiringStatus = await dependencies.inspectUnityCameraWiringStatus(projectPath, recoverySafe);

    if (!scriptExists) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "create-script",
          description: "Create CameraFollow.cs using the existing guarded Unity patch artifact flow.",
          targetFile: CAMERA_FOLLOW_TARGET_FILE,
          safe: recoverySafe,
          executorKind: "camera-follow-create-script",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests camera follow work; the next safe action is creating the validated CameraFollow.cs script."
          : "Recovery is not clean enough for execution; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    if (!metaExists) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: "CameraFollow.cs exists but CameraFollow.cs.meta is missing; no single safe action is defined for this partial state.",
      };
    }

    if (!(wiringStatus.cameraFollowAttached && wiringStatus.playerTargetAssigned)) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "modify-scene",
          description: "Attach CameraFollow to Main Camera and assign the player target using the existing guarded scene wiring flow.",
          targetFile: wiringStatus.scenePath,
          safe: recoverySafe,
          executorKind: "camera-follow-scene-wiring",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests camera follow work; the next safe action is wiring the existing CameraFollow script into the scene."
          : "Recovery is not clean enough for scene mutation; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    return {
      status: "already-applied",
      sourceLoopFeature: latestLoop.feature,
      reason: "The latest validated camera-follow action is already applied.",
    };
  }

  if (progression.nextTask.requiredPatchType === "basic-enemy-script") {
    if (!isBasicEnemyLoopFeature(latestLoop.feature)) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: `Latest loop feature ${latestLoop.feature} does not map to basic-enemy-script execution.`,
      };
    }

    const recovery = await dependencies.inspectUnityPlaytestRecovery(projectPath);
    const recoverySafe = buildFollowupPatchRecoverySignal(recovery);
    const basicEnemyScriptAbsolutePath = path.join(snapshot.rootPath, BASIC_ENEMY_TARGET_FILE);
    const scriptExists = await dependencies.pathExists(basicEnemyScriptAbsolutePath);
    const metaExists = await dependencies.pathExists(`${basicEnemyScriptAbsolutePath}.meta`);
    const basicEnemyStatus = await dependencies.inspectUnityBasicEnemyStatus(projectPath, recoverySafe);

    if (!scriptExists) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "create-script",
          description: "Create BasicEnemy.cs using the existing guarded Unity patch artifact flow.",
          targetFile: BASIC_ENEMY_TARGET_FILE,
          safe: recoverySafe,
          executorKind: "basic-enemy-create-script",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests basic enemy work; the next safe action is creating the validated BasicEnemy.cs script."
          : "Recovery is not clean enough for execution; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    if (!metaExists) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: "BasicEnemy.cs exists but BasicEnemy.cs.meta is missing; no single safe action is defined for this partial state.",
      };
    }

    if (!(basicEnemyStatus.enemyExists && basicEnemyStatus.scriptAttached && basicEnemyStatus.positionedOnGround)) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "modify-scene",
          description: "Place or repair the scene enemy using the existing guarded BasicEnemy scene mutation flow.",
          targetFile: basicEnemyStatus.scenePath,
          safe: recoverySafe,
          executorKind: "basic-enemy-scene-placement",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests basic enemy work; the next safe action is placing the validated BasicEnemy script into the scene."
          : "Recovery is not clean enough for scene mutation; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    return {
      status: "already-applied",
      sourceLoopFeature: latestLoop.feature,
      reason: "The latest validated basic-enemy action is already applied.",
    };
  }

  if (progression.nextTask.requiredPatchType === "player-attack-script") {
    if (!isPlayerAttackLoopFeature(latestLoop.feature)) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: `Latest loop feature ${latestLoop.feature} does not map to player-attack-script execution.`,
      };
    }

    const recovery = await dependencies.inspectUnityPlaytestRecovery(projectPath);
    const recoverySafe = buildFollowupPatchRecoverySignal(recovery);
    const playerAttackScriptAbsolutePath = path.join(snapshot.rootPath, PLAYER_ATTACK_TARGET_FILE);
    const scriptExists = await dependencies.pathExists(playerAttackScriptAbsolutePath);
    const metaExists = await dependencies.pathExists(`${playerAttackScriptAbsolutePath}.meta`);
    const playerAttackStatus = await dependencies.inspectUnityPlayerAttackStatus(projectPath, recoverySafe);

    if (!scriptExists) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "create-script",
          description: "Create PlayerAttack.cs using the existing guarded Unity patch artifact flow.",
          targetFile: PLAYER_ATTACK_TARGET_FILE,
          safe: recoverySafe,
          executorKind: "player-attack-create-script",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests player attack work; the next safe action is creating the validated PlayerAttack.cs script."
          : "Recovery is not clean enough for execution; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    if (!metaExists) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: "PlayerAttack.cs exists but PlayerAttack.cs.meta is missing; no single safe action is defined for this partial state.",
      };
    }

    if (!(playerAttackStatus.playerAttackAttached && playerAttackStatus.attackKeyConfigured)) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "modify-scene",
          description: "Attach or repair the PlayerAttack scene wiring using the existing guarded player attack mutation flow.",
          targetFile: playerAttackStatus.scenePath,
          safe: recoverySafe,
          executorKind: "player-attack-scene-placement",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests player attack work; the next safe action is wiring the validated PlayerAttack script into the scene."
          : "Recovery is not clean enough for scene mutation; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    return {
      status: "already-applied",
      sourceLoopFeature: latestLoop.feature,
      reason: "The latest validated player-attack action is already applied.",
    };
  }

  if (progression.nextTask.requiredPatchType === "game-loop-script") {
    if (!isGameLoopFeature(latestLoop.feature)) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: `Latest loop feature ${latestLoop.feature} does not map to game-loop-script execution.`,
      };
    }

    const recovery = await dependencies.inspectUnityPlaytestRecovery(projectPath);
    const recoverySafe = buildFollowupPatchRecoverySignal(recovery);
    const gameLoopScriptAbsolutePath = path.join(snapshot.rootPath, GAME_LOOP_TARGET_FILE);
    const scriptExists = await dependencies.pathExists(gameLoopScriptAbsolutePath);
    const metaExists = await dependencies.pathExists(`${gameLoopScriptAbsolutePath}.meta`);
    const gameLoopStatus = await dependencies.inspectUnityGameLoopStatus(projectPath, recoverySafe);

    if (!scriptExists) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "create-script",
          description: "Create GameLoopController.cs using the existing guarded Unity patch artifact flow.",
          targetFile: GAME_LOOP_TARGET_FILE,
          safe: recoverySafe,
          executorKind: "game-loop-create-script",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests game loop work; the next safe action is creating the validated GameLoopController.cs script."
          : "Recovery is not clean enough for execution; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    if (!metaExists) {
      return {
        status: "blocked",
        sourceLoopFeature: latestLoop.feature,
        reason: "GameLoopController.cs exists but GameLoopController.cs.meta is missing; no single safe action is defined for this partial state.",
      };
    }

    if (!(gameLoopStatus.gameLoopAttached && gameLoopStatus.winFeedbackPresent && gameLoopStatus.enemyDefeatConnected)) {
      return {
        status: "ready",
        sourceLoopFeature: latestLoop.feature,
        action: {
          type: "modify-scene",
          description: "Attach or repair the GameLoopController scene wiring and visible win feedback using the guarded game loop mutation flow.",
          targetFile: gameLoopStatus.scenePath,
          safe: recoverySafe,
          executorKind: "game-loop-scene-wiring",
        },
        reason: recoverySafe
          ? "Latest autonomous loop suggests game loop work; the next safe action is wiring the existing GameLoopController into the scene and connecting visible win feedback."
          : "Recovery is not clean enough for scene mutation; preview only until the follow-up patch guard reports a safe state.",
      };
    }

    return {
      status: "already-applied",
      sourceLoopFeature: latestLoop.feature,
      reason: "The latest validated game-loop action is already applied.",
    };
  }

  return {
    status: "blocked",
    sourceLoopFeature: latestLoop.feature,
    reason: `No validated single-action executor exists yet for loop feature ${latestLoop.feature}.`,
  };
}

export async function executeNextAutonomousAction(
  projectPath: string,
  allowExecution: boolean,
  dependencies: Partial<ActionExecutorDependencies> = {},
): Promise<ActionExecutionResult> {
  const resolvedDependencies: ActionExecutorDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const logPath = getActionLogPath(projectPath);
  const plan = await resolveNextExecutableAction(projectPath, resolvedDependencies);

  if (plan.status === "blocked" || plan.status === "already-applied") {
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: plan.status,
      rollbackUsed: false,
      rollbackAvailable: false,
      reason: plan.reason,
    });

    return {
      status: plan.status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason: plan.reason,
      rollbackUsed: false,
      rollbackAvailable: false,
      logPath,
      record,
    };
  }

  if (!plan.action || !allowExecution || !plan.action.safe) {
    const reason = !allowExecution
      ? `${plan.reason} Pass --allow-execution true to apply exactly one action.`
      : plan.reason;
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: "preview",
      rollbackUsed: false,
      rollbackAvailable: false,
      reason,
    });

    return {
      status: "preview",
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: false,
      logPath,
      record,
    };
  }

  const recovery = await resolvedDependencies.inspectUnityPlaytestRecovery(projectPath);
  const recoverySafe = buildFollowupPatchRecoverySignal(recovery);

  if (plan.action.executorKind === "camera-follow-create-script") {
    const snapshot = await resolvedDependencies.inspectGameProject(projectPath);
    const artifact = await resolvedDependencies.generateCameraFollowArtifact(snapshot, CAMERA_FOLLOW_TARGET_FILE);
    const applyResult = await resolvedDependencies.applyUnityPatchArtifact(
      artifact,
      recoverySafe,
      buildRecoveryGuidance(recovery),
    );
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded CameraFollow patch flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "basic-enemy-create-script") {
    const snapshot = await resolvedDependencies.inspectGameProject(projectPath);
    const artifact = await resolvedDependencies.generateBasicEnemyScriptArtifact(snapshot, BASIC_ENEMY_TARGET_FILE);
    const applyResult = await resolvedDependencies.applyUnityPatchArtifact(
      artifact,
      recoverySafe,
      buildRecoveryGuidance(recovery),
    );
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded BasicEnemy patch flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "basic-enemy-scene-placement") {
    const applyResult = await resolvedDependencies.applyUnityBasicEnemy(projectPath, recoverySafe);
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded BasicEnemy scene mutation flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "player-attack-create-script") {
    const snapshot = await resolvedDependencies.inspectGameProject(projectPath);
    const artifact = await resolvedDependencies.generatePlayerAttackScriptArtifact(snapshot, PLAYER_ATTACK_TARGET_FILE);
    const applyResult = await resolvedDependencies.applyUnityPatchArtifact(
      artifact,
      recoverySafe,
      buildRecoveryGuidance(recovery),
    );
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded PlayerAttack patch flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "player-attack-scene-placement") {
    const applyResult = await resolvedDependencies.applyUnityPlayerAttack(projectPath, recoverySafe);
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded PlayerAttack scene mutation flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "game-loop-create-script") {
    const snapshot = await resolvedDependencies.inspectGameProject(projectPath);
    const artifact = await resolvedDependencies.generateGameLoopArtifact(snapshot, GAME_LOOP_TARGET_FILE);
    const applyResult = await resolvedDependencies.applyUnityPatchArtifact(
      artifact,
      recoverySafe,
      buildRecoveryGuidance(recovery),
    );
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded GameLoopController patch flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  if (plan.action.executorKind === "game-loop-scene-wiring") {
    const applyResult = await resolvedDependencies.applyUnityGameLoopWiring(projectPath, recoverySafe);
    const status: ActionExecutionResultState = applyResult.applied ? "executed" : "blocked";
    const reason = applyResult.applied
      ? "Executed one autonomous action through the guarded game loop scene wiring flow."
      : applyResult.blockedReasons.join(" ");
    const record = await recordActionExecution(projectPath, {
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      result: status,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      reason,
    });

    return {
      status,
      projectPath,
      sourceLoopFeature: plan.sourceLoopFeature,
      action: plan.action,
      reason,
      rollbackUsed: false,
      rollbackAvailable: true,
      backupPath: applyResult.backupPath,
      logPath,
      record,
    };
  }

  const wiringResult = await resolvedDependencies.applyUnityCameraWiring(projectPath, recoverySafe);
  const status: ActionExecutionResultState = wiringResult.applied ? "executed" : "blocked";
  const reason = wiringResult.applied
    ? "Executed one autonomous action through the guarded CameraFollow scene wiring flow."
    : wiringResult.blockedReasons.join(" ");
  const record = await recordActionExecution(projectPath, {
    sourceLoopFeature: plan.sourceLoopFeature,
    action: plan.action,
    result: status,
    rollbackUsed: false,
    rollbackAvailable: true,
    backupPath: wiringResult.backupPath,
    reason,
  });

  return {
    status,
    projectPath,
    sourceLoopFeature: plan.sourceLoopFeature,
    action: plan.action,
    reason,
    rollbackUsed: false,
    rollbackAvailable: true,
    backupPath: wiringResult.backupPath,
    logPath,
    record,
  };
}

export async function executeBoundedAutonomousActionChain(
  projectPath: string,
  maxSteps: number,
  allowExecution: boolean,
  runtimeLogPath?: string,
  dependencies: Partial<BoundedActionExecutorDependencies> = {},
): Promise<BoundedAutonomousExecutionChainResult> {
  const resolvedDependencies: BoundedActionExecutorDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const results: ActionExecutionResult[] = [];
  const checkpoints: AutonomousRollbackCheckpoint[] = [];
  const requestedSteps = Math.max(1, Math.floor(maxSteps || 1));
  const actionLogPath = getActionLogPath(projectPath);
  const checkpointLogPath = getCheckpointLogPath(projectPath);

  for (let step = 1; step <= requestedSteps; step += 1) {
    const snapshot = await resolvedDependencies.inspectGameProject(projectPath);
    const progression = await resolvedDependencies.determineGameProgression(snapshot);
    const loopFeature = resolveLoopFeatureForPatchType(progression.nextTask.requiredPatchType);

    if (!loopFeature) {
      return {
        status: results.length > 0 ? "completed" : "blocked",
        projectPath,
        requestedSteps,
        executedSteps: results.filter((result) => result.status === "executed").length,
        results,
        checkpoints,
        reason: `Next validated task ${progression.nextTask.requiredPatchType} is outside the bounded autonomous action chain scope.`,
        actionLogPath,
        checkpointLogPath,
      };
    }

    const loopResult = await resolvedDependencies.runAutonomousExecutionLoop(projectPath, loopFeature, runtimeLogPath);
    if (loopResult.status !== "completed") {
      return {
        status: "blocked",
        projectPath,
        requestedSteps,
        executedSteps: results.filter((result) => result.status === "executed").length,
        results,
        checkpoints,
        reason: loopResult.reason ?? "Autonomous execution loop did not complete.",
        actionLogPath,
        checkpointLogPath,
      };
    }

    const actionResult = await executeNextAutonomousAction(projectPath, allowExecution, resolvedDependencies);
    results.push(actionResult);

    if (actionResult.status !== "executed") {
      return {
        status: actionResult.status === "preview" ? "preview" : "blocked",
        projectPath,
        requestedSteps,
        executedSteps: results.filter((result) => result.status === "executed").length,
        results,
        checkpoints,
        reason: actionResult.reason,
        actionLogPath,
        checkpointLogPath,
      };
    }

    const checkpointDraft = buildCheckpointDraft(projectPath, step, actionResult);
    if (!checkpointDraft.checkpointReady) {
      return {
        status: "blocked",
        projectPath,
        requestedSteps,
        executedSteps: results.filter((result) => result.status === "executed").length,
        results,
        checkpoints,
        reason: `Rollback checkpoint could not be established after step ${step}.`,
        actionLogPath,
        checkpointLogPath,
      };
    }

    const recordedCheckpoint = await recordAutonomousRollbackCheckpoint(projectPath, checkpointDraft);
    checkpoints.push(recordedCheckpoint);

    if (step === requestedSteps) {
      return {
        status: "completed",
        projectPath,
        requestedSteps,
        executedSteps: results.filter((result) => result.status === "executed").length,
        results,
        checkpoints,
        reason: `Reached the bounded step limit (${requestedSteps}).`,
        actionLogPath,
        checkpointLogPath,
      };
    }
  }

  return {
    status: "completed",
    projectPath,
    requestedSteps,
    executedSteps: results.filter((result) => result.status === "executed").length,
    results,
    checkpoints,
    reason: `Completed ${results.length} bounded autonomous actions.`,
    actionLogPath,
    checkpointLogPath,
  };
}

export async function rollbackAutonomousCheckpoint(
  projectPath: string,
  checkpointId: string,
  dependencies: Partial<BoundedActionExecutorDependencies> = {},
): Promise<AutonomousCheckpointRollbackResult> {
  const resolvedDependencies: BoundedActionExecutorDependencies = {
    ...defaultDependencies,
    ...dependencies,
  };
  const checkpoints = await readAutonomousRollbackCheckpoints(projectPath);
  const checkpoint = checkpoints.find((entry) => entry.id === checkpointId);
  const actionLogPath = getActionLogPath(projectPath);
  const checkpointLogPath = getCheckpointLogPath(projectPath);

  if (!checkpoint) {
    return {
      status: "blocked",
      projectPath,
      checkpointId,
      reason: `No autonomous rollback checkpoint found for id ${checkpointId}.`,
      actionLogPath,
      checkpointLogPath,
    };
  }

  if (!checkpoint.checkpointReady) {
    return {
      status: "blocked",
      projectPath,
      checkpointId,
      checkpoint,
      reason: `Checkpoint ${checkpointId} was recorded without rollback readiness.`,
      actionLogPath,
      checkpointLogPath,
    };
  }

  const recovery = await resolvedDependencies.inspectUnityPlaytestRecovery(projectPath);
  const recoverySafe = buildFollowupPatchRecoverySignal(recovery);

  if (checkpoint.rollbackKind === "unity-patch-artifact") {
    const rollbackResult = await resolvedDependencies.rollbackUnityPatchArtifact(buildPatchArtifactFromCheckpoint(projectPath, checkpoint));
    return {
      status: rollbackResult.restored ? "rolled-back" : "blocked",
      projectPath,
      checkpointId,
      checkpoint,
      reason: rollbackResult.restored
        ? `Rolled back ${checkpoint.targetFile ?? "script patch"} from checkpoint ${checkpointId}.`
        : rollbackResult.blockedReasons.join(" "),
      actionLogPath,
      checkpointLogPath,
    };
  }

  if (checkpoint.rollbackKind === "camera-follow-scene") {
    const rollbackResult = await resolvedDependencies.rollbackUnityCameraWiring(projectPath);
    return {
      status: rollbackResult.restored ? "rolled-back" : "blocked",
      projectPath,
      checkpointId,
      checkpoint,
      reason: rollbackResult.restored
        ? `Rolled back camera-follow scene wiring from checkpoint ${checkpointId}.`
        : rollbackResult.blockedReasons.join(" "),
      actionLogPath,
      checkpointLogPath,
    };
  }

  if (checkpoint.rollbackKind === "basic-enemy-scene") {
    const rollbackResult = await resolvedDependencies.rollbackUnityBasicEnemy(projectPath, recoverySafe);
    return {
      status: rollbackResult.restored ? "rolled-back" : "blocked",
      projectPath,
      checkpointId,
      checkpoint,
      reason: rollbackResult.restored
        ? `Rolled back basic-enemy scene state from checkpoint ${checkpointId}.`
        : rollbackResult.blockedReasons.join(" "),
      actionLogPath,
      checkpointLogPath,
    };
  }

  if (checkpoint.rollbackKind === "game-loop-scene") {
    const rollbackResult = await resolvedDependencies.rollbackUnityGameLoopWiring(projectPath, recoverySafe);
    return {
      status: rollbackResult.restored ? "rolled-back" : "blocked",
      projectPath,
      checkpointId,
      checkpoint,
      reason: rollbackResult.restored
        ? `Rolled back game-loop scene state from checkpoint ${checkpointId}.`
        : rollbackResult.blockedReasons.join(" "),
      actionLogPath,
      checkpointLogPath,
    };
  }

  const rollbackResult = await resolvedDependencies.rollbackUnityPlayerAttack(projectPath, recoverySafe);
  return {
    status: rollbackResult.restored ? "rolled-back" : "blocked",
    projectPath,
    checkpointId,
    checkpoint,
    reason: rollbackResult.restored
      ? `Rolled back player-attack scene state from checkpoint ${checkpointId}.`
      : rollbackResult.blockedReasons.join(" "),
    actionLogPath,
    checkpointLogPath,
  };
}

export function renderActionExecutionResult(result: ActionExecutionResult): string {
  const heading = result.status === "executed"
    ? "AUTONOMOUS ACTION EXECUTED"
    : result.status === "preview"
      ? "AUTONOMOUS ACTION PREVIEW"
      : result.status === "already-applied"
        ? "AUTONOMOUS ACTION ALREADY APPLIED"
        : "AUTONOMOUS ACTION BLOCKED";

  return [
    heading,
    "",
    `Project: ${result.projectPath}`,
    `Source Loop Feature: ${result.sourceLoopFeature ?? "n/a"}`,
    `Action Type: ${result.action?.type ?? "n/a"}`,
    `Target File: ${result.action?.targetFile ?? "n/a"}`,
    `Safe: ${result.action?.safe ? "YES" : "NO"}`,
    `Rollback Available: ${result.rollbackAvailable ? "YES" : "NO"}`,
    `Rollback Used: ${result.rollbackUsed ? "YES" : "NO"}`,
    `Backup Path: ${result.backupPath ?? "n/a"}`,
    `Reason: ${result.reason}`,
    `Action Log: ${result.logPath}`,
  ].join("\n");
}

export function renderBoundedAutonomousExecutionChain(result: BoundedAutonomousExecutionChainResult): string {
  const heading = result.status === "completed"
    ? "AUTONOMOUS ACTION CHAIN COMPLETED"
    : result.status === "preview"
      ? "AUTONOMOUS ACTION CHAIN PREVIEW"
      : "AUTONOMOUS ACTION CHAIN BLOCKED";

  const lines = [
    heading,
    "",
    `Project: ${result.projectPath}`,
    `Requested Steps: ${result.requestedSteps}`,
    `Executed Steps: ${result.executedSteps}`,
    `Reason: ${result.reason}`,
    `Action Log: ${result.actionLogPath}`,
    `Checkpoint Log: ${result.checkpointLogPath}`,
  ];

  if (result.results.length > 0) {
    lines.push("", "Executed Actions:");
    for (const [index, stepResult] of result.results.entries()) {
      lines.push(`${index + 1}. ${stepResult.sourceLoopFeature ?? "n/a"} -> ${stepResult.action?.type ?? "n/a"} -> ${stepResult.status}`);
    }
  }

  if (result.checkpoints.length > 0) {
    lines.push("", "Rollback Checkpoints:");
    for (const checkpoint of result.checkpoints) {
      lines.push(`${checkpoint.step}. ${checkpoint.rollbackKind} | ready=${checkpoint.checkpointReady ? "yes" : "no"} | backup=${checkpoint.backupPath ?? "n/a"}`);
      lines.push(`   Command: ${checkpoint.rollbackCommand}`);
    }
  }

  return lines.join("\n");
}

export function renderAutonomousCheckpointRollbackResult(result: AutonomousCheckpointRollbackResult): string {
  const heading = result.status === "rolled-back"
    ? "AUTONOMOUS CHECKPOINT ROLLED BACK"
    : "AUTONOMOUS CHECKPOINT ROLLBACK BLOCKED";

  return [
    heading,
    "",
    `Project: ${result.projectPath}`,
    `Checkpoint Id: ${result.checkpointId}`,
    `Rollback Kind: ${result.checkpoint?.rollbackKind ?? "n/a"}`,
    `Target File: ${result.checkpoint?.targetFile ?? "n/a"}`,
    `Backup Path: ${result.checkpoint?.backupPath ?? "n/a"}`,
    `Reason: ${result.reason}`,
    `Action Log: ${result.actionLogPath}`,
    `Checkpoint Log: ${result.checkpointLogPath}`,
  ].join("\n");
}
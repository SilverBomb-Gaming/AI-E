import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { determineGameProgression, type GameProgressionResult } from "./gameProgression";
import {
  applyUnityPatchArtifact,
  generateCameraFollowArtifact,
  type GamePatchPlan,
  type UnityPatchApplyResult,
  type UnityPatchArtifact,
} from "./gameTaskGenerator";
import { inspectGameProject, type GameProjectSnapshot } from "./gameProjectInspector";
import { readExecutionLoopRecords, type ExecutionLoopRecord } from "./executionLoop";
import { inspectUnityPlaytestRecovery, type UnityPlaytestRecoverySnapshot } from "./unityPlaytestRecovery";
import {
  applyUnityCameraWiring,
  inspectUnityCameraWiringStatus,
  type UnitySceneWiringApplyResult,
  type UnitySceneWiringStatus,
} from "./unitySceneWiring";

export type ExecutableAction = {
  type: "patch-script" | "create-script" | "modify-scene";
  description: string;
  targetFile?: string;
  safe: boolean;
};

type ResolvedExecutableAction = ExecutableAction & {
  executorKind: "camera-follow-create-script" | "camera-follow-scene-wiring";
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

export type ActionExecutorDependencies = {
  inspectGameProject: (projectPath: string) => Promise<GameProjectSnapshot>;
  determineGameProgression: (snapshot: GameProjectSnapshot) => Promise<GameProgressionResult>;
  inspectUnityPlaytestRecovery: (projectPath: string) => Promise<UnityPlaytestRecoverySnapshot>;
  inspectUnityCameraWiringStatus: (projectPath: string, recoverySafe: boolean) => Promise<UnitySceneWiringStatus>;
  readExecutionLoopRecords: (projectPath: string) => Promise<ExecutionLoopRecord[]>;
  generateCameraFollowArtifact: (snapshot: GameProjectSnapshot, targetFile?: string) => Promise<UnityPatchArtifact>;
  applyUnityPatchArtifact: (
    artifact: UnityPatchArtifact,
    recoverySafe: boolean,
    recoveryGuidance: string[],
    allowExistingBackup?: boolean,
  ) => Promise<UnityPatchApplyResult>;
  applyUnityCameraWiring: (projectPath: string, recoverySafe: boolean) => Promise<UnitySceneWiringApplyResult>;
  pathExists: (targetPath: string) => Promise<boolean>;
};

const ACTION_DIRECTORY = ".aie";
const ACTION_LOG_FILE = "actions.jsonl";
const CAMERA_FOLLOW_TARGET_FILE = "Assets/Scripts/CameraFollow.cs";

const defaultDependencies: ActionExecutorDependencies = {
  inspectGameProject,
  determineGameProgression,
  inspectUnityPlaytestRecovery,
  inspectUnityCameraWiringStatus,
  readExecutionLoopRecords,
  generateCameraFollowArtifact,
  applyUnityPatchArtifact,
  applyUnityCameraWiring,
  pathExists,
};

function getActionLogPath(projectPath: string): string {
  return path.join(projectPath, ACTION_DIRECTORY, ACTION_LOG_FILE);
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

function buildRecoveryGuidance(snapshot: UnityPlaytestRecoverySnapshot): string[] {
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

function buildFollowupPatchRecoverySignal(snapshot: UnityPlaytestRecoverySnapshot): boolean {
  return snapshot.detectedIssues.accidentalGeneratedFiles.length === 0
    && snapshot.detectedIssues.duplicateClassRisks.length === 0;
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

  if (!isCameraLoopFeature(latestLoop.feature)) {
    return {
      status: "blocked",
      sourceLoopFeature: latestLoop.feature,
      reason: `No validated single-action executor exists yet for loop feature ${latestLoop.feature}.`,
    };
  }

  const snapshot = await dependencies.inspectGameProject(projectPath);
  const progression = await dependencies.determineGameProgression(snapshot);
  if (progression.nextTask.requiredPatchType !== "camera-follow-script") {
    return {
      status: "blocked",
      sourceLoopFeature: latestLoop.feature,
      reason: `Next validated task is ${progression.nextTask.requiredPatchType}; the first action executor only supports camera-follow-script.`,
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

  if (!allowExecution || !plan.action.safe) {
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
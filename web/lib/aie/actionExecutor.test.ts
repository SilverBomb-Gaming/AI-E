import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeNextAutonomousAction, readActionExecutionRecords } from "./actionExecutor";
import type { GameProgressionResult } from "./gameProgression";
import type { GameProjectSnapshot } from "./gameProjectInspector";
import type { ExecutionLoopRecord } from "./executionLoop";
import type { UnityPlaytestRecoverySnapshot } from "./unityPlaytestRecovery";
import type { UnitySceneWiringStatus } from "./unitySceneWiring";

function buildSnapshot(rootPath: string): GameProjectSnapshot {
  return {
    engine: "unity",
    rootPath,
    structure: { scenes: ["Assets/Scenes/EnemyAIDemo.unity"], scripts: ["Assets/Scripts/SimpleKeyboardPlayerMover.cs"], prefabs: [] },
    summary: { sceneCount: 1, scriptCount: 1, prefabCount: 0 },
    analysis: { scriptSignals: { movementScripts: ["Assets/Scripts/SimpleKeyboardPlayerMover.cs"], aiScripts: [], combatScripts: [], cameraScripts: [] } },
    readiness: "logic-present",
    nextStep: "Run playtest in Unity",
    safety: { readOnly: true },
  };
}

function buildProgression(): GameProgressionResult {
  return {
    currentStage: "movement",
    stages: [],
    signals: {
      movementExists: true,
      jumpExists: true,
      playerScriptPresent: true,
      cameraExists: false,
    },
    nextTask: {
      stage: "camera-control",
      title: "Add third-person camera follow system",
      scriptName: "CameraFollow.cs",
      behaviorDescription: "Add camera follow.",
      executionPlan: "create-new-script",
      implementationMode: "create-new-script",
      targetFile: "Assets/Scripts/CameraFollow.cs",
      requiredPatchType: "camera-follow-script",
      reasonBasedOnOutcomes: "test",
      safeImplementationPlan: [],
      safety: {
        noDuplicateSystems: true,
        preferExistingStructure: true,
        guardedPatchWorkflow: true,
        noUnityExecution: true,
      },
    },
  };
}

function buildRecovery(): UnityPlaytestRecoverySnapshot {
  return {
    projectPath: "temp",
    detectedIssues: {
      accidentalGeneratedFiles: [],
      duplicateClassRisks: [],
      missingTrackedMovementScripts: [],
      orphanedBackups: [],
    },
    recommendedActions: [],
    safeToResumePlaytest: true,
    safety: { readOnly: true, noUnityExecution: true },
  };
}

function buildWiringStatus(): UnitySceneWiringStatus {
  return {
    scenePath: "Assets/Scenes/EnemyAIDemo.unity",
    sceneAbsolutePath: "temp/Assets/Scenes/EnemyAIDemo.unity",
    backupPath: "temp/Assets/Scenes/EnemyAIDemo.unity.aie-backup",
    cameraFollowAttached: false,
    cameraFollowComponentVisibleToUnity: false,
    mainCameraComponentListLinked: false,
    monoBehaviourBlockExists: false,
    scriptGuidMatchesMeta: false,
    playerTargetAssigned: false,
    backupExists: false,
    safeToOpenUnityForCompileOrPlaytest: false,
    brokenLinks: [],
    safety: { readOnly: true, noUnityExecution: true },
  };
}

function buildLoopRecord(feature: string): ExecutionLoopRecord {
  return {
    id: "loop-1",
    timestamp: new Date().toISOString(),
    projectPath: "temp",
    feature,
    dryRun: true,
    iterations: 1,
    outcomes: ["fail"],
    adjustmentsUsed: ["Fix runtime errors before retry"],
    finalAction: "stop",
  };
}

test("action executor previews one safe action when execution is not allowed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-preview-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, false, {
      readExecutionLoopRecords: async () => [buildLoopRecord("camera follow")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      pathExists: async () => false,
    });

    assert.equal(result.status, "preview");
    assert.equal(result.action?.type, "create-script");
    assert.match(result.reason, /allow-execution true/i);

    const records = await readActionExecutionRecords(tempRoot);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.result, "preview");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded script creation and logs rollback availability", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-execute-script-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("camera follow")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      pathExists: async () => false,
      generateCameraFollowArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/CameraFollow.cs",
        absoluteTargetPath: path.join(tempRoot, "Assets", "Scripts", "CameraFollow.cs"),
        originalSha256: "missing-file",
        replacementSha256: "replacement",
        replacementCode: "public class CameraFollow {}",
        validationRules: {
          preserveClassName: "CameraFollow",
          preserveNamespace: "EnemyAIDemo",
          forbiddenClassNames: [],
          requireNoDuplicateMethods: true,
        },
        safety: {
          requiresCleanRecoveryState: true,
          createsBackupBeforeApply: true,
          noUnityExecution: true,
        },
      }),
      applyUnityPatchArtifact: async () => ({
        applied: true,
        patchKind: "gameplay-update",
        targetFile: "Assets/Scripts/CameraFollow.cs",
        targetPath: path.join(tempRoot, "Assets", "Scripts", "CameraFollow.cs"),
        backupPath: path.join(tempRoot, "Assets", "Scripts", "CameraFollow.cs.aie-backup"),
        originalSha256: "missing-file",
        replacementSha256: "replacement",
        blockedReasons: [],
        recoveryGuidance: [],
        safety: {
          noUnityExecution: true,
          backupCreated: true,
          targetWritten: true,
        },
      }),
    });

    assert.equal(result.status, "executed");
    assert.equal(result.action?.type, "create-script");
    assert.equal(result.rollbackAvailable, true);
    assert.match(result.backupPath ?? "", /aie-backup/i);

    const rawLog = await readFile(path.join(tempRoot, ".aie", "actions.jsonl"), "utf-8");
    assert.match(rawLog, /"result":"executed"/i);
    assert.match(rawLog, /"rollbackAvailable":true/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded scene mutation when script already exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-execute-scene-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("camera follow")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      pathExists: async () => true,
      applyUnityCameraWiring: async () => ({
        applied: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        backupPath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup"),
        cameraFollowAttached: true,
        targetAssigned: true,
        safeToOpenUnityForCompileOrPlaytest: true,
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupCreated: true,
          sceneWritten: true,
        },
      }),
    });

    assert.equal(result.status, "executed");
    assert.equal(result.action?.type, "modify-scene");
    assert.equal(result.rollbackAvailable, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor blocks unsupported loop features", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-blocked-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("enemy-health")],
    });

    assert.equal(result.status, "blocked");
    assert.match(result.reason, /no validated single-action executor exists yet/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
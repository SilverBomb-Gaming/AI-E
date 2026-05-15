import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeBoundedAutonomousActionChain,
  executeNextAutonomousAction,
  readActionExecutionRecords,
  readAutonomousRollbackCheckpoints,
} from "./actionExecutor";
import type { GameProgressionResult } from "./gameProgression";
import type { GameProjectSnapshot } from "./gameProjectInspector";
import type { ExecutionLoopRecord } from "./executionLoop";
import type { UnityPlaytestRecoverySnapshot } from "./unityPlaytestRecovery";
import type { UnityBasicEnemyStatus, UnityGameLoopStatus, UnityPlayerAttackStatus, UnitySceneWiringStatus } from "./unitySceneWiring";

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

function buildProgression(requiredPatchType: GameProgressionResult["nextTask"]["requiredPatchType"] = "camera-follow-script"): GameProgressionResult {
  const stage = requiredPatchType === "basic-enemy-script"
    ? "basic-enemy"
    : requiredPatchType === "player-attack-script"
      ? "player-attack"
      : requiredPatchType === "game-loop-script"
        ? "game-loop"
      : "camera-control";
  const title = requiredPatchType === "basic-enemy-script"
    ? "Add basic enemy"
    : requiredPatchType === "player-attack-script"
      ? "Add player attack"
      : requiredPatchType === "game-loop-script"
        ? "Add win/lose loop"
      : "Add third-person camera follow system";
  const scriptName = requiredPatchType === "basic-enemy-script"
    ? "BasicEnemy.cs"
    : requiredPatchType === "player-attack-script"
      ? "PlayerAttack.cs"
      : requiredPatchType === "game-loop-script"
        ? "GameLoopController.cs"
      : "CameraFollow.cs";
  const behaviorDescription = requiredPatchType === "basic-enemy-script"
    ? "Add basic enemy."
    : requiredPatchType === "player-attack-script"
      ? "Add player attack."
      : requiredPatchType === "game-loop-script"
        ? "Add a minimal win/lose loop."
      : "Add camera follow.";
  const targetFile = requiredPatchType === "basic-enemy-script"
    ? "Assets/Scripts/BasicEnemy.cs"
    : requiredPatchType === "player-attack-script"
      ? "Assets/Scripts/PlayerAttack.cs"
      : requiredPatchType === "game-loop-script"
        ? "Assets/Scripts/GameLoopController.cs"
      : "Assets/Scripts/CameraFollow.cs";

  return {
    currentStage: "movement",
    stages: [],
    signals: {
      movementExists: true,
      jumpExists: true,
      playerScriptPresent: true,
      cameraExists: false,
      basicEnemyReady: false,
      playerAttackReady: false,
      gameLoopReady: false,
    },
    nextTask: {
      stage,
      title,
      scriptName,
      behaviorDescription,
      executionPlan: "create-new-script",
      implementationMode: "create-new-script",
      targetFile,
      requiredPatchType,
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

function buildBasicEnemyStatus(): UnityBasicEnemyStatus {
  return {
    scenePath: "Assets/Scenes/EnemyAIDemo.unity",
    sceneAbsolutePath: "temp/Assets/Scenes/EnemyAIDemo.unity",
    enemyName: null,
    basicEnemyScriptExists: false,
    enemyExists: false,
    scriptAttached: false,
    positionedOnGround: false,
    backupExists: false,
    safeToOpenUnityForCompileOrPlaytest: false,
    details: [],
    safety: { readOnly: true, noUnityExecution: true },
  };
}

function buildPlayerAttackStatus(): UnityPlayerAttackStatus {
  return {
    scenePath: "Assets/Scenes/EnemyAIDemo.unity",
    sceneAbsolutePath: "temp/Assets/Scenes/EnemyAIDemo.unity",
    playerName: "Player",
    enemyName: "Enemy",
    playerAttackScriptExists: false,
    playerAttackAttached: false,
    attackKeyConfigured: false,
    backupExists: false,
    safeToOpenUnityForCompileOrPlaytest: false,
    details: [],
    safety: { readOnly: true, noUnityExecution: true },
  };
}

function buildGameLoopStatus(): UnityGameLoopStatus {
  return {
    scenePath: "Assets/Scenes/EnemyAIDemo.unity",
    sceneAbsolutePath: "temp/Assets/Scenes/EnemyAIDemo.unity",
    gameLoopName: null,
    winMessageName: null,
    gameLoopScriptExists: false,
    gameLoopMetaExists: false,
    basicEnemyScriptExists: true,
    basicEnemyMetaExists: true,
    gameLoopAttached: false,
    winFeedbackPresent: false,
    enemyDefeatConnected: false,
    backupExists: false,
    safeToOpenUnityForCompileOrPlaytest: false,
    details: [],
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
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
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
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
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
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
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

test("action executor previews one safe basic enemy script action when execution is not allowed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-basic-enemy-preview-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, false, {
      readExecutionLoopRecords: async () => [buildLoopRecord("basic-enemy")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("basic-enemy-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => false,
    });

    assert.equal(result.status, "preview");
    assert.equal(result.action?.type, "create-script");
    assert.match(result.action?.targetFile ?? "", /BasicEnemy\.cs/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded basic enemy script creation and logs rollback availability", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-basic-enemy-script-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("basic-enemy")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("basic-enemy-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => false,
      generateBasicEnemyScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/BasicEnemy.cs",
        absoluteTargetPath: path.join(tempRoot, "Assets", "Scripts", "BasicEnemy.cs"),
        originalSha256: "missing-file",
        replacementSha256: "replacement",
        replacementCode: "public class BasicEnemy {}",
        validationRules: {
          preserveClassName: "BasicEnemy",
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
        targetFile: "Assets/Scripts/BasicEnemy.cs",
        targetPath: path.join(tempRoot, "Assets", "Scripts", "BasicEnemy.cs"),
        backupPath: path.join(tempRoot, "Assets", "Scripts", "BasicEnemy.cs.aie-backup"),
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
    assert.match(result.backupPath ?? "", /BasicEnemy\.cs\.aie-backup/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded basic enemy scene mutation when script already exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-basic-enemy-scene-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("basic-enemy")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("basic-enemy-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => true,
      applyUnityBasicEnemy: async () => ({
        applied: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        enemyName: "Enemy",
        scriptPath: "Assets/Scripts/BasicEnemy.cs",
        backupPath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-basic-enemy"),
        basicEnemyScriptExists: true,
        enemyExists: true,
        scriptAttached: true,
        positionedOnGround: true,
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

test("action executor previews one safe player attack script action when execution is not allowed", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-player-attack-preview-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, false, {
      readExecutionLoopRecords: async () => [buildLoopRecord("player-attack")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("player-attack-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => false,
    });

    assert.equal(result.status, "preview");
    assert.equal(result.action?.type, "create-script");
    assert.match(result.action?.targetFile ?? "", /PlayerAttack\.cs/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded player attack script creation and logs rollback availability", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-player-attack-script-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("player-attack")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("player-attack-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => false,
      generatePlayerAttackScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/PlayerAttack.cs",
        absoluteTargetPath: path.join(tempRoot, "Assets", "Scripts", "PlayerAttack.cs"),
        originalSha256: "missing-file",
        replacementSha256: "replacement",
        replacementCode: "public class PlayerAttack {}",
        validationRules: {
          preserveClassName: "PlayerAttack",
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
        targetFile: "Assets/Scripts/PlayerAttack.cs",
        targetPath: path.join(tempRoot, "Assets", "Scripts", "PlayerAttack.cs"),
        backupPath: path.join(tempRoot, "Assets", "Scripts", "PlayerAttack.cs.aie-backup"),
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
    assert.match(result.backupPath ?? "", /PlayerAttack\.cs\.aie-backup/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded player attack scene mutation when script already exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-player-attack-scene-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("player-attack")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("player-attack-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => true,
      applyUnityPlayerAttack: async () => ({
        applied: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        playerName: "Player",
        enemyName: "Enemy",
        scriptPath: "Assets/Scripts/PlayerAttack.cs",
        backupPath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-player-attack"),
        playerAttackScriptExists: true,
        playerAttackAttached: true,
        attackKeyConfigured: true,
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

test("action executor executes one guarded game loop script creation and logs rollback availability", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-game-loop-script-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("game-loop")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("game-loop-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityGameLoopStatus: async () => buildGameLoopStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => false,
      generateGameLoopArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/GameLoopController.cs",
        absoluteTargetPath: path.join(tempRoot, "Assets", "Scripts", "GameLoopController.cs"),
        originalSha256: "missing-file",
        replacementSha256: "replacement",
        replacementCode: "public class GameLoopController {}",
        validationRules: {
          preserveClassName: "GameLoopController",
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
        targetFile: "Assets/Scripts/GameLoopController.cs",
        targetPath: path.join(tempRoot, "Assets", "Scripts", "GameLoopController.cs"),
        backupPath: path.join(tempRoot, "Assets", "Scripts", "GameLoopController.cs.aie-backup"),
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
    assert.match(result.backupPath ?? "", /GameLoopController\.cs\.aie-backup/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes one guarded game loop scene mutation when script already exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-game-loop-scene-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("game-loop")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression("game-loop-script"),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityGameLoopStatus: async () => ({
        ...buildGameLoopStatus(),
        gameLoopScriptExists: true,
        gameLoopMetaExists: true,
        basicEnemyScriptExists: true,
        basicEnemyMetaExists: true,
      }),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
      pathExists: async () => true,
      applyUnityGameLoopWiring: async () => ({
        applied: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        gameLoopName: "AIE_GameLoop",
        winMessageName: "AIE_WinMessage",
        scriptPath: "Assets/Scripts/GameLoopController.cs",
        backupPath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-game-loop-wiring"),
        gameLoopScriptExists: true,
        gameLoopAttached: true,
        winFeedbackPresent: true,
        enemyDefeatConnected: true,
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
    assert.equal(result.action?.executorKind, "game-loop-scene-wiring");
    assert.equal(result.rollbackAvailable, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor executes the full six-step basic-enemy to game-loop chain in order", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-full-chain-"));
  const basicEnemyScriptPath = path.join(tempRoot, "Assets", "Scripts", "BasicEnemy.cs");
  const gameLoopScriptPath = path.join(tempRoot, "Assets", "Scripts", "GameLoopController.cs");
  const playerAttackScriptPath = path.join(tempRoot, "Assets", "Scripts", "PlayerAttack.cs");
  const basicEnemySceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-basic-enemy");
  const gameLoopSceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-game-loop-wiring");
  const playerAttackSceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-player-attack");
  const state = {
    loopFeature: "basic-enemy",
    basicEnemyScriptExists: false,
    basicEnemyMetaExists: false,
    basicEnemyAttached: false,
    gameLoopScriptExists: false,
    gameLoopMetaExists: false,
    gameLoopAttached: false,
    gameLoopWinFeedbackPresent: false,
    gameLoopEnemyDefeatConnected: false,
    playerAttackScriptExists: false,
    playerAttackMetaExists: false,
    playerAttackAttached: false,
  };

  const buildDynamicProgression = (): GameProgressionResult => {
    if (!state.basicEnemyAttached) {
      return {
        ...buildProgression("basic-enemy-script"),
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: false,
          playerAttackReady: false,
          gameLoopReady: false,
        },
      };
    }

    if (!state.playerAttackAttached) {
      return {
        ...buildProgression("player-attack-script"),
        currentStage: "basic-enemy",
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: true,
          playerAttackReady: false,
          gameLoopReady: false,
        },
      };
    }

    if (!state.gameLoopAttached) {
      return {
        currentStage: "player-attack",
        stages: [],
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: true,
          playerAttackReady: true,
          gameLoopReady: false,
        },
        nextTask: {
          stage: "game-loop",
          title: "Add win/lose loop",
          scriptName: "GameLoopController.cs",
          behaviorDescription: "Add a minimal win/lose loop.",
          executionPlan: "create-new-script",
          implementationMode: "create-new-script",
          targetFile: "Assets/Scripts/GameLoopController.cs",
          requiredPatchType: "game-loop-script",
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

    return {
      currentStage: "player-attack",
      stages: [],
      signals: {
        movementExists: true,
        jumpExists: true,
        playerScriptPresent: true,
        cameraExists: true,
        basicEnemyReady: true,
        playerAttackReady: true,
        gameLoopReady: false,
      },
      nextTask: {
        stage: "game-loop",
        title: "Add win/lose loop",
        scriptName: "GameLoopController.cs",
        behaviorDescription: "Add a minimal win/lose loop.",
        executionPlan: "create-new-script",
        implementationMode: "create-new-script",
        targetFile: "Assets/Scripts/GameLoopController.cs",
        requiredPatchType: "game-loop-script",
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
  };

  try {
    const dependencies = {
      readExecutionLoopRecords: async () => [buildLoopRecord(state.loopFeature)],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildDynamicProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => ({
        ...buildBasicEnemyStatus(),
        enemyName: "Enemy",
        basicEnemyScriptExists: state.basicEnemyScriptExists,
        enemyExists: true,
        scriptAttached: state.basicEnemyAttached,
        positionedOnGround: true,
        backupExists: state.basicEnemyAttached,
        safeToOpenUnityForCompileOrPlaytest: state.basicEnemyAttached,
      }),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityGameLoopStatus: async () => ({
        ...buildGameLoopStatus(),
        gameLoopScriptExists: state.gameLoopScriptExists,
        gameLoopMetaExists: state.gameLoopMetaExists,
        gameLoopAttached: state.gameLoopAttached,
        winFeedbackPresent: state.gameLoopWinFeedbackPresent,
        enemyDefeatConnected: state.gameLoopEnemyDefeatConnected,
        backupExists: state.gameLoopAttached,
        safeToOpenUnityForCompileOrPlaytest: state.gameLoopAttached,
      }),
      inspectUnityPlayerAttackStatus: async () => ({
        ...buildPlayerAttackStatus(),
        playerName: "Player",
        enemyName: "Enemy",
        playerAttackScriptExists: state.playerAttackScriptExists,
        playerAttackAttached: state.playerAttackAttached,
        attackKeyConfigured: true,
        backupExists: state.playerAttackAttached,
        safeToOpenUnityForCompileOrPlaytest: state.playerAttackAttached,
      }),
      pathExists: async (targetPath: string) => {
        if (targetPath === basicEnemyScriptPath) {
          return state.basicEnemyScriptExists;
        }
        if (targetPath === `${basicEnemyScriptPath}.meta`) {
          return state.basicEnemyMetaExists;
        }
        if (targetPath === playerAttackScriptPath) {
          return state.playerAttackScriptExists;
        }
        if (targetPath === `${playerAttackScriptPath}.meta`) {
          return state.playerAttackMetaExists;
        }
        if (targetPath === gameLoopScriptPath) {
          return state.gameLoopScriptExists;
        }
        if (targetPath === `${gameLoopScriptPath}.meta`) {
          return state.gameLoopMetaExists;
        }
        return false;
      },
      generateBasicEnemyScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/BasicEnemy.cs",
        absoluteTargetPath: basicEnemyScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-basic-enemy",
        replacementCode: "public class BasicEnemy {}",
        validationRules: {
          preserveClassName: "BasicEnemy",
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
      generatePlayerAttackScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/PlayerAttack.cs",
        absoluteTargetPath: playerAttackScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-player-attack",
        replacementCode: "public class PlayerAttack {}",
        validationRules: {
          preserveClassName: "PlayerAttack",
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
      generateGameLoopArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/GameLoopController.cs",
        absoluteTargetPath: gameLoopScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-game-loop",
        replacementCode: "public class GameLoopController {}",
        validationRules: {
          preserveClassName: "GameLoopController",
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
      applyUnityPatchArtifact: async (artifact) => {
        if (artifact.targetFile.endsWith("BasicEnemy.cs")) {
          state.basicEnemyScriptExists = true;
          state.basicEnemyMetaExists = true;
          return {
            applied: true,
            patchKind: artifact.patchKind,
            targetFile: artifact.targetFile,
            targetPath: artifact.absoluteTargetPath,
            backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
            originalSha256: artifact.originalSha256,
            replacementSha256: artifact.replacementSha256,
            blockedReasons: [],
            recoveryGuidance: [],
            safety: {
              noUnityExecution: true,
              backupCreated: true,
              targetWritten: true,
            },
          };
        }

        if (artifact.targetFile.endsWith("GameLoopController.cs")) {
          state.gameLoopScriptExists = true;
          state.gameLoopMetaExists = true;
          return {
            applied: true,
            patchKind: artifact.patchKind,
            targetFile: artifact.targetFile,
            targetPath: artifact.absoluteTargetPath,
            backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
            originalSha256: artifact.originalSha256,
            replacementSha256: artifact.replacementSha256,
            blockedReasons: [],
            recoveryGuidance: [],
            safety: {
              noUnityExecution: true,
              backupCreated: true,
              targetWritten: true,
            },
          };
        }

        state.playerAttackScriptExists = true;
        state.playerAttackMetaExists = true;
        return {
          applied: true,
          patchKind: artifact.patchKind,
          targetFile: artifact.targetFile,
          targetPath: artifact.absoluteTargetPath,
          backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
          originalSha256: artifact.originalSha256,
          replacementSha256: artifact.replacementSha256,
          blockedReasons: [],
          recoveryGuidance: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            targetWritten: true,
          },
        };
      },
      applyUnityBasicEnemy: async () => {
        state.basicEnemyAttached = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          enemyName: "Enemy",
          scriptPath: "Assets/Scripts/BasicEnemy.cs",
          backupPath: basicEnemySceneBackupPath,
          basicEnemyScriptExists: true,
          enemyExists: true,
          scriptAttached: true,
          positionedOnGround: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
      applyUnityPlayerAttack: async () => {
        state.playerAttackAttached = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          playerName: "Player",
          enemyName: "Enemy",
          scriptPath: "Assets/Scripts/PlayerAttack.cs",
          backupPath: playerAttackSceneBackupPath,
          playerAttackScriptExists: true,
          playerAttackAttached: true,
          attackKeyConfigured: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
      applyUnityGameLoopWiring: async () => {
        state.gameLoopAttached = true;
        state.gameLoopWinFeedbackPresent = true;
        state.gameLoopEnemyDefeatConnected = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          gameLoopName: "AIE_GameLoop",
          winMessageName: "AIE_WinMessage",
          scriptPath: "Assets/Scripts/GameLoopController.cs",
          backupPath: gameLoopSceneBackupPath,
          gameLoopScriptExists: true,
          gameLoopAttached: true,
          winFeedbackPresent: true,
          enemyDefeatConnected: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
    };

    const step1 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step1.status, "executed");
    assert.equal(step1.action?.executorKind, "basic-enemy-create-script");

    const step2 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step2.status, "executed");
    assert.equal(step2.action?.executorKind, "basic-enemy-scene-placement");

    state.loopFeature = "player-attack";

    const step3 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step3.status, "executed");
    assert.equal(step3.action?.executorKind, "player-attack-create-script");

    const step4 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step4.status, "executed");
    assert.equal(step4.action?.executorKind, "player-attack-scene-placement");

    state.loopFeature = "game-loop";

    const step5 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step5.status, "executed");
    assert.equal(step5.action?.executorKind, "game-loop-create-script");

    const step6 = await executeNextAutonomousAction(tempRoot, true, dependencies);
    assert.equal(step6.status, "executed");
    assert.equal(step6.action?.executorKind, "game-loop-scene-wiring");

    const records = await readActionExecutionRecords(tempRoot);
    assert.deepEqual(
      records.map((record) => record.action?.executorKind),
      [
        "basic-enemy-create-script",
        "basic-enemy-scene-placement",
        "player-attack-create-script",
        "player-attack-scene-placement",
        "game-loop-create-script",
        "game-loop-scene-wiring",
      ],
    );
    assert.deepEqual(
      records.map((record) => record.sourceLoopFeature),
      ["basic-enemy", "basic-enemy", "player-attack", "player-attack", "game-loop", "game-loop"],
    );
    assert.ok(records.every((record) => record.result === "executed"));
    assert.equal(state.basicEnemyAttached, true);
    assert.equal(state.playerAttackAttached, true);
    assert.equal(state.gameLoopScriptExists, true);
    assert.equal(state.gameLoopAttached, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("bounded autonomous action chain records rollback checkpoints between every executed step", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-bounded-action-chain-"));
  const basicEnemyScriptPath = path.join(tempRoot, "Assets", "Scripts", "BasicEnemy.cs");
  const gameLoopScriptPath = path.join(tempRoot, "Assets", "Scripts", "GameLoopController.cs");
  const playerAttackScriptPath = path.join(tempRoot, "Assets", "Scripts", "PlayerAttack.cs");
  const basicEnemySceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-basic-enemy");
  const gameLoopSceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-game-loop-wiring");
  const playerAttackSceneBackupPath = path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-player-attack");
  const loopLogPath = path.join(tempRoot, ".aie", "loops.jsonl");
  const state = {
    loopFeature: "basic-enemy",
    basicEnemyScriptExists: false,
    basicEnemyMetaExists: false,
    basicEnemyAttached: false,
    gameLoopScriptExists: false,
    gameLoopMetaExists: false,
    gameLoopAttached: false,
    gameLoopWinFeedbackPresent: false,
    gameLoopEnemyDefeatConnected: false,
    playerAttackScriptExists: false,
    playerAttackMetaExists: false,
    playerAttackAttached: false,
  };

  const buildDynamicProgression = (): GameProgressionResult => {
    if (!state.basicEnemyAttached) {
      return {
        ...buildProgression("basic-enemy-script"),
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: false,
          playerAttackReady: false,
          gameLoopReady: false,
        },
      };
    }

    if (!state.playerAttackAttached) {
      return {
        ...buildProgression("player-attack-script"),
        currentStage: "basic-enemy",
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: true,
          playerAttackReady: false,
          gameLoopReady: false,
        },
      };
    }

    if (!state.gameLoopAttached) {
      return {
        currentStage: "player-attack",
        stages: [],
        signals: {
          movementExists: true,
          jumpExists: true,
          playerScriptPresent: true,
          cameraExists: true,
          basicEnemyReady: true,
          playerAttackReady: true,
          gameLoopReady: false,
        },
        nextTask: {
          stage: "game-loop",
          title: "Add win/lose loop",
          scriptName: "GameLoopController.cs",
          behaviorDescription: "Add a minimal win/lose loop.",
          executionPlan: "create-new-script",
          implementationMode: "create-new-script",
          targetFile: "Assets/Scripts/GameLoopController.cs",
          requiredPatchType: "game-loop-script",
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

    return {
      currentStage: "player-attack",
      stages: [],
      signals: {
        movementExists: true,
        jumpExists: true,
        playerScriptPresent: true,
        cameraExists: true,
        basicEnemyReady: true,
        playerAttackReady: true,
        gameLoopReady: false,
      },
      nextTask: {
        stage: "game-loop",
        title: "Add win/lose loop",
        scriptName: "GameLoopController.cs",
        behaviorDescription: "Add a minimal win/lose loop.",
        executionPlan: "create-new-script",
        implementationMode: "create-new-script",
        targetFile: "Assets/Scripts/GameLoopController.cs",
        requiredPatchType: "game-loop-script",
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
  };

  try {
    const dependencies = {
      readExecutionLoopRecords: async () => [buildLoopRecord(state.loopFeature)],
      runAutonomousExecutionLoop: async (projectPath: string, feature?: string) => {
        state.loopFeature = feature ?? state.loopFeature;
        return {
          status: "completed" as const,
          projectPath,
          feature: state.loopFeature,
          dryRun: true,
          state: {
            feature: state.loopFeature,
          iteration: 1,
          maxIterations: 3,
          lastResult: "pass",
          active: false,
          },
          iterations: [
            {
              iteration: 1,
              result: "pass",
              action: "stop" as const,
              reason: "test",
              simulated: false,
            },
          ],
          logPath: loopLogPath,
        };
      },
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildDynamicProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => ({
        ...buildBasicEnemyStatus(),
        enemyName: "Enemy",
        basicEnemyScriptExists: state.basicEnemyScriptExists,
        enemyExists: true,
        scriptAttached: state.basicEnemyAttached,
        positionedOnGround: true,
        backupExists: state.basicEnemyAttached,
        safeToOpenUnityForCompileOrPlaytest: state.basicEnemyAttached,
      }),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityGameLoopStatus: async () => ({
        ...buildGameLoopStatus(),
        gameLoopScriptExists: state.gameLoopScriptExists,
        gameLoopMetaExists: state.gameLoopMetaExists,
        gameLoopAttached: state.gameLoopAttached,
        winFeedbackPresent: state.gameLoopWinFeedbackPresent,
        enemyDefeatConnected: state.gameLoopEnemyDefeatConnected,
        backupExists: state.gameLoopAttached,
        safeToOpenUnityForCompileOrPlaytest: state.gameLoopAttached,
      }),
      inspectUnityPlayerAttackStatus: async () => ({
        ...buildPlayerAttackStatus(),
        playerName: "Player",
        enemyName: "Enemy",
        playerAttackScriptExists: state.playerAttackScriptExists,
        playerAttackAttached: state.playerAttackAttached,
        attackKeyConfigured: true,
        backupExists: state.playerAttackAttached,
        safeToOpenUnityForCompileOrPlaytest: state.playerAttackAttached,
      }),
      pathExists: async (targetPath: string) => {
        if (targetPath === basicEnemyScriptPath) {
          return state.basicEnemyScriptExists;
        }
        if (targetPath === `${basicEnemyScriptPath}.meta`) {
          return state.basicEnemyMetaExists;
        }
        if (targetPath === playerAttackScriptPath) {
          return state.playerAttackScriptExists;
        }
        if (targetPath === `${playerAttackScriptPath}.meta`) {
          return state.playerAttackMetaExists;
        }
        if (targetPath === gameLoopScriptPath) {
          return state.gameLoopScriptExists;
        }
        if (targetPath === `${gameLoopScriptPath}.meta`) {
          return state.gameLoopMetaExists;
        }
        return false;
      },
      generateBasicEnemyScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/BasicEnemy.cs",
        absoluteTargetPath: basicEnemyScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-basic-enemy",
        replacementCode: "public class BasicEnemy {}",
        validationRules: {
          preserveClassName: "BasicEnemy",
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
      generatePlayerAttackScriptArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/PlayerAttack.cs",
        absoluteTargetPath: playerAttackScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-player-attack",
        replacementCode: "public class PlayerAttack {}",
        validationRules: {
          preserveClassName: "PlayerAttack",
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
      generateGameLoopArtifact: async () => ({
        patchKind: "gameplay-update",
        operation: "create-new-script",
        targetFile: "Assets/Scripts/GameLoopController.cs",
        absoluteTargetPath: gameLoopScriptPath,
        originalSha256: "missing-file",
        replacementSha256: "replacement-game-loop",
        replacementCode: "public class GameLoopController {}",
        validationRules: {
          preserveClassName: "GameLoopController",
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
      applyUnityPatchArtifact: async (artifact) => {
        if (artifact.targetFile.endsWith("BasicEnemy.cs")) {
          state.basicEnemyScriptExists = true;
          state.basicEnemyMetaExists = true;
          return {
            applied: true,
            patchKind: artifact.patchKind,
            targetFile: artifact.targetFile,
            targetPath: artifact.absoluteTargetPath,
            backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
            originalSha256: artifact.originalSha256,
            replacementSha256: artifact.replacementSha256,
            blockedReasons: [],
            recoveryGuidance: [],
            safety: {
              noUnityExecution: true,
              backupCreated: true,
              targetWritten: true,
            },
          };
        }

        if (artifact.targetFile.endsWith("GameLoopController.cs")) {
          state.gameLoopScriptExists = true;
          state.gameLoopMetaExists = true;
          return {
            applied: true,
            patchKind: artifact.patchKind,
            targetFile: artifact.targetFile,
            targetPath: artifact.absoluteTargetPath,
            backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
            originalSha256: artifact.originalSha256,
            replacementSha256: artifact.replacementSha256,
            blockedReasons: [],
            recoveryGuidance: [],
            safety: {
              noUnityExecution: true,
              backupCreated: true,
              targetWritten: true,
            },
          };
        }

        state.playerAttackScriptExists = true;
        state.playerAttackMetaExists = true;
        return {
          applied: true,
          patchKind: artifact.patchKind,
          targetFile: artifact.targetFile,
          targetPath: artifact.absoluteTargetPath,
          backupPath: `${artifact.absoluteTargetPath}.aie-backup`,
          originalSha256: artifact.originalSha256,
          replacementSha256: artifact.replacementSha256,
          blockedReasons: [],
          recoveryGuidance: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            targetWritten: true,
          },
        };
      },
      applyUnityBasicEnemy: async () => {
        state.basicEnemyAttached = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          enemyName: "Enemy",
          scriptPath: "Assets/Scripts/BasicEnemy.cs",
          backupPath: basicEnemySceneBackupPath,
          basicEnemyScriptExists: true,
          enemyExists: true,
          scriptAttached: true,
          positionedOnGround: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
      applyUnityPlayerAttack: async () => {
        state.playerAttackAttached = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          playerName: "Player",
          enemyName: "Enemy",
          scriptPath: "Assets/Scripts/PlayerAttack.cs",
          backupPath: playerAttackSceneBackupPath,
          playerAttackScriptExists: true,
          playerAttackAttached: true,
          attackKeyConfigured: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
      applyUnityGameLoopWiring: async () => {
        state.gameLoopAttached = true;
        state.gameLoopWinFeedbackPresent = true;
        state.gameLoopEnemyDefeatConnected = true;
        return {
          applied: true,
          scenePath: "Assets/Scenes/EnemyAIDemo.unity",
          sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
          gameLoopName: "AIE_GameLoop",
          winMessageName: "AIE_WinMessage",
          scriptPath: "Assets/Scripts/GameLoopController.cs",
          backupPath: gameLoopSceneBackupPath,
          gameLoopScriptExists: true,
          gameLoopAttached: true,
          winFeedbackPresent: true,
          enemyDefeatConnected: true,
          safeToOpenUnityForCompileOrPlaytest: true,
          blockedReasons: [],
          safety: {
            noUnityExecution: true,
            backupCreated: true,
            sceneWritten: true,
          },
        };
      },
      rollbackUnityPatchArtifact: async () => ({
        restored: true,
        targetFile: "Assets/Scripts/PlayerAttack.cs",
        targetPath: playerAttackScriptPath,
        backupPath: `${playerAttackScriptPath}.aie-backup`,
        restoredSha256: "restored",
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupRetained: true,
        },
      }),
      rollbackUnityBasicEnemy: async () => ({
        restored: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        enemyName: "Enemy",
        scriptPath: "Assets/Scripts/BasicEnemy.cs",
        backupPath: basicEnemySceneBackupPath,
        basicEnemyScriptExists: true,
        enemyExists: true,
        scriptAttached: false,
        positionedOnGround: true,
        safeToOpenUnityForCompileOrPlaytest: false,
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupRetained: true,
          scriptRemoved: false,
        },
      }),
      rollbackUnityCameraWiring: async () => ({
        restored: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        backupPath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity.aie-backup-camera"),
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupRetained: true,
        },
      }),
      rollbackUnityPlayerAttack: async () => ({
        restored: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        playerName: "Player",
        enemyName: "Enemy",
        scriptPath: "Assets/Scripts/PlayerAttack.cs",
        backupPath: playerAttackSceneBackupPath,
        playerAttackScriptExists: true,
        playerAttackAttached: false,
        attackKeyConfigured: true,
        safeToOpenUnityForCompileOrPlaytest: false,
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupRetained: true,
          scriptRemoved: false,
        },
      }),
      rollbackUnityGameLoopWiring: async () => ({
        restored: true,
        scenePath: "Assets/Scenes/EnemyAIDemo.unity",
        sceneAbsolutePath: path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"),
        gameLoopName: "AIE_GameLoop",
        winMessageName: "AIE_WinMessage",
        scriptPath: "Assets/Scripts/GameLoopController.cs",
        backupPath: gameLoopSceneBackupPath,
        gameLoopScriptExists: true,
        gameLoopAttached: false,
        winFeedbackPresent: false,
        enemyDefeatConnected: false,
        safeToOpenUnityForCompileOrPlaytest: false,
        blockedReasons: [],
        safety: {
          noUnityExecution: true,
          backupRetained: true,
          scriptRemoved: false,
        },
      }),
    };

    const result = await executeBoundedAutonomousActionChain(tempRoot, 6, true, undefined, dependencies);
    assert.equal(result.status, "completed");
    assert.equal(result.executedSteps, 6);
    assert.equal(result.results.length, 6);
    assert.deepEqual(
      result.checkpoints.map((checkpoint) => checkpoint.rollbackKind),
      [
        "unity-patch-artifact",
        "basic-enemy-scene",
        "unity-patch-artifact",
        "player-attack-scene",
        "unity-patch-artifact",
        "game-loop-scene",
      ],
    );
    assert.ok(result.checkpoints.every((checkpoint) => checkpoint.checkpointReady));
    assert.ok(result.checkpoints.every((checkpoint) => /--rollback-autonomous-checkpoint/i.test(checkpoint.rollbackCommand)));

    const checkpointRecords = await readAutonomousRollbackCheckpoints(tempRoot);
    assert.equal(checkpointRecords.length, 6);
    assert.deepEqual(
      checkpointRecords.map((checkpoint) => checkpoint.targetFile),
      [
        "Assets/Scripts/BasicEnemy.cs",
        "Assets/Scenes/EnemyAIDemo.unity",
        "Assets/Scripts/PlayerAttack.cs",
        "Assets/Scenes/EnemyAIDemo.unity",
        "Assets/Scripts/GameLoopController.cs",
        "Assets/Scenes/EnemyAIDemo.unity",
      ],
    );
    assert.ok(checkpointRecords.every((checkpoint) => checkpoint.rollbackCommand.length > 0));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("action executor blocks unsupported loop features", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-action-executor-blocked-"));

  try {
    const result = await executeNextAutonomousAction(tempRoot, true, {
      readExecutionLoopRecords: async () => [buildLoopRecord("enemy-health")],
      inspectGameProject: async () => buildSnapshot(tempRoot),
      determineGameProgression: async () => buildProgression(),
      inspectUnityPlaytestRecovery: async () => buildRecovery(),
      inspectUnityBasicEnemyStatus: async () => buildBasicEnemyStatus(),
      inspectUnityCameraWiringStatus: async () => buildWiringStatus(),
      inspectUnityPlayerAttackStatus: async () => buildPlayerAttackStatus(),
    });

    assert.equal(result.status, "blocked");
    assert.match(result.reason, /does not map to camera-follow-script execution|no validated single-action executor exists yet/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
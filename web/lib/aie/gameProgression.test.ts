import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectGameProject, type GameProjectSnapshot } from "./gameProjectInspector";
import { determineGameProgression } from "./gameProgression";
import { recordOutcome } from "./outcomeLearning";
import { applyUnityGameLoopWiring } from "./unitySceneWiring";

async function createSnapshot(rootPath: string): Promise<GameProjectSnapshot> {
  const scriptsDirectory = path.join(rootPath, "Assets", "Scripts");
  await mkdir(scriptsDirectory, { recursive: true });
  await mkdir(path.join(rootPath, "ProjectSettings"), { recursive: true });
  await mkdir(path.join(rootPath, "Packages"), { recursive: true });

  await writeFile(path.join(scriptsDirectory, "SimpleKeyboardPlayerMover.cs"), [
    "using UnityEngine;",
    "public class SimpleKeyboardPlayerMover : MonoBehaviour",
    "{",
    "    public float jumpHeight = 2f;",
    "    private bool jumpRequested;",
    "    private float gravity = -9.81f;",
    "    private void Update()",
    "    {",
    "        if (Input.GetKeyDown(KeyCode.Space))",
    "        {",
    "            jumpRequested = true;",
    "        }",
    "        float jumpVelocity = Mathf.Sqrt(jumpHeight * -2f * gravity);",
    "    }",
    "}",
    "",
  ].join("\n"), "utf-8");

  return {
    engine: "unity",
    rootPath,
    structure: {
      scenes: ["Assets/Scenes/EnemyAIDemo.unity"],
      scripts: ["Assets/Scripts/SimpleKeyboardPlayerMover.cs"],
      prefabs: [],
    },
    summary: {
      sceneCount: 1,
      scriptCount: 1,
      prefabCount: 0,
    },
    analysis: {
      scriptSignals: {
        movementScripts: ["Assets/Scripts/SimpleKeyboardPlayerMover.cs"],
        aiScripts: [],
        combatScripts: [],
        cameraScripts: ["Assets/Scripts/CameraFollow.cs"],
      },
    },
    readiness: "ready",
    nextStep: "next",
    safety: {
      readOnly: true,
    },
  };
}

test("game progression includes outcome-based reason for the next task", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-game-progression-"));

  try {
    const snapshot = await createSnapshot(tempRoot);
    await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "fail",
      observation: "Manual note said the enemy flash was hard to see.",
    });
    await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "pass",
      observation: "Mouse0 and E both hit; enemy flashes red and pulses visibly.",
      evaluationSource: "runtime-auto",
    });

    const progression = await determineGameProgression(snapshot);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /stored outcomes/i);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /Using latest runtime-auto outcome for decision context\./i);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /auto-detected pass/i);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /attack-feedback/i);
    assert.match(progression.nextTask.safeImplementationPlan[0], /runtime-auto outcome/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("game progression includes retry reasoning for failed outcomes", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-game-progression-retry-"));

  try {
    const snapshot = await createSnapshot(tempRoot);
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "NullReferenceException during enemy health update.",
      evaluationSource: "runtime-auto",
      errors: ["NullReferenceException"],
    });

    const progression = await determineGameProgression(snapshot);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /Previous attempt failed/i);
    assert.match(progression.nextTask.reasonBasedOnOutcomes, /retrying with Fix runtime errors before retry/i);
    assert.match(progression.nextTask.safeImplementationPlan.join("\n"), /Retry guidance: Fix runtime errors before retry\./i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("game progression advances to game-loop when Unity fixture already has basic enemy and player attack complete", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-game-progression-unity-fixture-"));
  const fixtureRoot = path.resolve(process.cwd(), "..", "orchestrator_lane", "Tools", "EnemyAIDemoStandalone");
  const projectCopyPath = path.join(tempRoot, "EnemyAIDemoStandalone");

  try {
    await cp(fixtureRoot, projectCopyPath, { recursive: true });
    const snapshot = await inspectGameProject(projectCopyPath);
    const progression = await determineGameProgression(snapshot);

    assert.equal(progression.signals.basicEnemyReady, true);
    assert.equal(progression.signals.playerAttackReady, true);
    assert.equal(progression.currentStage, "player-attack");
    assert.equal(progression.nextTask.requiredPatchType, "game-loop-script");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("game progression marks game-loop complete when GameLoopController is fully wired", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-game-progression-game-loop-ready-"));
  const fixtureRoot = path.resolve(process.cwd(), "..", "orchestrator_lane", "Tools", "EnemyAIDemoStandalone");
  const projectCopyPath = path.join(tempRoot, "EnemyAIDemoStandalone");

  try {
    await cp(fixtureRoot, projectCopyPath, { recursive: true });
    await writeFile(path.join(projectCopyPath, "Assets", "Scripts", "GameLoopController.cs"), [
      "using UnityEngine;",
      "using UnityEngine.SceneManagement;",
      "namespace EnemyAIDemo",
      "{",
      "    public sealed class GameLoopController : MonoBehaviour",
      "    {",
      "        public void RegisterWin(string reason = \"win\") { }",
      "        public void RegisterLoss(string reason = \"lose\") { }",
      "        public void RestartLevel()",
      "        {",
      "            SceneManager.LoadScene(SceneManager.GetActiveScene().name);",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n"), "utf-8");
    const wiringResult = await applyUnityGameLoopWiring(projectCopyPath, true);
    assert.equal(wiringResult.applied, true);

    const snapshot = await inspectGameProject(projectCopyPath);
    const progression = await determineGameProgression(snapshot);

    assert.equal(progression.signals.gameLoopReady, true);
    assert.equal(progression.currentStage, "game-loop");
    assert.equal(progression.stages.find((stage) => stage.id === "game-loop")?.complete, true);
    assert.equal(progression.nextTask.executionPlan, "modify-existing-script");
    assert.equal(progression.nextTask.implementationMode, "modify-existing-script");
    assert.equal(progression.nextTask.targetFile, "Assets/Scripts/GameLoopController.cs");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
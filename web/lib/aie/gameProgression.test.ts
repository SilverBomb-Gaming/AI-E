import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { GameProjectSnapshot } from "./gameProjectInspector";
import { determineGameProgression } from "./gameProgression";
import { recordOutcome } from "./outcomeLearning";

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
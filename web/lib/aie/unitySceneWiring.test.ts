import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyUnityGameLoopWiring,
  inspectUnityGameLoopStatus,
  rollbackUnityGameLoopWiring,
} from "./unitySceneWiring";

async function createFixtureProject(tempPrefix: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), tempPrefix));
  const fixtureRoot = path.resolve(process.cwd(), "..", "orchestrator_lane", "Tools", "EnemyAIDemoStandalone");
  const projectCopyPath = path.join(tempRoot, "EnemyAIDemoStandalone");
  await cp(fixtureRoot, projectCopyPath, { recursive: true });
  return projectCopyPath;
}

async function writeUnwiredGameLoopScript(projectPath: string): Promise<void> {
  await writeFile(path.join(projectPath, "Assets", "Scripts", "GameLoopController.cs"), [
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
}

test("game-loop status detects an unwired script state", async () => {
  const projectPath = await createFixtureProject("aie-unity-game-loop-status-");

  try {
    await writeUnwiredGameLoopScript(projectPath);

    const status = await inspectUnityGameLoopStatus(projectPath, true);
    assert.equal(status.gameLoopScriptExists, true);
    assert.equal(status.gameLoopAttached, false);
    assert.equal(status.winFeedbackPresent, false);
    assert.equal(status.enemyDefeatConnected, false);
    assert.equal(status.safeToOpenUnityForCompileOrPlaytest, false);
  } finally {
    await rm(path.dirname(projectPath), { recursive: true, force: true });
  }
});

test("game-loop wiring creates visible win feedback and reuses the scene lane on rerun", async () => {
  const projectPath = await createFixtureProject("aie-unity-game-loop-apply-");

  try {
    await writeUnwiredGameLoopScript(projectPath);

    const applyResult = await applyUnityGameLoopWiring(projectPath, true);
    assert.equal(applyResult.applied, true);
    assert.equal(applyResult.gameLoopAttached, true);
    assert.equal(applyResult.winFeedbackPresent, true);
    assert.equal(applyResult.enemyDefeatConnected, true);

    const status = await inspectUnityGameLoopStatus(projectPath, true);
    assert.equal(status.gameLoopAttached, true);
    assert.equal(status.winFeedbackPresent, true);
    assert.equal(status.enemyDefeatConnected, true);
    assert.equal(status.safeToOpenUnityForCompileOrPlaytest, true);

    const sceneSource = await readFile(path.join(projectPath, "Assets", "Scenes", "EnemyAIDemo.unity"), "utf-8");
    assert.equal((sceneSource.match(/m_Name: AIE_GameLoop/g) ?? []).length, 1);
    assert.equal((sceneSource.match(/m_Name: AIE_WinMessage/g) ?? []).length, 1);

    const secondApplyResult = await applyUnityGameLoopWiring(projectPath, true);
    assert.equal(secondApplyResult.applied, false);
    assert.match(secondApplyResult.blockedReasons.join(" "), /already present|already/i);
  } finally {
    await rm(path.dirname(projectPath), { recursive: true, force: true });
  }
});

test("game-loop wiring rollback restores the unwired state", async () => {
  const projectPath = await createFixtureProject("aie-unity-game-loop-rollback-");

  try {
    await writeUnwiredGameLoopScript(projectPath);
    const applyResult = await applyUnityGameLoopWiring(projectPath, true);
    assert.equal(applyResult.applied, true);

    const rollbackResult = await rollbackUnityGameLoopWiring(projectPath, true);
    assert.equal(rollbackResult.restored, true);

    const status = await inspectUnityGameLoopStatus(projectPath, true);
    assert.equal(status.gameLoopAttached, false);
    assert.equal(status.winFeedbackPresent, false);
    assert.equal(status.enemyDefeatConnected, false);
  } finally {
    await rm(path.dirname(projectPath), { recursive: true, force: true });
  }
});
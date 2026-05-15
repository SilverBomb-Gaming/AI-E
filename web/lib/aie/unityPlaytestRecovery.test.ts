import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectLegacyCompileRecovery, inspectUnityPlaytestRecovery } from "./unityPlaytestRecovery";

async function createUnityProjectWithLegacyCompileRisk(rootPath: string): Promise<void> {
  await mkdir(path.join(rootPath, "Assets", "_LEGACY_DO_NOT_TOUCH", "Scripts"), { recursive: true });
  await mkdir(path.join(rootPath, "ProjectSettings"), { recursive: true });
  await mkdir(path.join(rootPath, "Packages"), { recursive: true });
  await mkdir(path.join(rootPath, "Assets", "Scenes"), { recursive: true });

  await writeFile(path.join(rootPath, "Assets", "Scenes", "EnemyAIDemo.unity"), "%YAML 1.1\n", "utf-8");
  await writeFile(path.join(rootPath, "Assets", "_LEGACY_DO_NOT_TOUCH", "Scripts", "PlayerController.cs"), [
    "using UnityEngine;",
    "using UnityEngine.InputSystem;",
    "public class PlayerController : MonoBehaviour",
    "{",
    "    public void OnMove(InputAction.CallbackContext context) { }",
    "}",
    "",
  ].join("\n"), "utf-8");
}

test("legacy compile recovery detects legacy scripts and recommends moving them outside Assets", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-legacy-compile-recovery-"));

  try {
    await createUnityProjectWithLegacyCompileRisk(tempRoot);
    const snapshot = await inspectLegacyCompileRecovery(tempRoot);

    assert.equal(snapshot.playtestBlocked, true);
    assert.deepEqual(snapshot.legacyScriptsDetected, ["Assets/_LEGACY_DO_NOT_TOUCH/Scripts/PlayerController.cs"]);
    assert.deepEqual(snapshot.compileRiskFiles, ["Assets/_LEGACY_DO_NOT_TOUCH/Scripts/PlayerController.cs"]);
    assert.match(snapshot.compatibilityIssues.join("\n"), /missing OnThrowLethal/i);
    assert.match(snapshot.compatibilityIssues.join("\n"), /missing OnThrowTactical/i);
    assert.equal(snapshot.recommendedActions[0]?.action, "move-folder-outside-assets");
    assert.match(snapshot.preferredRecoveryTarget ?? "", /^_LegacyOutsideUnity\/_LEGACY_DO_NOT_TOUCH/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("unity playtest recovery marks legacy compile blockers as unsafe to resume", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-unity-recovery-legacy-blocked-"));

  try {
    await createUnityProjectWithLegacyCompileRisk(tempRoot);
    const snapshot = await inspectUnityPlaytestRecovery(tempRoot);

    assert.equal(snapshot.safeToResumePlaytest, false);
    assert.deepEqual(snapshot.detectedIssues.legacyCompileRiskFiles, ["Assets/_LEGACY_DO_NOT_TOUCH/Scripts/PlayerController.cs"]);
    assert.match(snapshot.detectedIssues.legacyCompileCompatibilityIssues.join("\n"), /OnThrowLethal/i);
    assert.ok(snapshot.recommendedActions.some((action) => action.action === "move-folder-outside-assets"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { recordOutcome } from "../lib/aie/outcomeLearning";
import { autoRecordOutcomeForFeature, main } from "./showOperatorView";

test("auto-record writes runtime-auto outcome with latest session provenance", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-auto-record-"));
  const logPath = path.join(tempRoot, "Editor.log");

  try {
    await writeFile(logPath, [
      "[AIE Playtest Session] START id=session-1",
      "Enemy defeated",
      "[AIE Playtest Session] END id=session-1",
    ].join("\n"), "utf-8");

    const result = await autoRecordOutcomeForFeature(tempRoot, "enemy-health", logPath);
    assert.equal(result.status, "recorded");
    assert.equal(result.recorded.record.evaluationSource, "runtime-auto");
    assert.equal(result.recorded.record.sessionMode, "marker-session");
    assert.equal(result.recorded.record.inferredResult, "pass");
    assert.deepEqual(result.recorded.record.gameplayEvents, ["Enemy defeated"]);
    assert.deepEqual(result.recorded.record.errors, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("auto-record duplicate session does not append twice", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-auto-record-dup-"));
  const logPath = path.join(tempRoot, "Editor.log");

  try {
    await writeFile(logPath, [
      "[AIE Playtest Session] START id=session-dup",
      "Enemy defeated",
      "[AIE Playtest Session] END id=session-dup",
    ].join("\n"), "utf-8");

    const first = await autoRecordOutcomeForFeature(tempRoot, "enemy-health", logPath);
    const second = await autoRecordOutcomeForFeature(tempRoot, "enemy-health", logPath);

    assert.equal(first.status, "recorded");
    assert.equal(second.status, "duplicate");
    assert.equal(second.message, "Outcome already recorded for this session.");
    assert.equal(second.summary.totalOutcomes, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("auto-record blocks when feature is missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-auto-record-blocked-"));

  try {
    const result = await autoRecordOutcomeForFeature(tempRoot, undefined);
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "--feature is required so the outcome can be tied to a specific game feature.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view prints retry suggestion for latest failed outcome", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-retry-suggestion-cli-"));
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "runtime error during health update",
      evaluationSource: "runtime-auto",
      errors: ["NullReferenceException"],
    });

    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--suggest-retry",
      tempRoot,
    ]);

    assert.equal(exitCode, 0);
    const rendered = captured.join("\n");
    assert.match(rendered, /RETRY SUGGESTION/i);
    assert.match(rendered, /Feature: enemy-health/i);
    assert.match(rendered, /Last Result: fail/i);
    assert.match(rendered, /Retry Recommended: YES/i);
    assert.match(rendered, /Fix runtime errors before retry/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view prints auto retry task for latest partial outcome", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-auto-retry-cli-"));
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    await recordOutcome(tempRoot, {
      feature: "attack-feedback",
      result: "partial",
      observation: "attack pulse too weak",
      evaluationSource: "runtime-auto",
      gameplayEvents: ["PlayerAttack: swing started"],
    });

    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--auto-retry",
      tempRoot,
    ]);

    assert.equal(exitCode, 0);
    const rendered = captured.join("\n");
    assert.match(rendered, /AUTO RETRY TASK/i);
    assert.match(rendered, /Feature: attack-feedback/i);
    assert.match(rendered, /Strategy Adjustment: Refine feature behavior, not structure/i);
    assert.match(rendered, /Retry attack-feedback with adjusted strategy/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view runs autonomous execution loop in dry-run mode", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-autonomous-loop-cli-"));
  const logPath = path.join(tempRoot, "Editor.log");
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    await writeFile(logPath, [
      "[AIE Playtest Session] START id=session-loop-cli",
      "NullReferenceException: EnemyHealth update failed",
      "[AIE Playtest Session] END id=session-loop-cli",
    ].join("\n"), "utf-8");
    await recordOutcome(tempRoot, {
      feature: "enemy-health",
      result: "fail",
      observation: "prior outcome establishes feature context",
      evaluationSource: "runtime-auto",
      errors: ["NullReferenceException"],
    });

    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--run-autonomous-loop",
      tempRoot,
      "--runtime-log",
      logPath,
    ]);

    assert.equal(exitCode, 0);
    const rendered = captured.join("\n");
    assert.match(rendered, /AUTONOMOUS LOOP/i);
    assert.match(rendered, /DRY-RUN ONLY \(v1\)/i);
    assert.match(rendered, /Iteration: 1/i);
    assert.match(rendered, /Action: retry/i);
    assert.match(rendered, /Iteration: 3/i);
    assert.match(rendered, /Action: stop/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view blocks execute-next-action when no loop summary exists yet", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-execute-next-action-blocked-cli-"));
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--execute-next-action",
      tempRoot,
    ]);

    assert.equal(exitCode, 1);
    const rendered = captured.join("\n");
    assert.match(rendered, /AUTONOMOUS ACTION BLOCKED/i);
    assert.match(rendered, /run --run-autonomous-loop first/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view prints ranked feature candidates", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-feature-selection-report-"));
  const failLogPath = path.join(tempRoot, "Fail.log");
  const passLogPath = path.join(tempRoot, "Pass.log");
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    await writeFile(failLogPath, [
      "[AIE Playtest Session] START id=session-fail",
      "NullReferenceException: fail",
      "[AIE Playtest Session] END id=session-fail",
    ].join("\n"), "utf-8");
    await writeFile(passLogPath, [
      "[AIE Playtest Session] START id=session-pass",
      "Enemy defeated",
      "[AIE Playtest Session] END id=session-pass",
    ].join("\n"), "utf-8");

    await autoRecordOutcomeForFeature(tempRoot, "feature-fail", failLogPath);
    await autoRecordOutcomeForFeature(tempRoot, "feature-pass", passLogPath);

    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--feature-selection-report",
      tempRoot,
      "--feature-pool",
      "feature-pass,feature-fail,feature-unseen",
    ]);

    assert.equal(exitCode, 0);
    const rendered = captured.join("\n");
    assert.match(rendered, /FEATURE SELECTION REPORT/i);
    assert.match(rendered, /Selected Feature: feature-fail/i);
    assert.match(rendered, /feature-fail \| score=300 \| state=failing/i);
    assert.match(rendered, /feature-unseen \| score=100 \| state=unseen/i);
    assert.match(rendered, /feature-pass \| score=10 \| state=passing/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view requires checkpoint id for rollback-autonomous-checkpoint", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-rollback-checkpoint-cli-"));
  const captured: string[] = [];
  const originalError = console.error;

  try {
    console.error = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--rollback-autonomous-checkpoint",
      tempRoot,
    ]);

    assert.equal(exitCode, 1);
    assert.match(captured.join("\n"), /requires --checkpoint-id/i);
  } finally {
    console.error = originalError;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view rejects nonpositive max-autonomous-steps", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-bounded-chain-cli-invalid-"));
  const captured: string[] = [];
  const originalError = console.error;

  try {
    console.error = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--execute-bounded-action-chain",
      tempRoot,
      "--max-autonomous-steps",
      "0",
    ]);

    assert.equal(exitCode, 1);
    assert.match(captured.join("\n"), /--max-autonomous-steps expects an integer greater than 0/i);
  } finally {
    console.error = originalError;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator view prints legacy compile recovery report", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-legacy-compile-recovery-cli-"));
  const captured: string[] = [];
  const originalLog = console.log;

  try {
    await mkdir(path.join(tempRoot, "Assets", "_LEGACY_DO_NOT_TOUCH", "Scripts"), { recursive: true });
    await mkdir(path.join(tempRoot, "Assets", "Scenes"), { recursive: true });
    await mkdir(path.join(tempRoot, "ProjectSettings"), { recursive: true });
    await mkdir(path.join(tempRoot, "Packages"), { recursive: true });
    await writeFile(path.join(tempRoot, "Assets", "_LEGACY_DO_NOT_TOUCH", "Scripts", "PlayerController.cs"), [
      "using UnityEngine;",
      "using UnityEngine.InputSystem;",
      "public class PlayerController : MonoBehaviour",
      "{",
      "    public void OnMove(InputAction.CallbackContext context) { }",
      "}",
      "",
    ].join("\n"), "utf-8");
    await writeFile(path.join(tempRoot, "Assets", "Scenes", "EnemyAIDemo.unity"), "%YAML 1.1\n", "utf-8");
    await writeFile(path.join(tempRoot, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.0f1\n", "utf-8");
    await writeFile(path.join(tempRoot, "Packages", "manifest.json"), "{}\n", "utf-8");

    console.log = (...args: unknown[]) => {
      captured.push(args.join(" "));
    };

    const exitCode = await main([
      "--legacy-compile-recovery",
      tempRoot,
    ]);

    assert.equal(exitCode, 0);
    const rendered = captured.join("\n");
    assert.match(rendered, /LEGACY COMPILE RECOVERY/i);
    assert.match(rendered, /Playtest Blocked: YES/i);
    assert.match(rendered, /Assets\/_LEGACY_DO_NOT_TOUCH\/Scripts\/PlayerController\.cs/i);
    assert.match(rendered, /move legacy scripts outside Unity's Assets compilation path/i);
  } finally {
    console.log = originalLog;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
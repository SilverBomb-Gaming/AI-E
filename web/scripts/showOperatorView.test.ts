import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readExecutionLoopRecords,
  runAutonomousExecutionLoop,
  selectLoopAdjustment,
  type ExecutionLoopRecord,
} from "./executionLoop";

test("autonomous execution loop simulates bounded retry iterations and records loop summary", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-execution-loop-"));
  const logPath = path.join(tempRoot, "Editor.log");

  try {
    await writeFile(logPath, [
      "[AIE Playtest Session] START id=loop-session-1",
      "NullReferenceException: EnemyHealth update failed",
      "[AIE Playtest Session] END id=loop-session-1",
    ].join("\n"), "utf-8");

    const result = await runAutonomousExecutionLoop(tempRoot, "enemy-health", logPath);
    assert.equal(result.status, "completed");
    assert.equal(result.iterations.length, 3);
    assert.equal(result.iterations[0]?.result, "fail");
    assert.equal(result.iterations[0]?.action, "retry");
    assert.equal(result.iterations[0]?.adjustment, "Fix runtime errors before retry");
    assert.equal(result.iterations[1]?.result, "partial");
    assert.equal(result.iterations[1]?.action, "retry");
    assert.equal(result.iterations[1]?.adjustment, "Refine feature behavior, not structure");
    assert.equal(result.iterations[2]?.result, "pass");
    assert.equal(result.iterations[2]?.action, "stop");

    const summaries = await readExecutionLoopRecords(tempRoot);
    assert.equal(summaries.length, 1);
    assert.deepEqual(summaries[0]?.outcomes, ["fail", "partial", "pass"]);
    assert.deepEqual(summaries[0]?.adjustmentsUsed, [
      "Fix runtime errors before retry",
      "Refine feature behavior, not structure",
    ]);

    const rawSummary = await readFile(path.join(tempRoot, ".aie", "loops.jsonl"), "utf-8");
    assert.match(rawSummary, /enemy-health/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("autonomous loop adjustment selector prefers successful historical paths", async () => {
  const loopRecords: ExecutionLoopRecord[] = [
    {
      id: "loop-1",
      timestamp: new Date().toISOString(),
      projectPath: "temp",
      feature: "enemy-health",
      dryRun: true,
      iterations: 2,
      outcomes: ["fail", "pass"],
      adjustmentsUsed: ["Change implementation approach"],
      finalAction: "stop",
    },
    {
      id: "loop-2",
      timestamp: new Date().toISOString(),
      projectPath: "temp",
      feature: "enemy-health",
      dryRun: true,
      iterations: 1,
      outcomes: ["fail"],
      adjustmentsUsed: ["Retry with a smaller guarded change"],
      finalAction: "stop",
    },
  ];

  const adjustment = selectLoopAdjustment(
    "enemy-health",
    "Retry with a smaller guarded change",
    loopRecords,
    [],
  );

  assert.equal(adjustment, "Change implementation approach");
});

test("autonomous execution loop blocks when no feature context exists", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-execution-loop-blocked-"));

  try {
    const result = await runAutonomousExecutionLoop(tempRoot);
    assert.equal(result.status, "blocked");
    assert.match(result.reason ?? "", /feature is required/i);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("autonomous execution loop uses a local Editor.log when no runtime log is provided", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-execution-loop-local-log-"));
  const logPath = path.join(tempRoot, "Editor.log");

  try {
    await writeFile(logPath, [
      "[AIE Playtest Session] START id=loop-session-local-log",
      "NullReferenceException: EnemyHealth update failed",
      "[AIE Playtest Session] END id=loop-session-local-log",
    ].join("\n"), "utf-8");

    const result = await runAutonomousExecutionLoop(tempRoot, "enemy-health");
    assert.equal(result.status, "completed");
    assert.equal(result.iterations[0]?.result, "fail");
    assert.equal(result.iterations[0]?.action, "retry");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

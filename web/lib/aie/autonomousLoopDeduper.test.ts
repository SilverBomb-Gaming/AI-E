import assert from "node:assert/strict";
import test from "node:test";

import { detectAutonomousLoopStall } from "./autonomousLoopDeduper";

test("deduper detects repeated identical actions", () => {
  const result = detectAutonomousLoopStall({
    priorActions: ["Run validation", "Run validation"],
    priorOutputs: [],
    nextProposedAction: "Run validation",
  });

  assert.equal(result.repeatedAction, true);
  assert.equal(result.shouldStallStop, true);
});

test("deduper detects repeated outputs across different actions", () => {
  const result = detectAutonomousLoopStall({
    priorActions: ["Run test target A"],
    priorOutputs: ["Assertion failed in the same place"],
    nextProposedAction: "Inspect trace report",
    latestExecutionOutput: "Assertion failed in the same place",
  });

  assert.equal(result.repeatedOutput, true);
  assert.equal(result.shouldStallStop, true);
});

test("deduper detects repeated blocked root causes", () => {
  const result = detectAutonomousLoopStall({
    priorActions: ["Write outside root", "Write outside root"],
    priorOutputs: ["Blocked by path policy"],
    nextProposedAction: "Write outside root",
    latestExecutionOutput: "Blocked by path policy",
  });

  assert.equal(result.shouldStallStop, true);
});

test("deduper normalizes comparison before matching", () => {
  const result = detectAutonomousLoopStall({
    priorActions: ["Run   Validation!", "run validation"],
    priorOutputs: [],
    nextProposedAction: "RUN validation",
  });

  assert.equal(result.repeatedAction, true);
});
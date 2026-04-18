import assert from "node:assert/strict";
import test from "node:test";

import { captureTrainingScenarioTraces } from "./trainingTraceScenarios";
import type { FreeAnalysisResponse } from "./types";

function makeResult(problemDescription: string): FreeAnalysisResponse {
  return {
    what_happened: `Synthetic diagnosis for: ${problemDescription}`,
    what_matters: ["Synthetic trace capture coverage test."],
    what_to_do_next: ["Run one targeted check and compare the result."],
    upgrade_hint: "",
  };
}

test("captureTrainingScenarioTraces includes the controlled seed scenarios", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "committed",
    "duplicate-writer",
    "falsification",
    "instrumentation",
    "isolation",
    "messy",
    "ownership",
    "pending",
    "resolved",
    "stuck",
  ]);
  assert.equal(traces.length, 10);
});

test("captureTrainingScenarioTraces keeps the same coverage for paraphrased prompts", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
    promptVariant: "paraphrased",
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "committed",
    "duplicate-writer",
    "falsification",
    "instrumentation",
    "isolation",
    "messy",
    "ownership",
    "pending",
    "resolved",
    "stuck",
  ]);
  assert.equal(traces.length, 10);
});

test("captureTrainingScenarioTraces includes the complex second-tier scenarios", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
    scenarioSet: "complex",
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "complex-async-race-committed",
    "complex-async-race-converging",
    "complex-async-race-fresh",
    "complex-async-race-pending",
    "complex-regression-committed",
    "complex-regression-converging",
    "complex-regression-fresh",
    "complex-regression-pending",
    "complex-state-desync-committed",
    "complex-state-desync-converging",
    "complex-state-desync-fresh",
    "complex-state-desync-pending",
  ]);
  assert.equal(traces.length, 12);
});

test("captureTrainingScenarioTraces keeps complex coverage for paraphrased prompts", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
    promptVariant: "paraphrased",
    scenarioSet: "complex",
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "complex-async-race-committed",
    "complex-async-race-converging",
    "complex-async-race-fresh",
    "complex-async-race-pending",
    "complex-regression-committed",
    "complex-regression-converging",
    "complex-regression-fresh",
    "complex-regression-pending",
    "complex-state-desync-committed",
    "complex-state-desync-converging",
    "complex-state-desync-fresh",
    "complex-state-desync-pending",
  ]);
  assert.equal(traces.length, 12);
});

test("captureTrainingScenarioTraces includes the game-dev bridge scenarios", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
    scenarioSet: "game-dev",
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "game-balance-action",
    "game-balance-hypothesis",
    "game-balance-validation",
    "game-feature-refinement-action",
    "game-feature-refinement-hypothesis",
    "game-feature-refinement-validation",
    "game-mechanic-tuning-action",
    "game-mechanic-tuning-hypothesis",
    "game-mechanic-tuning-validation",
    "game-player-feedback-action",
    "game-player-feedback-hypothesis",
    "game-player-feedback-validation",
    "game-system-design-action",
    "game-system-design-hypothesis",
    "game-system-design-validation",
  ]);
  assert.equal(traces.length, 15);
  assert.ok(traces.every((trace) => typeof trace.sessionId === "string" && trace.sessionId.length > 0));
  assert.ok(traces.every((trace) => Number.isInteger(trace.stepIndex) && trace.stepIndex > 0));
  assert.ok(traces.every((trace) => typeof trace.goal === "string" && trace.goal.length > 0));
});

test("captureTrainingScenarioTraces keeps game-dev coverage for paraphrased prompts", async () => {
  const traces = await captureTrainingScenarioTraces({
    analyze: async (problemDescription) => makeResult(problemDescription),
    promptVariant: "paraphrased",
    scenarioSet: "game-dev",
  });

  const scenarios = new Set(traces.map((trace) => trace.scenario));

  assert.deepEqual([...scenarios].sort(), [
    "game-balance-action",
    "game-balance-hypothesis",
    "game-balance-validation",
    "game-feature-refinement-action",
    "game-feature-refinement-hypothesis",
    "game-feature-refinement-validation",
    "game-mechanic-tuning-action",
    "game-mechanic-tuning-hypothesis",
    "game-mechanic-tuning-validation",
    "game-player-feedback-action",
    "game-player-feedback-hypothesis",
    "game-player-feedback-validation",
    "game-system-design-action",
    "game-system-design-hypothesis",
    "game-system-design-validation",
  ]);
  assert.equal(traces.length, 15);
});
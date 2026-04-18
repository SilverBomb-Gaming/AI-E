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
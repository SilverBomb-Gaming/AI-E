import assert from "node:assert/strict";
import test from "node:test";

import type { SimulatedRankingAdjustment } from "./passiveLearningSimulation";
import { renderSimulatedRankingAdjustments } from "./passiveLearningSimulationOutput";

test("renderSimulatedRankingAdjustments renders current score simulated score delta and simulation-only language", () => {
  const adjustments: SimulatedRankingAdjustment[] = [
    {
      plan_id: "plan-a",
      current_score: 0.292,
      simulated_adjusted_score: 0.267,
      delta: -0.025,
    },
    {
      plan_id: "plan-b",
      current_score: 0.076,
      simulated_adjusted_score: 0.101,
      delta: 0.025,
    },
  ];
  const before = JSON.stringify(adjustments);

  const rendered = renderSimulatedRankingAdjustments(adjustments);

  assert.equal(JSON.stringify(adjustments), before);
  assert.equal(rendered.display_only, true);
  assert.equal(rendered.applied, false);
  assert.equal(rendered.adjustments[0]?.reason, "Shadow signal suggests historical operator choices would reduce confidence in this plan.");
  assert.equal(rendered.adjustments[1]?.reason, "Shadow signal suggests historical operator choices would increase confidence in this plan.");
  assert.match(rendered.console_output, /Simulation only - not applied\./);
  assert.match(rendered.console_output, /Current score: 0.292/);
  assert.match(rendered.console_output, /Simulated adjusted score: 0.267/);
  assert.match(rendered.console_output, /Delta: -0.025/);
  assert.match(rendered.console_output, /Reason: Shadow signal suggests historical operator choices would reduce confidence in this plan\./);
});

test("renderSimulatedRankingAdjustments does not change ranking output or input records", () => {
  const adjustments: SimulatedRankingAdjustment[] = [
    {
      plan_id: "plan-a",
      current_score: 0.5,
      simulated_adjusted_score: 0.5,
      delta: 0,
    },
  ];
  const before = JSON.stringify(adjustments);

  const rendered = renderSimulatedRankingAdjustments(adjustments);

  assert.equal(JSON.stringify(adjustments), before);
  assert.equal(rendered.adjustments[0]?.current_score, 0.5);
  assert.equal(rendered.adjustments[0]?.simulated_adjusted_score, 0.5);
  assert.equal(rendered.adjustments[0]?.delta, 0);
  assert.equal(rendered.adjustments[0]?.reason, "Shadow signal shows no simulated adjustment for this plan.");
  assert.match(rendered.console_output, /Display only\./);
});
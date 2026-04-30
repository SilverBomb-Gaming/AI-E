import assert from "node:assert/strict";
import test from "node:test";

import { normalizeStrategyGoal } from "./strategyGoalPortfolio";

test("normalizeStrategyGoal clamps numeric scores and preserves array fields", () => {
  const normalized = normalizeStrategyGoal({
    strategy_goal_id: "strategy-test",
    title: "Test strategy goal",
    summary: "Verify normalization.",
    category: "tooling",
    priority: "high",
    impact_score: 140,
    effort_score: -8,
    risk_score: 74.4,
    confidence_score: 48.8,
    time_horizon: "near_term",
    status: "proposed",
    owner_agent_role: "planner",
    dependency_goal_ids: ["dep-1"],
    blocked_by: ["blocker-1"],
    success_criteria: ["criterion-1"],
    expected_outputs: ["output-1"],
    linked_work_item_ids: ["work-1"],
    linked_delivery_package_ids: ["delivery-1"],
    created_at: "2026-04-26T12:00:00.000Z",
    updated_at: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(normalized.impact_score, 100);
  assert.equal(normalized.effort_score, 0);
  assert.equal(normalized.risk_score, 74);
  assert.equal(normalized.confidence_score, 49);
  assert.deepEqual(normalized.dependency_goal_ids, ["dep-1"]);
  assert.deepEqual(normalized.linked_work_item_ids, ["work-1"]);
});
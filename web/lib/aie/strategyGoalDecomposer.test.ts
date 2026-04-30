import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { decomposeStrategyGoal } from "./strategyGoalDecomposer";

test("decomposeStrategyGoal produces bounded proposed work items with operator approval gates", () => {
  const state = createOperatorDashboardDemoState();
  const goal = state.strategy_goals?.find((item) => item.strategy_goal_id === "strategy-ship-first-playable-loop");
  if (!goal) {
    throw new Error("Expected seeded strategy goal.");
  }

  const result = decomposeStrategyGoal(goal, "2026-04-26T12:05:00.000Z");

  assert.equal(result.proposed_work_items.length, 2);
  assert.equal(result.proposed_work_items.every((item) => item.required_approval_level === "operator_approval"), true);
  assert.equal(result.decomposition.proposed_work_items[0], `${goal.strategy_goal_id}-portfolio-brief`);
  assert.equal(result.decomposition.review_gates.some((item) => /operator review required/i.test(item)), true);
});
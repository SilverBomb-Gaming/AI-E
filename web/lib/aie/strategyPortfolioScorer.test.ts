import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { scoreStrategyPortfolio } from "./strategyPortfolioScorer";

test("scoreStrategyPortfolio ranks the playable-loop strategy first in the demo seed", () => {
  const state = createOperatorDashboardDemoState();
  const scores = scoreStrategyPortfolio({
    goals: state.strategy_goals ?? [],
    state,
    operator_preferences: (state.meta_policy_recommendations ?? []).map((item) => item.target),
  });

  assert.equal(scores[0]?.strategy_goal_id, "strategy-ship-first-playable-loop");
  assert.equal(scores[0]?.portfolio_rank, 1);
  assert.equal(scores.find((item) => item.strategy_goal_id === "strategy-evaluate-live-ops-experiment")?.recommended_action, "clear_blockers");
});
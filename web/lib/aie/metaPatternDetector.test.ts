import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { buildMetaIntelligenceState, detectMetaPatterns } from "./metaPatternDetector";
import { deriveMetaPolicyState, recommendMetaPolicyAdjustments } from "./metaPolicyRecommender";

test("detectMetaPatterns identifies recurring signals from demo state", () => {
  const state = createOperatorDashboardDemoState();

  const patterns = detectMetaPatterns({
    studio_operations_state: state.studio_operations,
    runtime_timeline_events: state.runtime_observability?.event_log,
    execution_chains: state.execution_chains,
    review_packages: state.review_packages,
    delivery_packages: state.delivery_packages,
    recovery_events: state.recovery_recommendations,
    operator_decisions: state.meta_operator_decision_history,
    autonomous_sessions: state.governed_runtime_lanes,
    agent_runtime: state.agent_runtime,
  });

  assert.equal(patterns.length > 0, true);
  assert.equal(patterns.some((item) => Boolean(item.recommended_action)), true);
});

test("buildMetaIntelligenceState summarizes the observed window", () => {
  const state = createOperatorDashboardDemoState();
  const patterns = detectMetaPatterns({
    studio_operations_state: state.studio_operations,
    runtime_timeline_events: state.runtime_observability?.event_log,
    execution_chains: state.execution_chains,
    review_packages: state.review_packages,
    delivery_packages: state.delivery_packages,
    recovery_events: state.recovery_recommendations,
    operator_decisions: state.meta_operator_decision_history,
    autonomous_sessions: state.governed_runtime_lanes,
    agent_runtime: state.agent_runtime,
  });
  const recommendations = recommendMetaPolicyAdjustments({
    detected_patterns: patterns,
    current_policy_state: deriveMetaPolicyState(state),
    overnight_policy: state.supervised_session?.overnight_policy,
    recovery_policy: state.supervised_session?.recovery_policy ?? null,
    planning_priority_weights: (state.planning_recommendations ?? []).map((item) => `${item.work_item_id}:${item.score}`),
    delivery_gating_rules: (state.delivery_packages ?? []).map((item) => `${item.delivery_package_id}:${item.status}`),
    operator_decision_history: state.meta_operator_decision_history,
    timestamp: state.last_updated_at,
  });

  const metaState = buildMetaIntelligenceState(state, patterns, recommendations);

  assert.equal(metaState.total_sessions > 0, true);
  assert.equal(metaState.recommended_policy_adjustments.length > 0, true);
  assert.match(metaState.meta_cycle_id, /^meta-cycle-/);
});

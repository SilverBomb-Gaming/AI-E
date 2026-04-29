import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { detectMetaPatterns } from "./metaPatternDetector";
import { deriveMetaPolicyState, recommendMetaPolicyAdjustments } from "./metaPolicyRecommender";

test("recommendMetaPolicyAdjustments produces bounded advisory changes", () => {
  const state = createOperatorDashboardDemoState();
  const patterns = detectMetaPatterns({
    studio_operations_state: state.studio_operations,
    runtime_timeline_events: state.runtime_observability?.event_log,
    execution_chains: state.execution_chains,
    review_packages: state.review_packages,
    delivery_packages: state.delivery_packages,
    recovery_events: state.recovery_recommendations,
    operator_decisions: state.meta_operator_decision_history,
    autonomous_sessions: state.autonomous_sessions,
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

  assert.equal(recommendations.length > 0, true);
  assert.equal(recommendations.every((item) => /bounded policy-state changes/i.test(item.safe_rationale)), true);
  assert.equal(recommendations.some((item) => Boolean(item.requested_policy_value)), true);
});
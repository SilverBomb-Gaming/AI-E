import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { aggregateStudioHealthFromDashboardState } from "./studioHealthAggregator";

function createNominalState() {
  const state = structuredClone(createOperatorDashboardDemoState());
  state.blocked_goals = [];
  state.recent_failures = [];
  state.recovery_recommendations = [];
  state.approvals_required = [];
  state.validation_issues = [];
  state.review_packages = [];
  state.delivery_packages = [];
  state.runtime_status = {
    status: "runtime_ready",
    explanation: "Nominal runtime state for studio aggregation tests.",
  };
  if (state.autonomous_sessions) {
    state.autonomous_sessions.sessions = state.autonomous_sessions.sessions.map((session) => ({
      ...session,
      status: session.session_id === "demo-session-feature-ui" ? "running" : "pending",
      blocked_by_conflict: false,
      ready_on_dependency: true,
    }));
    state.autonomous_sessions.blocked_session_ids = [];
  }
  return state;
}

test("studio state contract reports nominal state from clean runtime data", () => {
  const state = createNominalState();

  const result = aggregateStudioHealthFromDashboardState(state);

  assert.equal(result.studio_status, "nominal");
  assert.equal(result.blocked_session_count, 0);
  assert.equal(result.pending_review_count, 0);
  assert.equal(result.health_score >= 80, true);
});

test("studio state contract reports blocked state when sessions fail", () => {
  const state = createNominalState();
  if (!state.autonomous_sessions) {
    throw new Error("Expected autonomous session state in demo seed.");
  }
  state.autonomous_sessions.sessions[1] = {
    ...state.autonomous_sessions.sessions[1],
    status: "failed",
    blocked_by_conflict: true,
    ready_on_dependency: false,
  };

  const result = aggregateStudioHealthFromDashboardState(state);

  assert.equal(result.studio_status, "blocked");
  assert.equal(result.blocked_session_count, 1);
  assert.match(result.recent_risks[0]?.summary ?? "", /blocked|failed/i);
});

test("studio state contract reports overloaded state under critical resource pressure", () => {
  const state = createNominalState();
  if (!state.autonomous_sessions) {
    throw new Error("Expected autonomous session state in demo seed.");
  }
  state.autonomous_sessions.max_logical_cpu_units = 2;
  state.autonomous_sessions.max_concurrent_chains = 1;

  const result = aggregateStudioHealthFromDashboardState(state);

  assert.equal(result.studio_status, "overloaded");
  assert.equal(result.resource_pressure, "critical");
});

test("pending reviews reduce studio health and recommend queue prioritization", () => {
  const baseState = createNominalState();
  const reviewState = createNominalState();
  const sourceReviewPackage = createOperatorDashboardDemoState().review_packages?.[0];
  if (!sourceReviewPackage) {
    throw new Error("Expected review package in demo seed.");
  }
  reviewState.review_packages = [
    structuredClone(sourceReviewPackage),
    structuredClone(sourceReviewPackage),
    structuredClone(sourceReviewPackage),
    structuredClone(sourceReviewPackage),
  ].map((item, index) => ({
    ...item,
    package_id: `${item.package_id}-${index}`,
    work_item_id: `${item.work_item_id}-${index}`,
    status: "pending",
  }));

  const baseResult = aggregateStudioHealthFromDashboardState(baseState);
  const reviewResult = aggregateStudioHealthFromDashboardState(reviewState);

  assert.equal(reviewResult.pending_review_count, 4);
  assert.equal(reviewResult.health_score < baseResult.health_score, true);
  assert.equal(reviewResult.recommended_operator_actions.some((item) => item.action === "prioritize_review_queue"), true);
});

test("failed sessions reduce studio health score", () => {
  const baseState = createNominalState();
  const failedState = createNominalState();
  if (!failedState.autonomous_sessions) {
    throw new Error("Expected autonomous session state in demo seed.");
  }
  failedState.autonomous_sessions.sessions[0] = {
    ...failedState.autonomous_sessions.sessions[0],
    status: "failed",
    blocked_by_conflict: true,
  };

  const baseResult = aggregateStudioHealthFromDashboardState(baseState);
  const failedResult = aggregateStudioHealthFromDashboardState(failedState);

  assert.equal(failedResult.health_score < baseResult.health_score, true);
  assert.equal(failedResult.blocked_session_count, 1);
});

test("aggregator computes counts from persisted runtime slices and does not invent missing state", () => {
  const state = createNominalState();
  state.execution_chains = [];
  state.review_packages = [];
  state.delivery_packages = [];
  state.autonomous_sessions = undefined;

  const result = aggregateStudioHealthFromDashboardState(state);

  assert.equal(result.active_session_count, 0);
  assert.equal(result.blocked_session_count, 0);
  assert.equal(result.pending_review_count, 0);
  assert.equal(result.active_delivery_count, 0);
  assert.equal(result.pending_delivery_count, 0);
  assert.equal(result.active_chain_count, 0);
});
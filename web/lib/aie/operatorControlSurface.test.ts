import assert from "node:assert/strict";
import test from "node:test";

import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { applyOperatorControlAction } from "./operatorControlSurface";

test("approve_goal clears approval requirements and readies runtime", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "approve_goal",
    goal_id: initialState.approvals_required[0]?.goal_id ?? null,
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.approvals_required.length, 0);
  assert.equal(result.state.runtime_status.status, "runtime_ready");
});

test("pause_goal moves the active goal into the paused list", () => {
  const initialState = createOperatorDashboardDemoState();
  const activeGoalId = initialState.active_goal?.goal_id ?? null;

  const result = applyOperatorControlAction(initialState, {
    type: "pause_goal",
    goal_id: activeGoalId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.active_goal, null);
  assert.equal(result.state.paused_goals[0]?.goal_id, activeGoalId);
  assert.equal(result.state.runtime_status.status, "runtime_paused");
});

test("resume_goal restores a paused goal to the active slot", () => {
  const initialState = createOperatorDashboardDemoState();
  const pausedState = applyOperatorControlAction(initialState, {
    type: "pause_goal",
    goal_id: initialState.active_goal?.goal_id ?? null,
  }).state;
  const pausedGoalId = pausedState.paused_goals[0]?.goal_id ?? null;

  const result = applyOperatorControlAction(pausedState, {
    type: "resume_goal",
    goal_id: pausedGoalId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.active_goal?.goal_id, pausedGoalId);
  assert.equal(result.state.runtime_status.status, "runtime_ready");
});

test("retry_goal returns a blocked goal to the queue and clears one recovery signal", () => {
  const initialState = createOperatorDashboardDemoState();
  const blockedGoalId = initialState.blocked_goals[0]?.goal_id ?? null;
  const initialRecoveryCount = initialState.recovery_recommendations.length;

  const result = applyOperatorControlAction(initialState, {
    type: "retry_goal",
    goal_id: blockedGoalId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.blocked_goals.some((goal) => goal.goal_id === blockedGoalId), false);
  assert.equal(result.state.queued_goals[0]?.goal_id, blockedGoalId);
  assert.equal(result.state.recovery_recommendations.length, Math.max(0, initialRecoveryCount - 1));
});
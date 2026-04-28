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

test("start_supervised_session creates a bounded pending-approval session", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "start_supervised_session",
    supervised_session_input: {
      max_duration_ms: 7_200_000,
      tick_budget: 6,
      max_chain_count: 4,
      approval_policy: "operator_must_approve_start",
      recovery_policy: "request_operator_review",
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "pending_approval");
  assert.equal(result.state.supervised_session?.tick_budget, 6);
  assert.equal(result.state.approvals_required.length > 0, true);
});

test("start_supervised_session can initialize overnight autonomy policy state", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "start_supervised_session",
    supervised_session_input: {
      approval_policy: "preapproved_with_limits",
      overnight_mode_enabled: true,
      max_runtime_hours: 6,
      max_tick_count: 9,
      max_chain_count: 3,
      max_retries_per_chain: 1,
      max_recovery_attempts: 2,
      checkpoint_interval_ticks: 2,
      review_queue_enabled: true,
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "running");
  assert.equal(result.state.supervised_session?.overnight_policy?.max_runtime_hours, 6);
  assert.equal(result.state.supervised_session?.overnight_policy?.max_tick_count, 9);
  assert.equal(result.state.supervised_session?.review_queue?.length, 0);
  assert.equal(result.state.supervised_session?.resume_state?.resume_status, "resume_ready");
});

test("pause_session pauses the supervised session", () => {
  const initialState = applyOperatorControlAction(createOperatorDashboardDemoState(), {
    type: "start_supervised_session",
    supervised_session_input: {
      approval_policy: "preapproved_with_limits",
    },
  }).state;

  const result = applyOperatorControlAction(initialState, { type: "pause_session" });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "paused");
  assert.equal(result.state.supervised_session?.next_scheduled_tick_at, null);
});

test("resume_session restarts a paused supervised session", () => {
  const pausedState = applyOperatorControlAction(
    applyOperatorControlAction(createOperatorDashboardDemoState(), {
      type: "start_supervised_session",
      supervised_session_input: {
        approval_policy: "preapproved_with_limits",
      },
    }).state,
    { type: "pause_session" },
  ).state;

  const result = applyOperatorControlAction(pausedState, { type: "resume_session" });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "running");
});

test("stop_session marks the supervised session as operator-stopped", () => {
  const initialState = applyOperatorControlAction(createOperatorDashboardDemoState(), {
    type: "start_supervised_session",
    supervised_session_input: {
      approval_policy: "preapproved_with_limits",
    },
  }).state;

  const result = applyOperatorControlAction(initialState, { type: "stop_session" });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "stopped_by_operator");
});

test("request_operator_review moves the supervised session into waiting state", () => {
  const initialState = applyOperatorControlAction(createOperatorDashboardDemoState(), {
    type: "start_supervised_session",
    supervised_session_input: {
      approval_policy: "preapproved_with_limits",
    },
  }).state;

  const result = applyOperatorControlAction(initialState, { type: "request_operator_review" });

  assert.equal(result.changed, true);
  assert.equal(result.state.supervised_session?.status, "waiting_for_operator");
  assert.equal(result.state.supervised_session?.pending_operator_review, true);
});
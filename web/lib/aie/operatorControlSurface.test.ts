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

test("approve_work_item moves a proposed item into the bounded queue", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "approve_work_item",
    work_item_id: "demo-work-risky-refactor",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.scheduled_work_items?.some((item) => item.work_item_id === "demo-work-risky-refactor"), true);
  assert.equal(result.state.queued_goals.some((goal) => goal.goal_id === "demo-work-risky-refactor"), true);
});

test("defer_work_item records planning feedback without queueing the item", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "defer_work_item",
    work_item_id: "demo-work-risky-refactor",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.proposed_work_items?.find((item) => item.work_item_id === "demo-work-risky-refactor")?.status, "needs_review");
  assert.equal(result.state.planning_policy_feedback?.deferrals_recorded, 2);
});

test("approve_review_package marks the package approved and closes the work item", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "approve_review_package",
    package_id: "demo-review-package",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.review_packages?.find((item) => item.package_id === "demo-review-package")?.status, "approved");
  assert.equal(result.state.delivery_packages?.some((item) => item.review_package_id === "demo-review-package"), true);
  assert.equal(result.state.delivery_packages?.find((item) => item.review_package_id === "demo-review-package")?.status, "awaiting_operator_approval");
});

test("approve_delivery_package marks the package approved for commit", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "approve_delivery_package",
    package_id: "delivery-demo-review-package-approved",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.delivery_packages?.find((item) => item.delivery_package_id === "delivery-demo-review-package-approved")?.status, "approved_for_commit");
});

test("request_delivery_changes returns the package to draft", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "request_delivery_changes",
    package_id: "delivery-demo-review-package-approved",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.delivery_packages?.find((item) => item.delivery_package_id === "delivery-demo-review-package-approved")?.status, "draft");
});

test("approve_policy_recommendation persists the approved meta policy state", () => {
  const initialState = createOperatorDashboardDemoState();
  const recommendationId = initialState.meta_policy_recommendations?.find((item) => item.target === "concurrency")?.recommendation_id
    ?? initialState.meta_policy_recommendations?.[0]?.recommendation_id
    ?? null;

  const result = applyOperatorControlAction(initialState, {
    type: "approve_policy_recommendation",
    recommendation_id: recommendationId,
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId)?.status, "approved");
  assert.equal(result.state.meta_operator_decision_history?.[0]?.recommendation_id, recommendationId);
});

test("request_meta_summary generates a persisted meta summary package", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "request_meta_summary",
  });

  assert.equal(result.changed, true);
  assert.equal(Boolean(result.state.meta_summary_package?.narrative), true);
  assert.equal(result.state.meta_summary_package?.should_not_change.includes("Do not modify code automatically."), true);
});

test("pause_autonomous_session pauses the selected multi-session worker", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "pause_autonomous_session",
    session_id: "demo-session-feature-ui",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "paused");
});

test("reprioritize_autonomous_session updates session ordering priority", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "reprioritize_autonomous_session",
    session_id: "demo-session-bugfix-delivery",
    session_priority: "critical",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.priority, "critical");
});

test("pause_all_sessions pauses active autonomous work safely", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "pause_all_sessions",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.every((session) => session.status !== "running" && session.status !== "pending"), true);
  assert.equal(result.state.runtime_status.status, "runtime_paused");
});

test("resume_safe_sessions skips blocked sessions and resumes only safe paused sessions", () => {
  const initialState = applyOperatorControlAction(createOperatorDashboardDemoState(), {
    type: "pause_all_sessions",
  }).state;
  if (!initialState.autonomous_sessions) {
    throw new Error("Expected autonomous sessions in demo seed.");
  }
  initialState.autonomous_sessions.sessions[1] = {
    ...initialState.autonomous_sessions.sessions[1],
    blocked_by_conflict: true,
    ready_on_dependency: false,
  };

  const result = applyOperatorControlAction(initialState, {
    type: "resume_safe_sessions",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "pending");
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.status, "paused");
});

test("acknowledge_studio_risk persists the current top studio risk acknowledgement", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "acknowledge_studio_risk",
  });

  assert.equal(result.changed, true);
  assert.equal((result.state.studio_risk_acknowledgements?.length ?? 0) > 0, true);
});

test("prioritize_review_queue updates review ordering safely", () => {
  const initialState = createOperatorDashboardDemoState();
  const baseReviewPackage = initialState.review_packages?.[0];
  if (!baseReviewPackage) {
    throw new Error("Expected review package.");
  }
  initialState.review_packages = [
    ...(initialState.review_packages ?? []),
    {
      ...baseReviewPackage,
    },
  ];
  if (!initialState.review_packages?.[1]) {
    throw new Error("Expected duplicated review package.");
  }
  initialState.review_packages[0] = {
    ...initialState.review_packages[0],
    package_id: "review-low-priority",
    work_item_id: "review-low-priority",
    status: "deferred",
    recommended_decision: "defer",
  };
  initialState.review_packages[1] = {
    ...initialState.review_packages[1],
    package_id: "review-high-priority",
    work_item_id: "review-high-priority",
    status: "pending",
    recommended_decision: "approve",
  };

  const result = applyOperatorControlAction(initialState, {
    type: "prioritize_review_queue",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.review_packages?.[0]?.package_id, "review-high-priority");
});

test("request_studio_summary creates a persisted studio summary package", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "request_studio_summary",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.studio_summary_package?.recommended_next_operator_action.length ? true : false, true);
});

test("merge_autonomous_sessions consolidates the source session into the target", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "merge_autonomous_sessions",
    session_id: "demo-session-bugfix-delivery",
    target_session_id: "demo-session-feature-ui",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.status, "completed");
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.queued_work_item_count, 2);
});

test("terminate_autonomous_session marks the session failed and removes it from runnable work", () => {
  const initialState = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(initialState, {
    type: "terminate_autonomous_session",
    session_id: "demo-session-feature-ui",
  });

  assert.equal(result.changed, true);
  assert.equal(result.state.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "failed");
  assert.equal(result.state.autonomous_sessions?.runnable_session_ids.includes("demo-session-feature-ui"), false);
});
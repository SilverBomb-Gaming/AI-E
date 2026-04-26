import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorDashboardState } from "./operatorDashboardState";
import { summarizeOperatorDashboardState } from "./operatorDashboardState";
import { runExecutionLoopController } from "./executionLoopController";

function createGoal(overrides: Partial<OperatorDashboardState["queued_goals"][number]> & { goal_id: string; description: string }) {
  return {
    goal_id: overrides.goal_id,
    description: overrides.description,
    priority: overrides.priority ?? "medium",
    status: overrides.status ?? "pending",
    explanation: overrides.explanation ?? `${overrides.description} is ready.`,
    recommended_action: overrides.recommended_action ?? null,
    depends_on_goal_ids: [...(overrides.depends_on_goal_ids ?? [])],
    blocking_goal_ids: [...(overrides.blocking_goal_ids ?? [])],
    conflict_goal_ids: [...(overrides.conflict_goal_ids ?? [])],
    last_updated_at: overrides.last_updated_at ?? "2026-04-26T12:00:00.000Z",
  };
}

function createState(): OperatorDashboardState {
  return {
    active_goal: createGoal({
      goal_id: "goal-active",
      description: "Advance active runtime goal",
      status: "active",
      priority: "high",
      explanation: "The active goal is ready to continue.",
    }),
    queued_goals: [
      createGoal({
        goal_id: "goal-queued",
        description: "Queued follow-up runtime goal",
      }),
    ],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: [],
    conflict_blockers: [],
    recent_failures: [],
    recovery_recommendations: [],
    approvals_required: [],
    validation_issues: [],
    runtime_status: {
      status: "runtime_ready",
      explanation: "The runtime is ready.",
    },
    session_status: {
      status: "session_running",
      explanation: "The session is running.",
    },
    queue_status: {
      status: "queue_running",
      explanation: "Queued work is available.",
    },
    scheduler_status: {
      status: "goal_selected",
      explanation: "An active goal is selected.",
    },
    last_updated_at: "2026-04-26T12:00:00.000Z",
  };
}

test("approval intent triggers bounded execution loop", () => {
  const result = runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: createState(),
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_executed");
  assert.equal(result.triggered, true);
  assert.equal(result.queue_result?.sessions_run, 1);
  assert.equal(result.updated_dashboard_state.active_goal?.goal_id, "goal-active");
});

test("pause intent does not start execution loop", () => {
  const state = createState();
  const result = runExecutionLoopController({
    runtime_intent: "pause_active_goal",
    dashboard_state: state,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_not_triggered");
  assert.equal(result.triggered, false);
  assert.equal(result.updated_dashboard_state.active_goal?.goal_id, state.active_goal?.goal_id);
});

test("bounded loop respects priority ordering", () => {
  const state = createState();
  state.active_goal = null;
  state.queued_goals = [
    createGoal({ goal_id: "goal-low", description: "Low priority goal", priority: "low" }),
    createGoal({ goal_id: "goal-high", description: "High priority goal", priority: "high" }),
  ];

  const result = runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: state,
    timestamp: "2026-04-26T12:01:00.000Z",
    max_sessions_per_run: 1,
  });

  assert.equal(result.queue_result?.run_results[0]?.session.session_id, "goal-high");
  assert.equal(result.updated_dashboard_state.active_goal?.goal_id, "goal-high");
  assert.equal(result.updated_dashboard_state.queued_goals.some((goal) => goal.goal_id === "goal-low"), true);
});

test("bounded loop respects dependency ordering", () => {
  const state = createState();
  state.active_goal = null;
  state.queued_goals = [
    createGoal({
      goal_id: "goal-dependent",
      description: "Dependent goal",
      priority: "high",
      depends_on_goal_ids: ["goal-prereq"],
    }),
    createGoal({
      goal_id: "goal-prereq",
      description: "Prerequisite goal",
      priority: "medium",
    }),
  ];

  const result = runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: state,
    timestamp: "2026-04-26T12:01:00.000Z",
    max_sessions_per_run: 1,
  });

  assert.equal(result.queue_result?.run_results[0]?.session.session_id, "goal-prereq");
  assert.equal(result.updated_dashboard_state.active_goal?.goal_id, "goal-prereq");
  assert.equal(result.updated_dashboard_state.blocked_goals.some((goal) => goal.goal_id === "goal-dependent"), true);
});

test("validation issues block execution loop start", () => {
  const state = createState();
  state.validation_issues = [{
    goal_id: "goal-active",
    source: "session_runtime",
    status: "validation_failed",
    recommendation: "review",
    summary: "Validation failed.",
  }];

  const result = runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: state,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_blocked");
  assert.equal(result.triggered, false);
});

test("execution loop behavior is deterministic", () => {
  const first = summarizeOperatorDashboardState(runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: createState(),
    timestamp: "2026-04-26T12:01:00.000Z",
  }).updated_dashboard_state);
  const second = summarizeOperatorDashboardState(runExecutionLoopController({
    runtime_intent: "grant_session_approval",
    dashboard_state: createState(),
    timestamp: "2026-04-26T12:01:00.000Z",
  }).updated_dashboard_state);

  assert.equal(first, second);
});
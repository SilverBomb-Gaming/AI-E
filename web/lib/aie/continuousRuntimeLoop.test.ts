import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import type { OperatorDashboardState } from "./operatorDashboardState";
import {
  createContinuousRuntimeLoopClock,
  runContinuousRuntimeLoop,
  summarizeContinuousRuntimeLoop,
} from "./continuousRuntimeLoop";
import {
  createRuntimeStateStore,
  loadRuntimeState,
  persistRuntimeStateRecord,
  saveRuntimeState,
} from "./runtimeStateStore";
import {
  createSupervisedAutonomySessionId,
} from "./supervisedAutonomySession";

function createStoppedService() {
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    require_supervised_scope: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  return stopBackgroundRuntimeService({
    ...service,
    started_at: "2026-04-26T11:50:00.000Z",
    stopped_at: "2026-04-26T11:55:00.000Z",
    last_tick_at: "2026-04-26T11:55:00.000Z",
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
}

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

function createDashboardState(): OperatorDashboardState {
  return {
    active_goal: createGoal({
      goal_id: "goal-active",
      description: "Advance active runtime goal",
      priority: "high",
      status: "active",
      explanation: "The active goal is ready to continue.",
    }),
    queued_goals: [createGoal({
      goal_id: "goal-queued",
      description: "Queued follow-up runtime goal",
      priority: "medium",
    })],
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

function createSeededRuntimeRecord(mutateState?: (state: OperatorDashboardState) => void) {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = {
    ...createStoppedService(),
    status: "service_idle" as const,
    stop_reason: "not_started" as const,
    blockers: [],
  };
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected a persisted runtime record.");
  }

  currentRecord.operator_dashboard_state = createDashboardState();
  mutateState?.(currentRecord.operator_dashboard_state);
  const persistedRecord = persistRuntimeStateRecord(store, currentRecord);

  return {
    store,
    record: persistedRecord,
  };
}

function attachSupervisedSession(seeded: ReturnType<typeof createSeededRuntimeRecord>, overrides: Partial<NonNullable<ReturnType<typeof loadRuntimeState>["supervised_session"]>> = {}) {
  const currentRecord = loadRuntimeState(seeded.store, seeded.record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected persisted runtime record.");
  }

  currentRecord.supervised_session = {
    session_id: createSupervisedAutonomySessionId(seeded.record.runtime_id, "2026-04-26T12:00:00.000Z"),
    runtime_id: seeded.record.runtime_id,
    status: "running",
    started_at: "2026-04-26T12:00:00.000Z",
    stopped_at: null,
    duration_ms: 0,
    max_duration_ms: 3_600_000,
    tick_budget: 4,
    ticks_completed: 0,
    max_chain_count: 4,
    agent_ids: ["planner-agent", "executor-agent", "validator-agent", "reporter-agent"],
    active_chain_ids: [],
    completed_chain_ids: [],
    failed_chain_ids: [],
    safety_scope: "bounded_multi_agent_runtime",
    approval_policy: "operator_must_approve_start",
    recovery_policy: "request_operator_review",
    last_checkpoint_at: null,
    stop_reason: null,
    last_recovery_action: "none",
    next_scheduled_tick_at: null,
    latest_timeline_event_id: null,
    pending_operator_review: false,
    ...overrides,
  };

  return {
    store: seeded.store,
    record: persistRuntimeStateRecord(seeded.store, currentRecord),
  };
}

test("loop runs multiple cycles", () => {
  const seeded = createSeededRuntimeRecord();
  const result = runContinuousRuntimeLoop(
    seeded.store,
    {
      runtime_id: seeded.record.runtime_id,
      profile_name: "bounded_batch",
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  );

  assert.equal(result.ticks.length >= 2, true);
  assert.equal(result.runtime_state?.continuous_loop?.ticks_attempted, result.ticks.length);
  assert.equal(result.runtime_state?.agent_runtime_registry?.agents.length, 4);
  assert.equal((result.runtime_state?.execution_chains ?? []).length >= 1, true);
});

test("loop respects tick interval", () => {
  const seeded = createSeededRuntimeRecord();
  const times = ["2026-04-26T12:01:00.000Z", "2026-04-26T12:01:30.000Z"];
  let index = 0;
  const clock = {
    nextTickTime() {
      const value = times[index];
      if (!value) {
        throw new Error("No more deterministic clock values available.");
      }
      index += 1;
      return value;
    },
  };

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:01:00.000Z",
  }, clock);

  assert.equal(result.status, "loop_stopped");
  assert.equal(result.ticks.length, 1);
  assert.match(result.reason, /tick interval/i);
});

test("loop stops on blocker", () => {
  const seeded = createSeededRuntimeRecord((state) => {
    state.active_goal = null;
    state.queued_goals = [];
    state.blocked_goals = [{
      ...createGoal({
        goal_id: "goal-blocked",
        description: "Blocked goal",
      }),
      blocker_type: "dependency",
      blocker_ids: ["goal-prereq"],
    }];
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_blocked");
  assert.equal(result.ticks.length, 1);
  assert.equal(result.ticks[0]?.event_type, "tick_blocked");
  assert.equal(result.ticks[0]?.safety_gate_result, "blocked");
});

test("loop stops on validation failure", () => {
  const seeded = createSeededRuntimeRecord((state) => {
    state.validation_issues = [{
      goal_id: "goal-active",
      source: "session_runtime",
      status: "validation_failed",
      recommendation: "review",
      summary: "Validation failed.",
    }];
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_blocked");
  assert.equal(result.ticks.length, 1);
  assert.equal(result.ticks[0]?.event_type, "tick_blocked");
  assert.equal(result.ticks[0]?.safety_gate_result, "blocked");
});

test("loop stops on approval requirement", () => {
  const seeded = createSeededRuntimeRecord((state) => {
    state.approvals_required = [{
      goal_id: "goal-active",
      approvals_needed: ["session"],
      reason: "Session approval required.",
      recommended_action: "Grant session approval.",
    }];
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_paused");
  assert.equal(result.ticks.length, 1);
  assert.equal(result.ticks[0]?.event_type, "tick_blocked");
  assert.equal(result.ticks[0]?.safety_gate_result, "blocked");
  assert.equal(result.ticks[0]?.mutation_applied, null);
});

test("loop stops on max ticks", () => {
  const seeded = createSeededRuntimeRecord();
  const result = runContinuousRuntimeLoop(
    seeded.store,
    {
      runtime_id: seeded.record.runtime_id,
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  );

  assert.equal(result.status, "loop_stopped");
  assert.equal(result.runtime_state?.continuous_loop?.ticks_attempted, 2);
  assert.equal(result.runtime_state?.continuous_loop?.tick_history[0]?.goal_transition.changed, false);
  assert.match(result.runtime_state?.continuous_loop?.tick_history[0]?.mutation_summary ?? "", /runtime/i);
  assert.equal(result.runtime_state?.continuous_loop?.tick_history[0]?.runtime_id, seeded.record.runtime_id);
  assert.equal(result.runtime_state?.continuous_loop?.tick_history[0]?.event_type, "tick_executed");
  assert.equal(result.runtime_state?.continuous_loop?.tick_history[0]?.safety_gate_result, "passed");
  assert.equal(result.runtime_state?.continuous_loop?.tick_history[0]?.persistence_result, "persisted_to_runtime_state");
  assert.match(result.runtime_state?.continuous_loop?.tick_history[0]?.mutation_summary ?? "", /executor-agent/i);
  assert.match(result.runtime_state?.continuous_loop?.tick_history[0]?.mutation_summary ?? "", /execution chain/i);
});

test("loop completes when no work remains", () => {
  const seeded = createSeededRuntimeRecord((state) => {
    state.active_goal = null;
    state.queued_goals = [];
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_completed");
  assert.equal(result.ticks.length, 1);
  assert.equal(result.ticks[0]?.event_type, "tick_observed");
  assert.equal(result.ticks[0]?.safety_gate_result, "not_triggered");
});

test("loop persists state after each cycle", () => {
  const seeded = createSeededRuntimeRecord();
  const result = runContinuousRuntimeLoop(
    seeded.store,
    {
      runtime_id: seeded.record.runtime_id,
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  );
  const persisted = loadRuntimeState(seeded.store, seeded.record.runtime_id);

  assert.equal(persisted?.continuous_loop?.ticks_attempted, result.ticks.length);
  assert.equal(persisted?.last_tick_at, result.runtime_state?.last_tick_at);
  assert.equal(persisted?.agent_runtime_registry?.agents.some((agent) => agent.agent_id === "reporter-agent"), true);
  assert.equal((persisted?.execution_chains ?? []).length >= 1, true);
});

test("loop writes supervised session checkpoints", () => {
  const seeded = attachSupervisedSession(createSeededRuntimeRecord());
  const result = runContinuousRuntimeLoop(
    seeded.store,
    {
      runtime_id: seeded.record.runtime_id,
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  );

  assert.equal((result.runtime_state?.supervised_checkpoints ?? []).length >= 1, true);
  assert.equal(result.runtime_state?.supervised_session?.ticks_completed, result.runtime_state?.continuous_loop?.ticks_completed);
  assert.equal(result.runtime_state?.supervised_session?.last_checkpoint_at, result.runtime_state?.last_tick_at);
});

test("loop enforces supervised session tick budget", () => {
  const seeded = attachSupervisedSession(createSeededRuntimeRecord(), {
    tick_budget: 0 + 1,
    ticks_completed: 1,
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_stopped");
  assert.match(result.reason, /tick budget/i);
});

test("loop persists bounded supervised recovery decision on failure", () => {
  const seeded = attachSupervisedSession(createSeededRuntimeRecord((state) => {
    state.validation_issues = [{
      goal_id: "goal-active",
      source: "session_runtime",
      status: "validation_failed",
      recommendation: "review",
      summary: "Validation failed.",
    }];
  }), {
    recovery_policy: "request_operator_review",
  });

  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "loop_blocked");
  assert.equal(result.runtime_state?.supervised_session?.status, "safety_blocked");
  assert.equal(result.runtime_state?.supervised_session?.pending_operator_review, true);
});

test("loop enforces overnight recovery queue and resume metadata", () => {
  const seeded = attachSupervisedSession(createSeededRuntimeRecord((state) => {
    state.validation_issues = [{
      goal_id: "goal-active",
      source: "session_runtime",
      status: "validation_failed",
      recommendation: "review",
      summary: "Validation failed.",
    }];
  }), {
    recovery_policy: "request_operator_review",
    overnight_policy: {
      policy_id: "overnight-policy-1",
      session_id: "overnight-session-1",
      max_runtime_hours: 6,
      allowed_time_window: {
        start_time: "00:00",
        end_time: "23:59",
      },
      max_tick_count: 4,
      max_chain_count: 4,
      max_retries_per_chain: 0,
      max_recovery_attempts: 2,
      requires_operator_review_before_commit: true,
      allowed_agent_roles: ["planner", "executor", "validator"],
      disallowed_actions: ["commit_changes"],
      shutdown_on_failure_count: 2,
      checkpoint_interval_ticks: 1,
      review_queue_enabled: true,
    },
    review_queue: [],
    active_recovery: null,
    resume_state: {
      resume_status: "resume_ready",
      restart_count: 0,
      resumed_from_checkpoint_id: null,
      resumed_at: null,
      preserved_review_queue_count: 0,
      shutdown_reason: null,
    },
    failure_count: 0,
  });

  const first = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    started_at: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(first.status, "loop_blocked");
  assert.equal(first.runtime_state?.supervised_session?.review_queue?.length, 1);
  assert.equal(first.runtime_state?.supervised_session?.active_recovery?.selected_outcome, "request_operator_review");
  assert.equal(first.runtime_state?.supervised_session?.failure_count, 1);

  const second = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 60_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:05:00.000Z",
  }, createContinuousRuntimeLoopClock("2026-04-26T12:05:00.000Z", 60_000));

  assert.equal(second.runtime_state?.supervised_session?.resume_state?.resume_status, "resumed_from_checkpoint");
  assert.equal(second.runtime_state?.supervised_session?.resume_state?.restart_count, 1);
  assert.equal(Boolean(second.runtime_state?.supervised_session?.resume_state?.resumed_from_checkpoint_id), true);
});

test("loop integrates with executionLoopController", () => {
  const seeded = createSeededRuntimeRecord();
  const result = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 60_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:01:00.000Z",
  }, createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000));

  assert.equal(result.runtime_state?.last_trigger_result?.status, "loop_executed");
  assert.equal(result.runtime_state?.operator_dashboard_state?.active_goal?.goal_id, "goal-active");
  assert.equal(result.runtime_state?.agent_runtime_registry?.agents.find((agent) => agent.agent_id === "executor-agent")?.status, "assigned");
  assert.equal(result.runtime_state?.execution_chains?.[0]?.status, "active");
});

test("loop can continue across separate invocations when queue state is preserved", () => {
  const seeded = createSeededRuntimeRecord((state) => {
    state.active_goal = createGoal({
      goal_id: "goal-approval-gate",
      description: "Complete live runtime approval gate",
      priority: "high",
      status: "active",
    });
    state.queued_goals = [
      createGoal({
        goal_id: "goal-queued-prereq",
        description: "Complete queued prerequisite cycle",
        priority: "medium",
      }),
      createGoal({
        goal_id: "goal-dependent",
        description: "Complete dependent follow-up cycle",
        priority: "medium",
        depends_on_goal_ids: ["goal-queued-prereq"],
      }),
    ];
  });

  const first = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 1_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:01:00.000Z",
  }, createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 1_000));

  const second = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 1_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:01:01.000Z",
    existing_queue: first.last_queue,
  }, createContinuousRuntimeLoopClock("2026-04-26T12:01:01.000Z", 1_000));

  const third = runContinuousRuntimeLoop(seeded.store, {
    runtime_id: seeded.record.runtime_id,
    tick_interval_ms: 1_000,
    max_ticks_per_run: 1,
    max_runs_per_invocation: 1,
    started_at: "2026-04-26T12:01:02.000Z",
    existing_queue: second.last_queue,
  }, createContinuousRuntimeLoopClock("2026-04-26T12:01:02.000Z", 1_000));

  assert.equal(first.runtime_state?.operator_dashboard_state?.active_goal?.goal_id, "goal-queued-prereq");
  assert.equal(first.runtime_state?.operator_dashboard_state?.completed_goals.some((goal) => goal.goal_id === "goal-approval-gate"), true);
  assert.equal(second.runtime_state?.operator_dashboard_state?.active_goal?.goal_id, "goal-dependent");
  assert.equal(second.runtime_state?.operator_dashboard_state?.completed_goals.some((goal) => goal.goal_id === "goal-queued-prereq"), true);
  assert.equal(third.runtime_state?.operator_dashboard_state?.active_goal, null);
  assert.equal(third.runtime_state?.operator_dashboard_state?.completed_goals.some((goal) => goal.goal_id === "goal-dependent"), true);
});

test("deterministic loop behavior", () => {
  const firstSeeded = createSeededRuntimeRecord();
  const secondSeeded = createSeededRuntimeRecord();

  const first = summarizeContinuousRuntimeLoop(runContinuousRuntimeLoop(
    firstSeeded.store,
    {
      runtime_id: firstSeeded.record.runtime_id,
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  ));
  const second = summarizeContinuousRuntimeLoop(runContinuousRuntimeLoop(
    secondSeeded.store,
    {
      runtime_id: secondSeeded.record.runtime_id,
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-26T12:01:00.000Z",
    },
    createContinuousRuntimeLoopClock("2026-04-26T12:01:00.000Z", 60_000),
  ));

  assert.equal(first, second);
});
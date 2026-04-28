import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import {
  applyOperatorActionToProviderState,
  loadDemoOperatorDashboardState,
  loadLiveOperatorDashboardState,
  loadOperatorDashboardState,
  resolveOperatorStateSource,
  summarizeOperatorStateProviderResult,
} from "./operatorRuntimeStateProvider";
import type { OperatorRuntimeStateProviderResult } from "./operatorRuntimeStateContract";
import { createRuntimeStateStore, loadRuntimeState, persistRuntimeStateRecord, saveRuntimeState } from "./runtimeStateStore";

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

test("provider returns demo_seed when no live runtime exists", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });

  assert.equal(result.source, "demo_seed");
  assert.equal(result.dashboard_state?.active_goal?.description, "Stabilize KBM input lane");
});

test("provider labels demo state clearly", () => {
  const result = loadDemoOperatorDashboardState("2026-04-26T12:00:00.000Z");

  assert.equal(result.source, "demo_seed");
  assert.match(result.warnings.join(" "), /seeded demo state/i);
});

test("provider returns live_runtime when runtime state exists", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(result.source, "live_runtime");
  assert.equal(result.dashboard_state?.runtime_status.status, record.last_status);
  assert.equal(result.dashboard_state?.runtime_observability?.current_tick, 0);
  assert.equal(result.dashboard_state?.agent_runtime?.agents.length, 4);
  assert.equal(result.dashboard_state?.execution_chains?.length, 0);
});

test("provider maps persisted continuous loop history into runtime observability", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected persisted runtime record.");
  }

  currentRecord.operator_dashboard_state = {
    ...(loadDemoOperatorDashboardState("2026-04-26T12:00:00.000Z").dashboard_state as NonNullable<OperatorRuntimeStateProviderResult["dashboard_state"]>),
    active_goal: null,
    queued_goals: [],
    blocked_goals: [],
    approvals_required: [],
    runtime_status: {
      status: "runtime_idle",
      explanation: "No runtime state is currently active.",
    },
    scheduler_status: {
      status: "scheduler_idle",
      explanation: "All queued goals are paused, blocked, completed, dependency-blocked, or conflict with an active goal.",
    },
  };
  currentRecord.continuous_loop = {
    status: "loop_stopped",
    started_at: "2026-04-26T12:01:00.000Z",
    stopped_at: "2026-04-26T12:02:00.000Z",
    last_tick_at: "2026-04-26T12:02:00.000Z",
    ticks_attempted: 2,
    ticks_completed: 2,
    last_trigger_result: {
      status: "loop_running",
      reason: "Completed bounded runtime tick.",
      triggered: true,
      run_results_recorded: 1,
    },
    reason: "Loop stopped after bounded ticks.",
    tick_history: [{
      tick_id: "tick-2",
      event_id: "tick-2",
      runtime_id: record.runtime_id,
      attempted_at: "2026-04-26T12:02:00.000Z",
      timestamp: "2026-04-26T12:02:00.000Z",
      tick_index: 2,
      status: "loop_running",
      event_type: "goal_transition",
      triggered: true,
      run_results_recorded: 1,
      reason: "Completed bounded runtime tick.",
      active_goal_before: {
        goal_id: "goal-a",
        goal_label: "Complete queued prerequisite cycle",
      },
      active_goal_after: null,
      mutation_applied: "Completed bounded runtime tick. | Queue 1 -> 0 | Runtime runtime_ready -> runtime_idle | Scheduler goal_selected -> scheduler_idle",
      safety_gate_result: "passed",
      scheduler_decision: "All queued goals are paused, blocked, completed, dependency-blocked, or conflict with an active goal.",
      persistence_result: "persisted_to_runtime_state",
      goal_transition: {
        changed: true,
        from_goal_id: "goal-a",
        to_goal_id: null,
        from_goal_label: "Complete queued prerequisite cycle",
        to_goal_label: null,
        summary: "Goal focus cleared after Complete queued prerequisite cycle completed or yielded control.",
      },
      semantic_progression: {
        queue_count_before: 1,
        queue_count_after: 0,
        blocked_count_before: 0,
        blocked_count_after: 0,
        runtime_status_before: "runtime_ready",
        runtime_status_after: "runtime_idle",
        scheduler_status_before: "goal_selected",
        scheduler_status_after: "scheduler_idle",
      },
      mutation_summary: "Completed bounded runtime tick. | Queue 1 -> 0 | Runtime runtime_ready -> runtime_idle | Scheduler goal_selected -> scheduler_idle",
      next_scheduled_action: "All queued goals are paused, blocked, completed, dependency-blocked, or conflict with an active goal.",
    }],
  };
  currentRecord.agent_runtime_registry = {
    registry_id: "aie-agent-registry-20260426120000",
    runtime_id: record.runtime_id,
    orchestration_id: null,
    multi_agent_session_id: "multi-agent-session-test",
    recursion_guard_enabled: true,
    max_agents: 4,
    agents: [
      {
        agent_id: "planner-agent",
        role: "planner",
        status: "idle",
        assigned_goal_ids: [],
        current_goal_id: null,
        last_tick_at: "2026-04-26T12:02:00.000Z",
        last_event_id: "tick-2-planner",
        last_event_summary: "planner-agent selected Complete queued prerequisite cycle for bounded execution.",
        safety_scope: "planning_only",
        approval_state: "not_required",
        failure_count: 0,
        can_spawn_agents: false,
        max_concurrent_goals: 1,
      },
      {
        agent_id: "executor-agent",
        role: "executor",
        status: "idle",
        assigned_goal_ids: [],
        current_goal_id: null,
        last_tick_at: "2026-04-26T12:02:00.000Z",
        last_event_id: "tick-2-executor",
        last_event_summary: "executor-agent completed or yielded Complete queued prerequisite cycle.",
        safety_scope: "bounded_execution_only",
        approval_state: "approved",
        failure_count: 0,
        can_spawn_agents: false,
        max_concurrent_goals: 1,
      },
      {
        agent_id: "validator-agent",
        role: "validator",
        status: "idle",
        assigned_goal_ids: [],
        current_goal_id: null,
        last_tick_at: "2026-04-26T12:02:00.000Z",
        last_event_id: "tick-2-validator",
        last_event_summary: "validator-agent cleared the bounded runtime transition.",
        safety_scope: "validation_only",
        approval_state: "not_required",
        failure_count: 0,
        can_spawn_agents: false,
        max_concurrent_goals: 1,
      },
      {
        agent_id: "reporter-agent",
        role: "reporter",
        status: "idle",
        assigned_goal_ids: [],
        current_goal_id: null,
        last_tick_at: "2026-04-26T12:02:00.000Z",
        last_event_id: "tick-2-reporter",
        last_event_summary: "reporter-agent persisted chain telemetry.",
        safety_scope: "reporting_only",
        approval_state: "not_required",
        failure_count: 0,
        can_spawn_agents: false,
        max_concurrent_goals: 1,
      },
    ],
  };
  currentRecord.execution_chains = [{
    chain_id: "execution-chain-goal-a-20260426120200",
    parent_goal_id: "goal-a",
    current_step: 2,
    total_steps: 4,
    status: "completed",
    agent_ids: ["planner-agent", "executor-agent", "validator-agent", "reporter-agent"],
    started_at: "2026-04-26T12:01:00.000Z",
    completed_at: "2026-04-26T12:02:00.000Z",
    failure_reason: null,
    last_transition: "Completed bounded runtime tick.",
    safety_status: "safe",
  }];
  persistRuntimeStateRecord(store, currentRecord);

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:03:00.000Z",
  });

  assert.equal(result.dashboard_state?.runtime_observability?.current_tick, 2);
  assert.equal(result.dashboard_state?.runtime_observability?.last_mutation, currentRecord.continuous_loop.tick_history[0].mutation_applied);
  assert.equal(result.dashboard_state?.runtime_observability?.last_semantic_transition, currentRecord.continuous_loop.tick_history[0].goal_transition.summary);
  assert.equal(result.dashboard_state?.runtime_observability?.latest_safety_gate_decision, "passed");
  assert.equal(result.dashboard_state?.runtime_observability?.event_log[0]?.goal_transition?.changed, true);
  assert.equal(result.dashboard_state?.runtime_observability?.event_log[0]?.event_type, "goal_transition");
  assert.match(result.dashboard_state?.runtime_observability?.next_scheduled_action ?? "", /queued goals/i);
  assert.equal(result.dashboard_state?.agent_runtime?.idle_agents.length, 4);
  assert.equal(result.dashboard_state?.agent_runtime?.agents[0]?.last_event_summary?.includes("planner-agent"), true);
  assert.equal(result.dashboard_state?.execution_chains?.[0]?.chain_id, "execution-chain-goal-a-20260426120200");
});

test("provider does not treat timestamp-only runtime observations as semantic progress", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected persisted runtime record.");
  }

  currentRecord.operator_dashboard_state = {
    ...(loadDemoOperatorDashboardState("2026-04-26T12:00:00.000Z").dashboard_state as NonNullable<OperatorRuntimeStateProviderResult["dashboard_state"]>),
    active_goal: null,
    queued_goals: [],
    blocked_goals: [],
    approvals_required: [],
    runtime_status: {
      status: "runtime_idle",
      explanation: "No runtime state is currently active.",
    },
    scheduler_status: {
      status: "scheduler_idle",
      explanation: "No runnable work is currently scheduled.",
    },
  };
  currentRecord.continuous_loop = {
    status: "loop_stopped",
    started_at: "2026-04-26T12:01:00.000Z",
    stopped_at: "2026-04-26T12:02:00.000Z",
    last_tick_at: "2026-04-26T12:02:00.000Z",
    ticks_attempted: 1,
    ticks_completed: 0,
    last_trigger_result: {
      status: "loop_stopped",
      reason: "Continuous runtime loop observed no runnable work.",
      triggered: false,
      run_results_recorded: 0,
    },
    reason: "Continuous runtime loop observed no runnable work.",
    tick_history: [{
      tick_id: "tick-observed",
      event_id: "tick-observed",
      runtime_id: record.runtime_id,
      attempted_at: "2026-04-26T12:02:00.000Z",
      timestamp: "2026-04-26T12:02:00.000Z",
      tick_index: 1,
      status: "loop_stopped",
      event_type: "tick_observed",
      triggered: false,
      run_results_recorded: 0,
      reason: "Continuous runtime loop observed no runnable work.",
      active_goal_before: null,
      active_goal_after: null,
      mutation_applied: null,
      safety_gate_result: "not_triggered",
      scheduler_decision: "No runnable work is currently scheduled.",
      persistence_result: "persisted_to_runtime_state",
      goal_transition: {
        changed: false,
        from_goal_id: null,
        to_goal_id: null,
        from_goal_label: null,
        to_goal_label: null,
        summary: "No active goal owned the slot before or after the runtime gate decision.",
      },
      semantic_progression: {
        queue_count_before: 0,
        queue_count_after: 0,
        blocked_count_before: 0,
        blocked_count_after: 0,
        runtime_status_before: "runtime_idle",
        runtime_status_after: "runtime_idle",
        scheduler_status_before: "scheduler_idle",
        scheduler_status_after: "scheduler_idle",
      },
      mutation_summary: "Continuous runtime loop observed no runnable work.",
      next_scheduled_action: "No runnable work is currently scheduled.",
    }],
  };
  persistRuntimeStateRecord(store, currentRecord);

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:03:00.000Z",
  });

  assert.equal(result.dashboard_state?.runtime_observability?.last_mutation, null);
  assert.equal(result.dashboard_state?.runtime_observability?.last_semantic_transition, null);
  assert.equal(result.dashboard_state?.runtime_observability?.latest_safety_gate_decision, "not_triggered");
  assert.equal(result.dashboard_state?.runtime_observability?.event_log[0]?.event_type, "tick_observed");
});

test("provider labels live state clearly", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.match(result.warnings.join(" "), /connected to live ai-e runtime state/i);
});

test("unavailable state is handled safely", async () => {
  const store = createRuntimeStateStore({
    records: {
      broken: "{not-valid-json",
    },
  });

  const result = await loadOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: "broken",
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(result.source, "unavailable");
  assert.equal(result.dashboard_state, null);
});

test("demo actions still work", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });
  const actionResult = applyOperatorActionToProviderState(result, {
    type: "pause_goal",
    goal_id: result.dashboard_state?.active_goal?.goal_id ?? null,
  });

  assert.equal(actionResult.result, "accepted");
  assert.equal(actionResult.dashboard_state?.runtime_status.status, "runtime_paused");
});

test("live supported mutation returns runtime intent metadata", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const providerResult = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  if (!providerResult.dashboard_state) {
    throw new Error("Expected live provider state.");
  }

  providerResult.dashboard_state = {
    ...providerResult.dashboard_state,
    blocked_goals: [{
      goal_id: "runtime-blocker-1",
      description: "Retry blocked live runtime lane",
      priority: "medium",
      status: "blocked",
      explanation: "Live retry candidate is blocked pending operator action.",
      recommended_action: "Retry after review.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:57:00.000Z",
      blocker_type: "status",
      blocker_ids: [],
    }],
    approvals_required: [],
  };

  const currentRecord = loadRuntimeState(store, record.runtime_id);
  if (!currentRecord) {
    throw new Error("Expected persisted runtime record.");
  }
  currentRecord.operator_dashboard_state = providerResult.dashboard_state;
  persistRuntimeStateRecord(store, currentRecord);

  const actionResult = applyOperatorActionToProviderState(providerResult, {
    type: "retry_goal",
    goal_id: "runtime-blocker-1",
  }, {
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(actionResult.result, "accepted");
  assert.equal(actionResult.runtime_intent, "mark_goal_retry_requested");
  assert.match(actionResult.reason, /returned to the queue for retry/i);
  assert.equal(actionResult.audit_event?.status, "mutation_applied");
  assert.equal(actionResult.dashboard_state?.blocked_goals.length, 0);
});

test("resolveOperatorStateSource is deterministic", () => {
  const first = resolveOperatorStateSource({ now: "2026-04-26T12:00:00.000Z" });
  const second = resolveOperatorStateSource({ now: "2026-04-26T12:00:00.000Z" });

  assert.equal(first, "demo_seed");
  assert.equal(first, second);
});

test("deterministic provider summary", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });

  const first = summarizeOperatorStateProviderResult(result);
  const second = summarizeOperatorStateProviderResult(result);

  assert.equal(first, second);
});
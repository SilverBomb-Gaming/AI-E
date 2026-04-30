import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import type { OperatorDashboardState } from "./operatorDashboardState";
import { createRuntimeStateStore, loadRuntimeState, persistRuntimeStateRecord, saveRuntimeState } from "./runtimeStateStore";
import {
  executeRuntimeMutation,
  summarizeRuntimeMutationResult,
} from "./runtimeMutationExecutor";

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

function createLiveDashboardState(): OperatorDashboardState {
  return {
    ...createOperatorDashboardDemoState(),
    active_goal: {
      goal_id: "live-active-goal",
      description: "Stabilize live runtime lane",
      priority: "high",
      status: "active",
      explanation: "Active live goal.",
      recommended_action: "Pause when review is required.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:59:00.000Z",
    },
    queued_goals: [{
      goal_id: "queued-goal",
      description: "Queued follow-up goal",
      priority: "medium",
      status: "pending",
      explanation: "Queued follow-up goal.",
      recommended_action: null,
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:58:00.000Z",
    }],
    blocked_goals: [{
      goal_id: "live-blocked-goal",
      description: "Retry live runtime lane",
      priority: "medium",
      status: "blocked",
      explanation: "Blocked live goal.",
      recommended_action: "Retry after review.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:57:00.000Z",
      blocker_type: "status",
      blocker_ids: [],
    }],
    completed_goals: [],
    paused_goals: [{
      goal_id: "live-paused-goal",
      description: "Resume live runtime lane",
      priority: "medium",
      status: "paused",
      explanation: "Paused live goal.",
      recommended_action: "Resume when ready.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:56:00.000Z",
    }],
    dependency_blockers: [],
    conflict_blockers: [],
    recent_failures: [{
      report_id: "live-report",
      created_at: "2026-04-26T11:57:00.000Z",
      source: "runtime_state_store",
      category: "stale_context",
      severity: "medium",
      recommendation: "request_operator_review",
      reason: "Review required before retry.",
    }],
    recovery_recommendations: [{
      report_id: "live-report",
      source: "runtime_state_store",
      category: "stale_context",
      severity: "medium",
      recommendation: "request_operator_review",
      retry_safe: false,
      operator_review_required: true,
      reason: "Review required before retry.",
    }],
    approvals_required: [{
      goal_id: "live-active-goal",
      approvals_needed: ["session"],
      reason: "Session approval required.",
      recommended_action: "Grant session approval.",
    }],
    validation_issues: [],
    runtime_status: {
      status: "runtime_blocked",
      explanation: "The runtime is waiting for operator action.",
    },
    session_status: {
      status: "session_waiting_for_approval",
      explanation: "The session is blocked pending approval.",
    },
    queue_status: {
      status: "queue_running",
      explanation: "Queued work is available.",
    },
    scheduler_status: {
      status: "goal_selected",
      explanation: "The runtime has a selected goal.",
    },
    last_updated_at: "2026-04-26T12:00:00.000Z",
  };
}

function createSeededRuntimeRecord(options: {
  staleAfterMs?: number;
  mutateRecord?: (record: ReturnType<typeof loadRuntimeState>) => void;
  mutateState?: (state: OperatorDashboardState) => void;
} = {}) {
  const store = createRuntimeStateStore({ stale_after_ms: options.staleAfterMs ?? 10 * 60 * 1000 });
  const service = {
    ...createStoppedService(),
    status: "service_blocked" as const,
    stop_reason: "blocker_detected" as const,
    blockers: [{ code: "approval_required", message: "Fresh approval is required." }],
  };
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected a persisted runtime record.");
  }

  currentRecord.operator_dashboard_state = createLiveDashboardState();
  options.mutateState?.(currentRecord.operator_dashboard_state);
  options.mutateRecord?.(currentRecord);
  const persistedRecord = persistRuntimeStateRecord(store, currentRecord);

  return {
    store,
    record: persistedRecord,
    state: persistedRecord.operator_dashboard_state!,
  };
}

test("approval intent updates runtime state", () => {
  const seeded = createSeededRuntimeRecord();

  const result = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.approvals_required.length, 0);
  assert.equal(result.execution_loop?.status, "loop_executed");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.active_goal?.goal_id, "live-active-goal");
});

test("pause intent pauses active goal", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "pause_active_goal",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.active_goal, null);
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.paused_goals[0]?.goal_id, "live-active-goal");
  assert.equal(result.updated_runtime_state.last_status, "service_paused");
});

test("resume intent resumes paused goal", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.active_goal = null;
      state.approvals_required = [];
      state.runtime_status.status = "runtime_paused";
      state.session_status.status = "session_paused";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_paused";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "resume_paused_goal",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-paused-goal",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_executed");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.active_goal?.goal_id, "live-paused-goal");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.paused_goals.some((goal) => goal.goal_id === "live-paused-goal"), false);
});

test("retry intent clears blocker", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.blockers = [];
      record.last_status = "service_idle";
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "mark_goal_retry_requested",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-blocked-goal",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_executed");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.blocked_goals.length, 0);
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.active_goal?.goal_id, "live-blocked-goal");
});

test("pause intent does not trigger execution loop", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "pause_active_goal",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.updated_runtime_state.last_status, "service_paused");
});

test("pause autonomous session persists through live runtime mutation without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    action: {
      type: "pause_autonomous_session",
      session_id: "demo-session-feature-ui",
    },
    runtime_intent: "pause_autonomous_session",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.continuous_runtime_loop, null);
  assert.equal(
    result.updated_runtime_state.operator_dashboard_state?.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status,
    "paused",
  );
});

test("pause_all_sessions pauses active autonomous sessions without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "pause_all_sessions",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.autonomous_sessions?.sessions.some((session) => session.status === "running" || session.status === "pending"), false);
  assert.equal(result.continuous_runtime_loop, null);
  assert.equal(result.updated_runtime_state.last_status, "service_paused");
});

test("resume_safe_sessions skips blocked paused sessions in persisted runtime state", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      if (!state.autonomous_sessions) {
        throw new Error("Expected autonomous sessions.");
      }
      state.autonomous_sessions.sessions = state.autonomous_sessions.sessions.map((session) => ({
        ...session,
        status: "paused",
        blocked_by_conflict: session.session_id === "demo-session-bugfix-delivery",
      }));
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_paused";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "resume_safe_sessions",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-feature-ui")?.status, "pending");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.autonomous_sessions?.sessions.find((session) => session.session_id === "demo-session-bugfix-delivery")?.status, "paused");
  assert.equal(result.continuous_runtime_loop, null);
});

test("acknowledge_studio_risk persists an acknowledgement record", () => {
  const seeded = createSeededRuntimeRecord();

  const result = executeRuntimeMutation({
    runtime_intent: "acknowledge_studio_risk",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal((result.updated_runtime_state.operator_dashboard_state?.studio_risk_acknowledgements?.length ?? 0) > 0, true);
});

test("approve_policy_recommendation persists meta policy changes without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });
  const recommendationId = seeded.state.meta_policy_recommendations?.[0]?.recommendation_id ?? null;

  const result = executeRuntimeMutation({
    action: {
      type: "approve_policy_recommendation",
      recommendation_id: recommendationId,
    },
    runtime_intent: "approve_policy_recommendation",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.meta_operator_decision_history?.[0]?.recommendation_id, recommendationId);
  assert.equal(Boolean(result.updated_runtime_state.operator_dashboard_state?.meta_policy_state?.last_updated_at), true);
});

test("request_meta_summary persists a meta summary package without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "request_meta_summary",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(Boolean(result.updated_runtime_state.operator_dashboard_state?.meta_summary_package?.narrative), true);
});

test("request_strategy_summary persists a strategy summary package without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "request_strategy_summary",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(Boolean(result.updated_runtime_state.operator_dashboard_state?.strategy_summary_package?.rationale), true);
});

test("decompose_strategy_goal persists advisory work without starting loops", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.runtime_status.status = "runtime_ready";
      state.session_status.status = "session_running";
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.last_status = "service_idle";
      record.blockers = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "decompose_strategy_goal",
    action: {
      type: "decompose_strategy_goal",
      goal_id: "strategy-ship-first-playable-loop",
    },
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.proposed_work_items?.some((item) => item.work_item_id === "strategy-ship-first-playable-loop-portfolio-brief"), true);
});

test("prioritize_review_queue updates persisted review ordering safely", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      const firstReview = createOperatorDashboardDemoState().review_packages?.[0];
      if (!firstReview) {
        throw new Error("Expected review package.");
      }
      state.review_packages = [
        {
          ...firstReview,
          package_id: "review-low-priority",
          work_item_id: "review-low-priority",
          status: "deferred",
          recommended_decision: "defer",
        },
        {
          ...firstReview,
          package_id: "review-high-priority",
          work_item_id: "review-high-priority",
          status: "pending",
          recommended_decision: "approve",
        },
      ];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "prioritize_review_queue",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.review_packages?.[0]?.package_id, "review-high-priority");
});

test("start supervised session persists bounded session metadata", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.supervised_session = null;
      state.supervised_checkpoints = [];
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.blockers = [];
      record.last_status = "service_idle";
      record.supervised_session = null;
      record.supervised_checkpoints = [];
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "start_supervised_session",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.supervised_session?.runtime_id, seeded.record.runtime_id);
  assert.equal(result.updated_runtime_state.supervised_session?.status, "pending_approval");
  assert.equal(result.continuous_runtime_loop, null);
});

test("pause supervised session does not trigger loop", () => {
  const runningSession = {
    session_id: "session-1",
    runtime_id: "runtime-1",
    status: "running" as const,
    started_at: "2026-04-26T12:00:00.000Z",
    stopped_at: null,
    duration_ms: 0,
    max_duration_ms: 3600000,
    tick_budget: 4,
    ticks_completed: 0,
    max_chain_count: 4,
    agent_ids: ["planner-agent"],
    active_chain_ids: [],
    completed_chain_ids: [],
    failed_chain_ids: [],
    safety_scope: "bounded_multi_agent_runtime" as const,
    approval_policy: "operator_must_approve_start" as const,
    recovery_policy: "request_operator_review" as const,
    last_checkpoint_at: null,
    stop_reason: null,
    last_recovery_action: "none" as const,
    next_scheduled_tick_at: null,
    latest_timeline_event_id: null,
    pending_operator_review: false,
  };

  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.supervised_session = runningSession;
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.blockers = [];
      record.last_status = "service_idle";
      record.supervised_session = {
        ...runningSession,
        runtime_id: record.runtime_id,
      };
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "pause_supervised_session",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.updated_runtime_state.supervised_session?.status, "paused");
  assert.equal(result.continuous_runtime_loop, null);
});

test("pause supervised session after approval preserves paused state", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [{
        goal_id: "live-active-goal",
        approvals_needed: ["session"],
        reason: "Session approval required.",
        recommended_action: "Grant session approval.",
      }];
      state.supervised_session = {
        session_id: "session-approval",
        runtime_id: "runtime-1",
        status: "pending_approval",
        started_at: "2026-04-26T12:00:00.000Z",
        stopped_at: null,
        duration_ms: 0,
        max_duration_ms: 3600000,
        tick_budget: 4,
        ticks_completed: 0,
        max_chain_count: 4,
        agent_ids: [],
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
      };
      state.supervised_checkpoints = [];
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.blockers = [{ code: "approval_required", message: "Fresh approval is required." }];
      record.last_status = "service_blocked";
      record.supervised_session = {
        session_id: "session-approval",
        runtime_id: record.runtime_id,
        status: "pending_approval",
        started_at: "2026-04-26T12:00:00.000Z",
        stopped_at: null,
        duration_ms: 0,
        max_duration_ms: 3600000,
        tick_budget: 4,
        ticks_completed: 0,
        max_chain_count: 4,
        agent_ids: [],
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
      };
      record.supervised_checkpoints = [];
      record.continuous_loop_config = {
        tick_interval_ms: 10_000,
        max_ticks_per_run: 1,
        max_runs_per_invocation: 1,
      };
    },
  });

  const approved = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:00:15.000Z",
    goal_id: "live-active-goal",
    start_continuous_loop: true,
    continuous_loop_config: { max_ticks_per_run: 1, tick_interval_ms: 10_000 },
  });

  const paused = executeRuntimeMutation({
    runtime_intent: "pause_supervised_session",
    current_runtime_state: approved.updated_runtime_state,
    current_dashboard_state: approved.updated_runtime_state.operator_dashboard_state!,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:00:20.000Z",
    start_continuous_loop: true,
  });

  assert.equal(paused.status, "mutation_applied");
  assert.equal(paused.updated_runtime_state.supervised_session?.status, "paused");
  assert.equal(paused.updated_runtime_state.operator_dashboard_state?.supervised_session?.status, "paused");
  assert.equal(paused.continuous_runtime_loop, null);
});

test("invalid intent rejected", () => {
  const seeded = createSeededRuntimeRecord();

  const result = executeRuntimeMutation({
    runtime_intent: "no_op",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "mutation_no_op");
});

test("mutation persists via runtimeStateStore", () => {
  const seeded = createSeededRuntimeRecord();

  executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  });

  const persisted = loadRuntimeState(seeded.store, seeded.record.runtime_id);
  assert.equal(persisted?.operator_dashboard_state?.approvals_required.length, 0);
  assert.equal(persisted?.persisted_at, "2026-04-26T12:01:00.000Z");
});

test("approval constraints enforced", () => {
  const seeded = createSeededRuntimeRecord({ staleAfterMs: 60_000 });

  const result = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:05:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "mutation_rejected");
  assert.match(result.reason, /requires operator review/i);
});

test("dependency constraints enforced", () => {
  const seeded = createSeededRuntimeRecord({
    mutateState(state) {
      state.approvals_required = [];
      state.blocked_goals = [{
        ...state.blocked_goals[0],
        blocker_type: "dependency",
        blocker_ids: ["dep-1"],
      }];
    },
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.blockers = [];
      record.last_status = "service_idle";
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "mark_goal_retry_requested",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-blocked-goal",
  });

  assert.equal(result.status, "mutation_rejected");
  assert.match(result.reason, /dependency constraints/i);
});

test("audit event generated for applied mutation", () => {
  const seeded = createSeededRuntimeRecord();

  const result = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.audit_event.status, "mutation_applied");
  assert.match(result.audit_event.audit_event_id, /runtime-mutation-executor/);
});

test("audit event generated for rejected mutation", () => {
  const seeded = createSeededRuntimeRecord({ staleAfterMs: 60_000 });

  const result = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:05:00.000Z",
    goal_id: "live-active-goal",
  });

  assert.equal(result.audit_event.status, "mutation_rejected");
});

test("deterministic mutation behavior", () => {
  const firstSeed = createSeededRuntimeRecord();
  const secondSeed = createSeededRuntimeRecord();

  const first = summarizeRuntimeMutationResult(executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: firstSeed.record,
    current_dashboard_state: firstSeed.state,
    runtime_state_store: firstSeed.store,
    runtime_id: firstSeed.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  }));
  const second = summarizeRuntimeMutationResult(executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: secondSeed.record,
    current_dashboard_state: secondSeed.state,
    runtime_state_store: secondSeed.store,
    runtime_id: secondSeed.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
  }));

  assert.equal(first, second);
});

test("mutation can start continuous runtime follow-up", () => {
  const seeded = createSeededRuntimeRecord({
    mutateRecord(record) {
      if (!record) {
        throw new Error("Expected runtime record.");
      }
      record.continuous_loop_config = {
        tick_interval_ms: 1_000,
        max_ticks_per_run: 2,
        max_runs_per_invocation: 2,
      };
    },
  });

  const result = executeRuntimeMutation({
    runtime_intent: "grant_session_approval",
    current_runtime_state: seeded.record,
    current_dashboard_state: seeded.state,
    runtime_state_store: seeded.store,
    runtime_id: seeded.record.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    goal_id: "live-active-goal",
    start_continuous_loop: true,
    continuous_loop_config: {
      max_ticks_per_run: 2,
    },
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.continuous_runtime_loop?.runtime_state?.continuous_loop?.ticks_attempted, 2);
  assert.equal(result.updated_runtime_state.continuous_loop?.ticks_attempted, 2);
  assert.equal(result.continuous_runtime_loop?.config.tick_interval_ms, 1_000);
  assert.equal(result.continuous_runtime_loop?.config.max_runs_per_invocation, 2);
});
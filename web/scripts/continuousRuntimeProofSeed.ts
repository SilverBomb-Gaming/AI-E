import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "../lib/aie/backgroundRuntimeService";
import type { OperatorDashboardState } from "../lib/aie/operatorDashboardState";
import {
  createRuntimeStateStore,
  loadRuntimeState,
  persistRuntimeStateRecord,
  saveRuntimeState,
  type RuntimeStateStore,
} from "../lib/aie/runtimeStateStore";
import { createSupervisedAutonomySessionId } from "../lib/aie/supervisedAutonomySession";

export type ContinuousRuntimeProofSeedPayload = {
  runtimeId: string;
  store: RuntimeStateStore;
};

export type ContinuousRuntimeProofSeedMode = "continuous-runtime" | "supervised-autonomy";

export type ContinuousRuntimeProofSeedOptions = {
  runtimeId?: string;
  mode?: ContinuousRuntimeProofSeedMode;
};

function isoOffset(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

function createGoal(
  overrides: Partial<OperatorDashboardState["queued_goals"][number]> & {
    goal_id: string;
    description: string;
  },
) {
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
    last_updated_at: overrides.last_updated_at ?? new Date().toISOString(),
  };
}

function createStoppedService(runtimeId: string, nowMs: number) {
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
    service_id: runtimeId,
    started_at: isoOffset(nowMs, -120_000),
    stopped_at: isoOffset(nowMs, -30_000),
    last_tick_at: isoOffset(nowMs, -30_000),
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
}

export function createContinuousRuntimeProofSeedPayload(options: ContinuousRuntimeProofSeedOptions = {}): ContinuousRuntimeProofSeedPayload {
  const nowMs = Date.now();
  const mode = options.mode ?? "continuous-runtime";
  const freshRuntimeId = options.runtimeId?.trim() || `live-semantic-proof-${nowMs}`;
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = {
    ...createStoppedService(freshRuntimeId, nowMs),
    status: "service_blocked" as const,
    stop_reason: "blocker_detected" as const,
    blockers: [{ code: "approval_required", message: "Fresh approval is required." }],
  };
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected a persisted runtime record.");
  }

  currentRecord.continuous_loop = {
    status: "loop_paused",
    started_at: null,
    stopped_at: null,
    last_tick_at: null,
    ticks_attempted: 0,
    ticks_completed: 0,
    last_trigger_result: null,
    reason: "Continuous runtime loop is waiting for fresh operator approval.",
    tick_history: [],
  };
  currentRecord.continuous_loop_config = {
    tick_interval_ms: mode === "supervised-autonomy" ? 10_000 : 1_000,
    max_ticks_per_run: mode === "supervised-autonomy" ? 1 : 3,
    max_runs_per_invocation: 1,
    require_fresh_approvals: true,
    require_fresh_context: true,
    stop_on_blocker: true,
    stop_on_error: true,
  };

  currentRecord.operator_dashboard_state = {
    active_goal: createGoal({
      goal_id: "goal-approval-gate",
      description: "Complete live runtime approval gate",
      priority: "high",
      status: "active",
      explanation: "The active goal is ready once approval clears.",
      recommended_action: "Approve the active goal to let runtime continue.",
    }),
    queued_goals: [
      createGoal({
        goal_id: "goal-queued-prereq",
        description: "Complete queued prerequisite cycle",
        priority: "medium",
        status: "pending",
        explanation: "This queued goal should run after the active approval gate clears.",
      }),
      createGoal({
        goal_id: "goal-dependent",
        description: "Complete dependent follow-up cycle",
        priority: "medium",
        status: "pending",
        explanation: "This goal depends on the queued prerequisite.",
        depends_on_goal_ids: ["goal-queued-prereq"],
      }),
    ],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: [],
    conflict_blockers: [],
    recent_failures: [],
    recovery_recommendations: [],
    approvals_required: [{
      goal_id: "goal-approval-gate",
      approvals_needed: ["session"],
      reason: "Session approval required for live runtime continuation.",
      recommended_action: "Approve the active goal.",
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
      explanation: "An active goal is selected.",
    },
    runtime_observability: {
      current_tick: 0,
      last_tick_at: null,
      last_mutation: null,
      last_semantic_transition: null,
      latest_safety_gate_decision: null,
      next_scheduled_action: "Await operator approval before the next bounded runtime tick.",
      next_scheduled_tick_at: null,
      event_log: [],
    },
    supervised_session: undefined,
    supervised_checkpoints: [],
    last_updated_at: new Date(nowMs).toISOString(),
  };

  if (mode === "supervised-autonomy") {
    const startedAt = new Date(nowMs).toISOString();
    const sessionId = createSupervisedAutonomySessionId(record.runtime_id, startedAt);
    const supervisedSession = {
      session_id: sessionId,
      runtime_id: record.runtime_id,
      status: "pending_approval" as const,
      started_at: startedAt,
      stopped_at: null,
      duration_ms: 0,
      max_duration_ms: 8 * 60 * 60 * 1000,
      tick_budget: 6,
      ticks_completed: 0,
      max_chain_count: 4,
      agent_ids: [],
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

    currentRecord.supervised_session = supervisedSession;
    currentRecord.supervised_checkpoints = [];
    currentRecord.operator_dashboard_state.supervised_session = { ...supervisedSession };
    currentRecord.operator_dashboard_state.supervised_checkpoints = [];
    currentRecord.operator_dashboard_state.session_status = {
      status: "session_waiting_for_approval",
      explanation: "The supervised autonomy session is pending operator approval.",
    };
    currentRecord.operator_dashboard_state.runtime_observability = {
      ...currentRecord.operator_dashboard_state.runtime_observability,
      next_scheduled_action: "Approve the pending supervised session to start bounded autonomous ticks.",
    };
  }

  persistRuntimeStateRecord(store, currentRecord);

  return {
    runtimeId: record.runtime_id,
    store,
  };
}
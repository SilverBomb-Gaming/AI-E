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
import {
  createOvernightAutonomyPolicyId,
  createOvernightAutonomyReviewId,
  createSupervisedAutonomySessionId,
} from "../lib/aie/supervisedAutonomySession";

export type ContinuousRuntimeProofSeedPayload = {
  runtimeId: string;
  store: RuntimeStateStore;
};

export type ContinuousRuntimeProofSeedMode = "continuous-runtime" | "supervised-autonomy" | "overnight-autonomy";

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
    tick_interval_ms: mode === "continuous-runtime" ? 1_000 : 10_000,
    max_ticks_per_run: mode === "continuous-runtime" ? 3 : 1,
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

  if (mode === "supervised-autonomy" || mode === "overnight-autonomy") {
    const startedAt = new Date(nowMs).toISOString();
    const sessionId = createSupervisedAutonomySessionId(record.runtime_id, startedAt);
    const supervisedSession = {
      session_id: sessionId,
      runtime_id: record.runtime_id,
      status: mode === "overnight-autonomy" ? "waiting_for_operator" as const : "pending_approval" as const,
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
      pending_operator_review: mode === "overnight-autonomy",
      overnight_policy: mode === "overnight-autonomy"
        ? {
          policy_id: createOvernightAutonomyPolicyId(sessionId, startedAt),
          session_id: sessionId,
          max_runtime_hours: 8,
          allowed_time_window: {
            start_time: "22:00",
            end_time: "06:00",
          },
          max_tick_count: 6,
          max_chain_count: 4,
          max_retries_per_chain: 1,
          max_recovery_attempts: 2,
          requires_operator_review_before_commit: true,
          allowed_agent_roles: ["planner", "executor", "validator"],
          disallowed_actions: ["commit_changes", "push_branch"],
          shutdown_on_failure_count: 2,
          checkpoint_interval_ticks: 1,
          review_queue_enabled: true,
        }
        : null,
      review_queue: mode === "overnight-autonomy"
        ? [{
          review_id: createOvernightAutonomyReviewId(sessionId, startedAt),
          session_id: sessionId,
          source_event_id: `overnight-proof-review-${nowMs}`,
          source_chain_id: "execution-chain-proof",
          source_agent_id: "validator-agent",
          severity: "high" as const,
          title: "Review bounded overnight recovery",
          summary: "The overnight session paused after a bounded recovery event and needs an operator decision.",
          recommended_action: "Approve the queued overnight recovery item to clear the review gate.",
          required_operator_decision: "approve" as const,
          created_at: startedAt,
          status: "pending" as const,
        }]
        : [],
      active_recovery: mode === "overnight-autonomy"
        ? {
          recovery_id: `overnight-proof-recovery-${nowMs}`,
          session_id: sessionId,
          source_event_id: `overnight-proof-review-${nowMs}`,
          source_chain_id: "execution-chain-proof",
          source_agent_id: "validator-agent",
          selected_outcome: "request_operator_review" as const,
          retry_count_for_chain: 1,
          recovery_attempt_count: 1,
          rollback_checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
          summary: "A bounded overnight recovery decision was escalated for operator review.",
          created_at: startedAt,
        }
        : null,
      resume_state: mode === "overnight-autonomy"
        ? {
          resume_status: "resumed_from_checkpoint" as const,
          restart_count: 1,
          resumed_from_checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
          resumed_at: startedAt,
          preserved_review_queue_count: 1,
          shutdown_reason: null,
        }
        : null,
      failure_count: mode === "overnight-autonomy" ? 1 : 0,
    };

    currentRecord.supervised_session = supervisedSession;
    currentRecord.supervised_checkpoints = mode === "overnight-autonomy"
      ? [{
        checkpoint_id: `supervised-checkpoint-${sessionId}-seeded-1`,
        session_id: sessionId,
        timestamp: startedAt,
        tick_index: 1,
        agent_states: [],
        active_chains: ["execution-chain-proof"],
        queued_goals: currentRecord.operator_dashboard_state.queued_goals.map((goal) => goal.goal_id),
        completed_goals: [],
        safety_status: "review_required" as const,
        latest_timeline_event_id: `overnight-proof-review-${nowMs}`,
      }]
      : [];
    currentRecord.operator_dashboard_state.supervised_session = { ...supervisedSession };
    currentRecord.operator_dashboard_state.supervised_checkpoints = [...currentRecord.supervised_checkpoints];
    currentRecord.operator_dashboard_state.session_status = {
      status: "session_waiting_for_approval",
      explanation: mode === "overnight-autonomy"
        ? "The overnight autonomy session is waiting for operator review."
        : "The supervised autonomy session is pending operator approval.",
    };
    currentRecord.operator_dashboard_state.runtime_observability = {
      ...currentRecord.operator_dashboard_state.runtime_observability,
      next_scheduled_action: mode === "overnight-autonomy"
        ? "Resolve the overnight review queue item before the next bounded resume."
        : "Approve the pending supervised session to start bounded autonomous ticks.",
    };
  }

  persistRuntimeStateRecord(store, currentRecord);

  return {
    runtimeId: record.runtime_id,
    store,
  };
}
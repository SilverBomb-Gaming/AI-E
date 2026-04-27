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
} from "../lib/aie/runtimeStateStore";

const RUNTIME_ID = process.env.AIE_OPERATOR_PROOF_RUNTIME_ID?.trim() || `live-semantic-proof-${Date.now()}`;

function isoOffset(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

function createStoppedService(nowMs: number) {
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
    service_id: RUNTIME_ID,
    started_at: isoOffset(nowMs, -120_000),
    stopped_at: isoOffset(nowMs, -30_000),
    last_tick_at: isoOffset(nowMs, -30_000),
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
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

function createSeededRuntimeStore() {
  const nowMs = Date.now();
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = {
    ...createStoppedService(nowMs),
    status: "service_blocked" as const,
    stop_reason: "blocker_detected" as const,
    blockers: [{ code: "approval_required", message: "Fresh approval is required." }],
  };
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const currentRecord = loadRuntimeState(store, record.runtime_id);

  if (!currentRecord) {
    throw new Error("Expected a persisted runtime record.");
  }

  currentRecord.continuous_loop_config = {
    tick_interval_ms: 1_000,
    max_ticks_per_run: 3,
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
    last_updated_at: new Date(nowMs).toISOString(),
  };

  persistRuntimeStateRecord(store, currentRecord);

  return {
    runtimeId: record.runtime_id,
    store,
  };
}

const seeded = createSeededRuntimeStore();

process.stdout.write(JSON.stringify({
  runtimeId: seeded.runtimeId,
  store: {
    records: seeded.store.records,
    stale_after_ms: seeded.store.stale_after_ms,
  },
}));
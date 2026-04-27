import { applyOperatorControlAction, type OperatorControlAction } from "./operatorControlSurface";
import {
  createContinuousRuntimeLoopClock,
  runContinuousRuntimeLoop,
  type ContinuousRuntimeLoopClock,
  type ContinuousRuntimeLoopConfig,
  type ContinuousRuntimeLoopResult,
} from "./continuousRuntimeLoop";
import {
  runExecutionLoopController,
  type ExecutionLoopControllerResult,
} from "./executionLoopController";
import type { OperatorDashboardBlockedGoal, OperatorDashboardState } from "./operatorDashboardState";
import {
  cloneRuntimeStateRecord,
  evaluateBootResume,
  loadRuntimeState,
  persistRuntimeStateRecord,
  type StoredContinuousLoopConfig,
  type RuntimeStateRecord,
  type RuntimeStateStore,
} from "./runtimeStateStore";
import type { SafeRuntimeActionAuditEvent, SafeRuntimeIntent } from "./safeRuntimeActionBridge";

export type RuntimeMutationStatus = "mutation_applied" | "mutation_rejected" | "mutation_no_op";

export type RuntimeMutationAuditEvent = {
  audit_event_id: string;
  created_at: string;
  runtime_id: string;
  goal_id: string | null;
  runtime_intent: SafeRuntimeIntent;
  status: RuntimeMutationStatus;
  reason: string;
  source_bridge_audit_event_id: string | null;
};

export type RuntimeMutationResult = {
  status: RuntimeMutationStatus;
  updated_runtime_state: RuntimeStateRecord;
  reason: string;
  audit_event: RuntimeMutationAuditEvent;
  execution_loop: ExecutionLoopControllerResult | null;
  continuous_runtime_loop: ContinuousRuntimeLoopResult | null;
};

export type RuntimeMutationExecutorInput = {
  runtime_intent: SafeRuntimeIntent;
  current_runtime_state: RuntimeStateRecord;
  current_dashboard_state: OperatorDashboardState;
  runtime_state_store: RuntimeStateStore;
  runtime_id: string;
  timestamp: string;
  goal_id?: string | null;
  source_audit_event?: SafeRuntimeActionAuditEvent;
  start_continuous_loop?: boolean;
  continuous_loop_clock?: ContinuousRuntimeLoopClock;
  continuous_loop_config?: Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">>;
};

function resolveContinuousLoopConfig(
  record: RuntimeStateRecord,
  overrides: Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">> | undefined,
): Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">> {
  const storedConfig = record.continuous_loop_config ?? null;
  return {
    ...((storedConfig ?? {}) as StoredContinuousLoopConfig),
    ...(overrides ?? {}),
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function isApprovalBlocker(codeOrMessage: string): boolean {
  return /approval|fresh/i.test(codeOrMessage);
}

function isRuntimeSnapshotStale(record: RuntimeStateRecord, now: string, staleAfterMs: number): boolean {
  const nowMs = Date.parse(now);
  const persistedMs = Date.parse(record.persisted_at);
  if (Number.isNaN(nowMs) || Number.isNaN(persistedMs)) {
    return true;
  }
  return (nowMs - persistedMs) > staleAfterMs;
}

function buildAuditEvent(input: RuntimeMutationExecutorInput, status: RuntimeMutationStatus, reason: string): RuntimeMutationAuditEvent {
  return {
    audit_event_id: [
      "runtime-mutation-executor",
      sanitizeTimestamp(input.timestamp),
      normalizeText(input.runtime_id) || "unknown-runtime",
      input.runtime_intent,
      input.goal_id ?? "global",
    ].join("-"),
    created_at: input.timestamp,
    runtime_id: input.runtime_id,
    goal_id: input.goal_id ?? null,
    runtime_intent: input.runtime_intent,
    status,
    reason,
    source_bridge_audit_event_id: input.source_audit_event?.audit_event_id ?? null,
  };
}

function buildResult(
  input: RuntimeMutationExecutorInput,
  status: RuntimeMutationStatus,
  record: RuntimeStateRecord,
  reason: string,
  executionLoop: ExecutionLoopControllerResult | null = null,
  continuousRuntimeLoop: ContinuousRuntimeLoopResult | null = null,
): RuntimeMutationResult {
  return {
    status,
    updated_runtime_state: record,
    reason,
    audit_event: buildAuditEvent(input, status, reason),
    execution_loop: executionLoop,
    continuous_runtime_loop: continuousRuntimeLoop,
  };
}

function createActionFromIntent(intent: SafeRuntimeIntent, goalId: string | null | undefined): OperatorControlAction | null {
  switch (intent) {
    case "grant_session_approval":
      return { type: "approve_goal", goal_id: goalId ?? null };
    case "pause_active_goal":
      return { type: "pause_goal", goal_id: goalId ?? null };
    case "resume_paused_goal":
      return { type: "resume_goal", goal_id: goalId ?? null };
    case "mark_goal_retry_requested":
      return { type: "retry_goal", goal_id: goalId ?? null };
    case "no_op":
    default:
      return null;
  }
}

function resolveBlockedGoal(state: OperatorDashboardState, goalId: string | null | undefined): OperatorDashboardBlockedGoal | null {
  if (!goalId) {
    return state.blocked_goals[0] ?? null;
  }
  return state.blocked_goals.find((goal) => goal.goal_id === goalId) ?? null;
}

function reject(input: RuntimeMutationExecutorInput, currentRecord: RuntimeStateRecord, reason: string): RuntimeMutationResult {
  return buildResult(input, "mutation_rejected", cloneRuntimeStateRecord(currentRecord), reason);
}

function validateMutationRequest(
  input: RuntimeMutationExecutorInput,
  persistedRecord: RuntimeStateRecord,
  state: OperatorDashboardState,
): string | null {
  if (isRuntimeSnapshotStale(persistedRecord, input.timestamp, input.runtime_state_store.stale_after_ms)) {
    return "live runtime state requires operator review before a runtime mutation can be applied";
  }

  const bootResume = evaluateBootResume(input.runtime_state_store, input.runtime_id, input.timestamp);

  if (bootResume.status === "state_corrupt" || !bootResume.record) {
    return "live runtime state could not be validated before applying the requested mutation";
  }

  if (input.runtime_intent === "no_op") {
    return null;
  }

  if (bootResume.status === "resume_requires_review") {
    return "live runtime state requires operator review before a runtime mutation can be applied";
  }

  switch (input.runtime_intent) {
    case "grant_session_approval": {
      if (state.approvals_required.length === 0) {
        return "no approval requirement is currently active for this runtime mutation";
      }

      const hasApprovalBlocker = persistedRecord.blockers.some((blocker) =>
        isApprovalBlocker(blocker.code) || isApprovalBlocker(blocker.message));
      if (bootResume.status === "resume_blocked" && !hasApprovalBlocker) {
        return "the current runtime blocker cannot be cleared through a session approval mutation";
      }
      return null;
    }

    case "pause_active_goal": {
      if (!state.active_goal || (input.goal_id && state.active_goal.goal_id !== input.goal_id)) {
        return "no active goal is available for a live pause mutation";
      }
      if (/paused/i.test(state.session_status.status) || /paused/i.test(state.runtime_status.status)) {
        return "the live runtime is already paused for the selected goal";
      }
      return null;
    }

    case "resume_paused_goal": {
      const pausedGoal = input.goal_id
        ? state.paused_goals.find((goal) => goal.goal_id === input.goal_id) ?? null
        : state.paused_goals[0] ?? null;
      if (!pausedGoal) {
        return "no paused goal is available for a live resume mutation";
      }
      if (state.active_goal) {
        return "a different goal is already active, so the requested paused goal cannot resume yet";
      }
      const hasBlockingApproval = state.approvals_required.some((approval) => approval.goal_id === null || approval.goal_id === pausedGoal.goal_id);
      if (hasBlockingApproval) {
        return "the paused goal still requires fresh approval before it can resume";
      }
      return null;
    }

    case "mark_goal_retry_requested": {
      const blockedGoal = resolveBlockedGoal(state, input.goal_id);
      if (!blockedGoal && state.recovery_recommendations.length === 0) {
        return "no blocked goal or recovery recommendation is available for a live retry mutation";
      }
      if (blockedGoal && blockedGoal.blocker_type !== "status" && blockedGoal.blocker_ids.length > 0) {
        return "dependency constraints still block the requested retry mutation";
      }
      return null;
    }

    default:
      return "the requested runtime mutation intent is not supported";
  }
}

function applyRecordMetadata(
  runtimeIntent: SafeRuntimeIntent,
  record: RuntimeStateRecord,
): void {
  switch (runtimeIntent) {
    case "grant_session_approval": {
      record.blockers = record.blockers.filter((blocker) =>
        !(isApprovalBlocker(blocker.code) || isApprovalBlocker(blocker.message)));
      if (record.last_status === "service_blocked") {
        record.last_status = "service_idle";
      }
      break;
    }

    case "pause_active_goal": {
      record.last_status = "service_paused";
      break;
    }

    case "resume_paused_goal": {
      record.last_status = "service_idle";
      break;
    }

    case "mark_goal_retry_requested": {
      if (record.last_status === "service_blocked") {
        record.last_status = "service_idle";
      }
      break;
    }

    case "no_op":
    default:
      break;
  }
}

export function executeRuntimeMutation(input: RuntimeMutationExecutorInput): RuntimeMutationResult {
  const runtimeId = normalizeText(input.runtime_id);
  if (!runtimeId) {
    return reject(input, input.current_runtime_state, "a runtime id is required before a runtime mutation can be applied");
  }

  if (normalizeText(input.current_runtime_state.runtime_id) !== runtimeId) {
    return reject(input, input.current_runtime_state, "the provided runtime state does not match the requested runtime id");
  }

  if (input.runtime_intent === "no_op") {
    return buildResult(input, "mutation_no_op", cloneRuntimeStateRecord(input.current_runtime_state), "no live runtime mutation was required for the requested intent");
  }

  const persistedRecord = loadRuntimeState(input.runtime_state_store, runtimeId);
  if (!persistedRecord) {
    return reject(input, input.current_runtime_state, "no persisted runtime state record was found for the requested live mutation");
  }

  const stateForMutation = persistedRecord.operator_dashboard_state ?? input.current_dashboard_state;
  const validationFailure = validateMutationRequest(input, persistedRecord, stateForMutation);
  if (validationFailure) {
    return reject(input, persistedRecord, validationFailure);
  }

  const action = createActionFromIntent(input.runtime_intent, input.goal_id);
  if (!action) {
    return buildResult(input, "mutation_no_op", cloneRuntimeStateRecord(persistedRecord), "the requested runtime intent does not mutate persisted runtime state");
  }

  const controlResult = applyOperatorControlAction(stateForMutation, action);
  if (!controlResult.changed) {
    return reject(input, persistedRecord, controlResult.message);
  }

  const nextRecord = cloneRuntimeStateRecord(persistedRecord);
  nextRecord.operator_dashboard_state = controlResult.state;
  nextRecord.persisted_at = input.timestamp;
  applyRecordMetadata(input.runtime_intent, nextRecord);

  const persistedNextRecord = persistRuntimeStateRecord(input.runtime_state_store, nextRecord);
  const effectiveContinuousLoopConfig = resolveContinuousLoopConfig(persistedNextRecord, input.continuous_loop_config);
  const executionLoop = persistedNextRecord.operator_dashboard_state
    ? runExecutionLoopController({
      runtime_intent: input.runtime_intent,
      dashboard_state: persistedNextRecord.operator_dashboard_state,
      timestamp: input.timestamp,
      goal_id: input.goal_id,
    })
    : null;

  if (!executionLoop || executionLoop.status === "loop_not_triggered" || executionLoop.status === "loop_blocked") {
    const baseResult = buildResult(
      input,
      "mutation_applied",
      persistedNextRecord,
      executionLoop ? `${controlResult.message} ${executionLoop.reason}`.trim() : controlResult.message,
      executionLoop,
    );

    if (!input.start_continuous_loop || input.runtime_intent === "pause_active_goal" || !persistedNextRecord.operator_dashboard_state) {
      return baseResult;
    }

    const continuousRuntimeLoop = runContinuousRuntimeLoop(
      input.runtime_state_store,
      {
        runtime_id: runtimeId,
        profile_name: persistedNextRecord.profile_name,
        started_at: input.timestamp,
        runtime_intent: "no_op",
        ...effectiveContinuousLoopConfig,
      },
      input.continuous_loop_clock ?? createContinuousRuntimeLoopClock(
        input.timestamp,
        effectiveContinuousLoopConfig.tick_interval_ms ?? 60_000,
      ),
    );

    return buildResult(
      input,
      "mutation_applied",
      continuousRuntimeLoop.runtime_state ?? persistedNextRecord,
      `${baseResult.reason} ${continuousRuntimeLoop.reason}`.trim(),
      executionLoop,
      continuousRuntimeLoop,
    );
  }

  const executedRecord = cloneRuntimeStateRecord(persistedNextRecord);
  executedRecord.operator_dashboard_state = executionLoop.updated_dashboard_state;
  executedRecord.persisted_at = input.timestamp;
  const persistedExecutedRecord = persistRuntimeStateRecord(input.runtime_state_store, executedRecord);
  const executedContinuousLoopConfig = resolveContinuousLoopConfig(persistedExecutedRecord, input.continuous_loop_config);

  if (!input.start_continuous_loop || input.runtime_intent === "pause_active_goal" || !persistedExecutedRecord.operator_dashboard_state) {
    return buildResult(
      input,
      "mutation_applied",
      persistedExecutedRecord,
      `${controlResult.message} ${executionLoop.reason}`.trim(),
      executionLoop,
    );
  }

  const continuousRuntimeLoop = runContinuousRuntimeLoop(
    input.runtime_state_store,
    {
      runtime_id: runtimeId,
      profile_name: persistedExecutedRecord.profile_name,
      started_at: input.timestamp,
      runtime_intent: "no_op",
      ...executedContinuousLoopConfig,
    },
    input.continuous_loop_clock ?? createContinuousRuntimeLoopClock(
      input.timestamp,
      executedContinuousLoopConfig.tick_interval_ms ?? 60_000,
    ),
  );

  return buildResult(
    input,
    "mutation_applied",
    continuousRuntimeLoop.runtime_state ?? persistedExecutedRecord,
    `${controlResult.message} ${executionLoop.reason} ${continuousRuntimeLoop.reason}`.trim(),
    executionLoop,
    continuousRuntimeLoop,
  );
}

export function summarizeRuntimeMutationResult(result: RuntimeMutationResult): string {
  const summary = [
    `Runtime mutation status: ${result.status}`,
    `Runtime status after mutation: ${result.updated_runtime_state.last_status}`,
    `Persisted at: ${result.updated_runtime_state.persisted_at}`,
    `Reason: ${result.reason}`,
    `Audit event: ${result.audit_event.audit_event_id}`,
  ];

  if (result.execution_loop) {
    summary.push(`Execution loop status: ${result.execution_loop.status}`);
    summary.push(`Execution loop reason: ${result.execution_loop.reason}`);
  }

  if (result.continuous_runtime_loop) {
    summary.push(`Continuous runtime loop status: ${result.continuous_runtime_loop.status}`);
    summary.push(`Continuous runtime loop reason: ${result.continuous_runtime_loop.reason}`);
  }

  return summary.join("\n");
}
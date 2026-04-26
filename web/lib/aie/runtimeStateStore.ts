import type {
  BackgroundRuntimeServiceState,
  BackgroundRuntimeServiceStatus,
  BackgroundRuntimeServiceStopReason,
} from "./backgroundRuntimeService";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardBlockedGoal,
  OperatorDashboardBlocker,
  OperatorDashboardFailure,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorDashboardStatusLine,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";

const DEFAULT_RUNTIME_STATE_STALE_AFTER_MS = 15 * 60 * 1000;

export type RuntimeResumeStatus =
  | "no_prior_state"
  | "resume_ready"
  | "resume_blocked"
  | "resume_requires_review"
  | "state_corrupt";

export type ContinuousLoopStatus =
  | "loop_running"
  | "loop_completed"
  | "loop_blocked"
  | "loop_paused"
  | "loop_stopped"
  | "loop_error";

export type ContinuousLoopTickHistoryEntry = {
  tick_id: string;
  attempted_at: string;
  tick_index: number;
  status: ContinuousLoopStatus;
  triggered: boolean;
  run_results_recorded: number;
  reason: string;
};

export type ContinuousLoopStateRecord = {
  status: ContinuousLoopStatus;
  started_at: string | null;
  stopped_at: string | null;
  last_tick_at: string | null;
  ticks_attempted: number;
  ticks_completed: number;
  last_trigger_result: {
    status: ContinuousLoopStatus;
    reason: string;
    triggered: boolean;
    run_results_recorded: number;
  } | null;
  reason: string;
  tick_history: ContinuousLoopTickHistoryEntry[];
};

export type RuntimeStateRecord = {
  runtime_id: string;
  profile_name: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
  last_status: BackgroundRuntimeServiceStatus;
  last_tick_at: string | null;
  ticks_attempted: number;
  ticks_completed: number;
  last_trigger_result: {
    status: string;
    reason: string;
    triggered: boolean;
    run_results_recorded: number;
  } | null;
  stop_reason: BackgroundRuntimeServiceStopReason;
  blockers: Array<{ code: string; message: string }>;
  tick_history: Array<{
    tick_id: string;
    attempted_at: string;
    tick_index: number;
    status: string;
    triggered: boolean;
    queue_runs_recorded: number;
    reason: string;
  }>;
  continuous_loop: ContinuousLoopStateRecord | null;
  operator_dashboard_state: OperatorDashboardState | null;
  persisted_at: string;
};

export type RuntimeStateStore = {
  records: Record<string, string>;
  stale_after_ms: number;
};

export type RuntimeStateValidationResult = {
  is_valid: boolean;
  status: "state_valid" | "state_blocked" | "state_stale" | "state_corrupt";
  requires_review: boolean;
  reason: string;
  blockers: Array<{ code: string; message: string }>;
  record: RuntimeStateRecord | null;
};

export type RuntimeBootResumeResult = {
  runtime_id: string;
  status: RuntimeResumeStatus;
  reason: string;
  record: RuntimeStateRecord | null;
  validation: RuntimeStateValidationResult;
};

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isBlocker(value: unknown): value is { code: string; message: string } {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { code?: unknown }).code === "string"
    && typeof (value as { message?: unknown }).message === "string",
  );
}

function isTickHistoryEntry(value: unknown): value is RuntimeStateRecord["tick_history"][number] {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { tick_id?: unknown }).tick_id === "string"
    && isIsoTimestamp((value as { attempted_at?: unknown }).attempted_at)
    && isFiniteNonNegativeInteger((value as { tick_index?: unknown }).tick_index)
    && typeof (value as { status?: unknown }).status === "string"
    && typeof (value as { triggered?: unknown }).triggered === "boolean"
    && isFiniteNonNegativeInteger((value as { queue_runs_recorded?: unknown }).queue_runs_recorded)
    && typeof (value as { reason?: unknown }).reason === "string",
  );
}

function isSerializableTriggerResult(
  value: unknown,
): value is NonNullable<RuntimeStateRecord["last_trigger_result"]> {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { status?: unknown }).status === "string"
    && typeof (value as { reason?: unknown }).reason === "string"
    && typeof (value as { triggered?: unknown }).triggered === "boolean"
    && isFiniteNonNegativeInteger((value as { run_results_recorded?: unknown }).run_results_recorded),
  );
}

function isContinuousLoopStatus(value: unknown): value is ContinuousLoopStatus {
  return value === "loop_running"
    || value === "loop_completed"
    || value === "loop_blocked"
    || value === "loop_paused"
    || value === "loop_stopped"
    || value === "loop_error";
}

function isContinuousLoopTickHistoryEntry(value: unknown): value is ContinuousLoopTickHistoryEntry {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { tick_id?: unknown }).tick_id === "string"
    && isIsoTimestamp((value as { attempted_at?: unknown }).attempted_at)
    && isFiniteNonNegativeInteger((value as { tick_index?: unknown }).tick_index)
    && isContinuousLoopStatus((value as { status?: unknown }).status)
    && typeof (value as { triggered?: unknown }).triggered === "boolean"
    && isFiniteNonNegativeInteger((value as { run_results_recorded?: unknown }).run_results_recorded)
    && typeof (value as { reason?: unknown }).reason === "string"
  );
}

function isSerializableContinuousLoopTriggerResult(
  value: unknown,
): value is NonNullable<ContinuousLoopStateRecord["last_trigger_result"]> {
  return Boolean(
    value
    && typeof value === "object"
    && isContinuousLoopStatus((value as { status?: unknown }).status)
    && typeof (value as { reason?: unknown }).reason === "string"
    && typeof (value as { triggered?: unknown }).triggered === "boolean"
    && isFiniteNonNegativeInteger((value as { run_results_recorded?: unknown }).run_results_recorded)
  );
}

function isContinuousLoopStateRecord(value: unknown): value is ContinuousLoopStateRecord {
  return Boolean(
    value
    && typeof value === "object"
    && isContinuousLoopStatus((value as { status?: unknown }).status)
    && (((value as { started_at?: unknown }).started_at === null) || isIsoTimestamp((value as { started_at?: unknown }).started_at))
    && (((value as { stopped_at?: unknown }).stopped_at === null) || isIsoTimestamp((value as { stopped_at?: unknown }).stopped_at))
    && (((value as { last_tick_at?: unknown }).last_tick_at === null) || isIsoTimestamp((value as { last_tick_at?: unknown }).last_tick_at))
    && isFiniteNonNegativeInteger((value as { ticks_attempted?: unknown }).ticks_attempted)
    && isFiniteNonNegativeInteger((value as { ticks_completed?: unknown }).ticks_completed)
    && (((value as { last_trigger_result?: unknown }).last_trigger_result === null)
      || isSerializableContinuousLoopTriggerResult((value as { last_trigger_result?: unknown }).last_trigger_result))
    && typeof (value as { reason?: unknown }).reason === "string"
    && Array.isArray((value as { tick_history?: unknown }).tick_history)
    && ((value as { tick_history?: unknown[] }).tick_history ?? []).every(isContinuousLoopTickHistoryEntry)
  );
}

function isDashboardStatusLine(value: unknown): value is OperatorDashboardStatusLine {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { status?: unknown }).status === "string"
    && typeof (value as { explanation?: unknown }).explanation === "string",
  );
}

function isDashboardGoal(value: unknown): value is OperatorDashboardGoal {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { goal_id?: unknown }).goal_id === "string"
    && typeof (value as { description?: unknown }).description === "string"
    && typeof (value as { priority?: unknown }).priority === "string"
    && typeof (value as { status?: unknown }).status === "string"
    && typeof (value as { explanation?: unknown }).explanation === "string"
    && (((value as { recommended_action?: unknown }).recommended_action === null) || typeof (value as { recommended_action?: unknown }).recommended_action === "string")
    && Array.isArray((value as { depends_on_goal_ids?: unknown }).depends_on_goal_ids)
    && Array.isArray((value as { blocking_goal_ids?: unknown }).blocking_goal_ids)
    && Array.isArray((value as { conflict_goal_ids?: unknown }).conflict_goal_ids)
    && isIsoTimestamp((value as { last_updated_at?: unknown }).last_updated_at),
  );
}

function isDashboardBlockedGoal(value: unknown): value is OperatorDashboardBlockedGoal {
  return Boolean(
    isDashboardGoal(value)
    && typeof (value as { blocker_type?: unknown }).blocker_type === "string"
    && Array.isArray((value as { blocker_ids?: unknown }).blocker_ids),
  );
}

function isDashboardBlocker(value: unknown): value is OperatorDashboardBlocker {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { goal_id?: unknown }).goal_id === "string"
    && Array.isArray((value as { blocker_ids?: unknown }).blocker_ids)
    && typeof (value as { explanation?: unknown }).explanation === "string",
  );
}

function isDashboardFailure(value: unknown): value is OperatorDashboardFailure {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { report_id?: unknown }).report_id === "string"
    && isIsoTimestamp((value as { created_at?: unknown }).created_at)
    && typeof (value as { source?: unknown }).source === "string"
    && typeof (value as { category?: unknown }).category === "string"
    && typeof (value as { severity?: unknown }).severity === "string"
    && typeof (value as { recommendation?: unknown }).recommendation === "string"
    && typeof (value as { reason?: unknown }).reason === "string",
  );
}

function isDashboardRecommendation(value: unknown): value is OperatorDashboardRecoveryRecommendation {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { report_id?: unknown }).report_id === "string"
    && typeof (value as { source?: unknown }).source === "string"
    && typeof (value as { category?: unknown }).category === "string"
    && typeof (value as { severity?: unknown }).severity === "string"
    && typeof (value as { recommendation?: unknown }).recommendation === "string"
    && typeof (value as { retry_safe?: unknown }).retry_safe === "boolean"
    && typeof (value as { operator_review_required?: unknown }).operator_review_required === "boolean"
    && typeof (value as { reason?: unknown }).reason === "string",
  );
}

function isDashboardApproval(value: unknown): value is OperatorDashboardApprovalRequirement {
  return Boolean(
    value
    && typeof value === "object"
    && (((value as { goal_id?: unknown }).goal_id === null) || typeof (value as { goal_id?: unknown }).goal_id === "string")
    && Array.isArray((value as { approvals_needed?: unknown }).approvals_needed)
    && typeof (value as { reason?: unknown }).reason === "string"
    && typeof (value as { recommended_action?: unknown }).recommended_action === "string",
  );
}

function isDashboardValidationIssue(value: unknown): value is OperatorDashboardValidationIssue {
  return Boolean(
    value
    && typeof value === "object"
    && (((value as { goal_id?: unknown }).goal_id === null) || typeof (value as { goal_id?: unknown }).goal_id === "string")
    && typeof (value as { source?: unknown }).source === "string"
    && typeof (value as { status?: unknown }).status === "string"
    && (((value as { recommendation?: unknown }).recommendation === null) || typeof (value as { recommendation?: unknown }).recommendation === "string")
    && typeof (value as { summary?: unknown }).summary === "string",
  );
}

function isOperatorDashboardState(value: unknown): value is OperatorDashboardState {
  return Boolean(
    value
    && typeof value === "object"
    && (((value as { active_goal?: unknown }).active_goal === null) || isDashboardGoal((value as { active_goal?: unknown }).active_goal))
    && Array.isArray((value as { queued_goals?: unknown }).queued_goals)
    && Array.isArray((value as { blocked_goals?: unknown }).blocked_goals)
    && Array.isArray((value as { completed_goals?: unknown }).completed_goals)
    && Array.isArray((value as { paused_goals?: unknown }).paused_goals)
    && Array.isArray((value as { dependency_blockers?: unknown }).dependency_blockers)
    && Array.isArray((value as { conflict_blockers?: unknown }).conflict_blockers)
    && Array.isArray((value as { recent_failures?: unknown }).recent_failures)
    && Array.isArray((value as { recovery_recommendations?: unknown }).recovery_recommendations)
    && Array.isArray((value as { approvals_required?: unknown }).approvals_required)
    && Array.isArray((value as { validation_issues?: unknown }).validation_issues)
    && ((value as { queued_goals?: unknown[] }).queued_goals ?? []).every(isDashboardGoal)
    && ((value as { blocked_goals?: unknown[] }).blocked_goals ?? []).every(isDashboardBlockedGoal)
    && ((value as { completed_goals?: unknown[] }).completed_goals ?? []).every(isDashboardGoal)
    && ((value as { paused_goals?: unknown[] }).paused_goals ?? []).every(isDashboardGoal)
    && ((value as { dependency_blockers?: unknown[] }).dependency_blockers ?? []).every(isDashboardBlocker)
    && ((value as { conflict_blockers?: unknown[] }).conflict_blockers ?? []).every(isDashboardBlocker)
    && ((value as { recent_failures?: unknown[] }).recent_failures ?? []).every(isDashboardFailure)
    && ((value as { recovery_recommendations?: unknown[] }).recovery_recommendations ?? []).every(isDashboardRecommendation)
    && ((value as { approvals_required?: unknown[] }).approvals_required ?? []).every(isDashboardApproval)
    && ((value as { validation_issues?: unknown[] }).validation_issues ?? []).every(isDashboardValidationIssue)
    && isDashboardStatusLine((value as { runtime_status?: unknown }).runtime_status)
    && isDashboardStatusLine((value as { session_status?: unknown }).session_status)
    && isDashboardStatusLine((value as { queue_status?: unknown }).queue_status)
    && isDashboardStatusLine((value as { scheduler_status?: unknown }).scheduler_status)
    && isIsoTimestamp((value as { last_updated_at?: unknown }).last_updated_at),
  );
}

function validateRecordShape(record: unknown): RuntimeStateRecord {
  if (!record || typeof record !== "object") {
    throw new Error("Runtime state record must be an object.");
  }

  const candidate = record as Partial<RuntimeStateRecord>;
  if (typeof candidate.runtime_id !== "string" || !candidate.runtime_id) {
    throw new Error("Runtime state record must include a runtime_id.");
  }
  if (typeof candidate.profile_name !== "string" || !candidate.profile_name) {
    throw new Error("Runtime state record must include a profile_name.");
  }
  if (candidate.last_started_at !== null && !isIsoTimestamp(candidate.last_started_at)) {
    throw new Error("Runtime state record last_started_at must be null or an ISO timestamp.");
  }
  if (candidate.last_stopped_at !== null && !isIsoTimestamp(candidate.last_stopped_at)) {
    throw new Error("Runtime state record last_stopped_at must be null or an ISO timestamp.");
  }
  if (typeof candidate.last_status !== "string" || !candidate.last_status) {
    throw new Error("Runtime state record must include a last_status.");
  }
  if (candidate.last_tick_at !== null && !isIsoTimestamp(candidate.last_tick_at)) {
    throw new Error("Runtime state record last_tick_at must be null or an ISO timestamp.");
  }
  if (!isFiniteNonNegativeInteger(candidate.ticks_attempted)) {
    throw new Error("Runtime state record ticks_attempted must be a finite non-negative integer.");
  }
  if (!isFiniteNonNegativeInteger(candidate.ticks_completed)) {
    throw new Error("Runtime state record ticks_completed must be a finite non-negative integer.");
  }
  if (candidate.last_trigger_result !== null && !isSerializableTriggerResult(candidate.last_trigger_result)) {
    throw new Error("Runtime state record last_trigger_result must be null or a serializable trigger summary.");
  }
  if (typeof candidate.stop_reason !== "string" || !candidate.stop_reason) {
    throw new Error("Runtime state record must include a stop_reason.");
  }
  if (!Array.isArray(candidate.blockers) || !candidate.blockers.every(isBlocker)) {
    throw new Error("Runtime state record blockers must be a blocker array.");
  }
  if (!Array.isArray(candidate.tick_history) || !candidate.tick_history.every(isTickHistoryEntry)) {
    throw new Error("Runtime state record tick_history must be a serializable tick history array.");
  }
  if (candidate.continuous_loop !== null && candidate.continuous_loop !== undefined && !isContinuousLoopStateRecord(candidate.continuous_loop)) {
    throw new Error("Runtime state record continuous_loop must be null or a valid continuous runtime loop snapshot.");
  }
  if (candidate.operator_dashboard_state !== null && candidate.operator_dashboard_state !== undefined && !isOperatorDashboardState(candidate.operator_dashboard_state)) {
    throw new Error("Runtime state record operator_dashboard_state must be null or a valid operator dashboard snapshot.");
  }
  if (!isIsoTimestamp(candidate.persisted_at)) {
    throw new Error("Runtime state record persisted_at must be an ISO timestamp.");
  }

  return candidate as RuntimeStateRecord;
}

function getReferenceTimestamp(record: RuntimeStateRecord): string {
  return record.last_stopped_at
    ?? record.last_tick_at
    ?? record.last_started_at
    ?? record.persisted_at;
}

function validateRuntimeStateWithThreshold(
  record: RuntimeStateRecord,
  now: string,
  staleAfterMs: number,
): RuntimeStateValidationResult {
  const validatedRecord = validateRecordShape(record);
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return {
      is_valid: false,
      status: "state_corrupt",
      requires_review: false,
      reason: "Boot resume validation could not parse the current timestamp.",
      blockers: [],
      record: null,
    };
  }

  if (validatedRecord.blockers.length > 0 || validatedRecord.last_status === "service_blocked") {
    return {
      is_valid: true,
      status: "state_blocked",
      requires_review: false,
      reason: "Prior runtime state remains blocked and cannot auto-resume.",
      blockers: validatedRecord.blockers,
      record: validatedRecord,
    };
  }

  const referenceMs = Date.parse(getReferenceTimestamp(validatedRecord));
  if (Number.isNaN(referenceMs)) {
    return {
      is_valid: false,
      status: "state_corrupt",
      requires_review: false,
      reason: "Prior runtime state contains an unreadable resume timestamp.",
      blockers: [],
      record: null,
    };
  }

  if ((nowMs - referenceMs) > staleAfterMs) {
    return {
      is_valid: true,
      status: "state_stale",
      requires_review: true,
      reason: "Prior runtime state is stale and requires operator review before resume.",
      blockers: [],
      record: validatedRecord,
    };
  }

  if (!["service_completed", "service_stopped", "service_paused", "service_idle"].includes(validatedRecord.last_status)) {
    return {
      is_valid: true,
      status: "state_stale",
      requires_review: true,
      reason: "Prior runtime state did not stop cleanly and requires operator review before resume.",
      blockers: [],
      record: validatedRecord,
    };
  }

  return {
    is_valid: true,
    status: "state_valid",
    requires_review: false,
    reason: "Prior runtime state is fresh and ready to resume through the normal entrypoint safety gates.",
    blockers: [],
    record: validatedRecord,
  };
}

export function createRuntimeStateStore(input: Partial<RuntimeStateStore> = {}): RuntimeStateStore {
  return {
    records: { ...(input.records ?? {}) },
    stale_after_ms: input.stale_after_ms ?? DEFAULT_RUNTIME_STATE_STALE_AFTER_MS,
  };
}

export function saveRuntimeState(
  store: RuntimeStateStore,
  serviceState: BackgroundRuntimeServiceState,
  profileName = "unknown",
): RuntimeStateRecord {
  const existingRecord = (() => {
    try {
      return loadRuntimeState(store, serviceState.service_id);
    } catch {
      return null;
    }
  })();

  const record: RuntimeStateRecord = {
    runtime_id: serviceState.service_id,
    profile_name: profileName,
    last_started_at: serviceState.started_at,
    last_stopped_at: serviceState.stopped_at,
    last_status: serviceState.status,
    last_tick_at: serviceState.last_tick_at,
    ticks_attempted: serviceState.ticks_attempted,
    ticks_completed: serviceState.ticks_completed,
    last_trigger_result: serviceState.last_trigger_result
      ? {
        status: serviceState.last_trigger_result.status,
        reason: serviceState.last_trigger_result.reason,
        triggered: serviceState.last_trigger_result.triggered,
        run_results_recorded: serviceState.last_trigger_result.run_results.length,
      }
      : null,
    stop_reason: serviceState.stop_reason,
    blockers: serviceState.blockers.map((blocker) => ({ ...blocker })),
    tick_history: serviceState.tick_history.map((tick) => ({
      tick_id: tick.tick_id,
      attempted_at: tick.attempted_at,
      tick_index: tick.tick_index,
      status: tick.status,
      triggered: tick.triggered,
      queue_runs_recorded: tick.queue_runs_recorded,
      reason: tick.reason,
    })),
    continuous_loop: existingRecord?.continuous_loop ?? null,
    operator_dashboard_state: existingRecord?.operator_dashboard_state ?? null,
    persisted_at: serviceState.stopped_at
      ?? serviceState.last_tick_at
      ?? serviceState.started_at
      ?? serviceState.created_at,
  };

  store.records[record.runtime_id] = JSON.stringify(record);
  return record;
}

export function loadRuntimeState(store: RuntimeStateStore, runtimeId: string): RuntimeStateRecord | null {
  const raw = store.records[runtimeId];
  if (raw === undefined) {
    return null;
  }
  return validateRecordShape(JSON.parse(raw) as unknown);
}

export function cloneRuntimeStateRecord(record: RuntimeStateRecord): RuntimeStateRecord {
  return JSON.parse(JSON.stringify(record)) as RuntimeStateRecord;
}

export function persistRuntimeStateRecord(store: RuntimeStateStore, record: RuntimeStateRecord): RuntimeStateRecord {
  const validatedRecord = validateRecordShape(record);
  store.records[validatedRecord.runtime_id] = JSON.stringify(validatedRecord);
  return validatedRecord;
}

export function validateRuntimeState(record: RuntimeStateRecord, now: string): RuntimeStateValidationResult {
  return validateRuntimeStateWithThreshold(record, now, DEFAULT_RUNTIME_STATE_STALE_AFTER_MS);
}

export function evaluateBootResume(store: RuntimeStateStore, runtimeId: string, now: string): RuntimeBootResumeResult {
  try {
    const record = loadRuntimeState(store, runtimeId);
    if (!record) {
      return {
        runtime_id: runtimeId,
        status: "no_prior_state",
        reason: "No prior runtime state record was found for this runtime id.",
        record: null,
        validation: {
          is_valid: true,
          status: "state_valid",
          requires_review: false,
          reason: "No prior runtime state exists, so the runtime can start fresh.",
          blockers: [],
          record: null,
        },
      };
    }

    const validation = validateRuntimeStateWithThreshold(record, now, store.stale_after_ms);
    if (!validation.is_valid) {
      return {
        runtime_id: runtimeId,
        status: "state_corrupt",
        reason: validation.reason,
        record: null,
        validation,
      };
    }
    if (validation.status === "state_blocked") {
      return {
        runtime_id: runtimeId,
        status: "resume_blocked",
        reason: validation.reason,
        record,
        validation,
      };
    }
    if (validation.requires_review) {
      return {
        runtime_id: runtimeId,
        status: "resume_requires_review",
        reason: validation.reason,
        record,
        validation,
      };
    }
    return {
      runtime_id: runtimeId,
      status: "resume_ready",
      reason: validation.reason,
      record,
      validation,
    };
  } catch (error) {
    return {
      runtime_id: runtimeId,
      status: "state_corrupt",
      reason: error instanceof Error ? error.message : "Runtime state record could not be parsed.",
      record: null,
      validation: {
        is_valid: false,
        status: "state_corrupt",
        requires_review: false,
        reason: error instanceof Error ? error.message : "Runtime state record could not be parsed.",
        blockers: [],
        record: null,
      },
    };
  }
}

export function summarizeBootResume(result: RuntimeBootResumeResult): string {
  return [
    `Boot resume status: ${result.status}`,
    `Boot resume reason: ${result.reason}`,
    `Runtime id: ${result.runtime_id}`,
    `Previous status: ${result.record?.last_status ?? "none"}`,
    `Previous stop reason: ${result.record?.stop_reason ?? "none"}`,
    `Previous profile: ${result.record?.profile_name ?? "none"}`,
    `Persisted at: ${result.record?.persisted_at ?? "none"}`,
    `Stored tick history entries: ${result.record?.tick_history.length ?? 0}`,
  ].join("\n");
}
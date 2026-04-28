import type {
  BackgroundRuntimeServiceState,
  BackgroundRuntimeServiceStatus,
  BackgroundRuntimeServiceStopReason,
} from "./backgroundRuntimeService";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardAgentRuntime,
  OperatorDashboardBlockedGoal,
  OperatorDashboardBlocker,
  OperatorDashboardFailure,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorDashboardStatusLine,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";
import type { AgentRuntimeApprovalState, AgentRuntimeId, AgentRuntimeNode, AgentRuntimeRegistry, AgentRuntimeRole, AgentRuntimeSafetyScope, AgentRuntimeStatus } from "./agentRuntimeRegistry";
import { createAgentRuntimeRegistry } from "./agentRuntimeRegistry";
import type { ExecutionChainRecord, ExecutionChainSafetyStatus, ExecutionChainStatus } from "./executionChainState";
import type {
  SupervisedAutonomyApprovalPolicy,
  SupervisedAutonomyCheckpointRecord,
  SupervisedAutonomyRecoveryAction,
  SupervisedAutonomyRecoveryPolicy,
  SupervisedAutonomySafetyScope,
  SupervisedAutonomySafetyStatus,
  SupervisedAutonomySessionRecord,
  SupervisedAutonomySessionStatus,
} from "./supervisedAutonomySession";

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
  event_id: string;
  runtime_id: string;
  attempted_at: string;
  timestamp: string;
  tick_index: number;
  status: ContinuousLoopStatus;
  event_type: "tick_executed" | "goal_transition" | "tick_blocked" | "tick_observed";
  triggered: boolean;
  run_results_recorded: number;
  reason: string;
  active_goal_before: {
    goal_id: string | null;
    goal_label: string | null;
  } | null;
  active_goal_after: {
    goal_id: string | null;
    goal_label: string | null;
  } | null;
  mutation_applied: string | null;
  safety_gate_result: "passed" | "blocked" | "not_triggered";
  scheduler_decision: string | null;
  persistence_result: "persisted_to_runtime_state";
  goal_transition: {
    changed: boolean;
    from_goal_id: string | null;
    to_goal_id: string | null;
    from_goal_label: string | null;
    to_goal_label: string | null;
    summary: string;
  };
  semantic_progression: {
    queue_count_before: number;
    queue_count_after: number;
    blocked_count_before: number;
    blocked_count_after: number;
    runtime_status_before: string;
    runtime_status_after: string;
    scheduler_status_before: string;
    scheduler_status_after: string;
  };
  mutation_summary: string;
  next_scheduled_action: string | null;
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

export type StoredContinuousLoopConfig = {
  tick_interval_ms?: number;
  max_ticks_per_run?: number;
  max_runs_per_invocation?: number;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
  stop_on_blocker?: boolean;
  stop_on_error?: boolean;
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
  continuous_loop_config?: StoredContinuousLoopConfig | null;
  agent_runtime_registry?: AgentRuntimeRegistry | null;
  execution_chains?: ExecutionChainRecord[] | null;
  supervised_session?: SupervisedAutonomySessionRecord | null;
  supervised_checkpoints?: SupervisedAutonomyCheckpointRecord[] | null;
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
    && typeof (value as { event_id?: unknown }).event_id === "string"
    && typeof (value as { runtime_id?: unknown }).runtime_id === "string"
    && isIsoTimestamp((value as { attempted_at?: unknown }).attempted_at)
    && isIsoTimestamp((value as { timestamp?: unknown }).timestamp)
    && isFiniteNonNegativeInteger((value as { tick_index?: unknown }).tick_index)
    && isContinuousLoopStatus((value as { status?: unknown }).status)
    && (
      (value as { event_type?: unknown }).event_type === "tick_executed"
      || (value as { event_type?: unknown }).event_type === "goal_transition"
      || (value as { event_type?: unknown }).event_type === "tick_blocked"
      || (value as { event_type?: unknown }).event_type === "tick_observed"
    )
    && typeof (value as { triggered?: unknown }).triggered === "boolean"
    && isFiniteNonNegativeInteger((value as { run_results_recorded?: unknown }).run_results_recorded)
    && typeof (value as { reason?: unknown }).reason === "string"
    && (
      (value as { active_goal_before?: unknown }).active_goal_before === null
      || Boolean(
        (value as { active_goal_before?: { goal_id?: unknown; goal_label?: unknown } }).active_goal_before
        && (((value as { active_goal_before?: { goal_id?: unknown } }).active_goal_before?.goal_id === null)
          || typeof (value as { active_goal_before?: { goal_id?: unknown } }).active_goal_before?.goal_id === "string")
        && (((value as { active_goal_before?: { goal_label?: unknown } }).active_goal_before?.goal_label === null)
          || typeof (value as { active_goal_before?: { goal_label?: unknown } }).active_goal_before?.goal_label === "string")
      )
    )
    && (
      (value as { active_goal_after?: unknown }).active_goal_after === null
      || Boolean(
        (value as { active_goal_after?: { goal_id?: unknown; goal_label?: unknown } }).active_goal_after
        && (((value as { active_goal_after?: { goal_id?: unknown } }).active_goal_after?.goal_id === null)
          || typeof (value as { active_goal_after?: { goal_id?: unknown } }).active_goal_after?.goal_id === "string")
        && (((value as { active_goal_after?: { goal_label?: unknown } }).active_goal_after?.goal_label === null)
          || typeof (value as { active_goal_after?: { goal_label?: unknown } }).active_goal_after?.goal_label === "string")
      )
    )
    && (((value as { mutation_applied?: unknown }).mutation_applied === null)
      || typeof (value as { mutation_applied?: unknown }).mutation_applied === "string")
    && (
      (value as { safety_gate_result?: unknown }).safety_gate_result === "passed"
      || (value as { safety_gate_result?: unknown }).safety_gate_result === "blocked"
      || (value as { safety_gate_result?: unknown }).safety_gate_result === "not_triggered"
    )
    && (((value as { scheduler_decision?: unknown }).scheduler_decision === null)
      || typeof (value as { scheduler_decision?: unknown }).scheduler_decision === "string")
    && (value as { persistence_result?: unknown }).persistence_result === "persisted_to_runtime_state"
    && Boolean(
      (value as { goal_transition?: unknown }).goal_transition
      && typeof (value as { goal_transition?: { changed?: unknown } }).goal_transition?.changed === "boolean"
      && (((value as { goal_transition?: { from_goal_id?: unknown } }).goal_transition?.from_goal_id === null)
        || typeof (value as { goal_transition?: { from_goal_id?: unknown } }).goal_transition?.from_goal_id === "string")
      && (((value as { goal_transition?: { to_goal_id?: unknown } }).goal_transition?.to_goal_id === null)
        || typeof (value as { goal_transition?: { to_goal_id?: unknown } }).goal_transition?.to_goal_id === "string")
      && (((value as { goal_transition?: { from_goal_label?: unknown } }).goal_transition?.from_goal_label === null)
        || typeof (value as { goal_transition?: { from_goal_label?: unknown } }).goal_transition?.from_goal_label === "string")
      && (((value as { goal_transition?: { to_goal_label?: unknown } }).goal_transition?.to_goal_label === null)
        || typeof (value as { goal_transition?: { to_goal_label?: unknown } }).goal_transition?.to_goal_label === "string")
      && typeof (value as { goal_transition?: { summary?: unknown } }).goal_transition?.summary === "string"
    )
    && Boolean(
      (value as { semantic_progression?: unknown }).semantic_progression
      && isFiniteNonNegativeInteger((value as { semantic_progression?: { queue_count_before?: unknown } }).semantic_progression?.queue_count_before)
      && isFiniteNonNegativeInteger((value as { semantic_progression?: { queue_count_after?: unknown } }).semantic_progression?.queue_count_after)
      && isFiniteNonNegativeInteger((value as { semantic_progression?: { blocked_count_before?: unknown } }).semantic_progression?.blocked_count_before)
      && isFiniteNonNegativeInteger((value as { semantic_progression?: { blocked_count_after?: unknown } }).semantic_progression?.blocked_count_after)
      && typeof (value as { semantic_progression?: { runtime_status_before?: unknown } }).semantic_progression?.runtime_status_before === "string"
      && typeof (value as { semantic_progression?: { runtime_status_after?: unknown } }).semantic_progression?.runtime_status_after === "string"
      && typeof (value as { semantic_progression?: { scheduler_status_before?: unknown } }).semantic_progression?.scheduler_status_before === "string"
      && typeof (value as { semantic_progression?: { scheduler_status_after?: unknown } }).semantic_progression?.scheduler_status_after === "string"
    )
    && typeof (value as { mutation_summary?: unknown }).mutation_summary === "string"
    && (((value as { next_scheduled_action?: unknown }).next_scheduled_action === null)
      || typeof (value as { next_scheduled_action?: unknown }).next_scheduled_action === "string")
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

function isAgentRuntimeRole(value: unknown): value is AgentRuntimeRole {
  return value === "planner" || value === "executor" || value === "validator" || value === "reporter";
}

function isAgentRuntimeId(value: unknown): value is AgentRuntimeId {
  return value === "planner-agent" || value === "executor-agent" || value === "validator-agent" || value === "reporter-agent";
}

function isAgentRuntimeStatus(value: unknown): value is AgentRuntimeStatus {
  return value === "idle" || value === "assigned" || value === "paused" || value === "blocked";
}

function isAgentRuntimeSafetyScope(value: unknown): value is AgentRuntimeSafetyScope {
  return value === "planning_only" || value === "bounded_execution_only" || value === "validation_only" || value === "reporting_only";
}

function isAgentRuntimeApprovalState(value: unknown): value is AgentRuntimeApprovalState {
  return value === "not_required" || value === "approval_pending" || value === "approved" || value === "rejected";
}

function isAgentRuntimeNode(value: unknown): value is AgentRuntimeNode {
  return Boolean(
    value
    && typeof value === "object"
    && isAgentRuntimeId((value as { agent_id?: unknown }).agent_id)
    && isAgentRuntimeRole((value as { role?: unknown }).role)
    && isAgentRuntimeStatus((value as { status?: unknown }).status)
    && Array.isArray((value as { assigned_goal_ids?: unknown }).assigned_goal_ids)
    && ((value as { assigned_goal_ids?: unknown[] }).assigned_goal_ids ?? []).every((goalId) => typeof goalId === "string")
    && (((value as { current_goal_id?: unknown }).current_goal_id === null) || typeof (value as { current_goal_id?: unknown }).current_goal_id === "string")
    && (((value as { last_tick_at?: unknown }).last_tick_at === null) || isIsoTimestamp((value as { last_tick_at?: unknown }).last_tick_at))
    && (((value as { last_event_id?: unknown }).last_event_id === null) || typeof (value as { last_event_id?: unknown }).last_event_id === "string")
    && (((value as { last_event_summary?: unknown }).last_event_summary === null) || typeof (value as { last_event_summary?: unknown }).last_event_summary === "string")
    && isAgentRuntimeSafetyScope((value as { safety_scope?: unknown }).safety_scope)
    && isAgentRuntimeApprovalState((value as { approval_state?: unknown }).approval_state)
    && isFiniteNonNegativeInteger((value as { failure_count?: unknown }).failure_count)
    && (value as { can_spawn_agents?: unknown }).can_spawn_agents === false
    && (value as { max_concurrent_goals?: unknown }).max_concurrent_goals === 1,
  );
}

function isAgentRuntimeRegistry(value: unknown): value is AgentRuntimeRegistry {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { registry_id?: unknown }).registry_id === "string"
    && (((value as { runtime_id?: unknown }).runtime_id === null) || typeof (value as { runtime_id?: unknown }).runtime_id === "string")
    && (((value as { orchestration_id?: unknown }).orchestration_id === null) || typeof (value as { orchestration_id?: unknown }).orchestration_id === "string")
    && typeof (value as { multi_agent_session_id?: unknown }).multi_agent_session_id === "string"
    && (value as { recursion_guard_enabled?: unknown }).recursion_guard_enabled === true
    && (value as { max_agents?: unknown }).max_agents === 4
    && Array.isArray((value as { agents?: unknown }).agents)
    && ((value as { agents?: unknown[] }).agents ?? []).every(isAgentRuntimeNode),
  );
}

function isExecutionChainStatus(value: unknown): value is ExecutionChainStatus {
  return value === "pending" || value === "active" || value === "completed" || value === "blocked";
}

function isExecutionChainSafetyStatus(value: unknown): value is ExecutionChainSafetyStatus {
  return value === "safe" || value === "approval_required" || value === "blocked";
}

function isExecutionChainRecord(value: unknown): value is ExecutionChainRecord {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { chain_id?: unknown }).chain_id === "string"
    && (((value as { parent_goal_id?: unknown }).parent_goal_id === null) || typeof (value as { parent_goal_id?: unknown }).parent_goal_id === "string")
    && isFiniteNonNegativeInteger((value as { current_step?: unknown }).current_step)
    && isFiniteNonNegativeInteger((value as { total_steps?: unknown }).total_steps)
    && isExecutionChainStatus((value as { status?: unknown }).status)
    && Array.isArray((value as { agent_ids?: unknown }).agent_ids)
    && ((value as { agent_ids?: unknown[] }).agent_ids ?? []).every(isAgentRuntimeId)
    && isIsoTimestamp((value as { started_at?: unknown }).started_at)
    && (((value as { completed_at?: unknown }).completed_at === null) || isIsoTimestamp((value as { completed_at?: unknown }).completed_at))
    && (((value as { failure_reason?: unknown }).failure_reason === null) || typeof (value as { failure_reason?: unknown }).failure_reason === "string")
    && typeof (value as { last_transition?: unknown }).last_transition === "string"
    && isExecutionChainSafetyStatus((value as { safety_status?: unknown }).safety_status),
  );
}

function isSupervisedAutonomySessionStatus(value: unknown): value is SupervisedAutonomySessionStatus {
  return value === "pending_approval"
    || value === "running"
    || value === "paused"
    || value === "waiting_for_operator"
    || value === "recovering"
    || value === "completed"
    || value === "failed"
    || value === "stopped_by_operator"
    || value === "safety_blocked";
}

function isSupervisedAutonomySafetyScope(value: unknown): value is SupervisedAutonomySafetyScope {
  return value === "bounded_runtime_only"
    || value === "bounded_multi_agent_runtime"
    || value === "bounded_execution_only";
}

function isSupervisedAutonomyApprovalPolicy(value: unknown): value is SupervisedAutonomyApprovalPolicy {
  return value === "operator_must_approve_start"
    || value === "operator_must_approve_sensitive"
    || value === "preapproved_with_limits";
}

function isSupervisedAutonomyRecoveryPolicy(value: unknown): value is SupervisedAutonomyRecoveryPolicy {
  return value === "retry_once"
    || value === "pause_chain"
    || value === "request_operator_review"
    || value === "stop_session";
}

function isSupervisedAutonomyRecoveryAction(value: unknown): value is SupervisedAutonomyRecoveryAction {
  return value === "none"
    || value === "retry_once"
    || value === "pause_chain"
    || value === "mark_agent_blocked"
    || value === "request_operator_review"
    || value === "stop_session"
    || value === "record_failure_event";
}

function isSupervisedAutonomySafetyStatus(value: unknown): value is SupervisedAutonomySafetyStatus {
  return value === "passed" || value === "blocked" || value === "review_required";
}

function isSupervisedAutonomySessionRecord(value: unknown): value is SupervisedAutonomySessionRecord {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { session_id?: unknown }).session_id === "string"
    && typeof (value as { runtime_id?: unknown }).runtime_id === "string"
    && isSupervisedAutonomySessionStatus((value as { status?: unknown }).status)
    && isIsoTimestamp((value as { started_at?: unknown }).started_at)
    && (((value as { stopped_at?: unknown }).stopped_at === null) || isIsoTimestamp((value as { stopped_at?: unknown }).stopped_at))
    && isFiniteNonNegativeInteger((value as { duration_ms?: unknown }).duration_ms)
    && isFiniteNonNegativeInteger((value as { max_duration_ms?: unknown }).max_duration_ms)
    && Number((value as { max_duration_ms?: unknown }).max_duration_ms) >= 1
    && isFiniteNonNegativeInteger((value as { tick_budget?: unknown }).tick_budget)
    && Number((value as { tick_budget?: unknown }).tick_budget) >= 1
    && isFiniteNonNegativeInteger((value as { ticks_completed?: unknown }).ticks_completed)
    && isFiniteNonNegativeInteger((value as { max_chain_count?: unknown }).max_chain_count)
    && Number((value as { max_chain_count?: unknown }).max_chain_count) >= 1
    && Array.isArray((value as { agent_ids?: unknown }).agent_ids)
    && ((value as { agent_ids?: unknown[] }).agent_ids ?? []).every((agentId) => typeof agentId === "string")
    && Array.isArray((value as { active_chain_ids?: unknown }).active_chain_ids)
    && ((value as { active_chain_ids?: unknown[] }).active_chain_ids ?? []).every((chainId) => typeof chainId === "string")
    && Array.isArray((value as { completed_chain_ids?: unknown }).completed_chain_ids)
    && ((value as { completed_chain_ids?: unknown[] }).completed_chain_ids ?? []).every((chainId) => typeof chainId === "string")
    && Array.isArray((value as { failed_chain_ids?: unknown }).failed_chain_ids)
    && ((value as { failed_chain_ids?: unknown[] }).failed_chain_ids ?? []).every((chainId) => typeof chainId === "string")
    && isSupervisedAutonomySafetyScope((value as { safety_scope?: unknown }).safety_scope)
    && isSupervisedAutonomyApprovalPolicy((value as { approval_policy?: unknown }).approval_policy)
    && isSupervisedAutonomyRecoveryPolicy((value as { recovery_policy?: unknown }).recovery_policy)
    && (((value as { last_checkpoint_at?: unknown }).last_checkpoint_at === null) || isIsoTimestamp((value as { last_checkpoint_at?: unknown }).last_checkpoint_at))
    && (((value as { stop_reason?: unknown }).stop_reason === null) || typeof (value as { stop_reason?: unknown }).stop_reason === "string")
    && isSupervisedAutonomyRecoveryAction((value as { last_recovery_action?: unknown }).last_recovery_action)
    && (((value as { next_scheduled_tick_at?: unknown }).next_scheduled_tick_at === null) || isIsoTimestamp((value as { next_scheduled_tick_at?: unknown }).next_scheduled_tick_at))
    && (((value as { latest_timeline_event_id?: unknown }).latest_timeline_event_id === null) || typeof (value as { latest_timeline_event_id?: unknown }).latest_timeline_event_id === "string")
    && typeof (value as { pending_operator_review?: unknown }).pending_operator_review === "boolean"
  );
}

function isSupervisedAutonomyCheckpointRecord(value: unknown): value is SupervisedAutonomyCheckpointRecord {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { checkpoint_id?: unknown }).checkpoint_id === "string"
    && typeof (value as { session_id?: unknown }).session_id === "string"
    && isIsoTimestamp((value as { timestamp?: unknown }).timestamp)
    && isFiniteNonNegativeInteger((value as { tick_index?: unknown }).tick_index)
    && Array.isArray((value as { agent_states?: unknown }).agent_states)
    && ((value as { agent_states?: Array<{ agent_id?: unknown; status?: unknown; current_goal_id?: unknown; failure_count?: unknown }> }).agent_states ?? []).every((agentState) => Boolean(
      agentState
      && typeof agentState.agent_id === "string"
      && typeof agentState.status === "string"
      && (agentState.current_goal_id === null || typeof agentState.current_goal_id === "string")
      && isFiniteNonNegativeInteger(agentState.failure_count)
    ))
    && Array.isArray((value as { active_chains?: unknown }).active_chains)
    && ((value as { active_chains?: unknown[] }).active_chains ?? []).every((chainId) => typeof chainId === "string")
    && Array.isArray((value as { queued_goals?: unknown }).queued_goals)
    && ((value as { queued_goals?: unknown[] }).queued_goals ?? []).every((goalId) => typeof goalId === "string")
    && Array.isArray((value as { completed_goals?: unknown }).completed_goals)
    && ((value as { completed_goals?: unknown[] }).completed_goals ?? []).every((goalId) => typeof goalId === "string")
    && isSupervisedAutonomySafetyStatus((value as { safety_status?: unknown }).safety_status)
    && (((value as { latest_timeline_event_id?: unknown }).latest_timeline_event_id === null) || typeof (value as { latest_timeline_event_id?: unknown }).latest_timeline_event_id === "string")
  );
}

function isStoredContinuousLoopConfig(value: unknown): value is StoredContinuousLoopConfig {
  return Boolean(
    value
    && typeof value === "object"
    && (((value as { tick_interval_ms?: unknown }).tick_interval_ms === undefined)
      || (isFiniteNonNegativeInteger((value as { tick_interval_ms?: unknown }).tick_interval_ms)
        && Number((value as { tick_interval_ms?: unknown }).tick_interval_ms) >= 1))
    && (((value as { max_ticks_per_run?: unknown }).max_ticks_per_run === undefined)
      || (isFiniteNonNegativeInteger((value as { max_ticks_per_run?: unknown }).max_ticks_per_run)
        && Number((value as { max_ticks_per_run?: unknown }).max_ticks_per_run) >= 1))
    && (((value as { max_runs_per_invocation?: unknown }).max_runs_per_invocation === undefined)
      || (isFiniteNonNegativeInteger((value as { max_runs_per_invocation?: unknown }).max_runs_per_invocation)
        && Number((value as { max_runs_per_invocation?: unknown }).max_runs_per_invocation) >= 1))
    && (((value as { require_fresh_approvals?: unknown }).require_fresh_approvals === undefined)
      || typeof (value as { require_fresh_approvals?: unknown }).require_fresh_approvals === "boolean")
    && (((value as { require_fresh_context?: unknown }).require_fresh_context === undefined)
      || typeof (value as { require_fresh_context?: unknown }).require_fresh_context === "boolean")
    && (((value as { stop_on_blocker?: unknown }).stop_on_blocker === undefined)
      || typeof (value as { stop_on_blocker?: unknown }).stop_on_blocker === "boolean")
    && (((value as { stop_on_error?: unknown }).stop_on_error === undefined)
      || typeof (value as { stop_on_error?: unknown }).stop_on_error === "boolean")
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

function isDashboardAgentRuntime(value: unknown): value is OperatorDashboardAgentRuntime {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray((value as { agents?: unknown }).agents)
    && ((value as { agents?: unknown[] }).agents ?? []).every(isAgentRuntimeNode)
    && Array.isArray((value as { active_agents?: unknown }).active_agents)
    && ((value as { active_agents?: unknown[] }).active_agents ?? []).every(isAgentRuntimeNode)
    && Array.isArray((value as { idle_agents?: unknown }).idle_agents)
    && ((value as { idle_agents?: unknown[] }).idle_agents ?? []).every(isAgentRuntimeNode)
    && Array.isArray((value as { blocked_agents?: unknown }).blocked_agents)
    && ((value as { blocked_agents?: unknown[] }).blocked_agents ?? []).every(isAgentRuntimeNode)
    && Array.isArray((value as { paused_agents?: unknown }).paused_agents)
    && ((value as { paused_agents?: unknown[] }).paused_agents ?? []).every(isAgentRuntimeNode),
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

function isDashboardRuntimeObservability(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && isFiniteNonNegativeInteger((value as { current_tick?: unknown }).current_tick)
    && (((value as { last_tick_at?: unknown }).last_tick_at === null) || isIsoTimestamp((value as { last_tick_at?: unknown }).last_tick_at))
    && (((value as { last_mutation?: unknown }).last_mutation === null) || typeof (value as { last_mutation?: unknown }).last_mutation === "string")
    && (((value as { last_semantic_transition?: unknown }).last_semantic_transition === null)
      || typeof (value as { last_semantic_transition?: unknown }).last_semantic_transition === "string")
    && (((value as { latest_safety_gate_decision?: unknown }).latest_safety_gate_decision === null)
      || typeof (value as { latest_safety_gate_decision?: unknown }).latest_safety_gate_decision === "string")
    && (((value as { next_scheduled_action?: unknown }).next_scheduled_action === null) || typeof (value as { next_scheduled_action?: unknown }).next_scheduled_action === "string")
    && (((value as { next_scheduled_tick_at?: unknown }).next_scheduled_tick_at === null)
      || isIsoTimestamp((value as { next_scheduled_tick_at?: unknown }).next_scheduled_tick_at))
    && Array.isArray((value as { event_log?: unknown }).event_log)
    && ((value as { event_log?: unknown[] }).event_log ?? []).every(isContinuousLoopTickHistoryEntry)
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
    && (((value as { runtime_observability?: unknown }).runtime_observability === undefined)
      || isDashboardRuntimeObservability((value as { runtime_observability?: unknown }).runtime_observability))
    && (((value as { agent_runtime?: unknown }).agent_runtime === undefined)
      || isDashboardAgentRuntime((value as { agent_runtime?: unknown }).agent_runtime))
    && (((value as { execution_chains?: unknown }).execution_chains === undefined)
      || (Array.isArray((value as { execution_chains?: unknown }).execution_chains)
        && ((value as { execution_chains?: unknown[] }).execution_chains ?? []).every(isExecutionChainRecord)))
    && (((value as { supervised_session?: unknown }).supervised_session === undefined)
      || ((value as { supervised_session?: unknown }).supervised_session === null)
      || isSupervisedAutonomySessionRecord((value as { supervised_session?: unknown }).supervised_session))
    && (((value as { supervised_checkpoints?: unknown }).supervised_checkpoints === undefined)
      || (Array.isArray((value as { supervised_checkpoints?: unknown }).supervised_checkpoints)
        && ((value as { supervised_checkpoints?: unknown[] }).supervised_checkpoints ?? []).every(isSupervisedAutonomyCheckpointRecord)))
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
  if (candidate.continuous_loop_config !== null && candidate.continuous_loop_config !== undefined && !isStoredContinuousLoopConfig(candidate.continuous_loop_config)) {
    throw new Error("Runtime state record continuous_loop_config must be null or a valid stored continuous loop config.");
  }
  if (candidate.agent_runtime_registry !== null && candidate.agent_runtime_registry !== undefined && !isAgentRuntimeRegistry(candidate.agent_runtime_registry)) {
    throw new Error("Runtime state record agent_runtime_registry must be null or a valid bounded agent runtime registry.");
  }
  if (candidate.execution_chains !== null && candidate.execution_chains !== undefined && (!Array.isArray(candidate.execution_chains) || !candidate.execution_chains.every(isExecutionChainRecord))) {
    throw new Error("Runtime state record execution_chains must be null or valid execution chain snapshots.");
  }
  if (candidate.supervised_session !== null && candidate.supervised_session !== undefined && !isSupervisedAutonomySessionRecord(candidate.supervised_session)) {
    throw new Error("Runtime state record supervised_session must be null or a valid supervised autonomy session snapshot.");
  }
  if (candidate.supervised_checkpoints !== null && candidate.supervised_checkpoints !== undefined && (!Array.isArray(candidate.supervised_checkpoints) || !candidate.supervised_checkpoints.every(isSupervisedAutonomyCheckpointRecord))) {
    throw new Error("Runtime state record supervised_checkpoints must be null or valid supervised autonomy checkpoints.");
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
    continuous_loop_config: existingRecord?.continuous_loop_config ?? null,
    agent_runtime_registry: existingRecord?.agent_runtime_registry ?? createAgentRuntimeRegistry({
      runtime_id: serviceState.service_id,
      now: serviceState.stopped_at ?? serviceState.last_tick_at ?? serviceState.started_at ?? serviceState.created_at,
    }),
    execution_chains: existingRecord?.execution_chains ?? [],
    supervised_session: existingRecord?.supervised_session ?? null,
    supervised_checkpoints: existingRecord?.supervised_checkpoints ?? [],
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
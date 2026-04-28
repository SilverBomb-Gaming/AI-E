export type SupervisedAutonomySessionStatus =
  | "pending_approval"
  | "running"
  | "paused"
  | "waiting_for_operator"
  | "recovering"
  | "completed"
  | "failed"
  | "stopped_by_operator"
  | "safety_blocked";

export type SupervisedAutonomySafetyScope =
  | "bounded_runtime_only"
  | "bounded_multi_agent_runtime"
  | "bounded_execution_only";

export type SupervisedAutonomyApprovalPolicy =
  | "operator_must_approve_start"
  | "operator_must_approve_sensitive"
  | "preapproved_with_limits";

export type SupervisedAutonomyRecoveryPolicy =
  | "retry_once"
  | "pause_chain"
  | "request_operator_review"
  | "stop_session";

export type SupervisedAutonomyRecoveryAction =
  | "none"
  | "retry_once"
  | "pause_chain"
  | "mark_agent_blocked"
  | "request_operator_review"
  | "stop_session"
  | "record_failure_event";

export type SupervisedAutonomySafetyStatus =
  | "passed"
  | "blocked"
  | "review_required";

export type SupervisedAutonomySessionRecord = {
  session_id: string;
  runtime_id: string;
  status: SupervisedAutonomySessionStatus;
  started_at: string;
  stopped_at: string | null;
  duration_ms: number;
  max_duration_ms: number;
  tick_budget: number;
  ticks_completed: number;
  max_chain_count: number;
  agent_ids: string[];
  active_chain_ids: string[];
  completed_chain_ids: string[];
  failed_chain_ids: string[];
  safety_scope: SupervisedAutonomySafetyScope;
  approval_policy: SupervisedAutonomyApprovalPolicy;
  recovery_policy: SupervisedAutonomyRecoveryPolicy;
  last_checkpoint_at: string | null;
  stop_reason: string | null;
  last_recovery_action: SupervisedAutonomyRecoveryAction;
  next_scheduled_tick_at: string | null;
  latest_timeline_event_id: string | null;
  pending_operator_review: boolean;
};

export type SupervisedAutonomyCheckpointRecord = {
  checkpoint_id: string;
  session_id: string;
  timestamp: string;
  tick_index: number;
  agent_states: Array<{
    agent_id: string;
    status: string;
    current_goal_id: string | null;
    failure_count: number;
  }>;
  active_chains: string[];
  queued_goals: string[];
  completed_goals: string[];
  safety_status: SupervisedAutonomySafetyStatus;
  latest_timeline_event_id: string | null;
};

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

export function createSupervisedAutonomySessionId(runtimeId: string, startedAt: string): string {
  return `supervised-session-${runtimeId}-${sanitizeTimestamp(startedAt)}`;
}

export function createSupervisedAutonomyCheckpointId(sessionId: string, timestamp: string, tickIndex: number): string {
  return `supervised-checkpoint-${sessionId}-${sanitizeTimestamp(timestamp)}-${tickIndex}`;
}
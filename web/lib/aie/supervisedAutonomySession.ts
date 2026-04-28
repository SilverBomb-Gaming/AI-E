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

export type OvernightAutonomyAllowedAgentRole =
  | "planner"
  | "executor"
  | "validator"
  | "reporter";

export type OvernightAutonomyDisallowedAction = string;

export type OvernightAutonomyReviewItemSeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type OvernightAutonomyReviewItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "deferred"
  | "expired";

export type OvernightAutonomyOperatorDecision =
  | "approve"
  | "reject"
  | "defer";

export type OvernightAutonomyRecoveryOutcome =
  | "retry_once"
  | "retry_later"
  | "reassign_agent"
  | "pause_chain"
  | "request_operator_review"
  | "stop_session"
  | "rollback_to_checkpoint"
  | "mark_failed";

export type OvernightAutonomyResumeStatus =
  | "not_applicable"
  | "resume_ready"
  | "resumed_from_checkpoint"
  | "resume_blocked";

export type OvernightAutonomyPolicyRecord = {
  policy_id: string;
  session_id: string;
  max_runtime_hours: number;
  allowed_time_window: {
    start_time: string;
    end_time: string;
  };
  max_tick_count: number;
  max_chain_count: number;
  max_retries_per_chain: number;
  max_recovery_attempts: number;
  requires_operator_review_before_commit: boolean;
  allowed_agent_roles: OvernightAutonomyAllowedAgentRole[];
  disallowed_actions: OvernightAutonomyDisallowedAction[];
  shutdown_on_failure_count: number;
  checkpoint_interval_ticks: number;
  review_queue_enabled: boolean;
};

export type OvernightAutonomyReviewQueueItemRecord = {
  review_id: string;
  session_id: string;
  source_event_id: string;
  source_chain_id: string | null;
  source_agent_id: string | null;
  severity: OvernightAutonomyReviewItemSeverity;
  title: string;
  summary: string;
  recommended_action: string;
  required_operator_decision: OvernightAutonomyOperatorDecision;
  created_at: string;
  status: OvernightAutonomyReviewItemStatus;
};

export type OvernightAutonomyRecoveryStateRecord = {
  recovery_id: string;
  session_id: string;
  source_event_id: string;
  source_chain_id: string | null;
  source_agent_id: string | null;
  selected_outcome: OvernightAutonomyRecoveryOutcome;
  retry_count_for_chain: number;
  recovery_attempt_count: number;
  rollback_checkpoint_id: string | null;
  summary: string;
  created_at: string;
};

export type OvernightAutonomyResumeStateRecord = {
  resume_status: OvernightAutonomyResumeStatus;
  restart_count: number;
  resumed_from_checkpoint_id: string | null;
  resumed_at: string | null;
  preserved_review_queue_count: number;
  shutdown_reason: string | null;
};

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
  overnight_policy?: OvernightAutonomyPolicyRecord | null;
  review_queue?: OvernightAutonomyReviewQueueItemRecord[];
  active_recovery?: OvernightAutonomyRecoveryStateRecord | null;
  resume_state?: OvernightAutonomyResumeStateRecord | null;
  failure_count?: number;
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

export function createOvernightAutonomyPolicyId(sessionId: string, timestamp: string): string {
  return `overnight-policy-${sessionId}-${sanitizeTimestamp(timestamp)}`;
}

export function createOvernightAutonomyReviewId(sessionId: string, timestamp: string): string {
  return `overnight-review-${sessionId}-${sanitizeTimestamp(timestamp)}`;
}

export function createOvernightAutonomyRecoveryId(sessionId: string, timestamp: string): string {
  return `overnight-recovery-${sessionId}-${sanitizeTimestamp(timestamp)}`;
}
export type MetaPatternSeverity = "high" | "medium" | "low";

export type MetaPatternCategory =
  | "blocked_sessions"
  | "review_deferrals"
  | "recovery_triggers"
  | "slow_chains"
  | "rejected_high_risk_work"
  | "resource_pressure"
  | "proof_failures"
  | "trace_failures"
  | "agent_role_blockers"
  | "agent_role_failures"
  | "operator_interventions"
  | "success_cluster";

export type MetaDetectedPattern = {
  pattern_id: string;
  severity: MetaPatternSeverity;
  category: MetaPatternCategory;
  summary: string;
  evidence: string[];
  affected_sessions: string[];
  affected_agents: string[];
  recommended_action: string;
};

export type MetaPolicyAdjustmentStatus = "pending" | "approved" | "rejected" | "deferred";

export type MetaPolicyAdjustmentImpact = "high" | "medium" | "low";

export type MetaPolicyAdjustmentTarget =
  | "concurrency"
  | "tick_budget"
  | "review_timing"
  | "work_type_priority"
  | "checkpoint_frequency"
  | "agent_role_pause"
  | "proof_timeout"
  | "resource_safe_mode";

export type MetaPolicyAdjustment = {
  recommendation_id: string;
  target: MetaPolicyAdjustmentTarget;
  title: string;
  summary: string;
  evidence: string[];
  impact: MetaPolicyAdjustmentImpact;
  requires_explicit_approval: boolean;
  status: MetaPolicyAdjustmentStatus;
  safe_rationale: string;
  requested_policy_value: string;
  current_policy_value: string;
  last_updated_at: string;
};

export type MetaOperatorDecisionType = "approve_policy_recommendation" | "reject_policy_recommendation" | "defer_policy_recommendation" | "acknowledge_pattern";

export type MetaOperatorDecisionRecord = {
  decision_id: string;
  decision_type: MetaOperatorDecisionType;
  recommendation_id: string | null;
  pattern_id: string | null;
  rationale: string;
  created_at: string;
};

export type MetaPolicyState = {
  concurrency_mode: string;
  tick_budget_mode: string;
  review_timing_mode: string;
  work_type_priority_mode: string;
  checkpoint_frequency_mode: string;
  paused_agent_roles: string[];
  proof_timeout_mode: string;
  resource_safe_mode_enabled: boolean;
  last_updated_at: string;
};

export type MetaIntelligenceState = {
  meta_cycle_id: string;
  observed_window_start: string;
  observed_window_end: string;
  total_sessions: number;
  successful_sessions: number;
  failed_sessions: number;
  blocked_sessions: number;
  average_ticks_to_completion: number;
  average_review_delay: number;
  proof_failure_count: number;
  trace_failure_count: number;
  recovery_event_count: number;
  operator_intervention_count: number;
  resource_pressure_events: number;
  top_failure_patterns: string[];
  top_success_patterns: string[];
  recommended_policy_adjustments: string[];
  safety_notes: string[];
  last_updated_at: string;
};

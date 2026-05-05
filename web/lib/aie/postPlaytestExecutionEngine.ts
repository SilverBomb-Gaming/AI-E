import type { PostPlaytestFixPlanResult } from "./postPlaytestFixPlanner";

export type PostPlaytestExecutionPlanStatus =
  | "execution_ready"
  | "execution_blocked"
  | "operator_approval_required"
  | "no_action_needed";

export type PostPlaytestExecutionPlanResult = {
  status: PostPlaytestExecutionPlanStatus;
  reason: string;
  proposed_actions: string[];
  allowed_file_scopes: string[];
  max_changed_files: number;
  max_retry_count: number;
  requires_operator_approval: boolean;
  confidence: "low" | "medium" | "high";
  source_fix_plan_status?: string;
  source_feature?: string;
  source_outcome_session_key?: string;
};

const READ_ONLY_ACTIONS = [
  "Do not modify project files automatically yet.",
  "Do not rerun Unity automatically yet.",
  "Do not commit automatically yet.",
  "Do not create unlimited loops.",
];

const NARROW_FILE_SCOPES = [
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/Assets/Scripts",
  "orchestrator_lane/Tools/EnemyAIDemoStandalone/ProjectSettings",
];

export function buildPostPlaytestExecutionPlan(
  fixPlan: PostPlaytestFixPlanResult,
): PostPlaytestExecutionPlanResult {
  const baseResult = {
    source_fix_plan_status: fixPlan.status,
    source_feature: fixPlan.source_feature,
    source_outcome_session_key: fixPlan.source_outcome_session_key,
  };

  switch (fixPlan.status) {
    case "no_fix_needed":
      return {
        ...baseResult,
        status: "no_action_needed",
        reason: "The fix planner found no repair work to stage, so no controlled execution envelope is needed.",
        proposed_actions: fixPlan.recommended_fix_steps.slice(),
        allowed_file_scopes: [],
        max_changed_files: 0,
        max_retry_count: 0,
        requires_operator_approval: false,
        confidence: "high",
      };
    case "blocked":
      return {
        ...baseResult,
        status: "execution_blocked",
        reason: fixPlan.reason,
        proposed_actions: fixPlan.recommended_fix_steps.slice(),
        allowed_file_scopes: [],
        max_changed_files: 0,
        max_retry_count: 0,
        requires_operator_approval: true,
        confidence: "high",
      };
    case "needs_operator_review":
      return {
        ...baseResult,
        status: "operator_approval_required",
        reason: fixPlan.reason,
        proposed_actions: fixPlan.recommended_fix_steps.slice(),
        allowed_file_scopes: [],
        max_changed_files: 0,
        max_retry_count: 0,
        requires_operator_approval: true,
        confidence: "low",
      };
    case "fix_plan_ready":
      return {
        ...baseResult,
        status: "execution_ready",
        reason: "A bounded controlled-action envelope is ready for operator approval. No edits, reruns, or commits will execute automatically.",
        proposed_actions: fixPlan.recommended_fix_steps.slice(),
        allowed_file_scopes: NARROW_FILE_SCOPES,
        max_changed_files: 2,
        max_retry_count: 1,
        requires_operator_approval: true,
        confidence: fixPlan.confidence,
      };
    default:
      return {
        ...baseResult,
        status: "operator_approval_required",
        reason: "The fix-plan status was not recognized, so operator approval is required before any controlled action can be prepared.",
        proposed_actions: READ_ONLY_ACTIONS,
        allowed_file_scopes: [],
        max_changed_files: 0,
        max_retry_count: 0,
        requires_operator_approval: true,
        confidence: "low",
      };
  }
}
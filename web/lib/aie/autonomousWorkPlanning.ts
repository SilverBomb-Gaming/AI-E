import { createGoalRecord, type GoalPriority, type GoalRecord } from "./multiGoalOrchestrator";

export type AutonomousWorkItemStatus =
  | "proposed"
  | "approved_for_planning"
  | "rejected"
  | "scheduled"
  | "running"
  | "completed"
  | "needs_review"
  | "blocked"
  | "failed";

export type AutonomousWorkItemPriority = GoalPriority;

export type AutonomousWorkItemRiskLevel = "low" | "medium" | "high";

export type AutonomousWorkItemApprovalLevel = "none" | "operator_review" | "operator_approval";

export type AutonomousWorkItemSafetyScope =
  | "bounded_runtime_only"
  | "bounded_multi_agent_runtime"
  | "bounded_execution_only";

export type AutonomousReviewOperatorAction =
  | "approve"
  | "reject"
  | "defer"
  | "request_changes"
  | "open_pr"
  | "archive";

export type AutonomousReviewPackageStatus = "pending" | "approved" | "rejected" | "deferred" | "request_changes" | "archived";

export type AutonomousDeliveryOperatorAction = "approve_for_commit" | "reject_delivery" | "request_changes" | "archive";

export type AutonomousDeliveryPackageStatus =
  | "draft"
  | "awaiting_operator_approval"
  | "approved_for_commit"
  | "committed"
  | "pushed"
  | "pr_ready"
  | "pr_opened"
  | "rejected"
  | "archived";

export type AutonomousWorkItem = {
  work_item_id: string;
  title: string;
  summary: string;
  source: string;
  proposed_by_agent_id: string;
  priority: AutonomousWorkItemPriority;
  risk_level: AutonomousWorkItemRiskLevel;
  estimated_tick_cost: number;
  required_agent_roles: string[];
  required_approval_level: AutonomousWorkItemApprovalLevel;
  dependency_ids: string[];
  expected_outputs: string[];
  safety_scope: AutonomousWorkItemSafetyScope;
  status: AutonomousWorkItemStatus;
  created_at: string;
  updated_at: string;
};

export type AutonomousWorkItemPolicyFeedback = {
  approvals_recorded: number;
  rejections_recorded: number;
  deferrals_recorded: number;
  request_changes_recorded: number;
  last_feedback_at: string | null;
};

export type AutonomousReviewPackage = {
  package_id: string;
  work_item_id: string;
  chain_id: string;
  status: AutonomousReviewPackageStatus;
  summary: string;
  files_changed: string[];
  tests_run: string[];
  proof_results: string[];
  risks: string[];
  recommended_decision: AutonomousReviewOperatorAction;
  rollback_notes: string;
  operator_actions: AutonomousReviewOperatorAction[];
};

export type AutonomousDeliveryPackage = {
  delivery_package_id: string;
  review_package_id: string;
  work_item_id: string;
  chain_id: string;
  branch_name: string;
  commit_plan: string[];
  files_changed: string[];
  validation_results: string[];
  proof_results: string[];
  risk_summary: string;
  rollback_plan: string;
  release_notes: string;
  recommended_pr_title: string;
  recommended_pr_body: string;
  operator_decision: AutonomousDeliveryOperatorAction | null;
  status: AutonomousDeliveryPackageStatus;
  created_at: string;
  updated_at: string;
};

export type AutonomousPlanningRankingInput = {
  urgency: number;
  dependency_unlock_value: number;
  operator_preference: number;
  estimated_effort: number;
  risk_level: number;
  current_runtime_budget: number;
  agent_availability: number;
  failure_history: number;
  review_queue_pressure: number;
};

export type RankedAutonomousWorkItem = {
  item: AutonomousWorkItem;
  score: number;
  explanation: string;
  runnable: boolean;
  requires_operator_review: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function clampRank(value: number): number {
  return Math.max(0, Math.min(5, Math.trunc(value)));
}

function riskPenalty(riskLevel: AutonomousWorkItemRiskLevel): number {
  switch (riskLevel) {
    case "high":
      return 5;
    case "medium":
      return 2;
    case "low":
    default:
      return 0;
  }
}

function priorityBoost(priority: AutonomousWorkItemPriority): number {
  switch (priority) {
    case "high":
      return 4;
    case "medium":
      return 2;
    case "low":
    default:
      return 0;
  }
}

function statusRank(status: AutonomousWorkItemStatus): number {
  switch (status) {
    case "running":
      return 0;
    case "scheduled":
      return 1;
    case "approved_for_planning":
      return 2;
    case "proposed":
      return 3;
    case "needs_review":
      return 4;
    case "blocked":
      return 5;
    case "failed":
      return 6;
    case "completed":
      return 7;
    case "rejected":
      return 8;
  }
}

export function createAutonomousWorkItem(input: AutonomousWorkItem): AutonomousWorkItem {
  return {
    ...input,
    work_item_id: normalizeText(input.work_item_id),
    title: normalizeText(input.title),
    summary: normalizeText(input.summary),
    source: normalizeText(input.source),
    proposed_by_agent_id: normalizeText(input.proposed_by_agent_id),
    estimated_tick_cost: Math.max(1, Math.trunc(input.estimated_tick_cost)),
    required_agent_roles: unique(input.required_agent_roles),
    dependency_ids: unique(input.dependency_ids),
    expected_outputs: unique(input.expected_outputs),
    updated_at: input.updated_at || input.created_at,
  };
}

export function createAutonomousReviewPackage(input: AutonomousReviewPackage): AutonomousReviewPackage {
  return {
    ...input,
    package_id: normalizeText(input.package_id),
    work_item_id: normalizeText(input.work_item_id),
    chain_id: normalizeText(input.chain_id),
    summary: normalizeText(input.summary),
    files_changed: unique(input.files_changed),
    tests_run: unique(input.tests_run),
    proof_results: unique(input.proof_results),
    risks: unique(input.risks),
    rollback_notes: normalizeText(input.rollback_notes),
    operator_actions: [...new Set(input.operator_actions)],
  };
}

export function createAutonomousDeliveryPackage(input: AutonomousDeliveryPackage): AutonomousDeliveryPackage {
  return {
    ...input,
    delivery_package_id: normalizeText(input.delivery_package_id),
    review_package_id: normalizeText(input.review_package_id),
    work_item_id: normalizeText(input.work_item_id),
    chain_id: normalizeText(input.chain_id),
    branch_name: normalizeText(input.branch_name),
    commit_plan: unique(input.commit_plan),
    files_changed: unique(input.files_changed),
    validation_results: unique(input.validation_results),
    proof_results: unique(input.proof_results),
    risk_summary: normalizeText(input.risk_summary),
    rollback_plan: normalizeText(input.rollback_plan),
    release_notes: normalizeText(input.release_notes),
    recommended_pr_title: normalizeText(input.recommended_pr_title),
    recommended_pr_body: normalizeText(input.recommended_pr_body),
    updated_at: input.updated_at || input.created_at,
  };
}

export function createAutonomousWorkItemPolicyFeedback(
  input: Partial<AutonomousWorkItemPolicyFeedback> = {},
): AutonomousWorkItemPolicyFeedback {
  return {
    approvals_recorded: Math.max(0, Math.trunc(input.approvals_recorded ?? 0)),
    rejections_recorded: Math.max(0, Math.trunc(input.rejections_recorded ?? 0)),
    deferrals_recorded: Math.max(0, Math.trunc(input.deferrals_recorded ?? 0)),
    request_changes_recorded: Math.max(0, Math.trunc(input.request_changes_recorded ?? 0)),
    last_feedback_at: input.last_feedback_at ?? null,
  };
}

export function rankAutonomousWorkItems(
  items: AutonomousWorkItem[],
  context: Partial<AutonomousPlanningRankingInput> = {},
): RankedAutonomousWorkItem[] {
  const ranking = items.map((item) => {
    const urgency = clampRank(context.urgency ?? (item.priority === "high" ? 4 : item.priority === "medium" ? 3 : 2));
    const dependencyUnlockValue = clampRank(context.dependency_unlock_value ?? Math.min(5, item.dependency_ids.length + (item.expected_outputs.length > 0 ? 1 : 0)));
    const operatorPreference = clampRank(context.operator_preference ?? (item.required_approval_level === "none" ? 3 : 1));
    const estimatedEffort = clampRank(context.estimated_effort ?? item.estimated_tick_cost);
    const runtimeBudget = clampRank(context.current_runtime_budget ?? 4);
    const agentAvailability = clampRank(context.agent_availability ?? Math.max(1, Math.min(5, item.required_agent_roles.length === 0 ? 5 : 5 - item.required_agent_roles.length + 1)));
    const failureHistory = clampRank(context.failure_history ?? 0);
    const reviewQueuePressure = clampRank(context.review_queue_pressure ?? 0);
    const riskLevel = clampRank(context.risk_level ?? (item.risk_level === "high" ? 5 : item.risk_level === "medium" ? 3 : 1));
    const budgetFit = item.estimated_tick_cost <= runtimeBudget ? 3 : -6;
    const requiresOperatorReview = item.risk_level === "high" || item.required_approval_level !== "none";
    const runnable = item.status !== "blocked"
      && item.status !== "rejected"
      && item.status !== "completed"
      && item.estimated_tick_cost <= runtimeBudget;
    const score = (urgency * 4)
      + (dependencyUnlockValue * 3)
      + (operatorPreference * 2)
      + (agentAvailability * 2)
      + priorityBoost(item.priority)
      + budgetFit
      - estimatedEffort
      - riskLevel
      - riskPenalty(item.risk_level)
      - failureHistory
      - reviewQueuePressure;

    return {
      item,
      score,
      explanation: [
        `urgency ${urgency}`,
        `dependency unlock ${dependencyUnlockValue}`,
        `operator preference ${operatorPreference}`,
        `budget ${item.estimated_tick_cost <= runtimeBudget ? "fits" : "exceeds"}`,
        `risk ${item.risk_level}`,
      ].join(", "),
      runnable,
      requires_operator_review: requiresOperatorReview,
    } satisfies RankedAutonomousWorkItem;
  });

  return ranking.sort((left, right) => {
    if (left.runnable !== right.runnable) {
      return left.runnable ? -1 : 1;
    }

    if (left.score !== right.score) {
      return right.score - left.score;
    }

    const leftStatus = statusRank(left.item.status);
    const rightStatus = statusRank(right.item.status);
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }

    if (left.item.estimated_tick_cost !== right.item.estimated_tick_cost) {
      return left.item.estimated_tick_cost - right.item.estimated_tick_cost;
    }

    return left.item.work_item_id.localeCompare(right.item.work_item_id);
  });
}

export function createGoalRecordFromWorkItem(item: AutonomousWorkItem): GoalRecord {
  return createGoalRecord({
    id: item.work_item_id,
    description: item.title,
    priority: item.priority,
    status: item.status === "running"
      ? "active"
      : item.status === "completed"
        ? "completed"
        : item.status === "blocked" || item.status === "failed"
          ? "blocked"
          : "pending",
    created_at: item.created_at,
    last_updated_at: item.updated_at,
    depends_on_goal_ids: item.dependency_ids,
    related_goal_ids: item.expected_outputs,
  });
}
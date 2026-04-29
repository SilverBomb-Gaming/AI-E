import type { AutonomousDeliveryPackage, AutonomousReviewPackage } from "./autonomousWorkPlanning";
import type { ExecutionChainRecord } from "./executionChainState";
import type { OperatorDashboardAgentRuntime, OperatorDashboardAutonomousSessionState, OperatorDashboardState, OperatorRuntimeObservabilityEvent, OperatorDashboardStatusLine } from "./operatorDashboardState";
import type { StudioOperationsState, StudioPriorityWorkItem, StudioRecommendedOperatorAction, StudioResourcePressure, StudioRiskItem, StudioOperationsStatus } from "./studioOperationsState";
import type { SupervisedAutonomySessionRecord } from "./supervisedAutonomySession";

export type StudioHealthAggregatorInput = {
  runtime_status: OperatorDashboardStatusLine;
  autonomous_sessions?: OperatorDashboardAutonomousSessionState;
  agent_runtime?: OperatorDashboardAgentRuntime;
  execution_chains?: ExecutionChainRecord[];
  review_queue?: AutonomousReviewPackage[];
  delivery_packages?: AutonomousDeliveryPackage[];
  overnight_policy?: SupervisedAutonomySessionRecord["overnight_policy"];
  timeline_events?: OperatorRuntimeObservabilityEvent[];
  active_goal: OperatorDashboardState["active_goal"];
  queued_goals: OperatorDashboardState["queued_goals"];
  blocked_goals: OperatorDashboardState["blocked_goals"];
  paused_goals: OperatorDashboardState["paused_goals"];
  approvals_required: OperatorDashboardState["approvals_required"];
  recovery_recommendations: OperatorDashboardState["recovery_recommendations"];
  validation_issues: OperatorDashboardState["validation_issues"];
  last_updated_at: string;
};

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function asArray<T>(value: T[] | undefined): T[] {
  return value ?? [];
}

function normalizePriority(value: string | null | undefined): "critical" | "high" | "medium" | "low" {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function inferResourcePressure(autonomousSessions?: OperatorDashboardAutonomousSessionState): StudioResourcePressure {
  if (!autonomousSessions || autonomousSessions.sessions.length === 0) {
    return "low";
  }

  const cpuLimit = autonomousSessions.max_logical_cpu_units;
  const chainLimit = autonomousSessions.max_concurrent_chains;
  const cpuRatio = cpuLimit > 0 ? autonomousSessions.total_logical_cpu_units / cpuLimit : 0;
  const chainRatio = chainLimit > 0 ? autonomousSessions.total_active_chains / chainLimit : 0;
  const ratio = Math.max(cpuRatio, chainRatio);

  if (ratio >= 1) {
    return "critical";
  }
  if (ratio >= 0.85 || autonomousSessions.resource_status.status === "resource_pressure") {
    return "high";
  }
  if (ratio >= 0.6) {
    return "medium";
  }
  return "low";
}

function countReviewPackages(reviewQueue: AutonomousReviewPackage[]): { pending: number; active: number } {
  let pending = 0;
  let active = 0;

  for (const item of reviewQueue) {
    if (/approved|rejected|archived/i.test(item.status)) {
      continue;
    }
    if (/open|in_progress|needs_review|pending/i.test(item.status)) {
      pending += 1;
    } else {
      active += 1;
    }
  }

  return { pending, active };
}

function countDeliveryPackages(deliveryPackages: AutonomousDeliveryPackage[]): { active: number; pending: number } {
  let active = 0;
  let pending = 0;

  for (const item of deliveryPackages) {
    if (/approved for commit|open pr|delivery_ready|approved/i.test(item.status)) {
      active += 1;
      continue;
    }
    if (/draft|pending|changes|review/i.test(item.status)) {
      pending += 1;
    }
  }

  return { active, pending };
}

function countExecutionChains(executionChains: ExecutionChainRecord[]): { active: number; blocked: number } {
  let active = 0;
  let blocked = 0;

  for (const chain of executionChains) {
    if (/blocked|failed|paused|awaiting/i.test(chain.status)) {
      blocked += 1;
      continue;
    }
    if (!/completed|cancelled/i.test(chain.status)) {
      active += 1;
    }
  }

  return { active, blocked };
}

function buildPriorityWork(input: StudioHealthAggregatorInput): StudioPriorityWorkItem[] {
  const items: StudioPriorityWorkItem[] = [];

  if (input.active_goal) {
    items.push({
      id: input.active_goal.goal_id,
      title: input.active_goal.description,
      kind: "goal",
      priority: normalizePriority(input.active_goal.priority),
      status: input.active_goal.status,
      summary: input.active_goal.explanation,
    });
  }

  for (const goal of input.blocked_goals.slice(0, 2)) {
    items.push({
      id: goal.goal_id,
      title: goal.description,
      kind: "goal",
      priority: normalizePriority(goal.priority),
      status: goal.status,
      summary: goal.explanation,
    });
  }

  for (const item of asArray(input.review_queue).slice(0, 2)) {
    items.push({
      id: item.package_id,
      title: item.work_item_id,
      kind: "review",
      priority: normalizePriority(item.recommended_decision === "approve" ? "high" : "medium"),
      status: item.status,
      summary: item.summary,
    });
  }

  for (const item of asArray(input.delivery_packages).slice(0, 2)) {
    items.push({
      id: item.work_item_id,
      title: item.work_item_id,
      kind: "delivery",
      priority: "medium",
      status: item.status,
      summary: item.release_notes,
    });
  }

  return items
    .sort((left, right) => {
      const priorityWeight = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      return priorityWeight[left.priority] - priorityWeight[right.priority] || left.title.localeCompare(right.title);
    })
    .slice(0, 4);
}

function buildRisks(
  input: StudioHealthAggregatorInput,
  resourcePressure: StudioResourcePressure,
  pendingReviewCount: number,
  blockedSessionCount: number,
  blockedChainCount: number,
): StudioRiskItem[] {
  const risks: StudioRiskItem[] = [];

  for (const recommendation of input.recovery_recommendations.slice(0, 3)) {
    risks.push({
      id: recommendation.report_id,
      source: recommendation.source,
      severity: recommendation.severity === "high" ? "high" : recommendation.severity === "medium" ? "medium" : "low",
      summary: recommendation.reason,
    });
  }

  for (const issue of input.validation_issues.slice(0, 2)) {
    risks.push({
      id: `${issue.source}-${issue.status}`,
      source: issue.source,
      severity: "medium",
      summary: issue.summary,
    });
  }

  if (blockedSessionCount > 0) {
    risks.push({
      id: `blocked-sessions-${blockedSessionCount}`,
      source: "autonomous_sessions",
      severity: blockedSessionCount > 1 ? "high" : "medium",
      summary: `${blockedSessionCount} autonomous session${blockedSessionCount === 1 ? " is" : "s are"} blocked or failed.`,
    });
  }

  if (blockedChainCount > 0) {
    risks.push({
      id: `blocked-chains-${blockedChainCount}`,
      source: "execution_chains",
      severity: blockedChainCount > 1 ? "high" : "medium",
      summary: `${blockedChainCount} execution chain${blockedChainCount === 1 ? " is" : "s are"} blocked or awaiting recovery.`,
    });
  }

  if (pendingReviewCount >= 3) {
    risks.push({
      id: `review-overload-${pendingReviewCount}`,
      source: "review_queue",
      severity: pendingReviewCount >= 5 ? "high" : "medium",
      summary: `${pendingReviewCount} review packages are waiting for operator attention.`,
    });
  }

  if (resourcePressure === "high" || resourcePressure === "critical") {
    risks.push({
      id: `resource-pressure-${resourcePressure}`,
      source: "runtime_resources",
      severity: resourcePressure === "critical" ? "high" : "medium",
      summary: `Resource pressure is ${resourcePressure} across the active autonomous session pool.`,
    });
  }

  return risks
    .sort((left, right) => {
      const severityWeight = { high: 0, medium: 1, low: 2 } as const;
      return severityWeight[left.severity] - severityWeight[right.severity] || left.summary.localeCompare(right.summary);
    })
    .slice(0, 5);
}

function buildRecommendedActions(
  input: StudioHealthAggregatorInput,
  pendingReviewCount: number,
  blockedSessionCount: number,
  blockedChainCount: number,
  resourcePressure: StudioResourcePressure,
): StudioRecommendedOperatorAction[] {
  const actions: StudioRecommendedOperatorAction[] = [];

  if (input.approvals_required.length > 0) {
    actions.push({
      action: "prioritize_review_queue",
      priority: "high",
      reason: `${input.approvals_required.length} approval gate${input.approvals_required.length === 1 ? " is" : "s are"} blocking forward progress.`,
    });
  }

  if (pendingReviewCount > 0) {
    actions.push({
      action: "prioritize_review_queue",
      priority: pendingReviewCount >= 3 ? "high" : "medium",
      reason: `${pendingReviewCount} review package${pendingReviewCount === 1 ? " is" : "s are"} pending operator review.`,
    });
  }

  if (asArray(input.delivery_packages).some((item) => /approved for commit|open pr|delivery_ready|approved/i.test(item.status))) {
    actions.push({
      action: "prioritize_delivery_queue",
      priority: "medium",
      reason: "Delivery-ready work is available and should be surfaced before it stalls.",
    });
  }

  if (blockedSessionCount > 0 || blockedChainCount > 0) {
    actions.push({
      action: "request_studio_summary",
      priority: "high",
      reason: "Blocked runtime work needs a concise studio-level summary before the next operator decision.",
    });
  }

  if (resourcePressure === "critical") {
    actions.push({
      action: "pause_all_sessions",
      priority: "high",
      reason: "Resource pressure is critical and should be reduced before more work is allowed to run.",
    });
  }

  if (input.paused_goals.length > 0 || asArray(input.autonomous_sessions?.sessions).some((session) => session.status === "paused")) {
    actions.push({
      action: "resume_safe_sessions",
      priority: "medium",
      reason: "Paused sessions can be resumed selectively when they are no longer blocked or unsafe.",
    });
  }

  if (input.recovery_recommendations.length > 0 || input.validation_issues.length > 0) {
    actions.push({
      action: "acknowledge_studio_risk",
      priority: "medium",
      reason: "Recovery or validation risks are present and should be explicitly acknowledged in the live runtime record.",
    });
  }

  const seen = new Set<string>();
  return actions.filter((item) => {
    if (seen.has(item.action)) {
      return false;
    }
    seen.add(item.action);
    return true;
  }).slice(0, 5);
}

function inferStudioStatus(
  score: number,
  input: StudioHealthAggregatorInput,
  blockedSessionCount: number,
  resourcePressure: StudioResourcePressure,
): StudioOperationsStatus {
  if (/paused/i.test(input.runtime_status.status) && blockedSessionCount === 0) {
    return "paused";
  }
  if (resourcePressure === "critical" || score <= 34) {
    return "overloaded";
  }
  if (blockedSessionCount > 0 || score <= 44) {
    return "blocked";
  }
  if (/recover/i.test(input.runtime_status.status) || input.recovery_recommendations.length > 0) {
    return "recovering";
  }
  if (score <= 79 || input.approvals_required.length > 0 || input.validation_issues.length > 0) {
    return "needs_attention";
  }
  return "nominal";
}

export function aggregateStudioHealth(input: StudioHealthAggregatorInput): StudioOperationsState {
  const autonomousSessions = input.autonomous_sessions;
  const reviewQueue = asArray(input.review_queue);
  const deliveryPackages = asArray(input.delivery_packages);
  const executionChains = asArray(input.execution_chains);

  const activeSessionCount = autonomousSessions?.sessions.filter((session) => session.status === "running" || session.status === "pending").length ?? 0;
  const blockedSessionCount = autonomousSessions?.sessions.filter((session) => session.status === "blocked" || session.status === "failed" || session.blocked_by_conflict).length ?? 0;
  const pausedSessionCount = autonomousSessions?.sessions.filter((session) => session.status === "paused").length ?? 0;
  const reviewCounts = countReviewPackages(reviewQueue);
  const deliveryCounts = countDeliveryPackages(deliveryPackages);
  const chainCounts = countExecutionChains(executionChains);
  const resourcePressure = inferResourcePressure(autonomousSessions);

  let healthScore = 100;
  healthScore -= blockedSessionCount * 12;
  healthScore -= pausedSessionCount > 0 && activeSessionCount === 0 && (input.queued_goals.length > 0 || blockedSessionCount > 0) ? 10 : 0;
  healthScore -= reviewCounts.pending >= 5 ? 20 : reviewCounts.pending >= 3 ? 12 : reviewCounts.pending > 0 ? 4 : 0;
  healthScore -= chainCounts.blocked * 8;
  healthScore -= input.validation_issues.length * 8;
  healthScore -= input.approvals_required.length * 6;
  healthScore -= input.recovery_recommendations.length * 7;
  healthScore -= resourcePressure === "critical" ? 20 : resourcePressure === "high" ? 12 : resourcePressure === "medium" ? 5 : 0;
  if (/blocked|failed/i.test(input.runtime_status.status)) {
    healthScore -= 12;
  }

  const clampedHealthScore = clampScore(healthScore);
  const recentRisks = buildRisks(input, resourcePressure, reviewCounts.pending, blockedSessionCount, chainCounts.blocked);
  const recommendedOperatorActions = buildRecommendedActions(input, reviewCounts.pending, blockedSessionCount, chainCounts.blocked, resourcePressure);

  return {
    studio_status: inferStudioStatus(clampedHealthScore, input, blockedSessionCount, resourcePressure),
    health_score: clampedHealthScore,
    active_session_count: activeSessionCount,
    blocked_session_count: blockedSessionCount,
    paused_session_count: pausedSessionCount,
    pending_review_count: reviewCounts.pending,
    active_delivery_count: deliveryCounts.active,
    pending_delivery_count: deliveryCounts.pending,
    active_chain_count: chainCounts.active,
    blocked_chain_count: chainCounts.blocked,
    resource_pressure: resourcePressure,
    top_priority_work: buildPriorityWork(input),
    recent_risks: recentRisks,
    recommended_operator_actions: recommendedOperatorActions,
    last_updated_at: input.last_updated_at,
  };
}

export function aggregateStudioHealthFromDashboardState(state: OperatorDashboardState): StudioOperationsState {
  return aggregateStudioHealth({
    runtime_status: state.runtime_status,
    autonomous_sessions: state.autonomous_sessions,
    agent_runtime: state.agent_runtime,
    execution_chains: state.execution_chains,
    review_queue: state.review_packages,
    delivery_packages: state.delivery_packages,
    overnight_policy: state.supervised_session?.overnight_policy,
    timeline_events: state.runtime_observability?.event_log,
    active_goal: state.active_goal,
    queued_goals: state.queued_goals,
    blocked_goals: state.blocked_goals,
    paused_goals: state.paused_goals,
    approvals_required: state.approvals_required,
    recovery_recommendations: state.recovery_recommendations,
    validation_issues: state.validation_issues,
    last_updated_at: state.last_updated_at,
  });
}
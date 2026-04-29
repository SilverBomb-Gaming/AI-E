import type { OperatorDashboardState } from "./operatorDashboardState";
import { aggregateStudioHealthFromDashboardState } from "./studioHealthAggregator";

export type StudioOperationsSummaryPackage = {
  requested_at: string;
  generated_at: string;
  what_is_running: string[];
  what_is_blocked: string[];
  what_needs_review: string[];
  what_is_delivery_ready: string[];
  risks: string[];
  recommended_next_operator_action: string;
  latest_validation_status: string | null;
  narrative: string;
};

function asReadableList(values: string[], emptyMessage: string): string[] {
  return values.length > 0 ? values : [emptyMessage];
}

export function createStudioOperationsSummary(
  state: OperatorDashboardState,
  requestedAt = state.last_updated_at,
): StudioOperationsSummaryPackage {
  const studioOperations = state.studio_operations ?? aggregateStudioHealthFromDashboardState(state);
  const running = [
    ...(state.active_goal ? [`Goal: ${state.active_goal.description}`] : []),
    ...((state.autonomous_sessions?.sessions ?? [])
      .filter((session) => session.status === "running" || session.status === "pending")
      .map((session) => `Session: ${session.session_id} (${session.status})`)),
    ...((state.execution_chains ?? [])
      .filter((chain) => !/completed|cancelled|failed/i.test(chain.status))
      .map((chain) => `Chain: ${chain.chain_id} (${chain.status})`)),
  ];
  const blocked = [
    ...state.blocked_goals.map((goal) => `Goal: ${goal.description} (${goal.blocker_type})`),
    ...((state.autonomous_sessions?.sessions ?? [])
      .filter((session) => session.status === "blocked" || session.status === "failed" || session.blocked_by_conflict)
      .map((session) => `Session: ${session.session_id} (${session.status})`)),
    ...((state.execution_chains ?? [])
      .filter((chain) => /blocked|failed|awaiting|paused/i.test(chain.status))
      .map((chain) => `Chain: ${chain.chain_id} (${chain.status})`)),
  ];
  const needsReview = [
    ...state.approvals_required.map((approval) => `Approval: ${approval.goal_id ?? "global"}`),
    ...((state.review_packages ?? [])
      .filter((item) => item.status === "pending" || item.status === "deferred" || item.status === "request_changes")
      .map((item) => `Review package: ${item.work_item_id} (${item.status})`)),
  ];
  const deliveryReady = (state.delivery_packages ?? [])
    .filter((item) => /approved_for_commit|pr_ready|pr_opened|pushed|committed/i.test(item.status))
    .map((item) => `Delivery: ${item.work_item_id} (${item.status})`);
  const risks = studioOperations.recent_risks.map((risk) => risk.summary);
  const latestValidationStatus = state.validation_issues.length > 0
    ? state.validation_issues[0]?.summary ?? null
    : state.delivery_packages?.find((item) => item.validation_results.length > 0)?.validation_results[0] ?? null;
  const nextAction = studioOperations.recommended_operator_actions[0]?.action ?? "request_studio_summary";

  return {
    requested_at: requestedAt,
    generated_at: state.last_updated_at,
    what_is_running: asReadableList(running, "No active goal, autonomous session, or execution chain is currently running."),
    what_is_blocked: asReadableList(blocked, "No blocked goals, sessions, or chains are currently recorded."),
    what_needs_review: asReadableList(needsReview, "No operator approvals or review packages are currently waiting."),
    what_is_delivery_ready: asReadableList(deliveryReady, "No delivery-ready package is currently waiting."),
    risks: asReadableList(risks, "No recent studio risks are currently recorded."),
    recommended_next_operator_action: nextAction,
    latest_validation_status: latestValidationStatus,
    narrative: [
      `Studio status is ${studioOperations.studio_status.replace(/_/g, " ")} with health score ${studioOperations.health_score}.`,
      `Running: ${running.length}. Blocked: ${blocked.length}. Pending review: ${studioOperations.pending_review_count}. Pending delivery: ${studioOperations.pending_delivery_count}.`,
      `Recommended next operator action: ${nextAction.replace(/_/g, " ")}.`,
    ].join(" "),
  };
}
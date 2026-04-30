import type { OperatorDashboardState } from "./operatorDashboardState";
import type { StrategyGoal } from "./strategyGoalPortfolio";

export type StrategySummaryPackage = {
  requested_at: string;
  current_strategic_goals: string[];
  top_recommended_goal: string | null;
  blocked_strategic_work: string[];
  highest_risk_strategy: string | null;
  best_next_objective: string | null;
  suggested_decomposition: string[];
  rationale: string;
  operator_decisions_needed: string[];
};

function sortByUpdated(goal: StrategyGoal): number {
  const parsed = Date.parse(goal.updated_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createStrategySummary(state: OperatorDashboardState, requestedAt: string): StrategySummaryPackage {
  const goals = [...(state.strategy_goals ?? [])].sort((left, right) => sortByUpdated(right) - sortByUpdated(left));
  const scores = state.strategy_portfolio_scores ?? [];
  const topScore = scores[0] ?? null;
  const topGoal = topScore ? goals.find((goal) => goal.strategy_goal_id === topScore.strategy_goal_id) ?? null : null;
  const blockedGoals = goals.filter((goal) => goal.status === "blocked" || goal.blocked_by.length > 0);
  const highestRiskGoal = [...goals].sort((left, right) => right.risk_score - left.risk_score || left.strategy_goal_id.localeCompare(right.strategy_goal_id))[0] ?? null;
  const latestDecomposition = state.strategy_decompositions?.[0] ?? null;

  return {
    requested_at: requestedAt,
    current_strategic_goals: goals.map((goal) => `${goal.title} (${goal.status})`),
    top_recommended_goal: topGoal?.title ?? null,
    blocked_strategic_work: blockedGoals.map((goal) => `${goal.title}: ${goal.blocked_by.join(", ") || "blocked"}`),
    highest_risk_strategy: highestRiskGoal ? `${highestRiskGoal.title} (${highestRiskGoal.risk_score})` : null,
    best_next_objective: topGoal ? `${topGoal.title} -> ${topScore?.recommended_action.replace(/_/g, " ")}` : null,
    suggested_decomposition: latestDecomposition?.proposed_work_items ?? [],
    rationale: topScore
      ? `${topGoal?.title ?? topScore.strategy_goal_id} ranks first with score ${topScore.score_breakdown.total}. ${topScore.rationale}`
      : "No strategic portfolio ranking is available yet.",
    operator_decisions_needed: goals
      .filter((goal) => goal.status === "proposed" || goal.status === "under_review" || goal.status === "approved")
      .map((goal) => `${goal.title}: ${goal.status === "approved" ? "activate or decompose" : "approve, reject, or defer"}`),
  };
}
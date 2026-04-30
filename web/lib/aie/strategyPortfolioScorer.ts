import type { OperatorDashboardState } from "./operatorDashboardState";
import type {
  StrategyGoal,
  StrategyPortfolioScore,
  StrategyPortfolioScoreBreakdown,
  StrategyRecommendedAction,
} from "./strategyGoalPortfolio";

export type StrategyPortfolioScoringInput = {
  goals: StrategyGoal[];
  state: OperatorDashboardState;
  operator_preferences?: string[];
};

function hasAvailableOwner(goal: StrategyGoal, state: OperatorDashboardState): boolean {
  return (state.agent_runtime?.agents ?? []).some((agent) => agent.role === goal.owner_agent_role && agent.status !== "blocked");
}

function buildRecommendedAction(goal: StrategyGoal, total: number): StrategyRecommendedAction {
  if (goal.status === "blocked") {
    return "clear_blockers";
  }
  if (goal.status === "completed" || goal.status === "rejected") {
    return "archive_goal";
  }
  if (goal.status === "active") {
    return goal.linked_work_item_ids.length === 0 ? "decompose_goal" : "monitor_goal";
  }
  if (goal.status === "approved") {
    return goal.blocked_by.length === 0 ? "activate_goal" : "clear_blockers";
  }
  if (goal.status === "paused") {
    return "pause_goal";
  }
  if (goal.risk_score >= 70 || goal.confidence_score <= 45 || total < 20) {
    return "review_before_activation";
  }
  return "approve_goal";
}

function buildBreakdown(goal: StrategyGoal, input: StrategyPortfolioScoringInput): StrategyPortfolioScoreBreakdown {
  const resourcePressure = input.state.studio_operations?.resource_pressure ?? "low";
  const metaPenalty = (input.state.meta_detected_patterns ?? []).reduce((total, pattern) => {
    if (pattern.recommended_action.includes(goal.category) || pattern.summary.toLowerCase().includes(goal.category)) {
      return total + (pattern.severity === "high" ? -10 : pattern.severity === "medium" ? -6 : -3);
    }
    return total;
  }, 0);
  const operatorPreferenceBonus = (input.operator_preferences ?? []).some((item) => item === goal.category || item === goal.owner_agent_role) ? 8 : 0;
  const deliveryReadinessBonus = goal.linked_delivery_package_ids.length > 0 ? 6 : goal.expected_outputs.length > 0 ? 2 : 0;
  const availableAgentBonus = hasAvailableOwner(goal, input.state) ? 6 : -8;
  const dependencyPenalty = goal.dependency_goal_ids.length * -4;
  const blockedPenalty = goal.blocked_by.length * -12;
  const resourcePressurePenalty = resourcePressure === "critical" ? -16 : resourcePressure === "high" ? -10 : resourcePressure === "medium" ? -4 : 0;
  const impact = Math.round(goal.impact_score * 0.45);
  const effort = -Math.round(goal.effort_score * 0.2);
  const risk = -Math.round(goal.risk_score * 0.35);
  const confidence = Math.round(goal.confidence_score * 0.25);
  const total = impact + effort + risk + confidence + dependencyPenalty + blockedPenalty + operatorPreferenceBonus + availableAgentBonus + metaPenalty + deliveryReadinessBonus + resourcePressurePenalty;

  return {
    impact,
    effort,
    risk,
    confidence,
    dependency_penalty: dependencyPenalty,
    blocked_penalty: blockedPenalty,
    operator_preference_bonus: operatorPreferenceBonus,
    available_agent_bonus: availableAgentBonus,
    meta_pattern_adjustment: metaPenalty,
    delivery_readiness_bonus: deliveryReadinessBonus,
    resource_pressure_penalty: resourcePressurePenalty,
    total,
  };
}

export function scoreStrategyPortfolio(input: StrategyPortfolioScoringInput): StrategyPortfolioScore[] {
  const scored = input.goals.map((goal) => {
    const scoreBreakdown = buildBreakdown(goal, input);
    const recommendedAction = buildRecommendedAction(goal, scoreBreakdown.total);
    const riskNotes = [
      goal.risk_score >= 70 ? `Risk score ${goal.risk_score} requires explicit review before activation.` : null,
      goal.confidence_score <= 45 ? `Confidence score ${goal.confidence_score} is too low for automatic activation.` : null,
      goal.blocked_by.length > 0 ? `Blocked by: ${goal.blocked_by.join(", ")}.` : null,
      goal.dependency_goal_ids.length > 0 ? `Dependencies: ${goal.dependency_goal_ids.join(", ")}.` : null,
    ].filter((value): value is string => Boolean(value));

    return {
      strategy_goal_id: goal.strategy_goal_id,
      portfolio_rank: 0,
      score_breakdown: scoreBreakdown,
      recommended_action: recommendedAction,
      rationale: `${goal.title} scores ${scoreBreakdown.total} from impact ${scoreBreakdown.impact}, confidence ${scoreBreakdown.confidence}, risk ${scoreBreakdown.risk}, and effort ${scoreBreakdown.effort}.`,
      risk_notes: riskNotes,
    } satisfies StrategyPortfolioScore;
  }).sort((left, right) => {
    return right.score_breakdown.total - left.score_breakdown.total
      || left.risk_notes.length - right.risk_notes.length
      || left.strategy_goal_id.localeCompare(right.strategy_goal_id);
  });

  return scored.map((item, index) => ({
    ...item,
    portfolio_rank: index + 1,
  }));
}
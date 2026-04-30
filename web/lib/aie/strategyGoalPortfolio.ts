import type { GoalPriority } from "./multiGoalOrchestrator";

export type StrategyGoalStatus =
  | "proposed"
  | "under_review"
  | "approved"
  | "active"
  | "paused"
  | "blocked"
  | "completed"
  | "rejected"
  | "archived";

export type StrategyGoalCategory =
  | "product"
  | "engineering"
  | "gameplay"
  | "tooling"
  | "research"
  | "content"
  | "monetization"
  | "operations"
  | "infrastructure";

export type StrategyTimeHorizon = "immediate" | "near_term" | "quarterly" | "long_term";

export type StrategyGoal = {
  strategy_goal_id: string;
  title: string;
  summary: string;
  category: StrategyGoalCategory;
  priority: GoalPriority;
  impact_score: number;
  effort_score: number;
  risk_score: number;
  confidence_score: number;
  time_horizon: StrategyTimeHorizon;
  status: StrategyGoalStatus;
  owner_agent_role: string;
  dependency_goal_ids: string[];
  blocked_by: string[];
  success_criteria: string[];
  expected_outputs: string[];
  linked_work_item_ids: string[];
  linked_delivery_package_ids: string[];
  created_at: string;
  updated_at: string;
};

export type StrategyRecommendedAction =
  | "approve_goal"
  | "review_before_activation"
  | "activate_goal"
  | "decompose_goal"
  | "pause_goal"
  | "clear_blockers"
  | "monitor_goal"
  | "archive_goal";

export type StrategyPortfolioScoreBreakdown = {
  impact: number;
  effort: number;
  risk: number;
  confidence: number;
  dependency_penalty: number;
  blocked_penalty: number;
  operator_preference_bonus: number;
  available_agent_bonus: number;
  meta_pattern_adjustment: number;
  delivery_readiness_bonus: number;
  resource_pressure_penalty: number;
  total: number;
};

export type StrategyPortfolioScore = {
  strategy_goal_id: string;
  portfolio_rank: number;
  score_breakdown: StrategyPortfolioScoreBreakdown;
  recommended_action: StrategyRecommendedAction;
  rationale: string;
  risk_notes: string[];
};

export type StrategyGoalDecompositionRecord = {
  strategy_goal_id: string;
  proposed_work_items: string[];
  dependencies: string[];
  suggested_agent_roles: string[];
  estimated_tick_cost: number;
  risk_level: "low" | "medium" | "high";
  review_gates: string[];
  delivery_expectations: string[];
  created_at: string;
};

export type StrategyGoalDecisionType =
  | "approve_strategy_goal"
  | "reject_strategy_goal"
  | "defer_strategy_goal"
  | "activate_strategy_goal"
  | "pause_strategy_goal"
  | "archive_strategy_goal"
  | "decompose_strategy_goal";

export type StrategyGoalDecisionRecord = {
  decision_id: string;
  strategy_goal_id: string;
  decision_type: StrategyGoalDecisionType;
  rationale: string;
  created_at: string;
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeStrategyGoal(goal: StrategyGoal): StrategyGoal {
  return {
    ...goal,
    impact_score: clampScore(goal.impact_score),
    effort_score: clampScore(goal.effort_score),
    risk_score: clampScore(goal.risk_score),
    confidence_score: clampScore(goal.confidence_score),
    dependency_goal_ids: [...goal.dependency_goal_ids],
    blocked_by: [...goal.blocked_by],
    success_criteria: [...goal.success_criteria],
    expected_outputs: [...goal.expected_outputs],
    linked_work_item_ids: [...goal.linked_work_item_ids],
    linked_delivery_package_ids: [...goal.linked_delivery_package_ids],
  };
}
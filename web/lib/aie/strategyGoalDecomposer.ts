import {
  createAutonomousWorkItem,
  type AutonomousWorkItem,
} from "./autonomousWorkPlanning";
import type { StrategyGoal, StrategyGoalDecompositionRecord } from "./strategyGoalPortfolio";

export type StrategyGoalDecomposition = {
  decomposition: StrategyGoalDecompositionRecord;
  proposed_work_items: AutonomousWorkItem[];
};

function determineRiskLevel(goal: StrategyGoal): "low" | "medium" | "high" {
  if (goal.risk_score >= 70) {
    return "high";
  }
  if (goal.risk_score >= 40) {
    return "medium";
  }
  return "low";
}

export function decomposeStrategyGoal(goal: StrategyGoal, timestamp: string): StrategyGoalDecomposition {
  const riskLevel = determineRiskLevel(goal);
  const reviewGates = [
    "Operator review required before approving generated work items.",
    "Generated work remains non-running until the existing work-item approval path accepts it.",
    riskLevel === "high" ? "High-risk decomposition requires validator coverage before activation." : null,
  ].filter((value): value is string => Boolean(value));
  const deliveryExpectations = goal.expected_outputs.length > 0
    ? goal.expected_outputs.map((item) => `Produce ${item}.`)
    : [`Deliver a bounded milestone artifact for ${goal.title}.`];

  const proposedWorkItems = [
    createAutonomousWorkItem({
      work_item_id: `${goal.strategy_goal_id}-portfolio-brief`,
      title: `${goal.title}: strategy brief`,
      summary: `Create a bounded execution brief for ${goal.title}.`,
      source: "strategy_engine",
      proposed_by_agent_id: `${goal.owner_agent_role}-strategy-advisor`,
      priority: goal.priority,
      risk_level: riskLevel,
      estimated_tick_cost: Math.max(1, Math.ceil(goal.effort_score / 20)),
      required_agent_roles: [goal.owner_agent_role, "planner"],
      required_approval_level: "operator_approval",
      dependency_ids: [...goal.dependency_goal_ids],
      expected_outputs: [`${goal.strategy_goal_id}-strategy-brief.md`],
      safety_scope: "bounded_multi_agent_runtime",
      status: "proposed",
      created_at: timestamp,
      updated_at: timestamp,
    }),
    createAutonomousWorkItem({
      work_item_id: `${goal.strategy_goal_id}-review-gate`,
      title: `${goal.title}: validation gate`,
      summary: `Prepare validation and review gates for ${goal.title} before any runtime execution.`,
      source: "strategy_engine",
      proposed_by_agent_id: `${goal.owner_agent_role}-strategy-advisor`,
      priority: goal.priority,
      risk_level: riskLevel,
      estimated_tick_cost: Math.max(1, Math.ceil(goal.effort_score / 25)),
      required_agent_roles: ["validator", goal.owner_agent_role],
      required_approval_level: "operator_approval",
      dependency_ids: [`${goal.strategy_goal_id}-portfolio-brief`],
      expected_outputs: [`${goal.strategy_goal_id}-validation-plan.md`],
      safety_scope: "bounded_multi_agent_runtime",
      status: "proposed",
      created_at: timestamp,
      updated_at: timestamp,
    }),
  ];

  return {
    decomposition: {
      strategy_goal_id: goal.strategy_goal_id,
      proposed_work_items: proposedWorkItems.map((item) => item.work_item_id),
      dependencies: [...goal.dependency_goal_ids],
      suggested_agent_roles: [...new Set(proposedWorkItems.flatMap((item) => item.required_agent_roles))],
      estimated_tick_cost: proposedWorkItems.reduce((total, item) => total + item.estimated_tick_cost, 0),
      risk_level: riskLevel,
      review_gates: reviewGates,
      delivery_expectations: deliveryExpectations,
      created_at: timestamp,
    },
    proposed_work_items: proposedWorkItems,
  };
}
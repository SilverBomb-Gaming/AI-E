import type { PostPlaytestDecisionResult } from "./postPlaytestDecisionEngine";
import type { PostPlaytestStrategySelectorResult } from "./postPlaytestStrategySelector";

export type PostPlaytestFixPlanStatus =
  | "fix_plan_ready"
  | "no_fix_needed"
  | "blocked"
  | "needs_operator_review";

export type PostPlaytestFixPlanResult = {
  status: PostPlaytestFixPlanStatus;
  reason: string;
  recommended_fix_steps: string[];
  safety_constraints: string[];
  confidence: "low" | "medium" | "high";
  source_decision_status?: string;
  source_strategy_id?: string | null;
  source_strategy_label?: string | null;
  source_feature?: string;
  source_outcome_session_key?: string;
};

const BASE_SAFETY_CONSTRAINTS = [
  "Do not edit project files automatically.",
  "Do not rerun Unity automatically.",
  "Require operator approval before any fix implementation.",
];

export function buildPostPlaytestFixPlan(
  decision: PostPlaytestDecisionResult,
  strategy?: PostPlaytestStrategySelectorResult,
): PostPlaytestFixPlanResult {
  const baseResult = {
    source_decision_status: decision.status,
    source_strategy_id: strategy?.selected_strategy_id ?? null,
    source_strategy_label: strategy?.selected_strategy_label ?? null,
    source_feature: decision.source_feature,
    source_outcome_session_key: decision.source_outcome_session_key,
  };

  const strategySpecificSteps = strategy?.selected_strategy_id === "configuration_adjustment"
    ? [
      "Limit the repair to one reviewed project setting change and avoid generated artifacts.",
      "Do not broaden the edit beyond the explicitly allowed configuration scope.",
    ]
    : strategy?.selected_strategy_id === "test_or_marker_adjustment"
      ? [
        "Keep the repair limited to instrumentation or marker-only updates.",
        "Do not change gameplay logic while collecting the next reviewed validation signal.",
      ]
      : [
        "Prefer the smallest source edit and keep the change isolated to one or two reviewed files.",
      ];

  switch (decision.status) {
    case "ready_for_next_feature":
      return {
        ...baseResult,
        status: "no_fix_needed",
        reason: "The post-playtest decision marked the current feature as stable, so no fix plan is needed.",
        recommended_fix_steps: [
          "Mark current feature stable and select next validation target.",
        ],
        safety_constraints: BASE_SAFETY_CONSTRAINTS,
        confidence: "high",
      };
    case "retry_recommended":
      return {
        ...baseResult,
        status: "fix_plan_ready",
        reason: strategy?.selected_strategy_id
          ? `The post-playtest decision recommends a bounded retry, so AI-E prepared a ${strategy.selected_strategy_id} fix plan for operator review.`
          : "The post-playtest decision recommends a bounded retry, so AI-E prepared a smallest-change fix plan for operator review.",
        recommended_fix_steps: [
          "Inspect failure evidence from the reviewed Unity playtest.",
          "Identify the smallest code or configuration change that addresses the observed failure.",
          ...strategySpecificSteps,
          "Avoid broad rewrites and keep the change isolated to the failing behavior.",
          "Rerun the reviewed Unity playtest after operator approval.",
        ],
        safety_constraints: [
          ...BASE_SAFETY_CONSTRAINTS,
          "Prefer the smallest safe change over broad rewrites.",
          "Do not reuse a failed strategy inside the same bounded loop when another safe strategy remains viable.",
        ],
        confidence: decision.confidence === "high" ? "high" : "medium",
      };
    case "escalation_recommended":
      return {
        ...baseResult,
        status: "needs_operator_review",
        reason: "The post-playtest decision requires operator inspection before AI-E can prepare a trustworthy bounded fix plan.",
        recommended_fix_steps: [
          "Inspect the reviewed playtest evidence with the operator before choosing a fix direction.",
        ],
        safety_constraints: BASE_SAFETY_CONSTRAINTS,
        confidence: "low",
      };
    case "blocked":
      return {
        ...baseResult,
        status: "blocked",
        reason: decision.reason,
        recommended_fix_steps: [
          "Resolve the blocking issue before generating or applying any fix plan.",
        ],
        safety_constraints: BASE_SAFETY_CONSTRAINTS,
        confidence: "high",
      };
    default:
      return {
        ...baseResult,
        status: "needs_operator_review",
        reason: "The post-playtest decision was not recognized, so operator review is required before planning a fix.",
        recommended_fix_steps: [
          "Inspect the reviewed playtest evidence with the operator before choosing a fix direction.",
        ],
        safety_constraints: BASE_SAFETY_CONSTRAINTS,
        confidence: "low",
      };
  }
}
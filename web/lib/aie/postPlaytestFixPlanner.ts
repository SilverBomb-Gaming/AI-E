import type { PostPlaytestDecisionResult } from "./postPlaytestDecisionEngine";

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
): PostPlaytestFixPlanResult {
  const baseResult = {
    source_decision_status: decision.status,
    source_feature: decision.source_feature,
    source_outcome_session_key: decision.source_outcome_session_key,
  };

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
        reason: "The post-playtest decision recommends a bounded retry, so AI-E prepared a smallest-change fix plan for operator review.",
        recommended_fix_steps: [
          "Inspect failure evidence from the reviewed Unity playtest.",
          "Identify the smallest code or configuration change that addresses the observed failure.",
          "Avoid broad rewrites and keep the change isolated to the failing behavior.",
          "Rerun the reviewed Unity playtest after operator approval.",
        ],
        safety_constraints: [
          ...BASE_SAFETY_CONSTRAINTS,
          "Prefer the smallest safe change over broad rewrites.",
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
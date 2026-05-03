import type { LearningRecommendationDecisionRecord } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

export type LearningApplicationAttemptResult = {
  enabled: false;
  gate_enabled: false;
  attempted_application: true;
  applied: false;
  blocked_reason: "learning application disabled";
  recommendation_id: string;
  decision_id: string;
  source_audit_id: string;
  operator_decision: LearningRecommendationDecisionRecord["operator_decision"];
  execution_triggered: false;
  autonomy_triggered: false;
};

function buildDecisionId(decision: LearningRecommendationDecisionRecord): string {
  const normalizedDecisionTimestamp = decision.decided_at.replace(/[:.]/g, "-");
  return `${decision.recommendation_id}-${decision.operator_decision}-${normalizedDecisionTimestamp}`;
}

export function attemptApplyLearningRecommendation(
  recommendation: LearningRecommendation,
  decision: LearningRecommendationDecisionRecord,
): LearningApplicationAttemptResult {
  if (recommendation.applied !== false) {
    throw new Error("Learning application gate requires an unapplied recommendation.");
  }

  if (recommendation.requires_operator_review !== true) {
    throw new Error("Learning application gate requires a recommendation marked for operator review.");
  }

  if (decision.recommendation_id !== recommendation.recommendation_id) {
    throw new Error("Learning application gate requires a matching recommendation decision.");
  }

  if (decision.source_audit_id !== recommendation.source_audit_id) {
    throw new Error("Learning application gate requires a decision from the same source audit.");
  }

  return {
    enabled: false,
    gate_enabled: false,
    attempted_application: true,
    applied: false,
    blocked_reason: "learning application disabled",
    recommendation_id: recommendation.recommendation_id,
    decision_id: buildDecisionId(decision),
    source_audit_id: recommendation.source_audit_id,
    operator_decision: decision.operator_decision,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}
import type { LearningRecommendationDecisionRecord } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

export type LearningApplicationAttemptResult = {
  enabled: false;
  applied: false;
  blocked_reason: "learning application disabled";
  recommendation_id: string;
  source_audit_id: string;
  operator_decision: LearningRecommendationDecisionRecord["operator_decision"];
  execution_triggered: false;
  autonomy_triggered: false;
};

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
    applied: false,
    blocked_reason: "learning application disabled",
    recommendation_id: recommendation.recommendation_id,
    source_audit_id: recommendation.source_audit_id,
    operator_decision: decision.operator_decision,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}
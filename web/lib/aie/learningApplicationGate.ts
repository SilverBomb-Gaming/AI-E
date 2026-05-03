import { getLearningConfig } from "./learningConfig";
import { applyScopedLearningApplication, getLearningApplicationState, type LearningApplicationScope } from "./learningApplicationState";
import { assessLearningAdjustment, markLearningDriftDetected, recordLearningAdjustment } from "./learningStabilityGuard";
import type { LearningRecommendationDecisionRecord } from "./learningRecommendationDecision";
import type { LearningRecommendation } from "./learningRecommendationReview";

export type LearningApplicationAttemptResult = {
  enabled: boolean;
  gate_enabled: boolean;
  attempted_application: true;
  applied: boolean;
  blocked_reason?: "learning disabled globally" | "learning recommendation not approved" | "learning scope not allowed" | "learning drift detected";
  recommendation_id: string;
  decision_id: string;
  source_audit_id: string;
  operator_decision: LearningRecommendationDecisionRecord["operator_decision"];
  scope?: LearningApplicationScope;
  reversible?: true;
  previous_value?: number;
  applied_value?: number;
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
  options?: { scope?: LearningApplicationScope; appliedAt?: string },
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

  const learningConfig = getLearningConfig();
  const requestedScope = options?.scope ?? "ranking_weight_adjustment";

  if (learningConfig.learning_enabled !== true) {
    return {
      enabled: false,
      gate_enabled: false,
      attempted_application: true,
      applied: false,
      blocked_reason: "learning disabled globally",
      recommendation_id: recommendation.recommendation_id,
      decision_id: buildDecisionId(decision),
      source_audit_id: recommendation.source_audit_id,
      operator_decision: decision.operator_decision,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  if (decision.operator_decision !== "approved_for_future_application") {
    return {
      enabled: false,
      gate_enabled: false,
      attempted_application: true,
      applied: false,
      blocked_reason: "learning recommendation not approved",
      recommendation_id: recommendation.recommendation_id,
      decision_id: buildDecisionId(decision),
      source_audit_id: recommendation.source_audit_id,
      operator_decision: decision.operator_decision,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  if (requestedScope !== "ranking_weight_adjustment" || recommendation.recommendation_kind !== "ranking_adjustment_candidate") {
    return {
      enabled: false,
      gate_enabled: false,
      attempted_application: true,
      applied: false,
      blocked_reason: "learning scope not allowed",
      recommendation_id: recommendation.recommendation_id,
      decision_id: buildDecisionId(decision),
      source_audit_id: recommendation.source_audit_id,
      operator_decision: decision.operator_decision,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const currentValue = getLearningApplicationState().parameter_value;
  const stabilityAssessment = assessLearningAdjustment(currentValue, recommendation.confidence);

  if (stabilityAssessment.allowed !== true) {
    markLearningDriftDetected();
    return {
      enabled: false,
      gate_enabled: false,
      attempted_application: true,
      applied: false,
      blocked_reason: "learning drift detected",
      recommendation_id: recommendation.recommendation_id,
      decision_id: buildDecisionId(decision),
      source_audit_id: recommendation.source_audit_id,
      operator_decision: decision.operator_decision,
      scope: "ranking_weight_adjustment",
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const application = applyScopedLearningApplication({
    scope: "ranking_weight_adjustment",
    recommendation_id: recommendation.recommendation_id,
    decision_id: buildDecisionId(decision),
    appliedValue: recommendation.confidence,
    appliedAt: options?.appliedAt,
  });
  recordLearningAdjustment(currentValue, application.applied_value);

  return {
    enabled: true,
    gate_enabled: true,
    attempted_application: true,
    applied: true,
    recommendation_id: recommendation.recommendation_id,
    decision_id: buildDecisionId(decision),
    source_audit_id: recommendation.source_audit_id,
    operator_decision: decision.operator_decision,
    scope: application.scope,
    reversible: true,
    previous_value: application.previous_value,
    applied_value: application.applied_value,
    execution_triggered: false,
    autonomy_triggered: false,
  };
}
import type { NodePlanRanking } from "./planRanking";
import type { PassiveLearningSignals } from "./passiveLearningSignals";

export type SimulatedRankingAdjustment = {
  plan_id: string;
  current_score: number;
  simulated_adjusted_score: number;
  delta: number;
};

function roundToThree(value: number): number {
  return Math.round(Math.max(-1, value) * 1000) / 1000;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computePatternWeight(signals: PassiveLearningSignals, planId: string): { selectionWeight: number; rejectionWeight: number } {
  let selectionWeight = 0;
  let rejectionWeight = 0;

  for (const pattern of signals.misalignment_patterns) {
    const weight = pattern.occurrence_count * pattern.average_error_margin;
    if (pattern.selected_plan_id === planId) {
      selectionWeight += weight;
    }
    if (pattern.recommended_plan_id === planId) {
      rejectionWeight += weight;
    }
  }

  return {
    selectionWeight,
    rejectionWeight,
  };
}

export function simulateRankingAdjustments(
  signals: PassiveLearningSignals,
  rankings: readonly NodePlanRanking[],
): SimulatedRankingAdjustment[] {
  const confidenceFactor = signals.total_records <= 0 ? 0 : Math.min(1, signals.total_records / 4);
  const disagreementFactor = Math.max(0.25, 1 - signals.recommendation_accuracy);

  return rankings.map((ranking) => {
    const { selectionWeight, rejectionWeight } = computePatternWeight(signals, ranking.plan_id);
    const rawDelta = signals.total_records <= 0
      ? 0
      : ((selectionWeight - rejectionWeight) / signals.total_records) * confidenceFactor * disagreementFactor;
    const delta = roundToThree(rawDelta);
    const simulatedAdjustedScore = roundToThree(clampScore(ranking.score + delta));

    return {
      plan_id: ranking.plan_id,
      current_score: ranking.score,
      simulated_adjusted_score: simulatedAdjustedScore,
      delta,
    };
  });
}
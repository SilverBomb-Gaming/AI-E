export type LearningApplicationScope = "ranking_weight_adjustment";

export type ActiveLearningApplication = {
  scope: LearningApplicationScope;
  reversible: true;
  recommendation_id: string;
  decision_id: string;
  applied_at: string;
  previous_value: number;
  applied_value: number;
};

export type LearningApplicationState = {
  scope: LearningApplicationScope;
  parameter_key: "ranking_weight_adjustment";
  parameter_value: number;
  has_active_application: boolean;
  active_application?: ActiveLearningApplication;
};

export type LearningApplicationReversionResult = {
  reverted: boolean;
  scope: LearningApplicationScope;
  reversible: true;
  previous_value: number;
  reverted_value: number;
  recommendation_id?: string;
  decision_id?: string;
};

const DEFAULT_RANKING_WEIGHT_ADJUSTMENT = 0;

let rankingWeightAdjustment = DEFAULT_RANKING_WEIGHT_ADJUSTMENT;
let activeApplication: ActiveLearningApplication | null = null;

function roundToThree(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeTimestamp(value: string | undefined): string {
  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return value.trim();
  }

  return new Date().toISOString();
}

export function getLearningApplicationState(): LearningApplicationState {
  return {
    scope: "ranking_weight_adjustment",
    parameter_key: "ranking_weight_adjustment",
    parameter_value: rankingWeightAdjustment,
    has_active_application: activeApplication !== null,
    active_application: activeApplication ?? undefined,
  };
}

export function applyScopedLearningApplication(input: {
  scope: LearningApplicationScope;
  recommendation_id: string;
  decision_id: string;
  appliedValue: number;
  appliedAt?: string;
}): ActiveLearningApplication {
  if (input.scope !== "ranking_weight_adjustment") {
    throw new Error("Only ranking_weight_adjustment can be applied.");
  }

  const appliedAt = normalizeTimestamp(input.appliedAt);
  const previousValue = rankingWeightAdjustment;
  const appliedValue = roundToThree(input.appliedValue);

  rankingWeightAdjustment = appliedValue;
  activeApplication = {
    scope: "ranking_weight_adjustment",
    reversible: true,
    recommendation_id: input.recommendation_id,
    decision_id: input.decision_id,
    applied_at: appliedAt,
    previous_value: previousValue,
    applied_value: appliedValue,
  };

  return activeApplication;
}

export function revertLearningApplication(): LearningApplicationReversionResult {
  if (!activeApplication) {
    return {
      reverted: false,
      scope: "ranking_weight_adjustment",
      reversible: true,
      previous_value: rankingWeightAdjustment,
      reverted_value: rankingWeightAdjustment,
    };
  }

  const previousApplication = activeApplication;
  rankingWeightAdjustment = previousApplication.previous_value;
  activeApplication = null;

  return {
    reverted: true,
    scope: "ranking_weight_adjustment",
    reversible: true,
    previous_value: previousApplication.applied_value,
    reverted_value: rankingWeightAdjustment,
    recommendation_id: previousApplication.recommendation_id,
    decision_id: previousApplication.decision_id,
  };
}

export function resetLearningApplicationState(): LearningApplicationState {
  rankingWeightAdjustment = DEFAULT_RANKING_WEIGHT_ADJUSTMENT;
  activeApplication = null;
  return getLearningApplicationState();
}
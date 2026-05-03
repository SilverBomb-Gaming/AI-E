export type LearningStabilityGuardStatus = {
  max_adjustment_range: number;
  cumulative_adjustment_limit: number;
  cumulative_adjustment_magnitude: number;
  drift_detected: boolean;
};

export type LearningStabilityAssessment = LearningStabilityGuardStatus & {
  allowed: boolean;
  proposed_adjustment_magnitude: number;
};

const MAX_ADJUSTMENT_RANGE = 0.75;
const CUMULATIVE_ADJUSTMENT_LIMIT = 1.25;

let cumulativeAdjustmentMagnitude = 0;
let driftDetected = false;

function roundToThree(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getLearningStabilityGuardStatus(): LearningStabilityGuardStatus {
  return {
    max_adjustment_range: MAX_ADJUSTMENT_RANGE,
    cumulative_adjustment_limit: CUMULATIVE_ADJUSTMENT_LIMIT,
    cumulative_adjustment_magnitude: roundToThree(cumulativeAdjustmentMagnitude),
    drift_detected: driftDetected,
  };
}

export function assessLearningAdjustment(currentValue: number, proposedValue: number): LearningStabilityAssessment {
  const normalizedProposedValue = roundToThree(proposedValue);
  const proposedAdjustmentMagnitude = roundToThree(Math.abs(normalizedProposedValue - currentValue));
  const proposedCumulativeMagnitude = roundToThree(cumulativeAdjustmentMagnitude + proposedAdjustmentMagnitude);
  const exceedsAdjustmentRange = Math.abs(normalizedProposedValue) > MAX_ADJUSTMENT_RANGE;
  const exceedsCumulativeLimit = proposedCumulativeMagnitude > CUMULATIVE_ADJUSTMENT_LIMIT;
  const allowed = driftDetected !== true && exceedsAdjustmentRange !== true && exceedsCumulativeLimit !== true;

  return {
    max_adjustment_range: MAX_ADJUSTMENT_RANGE,
    cumulative_adjustment_limit: CUMULATIVE_ADJUSTMENT_LIMIT,
    cumulative_adjustment_magnitude: proposedCumulativeMagnitude,
    drift_detected: driftDetected || exceedsAdjustmentRange || exceedsCumulativeLimit,
    proposed_adjustment_magnitude: proposedAdjustmentMagnitude,
    allowed,
  };
}

export function recordLearningAdjustment(currentValue: number, appliedValue: number): LearningStabilityGuardStatus {
  const appliedAdjustmentMagnitude = roundToThree(Math.abs(roundToThree(appliedValue) - currentValue));
  cumulativeAdjustmentMagnitude = roundToThree(cumulativeAdjustmentMagnitude + appliedAdjustmentMagnitude);
  return getLearningStabilityGuardStatus();
}

export function markLearningDriftDetected(): LearningStabilityGuardStatus {
  driftDetected = true;
  return getLearningStabilityGuardStatus();
}

export function resetLearningStabilityGuard(): LearningStabilityGuardStatus {
  cumulativeAdjustmentMagnitude = 0;
  driftDetected = false;
  return getLearningStabilityGuardStatus();
}
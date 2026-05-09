import type {
  HighIntensityFailureAnalysis,
  HighIntensityFailureType,
  HighIntensityRecoveryRecommendation,
} from "./governedHighIntensityState";

const RECOVERY_BY_FAILURE: Record<HighIntensityFailureType, Omit<HighIntensityRecoveryRecommendation, "failureType">> = {
  SILHOUETTE_COLLAPSE: {
    recommendation: "Reduce anime glow and edge softness, then re-check silhouette separation before any further HIGH probe.",
    targetCap: "silhouetteProtection",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  LIGHTING_OVERLOAD: {
    recommendation: "Reduce glow bloom and preserve a single readable lighting focus.",
    targetCap: "glowBloomCap",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  REFLECTION_NOISE: {
    recommendation: "Reduce reflection amplification and stabilize reactive reflections before continuing.",
    targetCap: "reflectionAmplificationCap",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  ATMOSPHERIC_OVERDENSITY: {
    recommendation: "Reduce fog density and restore environmental identity landmarks.",
    targetCap: "atmosphereDensityCap",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  MATERIAL_CLUTTER: {
    recommendation: "Reduce texture density and suppress noisy material detail.",
    targetCap: "materialDetailDensityCap",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  STYLE_OVERPOWER: {
    recommendation: "Reduce overall HIGH style influence and preserve scene cohesion/readability floors.",
    targetCap: "focusReadabilityFloor",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  TRANSITION_VISUAL_BREAKDOWN: {
    recommendation: "Reduce visual amplification during transitions and restore continuity weighting.",
    targetCap: "focusReadabilityFloor",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  READABILITY_COLLAPSE: {
    recommendation: "Restore composition readability, subject visibility, and camera focus before any follow-up probe.",
    targetCap: "objectSeparationFloor",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
};

export function recommendHighIntensityRecovery(analysis: HighIntensityFailureAnalysis | null): HighIntensityRecoveryRecommendation | null {
  if (!analysis) {
    return null;
  }

  return {
    failureType: analysis.failureType,
    ...RECOVERY_BY_FAILURE[analysis.failureType],
  };
}

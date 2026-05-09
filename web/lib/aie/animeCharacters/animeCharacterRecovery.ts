import type {
  AnimeCharacterFailureAnalysis,
  AnimeCharacterFailureType,
  AnimeCharacterRecoveryRecommendation,
} from "./governedAnimeCharacterState";

const RECOVERY_BY_FAILURE: Record<AnimeCharacterFailureType, Omit<AnimeCharacterRecoveryRecommendation, "failureType">> = {
  FACE_READABILITY_DROP: {
    recommendation: "Increase face framing priority, preserve large eye readability, and simplify competing chamber lighting.",
    targetLayer: "character face framing",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  SILHOUETTE_COLLAPSE: {
    recommendation: "Strengthen hair and torso outline contrast while reducing background interference behind the character.",
    targetLayer: "character silhouette separation",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  POSE_READABILITY_FAILURE: {
    recommendation: "Select a simpler pose template with stronger body balance, hand readability, and limb separation.",
    targetLayer: "pose template selection",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  STYLE_IDENTITY_WEAK: {
    recommendation: "Strengthen anime facial proportions, hair shape stylization, and cel-shading clarity.",
    targetLayer: "anime style identity",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  EXPRESSION_INSTABILITY: {
    recommendation: "Return to a calmer expression template and avoid dialogue-mouth or extreme emotion cues.",
    targetLayer: "bounded expression template",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  BACKGROUND_COMPETITION: {
    recommendation: "Reduce chamber emphasis and increase character focus priority so the character dominates the shot.",
    targetLayer: "character-scene composition balance",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  CHARACTER_SCENE_INTEGRATION_FAILURE: {
    recommendation: "Recenter focus flow around face, silhouette, and pose while keeping beacon/chamber elements supportive.",
    targetLayer: "character-aware scene integration",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
  ROLLBACK_PRESSURE_SPIKE: {
    recommendation: "Preserve diagnostics, restore rollback state, and require operator review before any retry.",
    targetLayer: "rollback diagnostics",
    autonomousTuningAllowed: false,
    operatorReviewRequired: true,
  },
};

export function recommendAnimeCharacterRecovery(analysis: AnimeCharacterFailureAnalysis | null): AnimeCharacterRecoveryRecommendation | null {
  if (!analysis) {
    return null;
  }

  return {
    failureType: analysis.failureType,
    ...RECOVERY_BY_FAILURE[analysis.failureType],
  };
}

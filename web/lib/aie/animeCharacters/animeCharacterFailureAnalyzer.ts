import type {
  AnimeCharacterFailureAnalysis,
  AnimeCharacterFailureType,
  AnimeCharacterMetricSnapshot,
  AnimeCharacterThresholdFailure,
} from "./governedAnimeCharacterState";

export function classifyAnimeCharacterFailure(input: {
  metrics: AnimeCharacterMetricSnapshot | null;
  failedThresholds: AnimeCharacterThresholdFailure[];
}): AnimeCharacterFailureAnalysis | null {
  const primaryFailure = input.failedThresholds[0];
  if (!primaryFailure) {
    return null;
  }

  const failedMetrics = new Set(input.failedThresholds.map((entry) => entry.metric));
  let failureType: AnimeCharacterFailureType = "STYLE_IDENTITY_WEAK";
  let weakestSubsystem = primaryFailure.recommendedRuntimeLayer;
  let tuningDirection = "strengthen anime character identity while preserving governed preview readability";

  if (failedMetrics.has("rollbackPressure") || failedMetrics.has("rollbackIntegrityStatus")) {
    failureType = "ROLLBACK_PRESSURE_SPIKE";
    weakestSubsystem = "rollback diagnostics";
    tuningDirection = "restore rollback stability before retrying character rendering";
  } else if (failedMetrics.has("characterFaceReadability")) {
    failureType = "FACE_READABILITY_DROP";
    weakestSubsystem = "face framing and eye readability";
    tuningDirection = "increase face framing priority and simplify lighting competition";
  } else if (failedMetrics.has("characterSilhouette")) {
    failureType = "SILHOUETTE_COLLAPSE";
    weakestSubsystem = "hair silhouette and character/background separation";
    tuningDirection = "strengthen outline contrast and reduce background interference";
  } else if (failedMetrics.has("characterPoseReadability")) {
    failureType = "POSE_READABILITY_FAILURE";
    weakestSubsystem = "pose template and limb readability";
    tuningDirection = "use a simpler pose template with stronger body balance and hand readability";
  } else if (failedMetrics.has("animeStyleIdentity")) {
    failureType = "STYLE_IDENTITY_WEAK";
    weakestSubsystem = "anime facial proportions, hair shape, and cel shading clarity";
    tuningDirection = "strengthen anime facial proportions, hair shape stylization, and cel shading clarity";
  } else if (failedMetrics.has("expressionStability")) {
    failureType = "EXPRESSION_INSTABILITY";
    weakestSubsystem = "bounded expression template";
    tuningDirection = "simplify expression and avoid mouth-performance cues";
  } else if (failedMetrics.has("backgroundSuppression")) {
    failureType = "BACKGROUND_COMPETITION";
    weakestSubsystem = "character-vs-background dominance";
    tuningDirection = "reduce chamber emphasis and increase character focus priority";
  } else if (failedMetrics.has("characterSceneIntegration") || failedMetrics.has("characterFocusPriority")) {
    failureType = "CHARACTER_SCENE_INTEGRATION_FAILURE";
    weakestSubsystem = "character-centered focus flow and composition balance";
    tuningDirection = "prioritize character face, silhouette, and pose as first-class focus subjects";
  }

  return {
    failureType,
    reason: primaryFailure.reason,
    weakestSubsystem,
    tuningDirection,
    autoRetryBlocked: true,
  };
}

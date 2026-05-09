import type {
  HighIntensityFailureAnalysis,
  HighIntensityFailureType,
  HighIntensityMetricSnapshot,
  HighIntensityThresholdFailure,
} from "./governedHighIntensityState";

export function classifyHighIntensityFailure(input: {
  styleId: string;
  domainId: string;
  metrics: HighIntensityMetricSnapshot | null;
  failedThresholds: HighIntensityThresholdFailure[];
}): HighIntensityFailureAnalysis | null {
  const primaryFailure = input.failedThresholds[0];
  if (!primaryFailure) {
    return null;
  }

  const failedMetrics = new Set(input.failedThresholds.map((entry) => entry.metric));
  let failureType: HighIntensityFailureType = "STYLE_OVERPOWER";
  let weakestSubsystem = primaryFailure.recommendedRuntimeLayer;
  let tuningDirection = "reduce HIGH style influence and preserve the governed preview readability floors";

  if (failedMetrics.has("silhouetteReadability") || failedMetrics.has("silhouettePreservation")) {
    failureType = "SILHOUETTE_COLLAPSE";
    weakestSubsystem = "silhouette protection and object separation";
    tuningDirection = "reduce anime glow and edge softness while strengthening object separation";
  } else if (failedMetrics.has("lightingStability")) {
    failureType = "LIGHTING_OVERLOAD";
    weakestSubsystem = "lighting focus and glow bloom caps";
    tuningDirection = "reduce glow bloom and preserve lighting focus";
  } else if (failedMetrics.has("reflectionContinuity")) {
    failureType = "REFLECTION_NOISE";
    weakestSubsystem = "reflection continuity and glow stacking";
    tuningDirection = "reduce reflection amplification and stabilize reactive floor reflections";
  } else if (failedMetrics.has("atmosphereClarity") || failedMetrics.has("environmentalIdentity")) {
    failureType = "ATMOSPHERIC_OVERDENSITY";
    weakestSubsystem = "atmosphere density and environmental identity";
    tuningDirection = "reduce fog density and restore environmental identity";
  } else if (failedMetrics.has("materialClarity")) {
    failureType = "MATERIAL_CLUTTER";
    weakestSubsystem = "material detail density";
    tuningDirection = "reduce texture density and suppress material noise";
  } else if (failedMetrics.has("transitionSmoothness") || failedMetrics.has("transitionContinuity") || failedMetrics.has("visualContinuity")) {
    failureType = "TRANSITION_VISUAL_BREAKDOWN";
    weakestSubsystem = "transition blend and visual continuity";
    tuningDirection = "reduce visual amplification during transitions and preserve motion readability";
  } else if (failedMetrics.has("previewReadability") || failedMetrics.has("highReadabilityScore") || failedMetrics.has("compositionReadability")) {
    failureType = "READABILITY_COLLAPSE";
    weakestSubsystem = "camera staging and composition readability";
    tuningDirection = "restore focus readability and composition clarity before continuing HIGH probes";
  }

  if (input.styleId === "STYLE_004" && (failedMetrics.has("reflectionContinuity") || failedMetrics.has("lightingStability"))) {
    failureType = failedMetrics.has("reflectionContinuity") ? "REFLECTION_NOISE" : "LIGHTING_OVERLOAD";
    weakestSubsystem = "neon glow and reflection caps";
    tuningDirection = "reduce neon reflection amplification and glow stacking";
  }

  if (input.styleId === "STYLE_005" && (failedMetrics.has("atmosphereClarity") || failedMetrics.has("environmentalIdentity") || failedMetrics.has("materialClarity"))) {
    failureType = "ATMOSPHERIC_OVERDENSITY";
    weakestSubsystem = "painterly edge clarity and atmosphere density";
    tuningDirection = "restore edge-preservation weighting and reduce painterly smearing";
  }

  if (input.styleId === "STYLE_002" && failedMetrics.has("materialClarity")) {
    failureType = "MATERIAL_CLUTTER";
    weakestSubsystem = "industrial material density";
    tuningDirection = "reduce material detail density and suppress texture noise";
  }

  return {
    failureType,
    reason: primaryFailure.reason,
    weakestSubsystem,
    tuningDirection,
    autoEscalationBlocked: true,
  };
}

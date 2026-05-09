import type { ApprovedPromptDomainTemplate } from "../promptDomains/approvedPromptDomainTemplates";
import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type {
  StyleIntensityFailureClassification,
  StyleIntensityLevel,
  StyleIntensityMetricSnapshot,
  StyleIntensityThresholdFailure,
} from "./governedStyleIntensityState";

export function classifyStyleIntensityFailure(input: {
  styleProfile: ApprovedVisualStyleProfile;
  domain: ApprovedPromptDomainTemplate;
  intensityLevel: StyleIntensityLevel;
  metrics: StyleIntensityMetricSnapshot | null;
  failedThresholds: StyleIntensityThresholdFailure[];
}): StyleIntensityFailureClassification | null {
  const primaryFailure = input.failedThresholds[0];
  if (!primaryFailure) {
    return null;
  }

  const failedMetrics = new Set(input.failedThresholds.map((entry) => entry.metric));

  if (failedMetrics.has("rollbackPressure") || failedMetrics.has("rollbackIntegrityStatus")) {
    return {
      code: "ROLLBACK_PRESSURE_SPIKE",
      reason: input.failedThresholds.find((entry) => entry.metric === "rollbackPressure" || entry.metric === "rollbackIntegrityStatus")?.reason ?? primaryFailure.reason,
      inspectLayer: "rollback diagnostics",
    };
  }

  if (input.intensityLevel === "HIGH" && failedMetrics.has("styleReadability")) {
    return {
      code: "STYLE_OVERPOWER",
      reason: input.failedThresholds.find((entry) => entry.metric === "styleReadability")?.reason ?? primaryFailure.reason,
      inspectLayer: "style intensity caps",
    };
  }

  if (input.styleProfile.id === "STYLE_003" && failedMetrics.has("silhouetteReadability")) {
    return {
      code: "SILHOUETTE_COLLAPSE",
      reason: input.failedThresholds.find((entry) => entry.metric === "silhouetteReadability")?.reason ?? primaryFailure.reason,
      inspectLayer: "silhouette protection and subject readability",
    };
  }

  if (input.styleProfile.id === "STYLE_004" && (failedMetrics.has("lightingStability") || failedMetrics.has("reflectionContinuity"))) {
    return {
      code: "LIGHTING_OVERLOAD",
      reason: input.failedThresholds.find((entry) => entry.metric === "lightingStability" || entry.metric === "reflectionContinuity")?.reason ?? primaryFailure.reason,
      inspectLayer: "glow caps and reflection continuity",
    };
  }

  if (input.domain.id === "DOMAIN_004" && failedMetrics.has("reflectionContinuity")) {
    return {
      code: "REFLECTION_INSTABILITY",
      reason: input.failedThresholds.find((entry) => entry.metric === "reflectionContinuity")?.reason ?? primaryFailure.reason,
      inspectLayer: "lighting and reflections",
    };
  }

  if (failedMetrics.has("atmosphereClarity")) {
    return {
      code: "ATMOSPHERE_OVERDENSITY",
      reason: input.failedThresholds.find((entry) => entry.metric === "atmosphereClarity")?.reason ?? primaryFailure.reason,
      inspectLayer: "fog readability and atmosphere density",
    };
  }

  if (input.styleProfile.id === "STYLE_002" && failedMetrics.has("materialClarity")) {
    return {
      code: "MATERIAL_NOISE",
      reason: input.failedThresholds.find((entry) => entry.metric === "materialClarity")?.reason ?? primaryFailure.reason,
      inspectLayer: "material detail noise and lighting stability",
    };
  }

  if (failedMetrics.has("focusContinuity") || failedMetrics.has("previewReadability")) {
    return {
      code: "FOCUS_READABILITY_DROP",
      reason: input.failedThresholds.find((entry) => entry.metric === "focusContinuity" || entry.metric === "previewReadability")?.reason ?? primaryFailure.reason,
      inspectLayer: "focus flow and camera staging",
    };
  }

  if (failedMetrics.has("transitionSmoothness") || failedMetrics.has("visualContinuity")) {
    return {
      code: "TRANSITION_VISUAL_NOISE",
      reason: input.failedThresholds.find((entry) => entry.metric === "transitionSmoothness" || entry.metric === "visualContinuity")?.reason ?? primaryFailure.reason,
      inspectLayer: "transition blend and visual continuity",
    };
  }

  return {
    code: "STYLE_OVERPOWER",
    reason: primaryFailure.reason,
    inspectLayer: primaryFailure.recommendedRuntimeLayer,
  };
}

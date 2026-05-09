import type { ApprovedPromptDomainTemplate } from "../promptDomains/approvedPromptDomainTemplates";
import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type {
  StyleStressFailureClassification,
  StyleStressMetricSnapshot,
  StyleStressThresholdFailure,
} from "./governedStyleStressState";

export function classifyStyleStressFailure(input: {
  styleProfile: ApprovedVisualStyleProfile;
  domain: ApprovedPromptDomainTemplate;
  metrics: StyleStressMetricSnapshot | null;
  failedThresholds: StyleStressThresholdFailure[];
}): StyleStressFailureClassification | null {
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

  if (input.styleProfile.id === "STYLE_003" && failedMetrics.has("silhouetteReadability")) {
    return {
      code: "SILHOUETTE_COLLAPSE",
      reason: input.failedThresholds.find((entry) => entry.metric === "silhouetteReadability")?.reason ?? primaryFailure.reason,
      inspectLayer: "entity readability",
    };
  }

  if (input.styleProfile.id === "STYLE_004" && (failedMetrics.has("lightingStability") || failedMetrics.has("reflectionContinuity"))) {
    return {
      code: "LIGHTING_OVERLOAD",
      reason: input.failedThresholds.find((entry) => entry.metric === "lightingStability" || entry.metric === "reflectionContinuity")?.reason ?? primaryFailure.reason,
      inspectLayer: "lighting layers",
    };
  }

  if (input.domain.id === "DOMAIN_004" && (failedMetrics.has("reflectionContinuity") || failedMetrics.has("lightingStability"))) {
    return {
      code: "REFLECTION_INSTABILITY",
      reason: input.failedThresholds.find((entry) => entry.metric === "reflectionContinuity" || entry.metric === "lightingStability")?.reason ?? primaryFailure.reason,
      inspectLayer: "lighting and reflections",
    };
  }

  if (failedMetrics.has("styleCohesion")) {
    return {
      code: "STYLE_COHESION_LOSS",
      reason: input.failedThresholds.find((entry) => entry.metric === "styleCohesion")?.reason ?? primaryFailure.reason,
      inspectLayer: "style profile tuning",
    };
  }

  if (failedMetrics.has("domainCompatibility") || failedMetrics.has("sceneCohesion")) {
    return {
      code: "DOMAIN_COMPATIBILITY_FAILURE",
      reason: input.failedThresholds.find((entry) => entry.metric === "domainCompatibility" || entry.metric === "sceneCohesion")?.reason ?? primaryFailure.reason,
      inspectLayer: failedMetrics.has("sceneCohesion") ? "scene cohesion" : "prompt-domain governance",
    };
  }

  if (failedMetrics.has("focusContinuity") || failedMetrics.has("transitionSmoothness")) {
    return {
      code: "CAMERA_COMPATIBILITY_DROP",
      reason: input.failedThresholds.find((entry) => entry.metric === "focusContinuity" || entry.metric === "transitionSmoothness")?.reason ?? primaryFailure.reason,
      inspectLayer: failedMetrics.has("focusContinuity") ? "focus flow" : "transition blend",
    };
  }

  return {
    code: "PREVIEW_READABILITY_DROP",
    reason: primaryFailure.reason,
    inspectLayer: primaryFailure.metric === "previewReadability" ? "camera and staging" : primaryFailure.recommendedRuntimeLayer,
  };
}
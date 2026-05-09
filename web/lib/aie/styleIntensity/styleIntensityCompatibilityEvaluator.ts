import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import {
  classifyPromptDomainSafety,
  inferPromptDomainCategory,
} from "../promptDomains/domainCompatibilityEvaluator";
import type { ApprovedPromptDomainTemplate } from "../promptDomains/approvedPromptDomainTemplates";
import { classifyVisualStyleProfile } from "../styleProfiles/styleCompatibilityEvaluator";
import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type {
  StyleIntensityCompatibilityResult,
  StyleIntensityLevel,
  StyleIntensityMetricSnapshot,
  StyleIntensityPreset,
  StyleIntensityThresholdFailure,
} from "./governedStyleIntensityState";

export const STYLE_INTENSITY_THRESHOLDS = {
  rollbackIntegrityStatus: "PASS",
  sceneCohesion: 95,
  styleReadability: 95,
  scenePhraseContinuity: 95,
  transitionSmoothness: 95,
  visualContinuity: 94,
  lightingStability: 94,
  reflectionContinuity: 94,
  silhouetteReadability: 95,
  previewReadability: 95,
  atmosphereClarity: 94,
  focusContinuity: 95,
  momentumContinuity: 95,
  finalComposition: 94,
  materialClarity: 90,
  rollbackPressure: 12,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof StyleIntensityMetricSnapshot, string> = {
  sceneCohesion: "scene cohesion",
  styleReadability: "style intensity caps",
  scenePhraseContinuity: "scene phrase continuity",
  transitionSmoothness: "transition blend",
  visualContinuity: "visual continuity",
  lightingStability: "lighting layers",
  reflectionContinuity: "lighting and reflections",
  silhouetteReadability: "entity readability",
  previewReadability: "camera and staging",
  atmosphereClarity: "fog readability and atmosphere density",
  focusContinuity: "focus flow",
  momentumContinuity: "momentum flow",
  finalComposition: "scene cohesion",
  materialClarity: "material detail noise",
  rollbackIntegrityStatus: "rollback diagnostics",
  rollbackPressure: "rollback diagnostics",
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: StyleIntensityMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof StyleIntensityMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: StyleIntensityMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof StyleIntensityMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

function buildIntensityFailureReason(input: {
  styleProfile: ApprovedVisualStyleProfile;
  domain: ApprovedPromptDomainTemplate;
  intensityLevel: StyleIntensityLevel;
  metric: keyof StyleIntensityMetricSnapshot;
}): string | null {
  if (input.intensityLevel === "HIGH" && input.styleProfile.id === "STYLE_003" && input.metric === "silhouetteReadability") {
    return "High anime-inspired intensity collapsed silhouette readability below the governed threshold.";
  }
  if (input.intensityLevel === "HIGH" && input.styleProfile.id === "STYLE_004" && (input.metric === "lightingStability" || input.metric === "reflectionContinuity")) {
    return "High neon intensity caused glow overload and destabilized lighting or reflections.";
  }
  if (input.intensityLevel === "HIGH" && input.styleProfile.id === "STYLE_005" && (input.metric === "previewReadability" || input.metric === "styleReadability")) {
    return "High painterly intensity reduced object clarity below the governed threshold.";
  }
  if (input.intensityLevel === "HIGH" && input.styleProfile.id === "STYLE_002" && input.metric === "materialClarity") {
    return "High industrial realism introduced noisy material clutter below the governed threshold.";
  }
  if (input.domain.id === "DOMAIN_004" && input.metric === "reflectionContinuity") {
    return "Reactive reflection continuity dropped below the governed intensity threshold.";
  }
  if (input.metric === "lightingStability") {
    return "Lighting stability dropped below the governed intensity threshold.";
  }
  if (input.metric === "rollbackPressure") {
    return "Rejected transition counts spiked unexpectedly during the intensity run.";
  }

  return null;
}

export function buildStyleIntensityMetricSnapshot(
  diagnostics: CinematicGovernedPreviewDiagnostics | null,
): StyleIntensityMetricSnapshot | null {
  if (!diagnostics) {
    return null;
  }

  const sceneCohesion = diagnostics.scene_cohesion_score ?? 0;
  const transitionSmoothness = diagnostics.transition_smoothness_score ?? diagnostics.shot_transition_smoothness_score ?? 0;
  const visualContinuity = diagnostics.visual_continuity_score ?? 0;
  const focusContinuity = diagnostics.focus_continuity_score ?? 0;
  const momentumContinuity = diagnostics.momentum_continuity_score ?? 0;
  const previewReadability = diagnostics.readability_score ?? 0;
  const lightingStability = diagnostics.lighting_stability_score ?? diagnostics.lighting_consistency_score ?? 0;
  const reflectionContinuity = diagnostics.reflection_continuity_score ?? visualContinuity;
  const silhouetteReadability = diagnostics.silhouette_readability_score ?? diagnostics.multi_entity_silhouette_score ?? previewReadability;
  const materialClarity = diagnostics.object_fidelity_score ?? previewReadability;
  const atmosphereClarity = average([
    diagnostics.environment_identity_score ?? diagnostics.environment_coherence_score ?? 0,
    previewReadability,
    lightingStability,
  ]);
  const styleReadability = average([
    visualContinuity,
    silhouetteReadability,
    previewReadability,
    materialClarity,
  ]);
  const rollbackPressure = [
    diagnostics.rejected_pose_transition_count,
    diagnostics.rejected_formation_transition_count,
    diagnostics.rejected_staging_transition_count,
    diagnostics.rejected_focus_transition_count,
    diagnostics.rejected_tension_transition_count,
    diagnostics.rejected_momentum_transition_count,
    diagnostics.rejected_blend_transition_count,
    diagnostics.rejected_cohesion_transition_count,
  ].map((value) => typeof value === "number" ? value : 0)
    .reduce((sum, value) => sum + value, 0);

  return {
    sceneCohesion,
    styleReadability,
    scenePhraseContinuity: diagnostics.phrase_continuity_score ?? 0,
    transitionSmoothness,
    visualContinuity,
    lightingStability,
    reflectionContinuity,
    silhouetteReadability,
    previewReadability,
    atmosphereClarity,
    focusContinuity,
    momentumContinuity,
    finalComposition: diagnostics.final_composition_score ?? diagnostics.scene_composition_score ?? 0,
    materialClarity,
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
    rollbackPressure,
  };
}

export function evaluateStyleIntensityThresholds(input: {
  styleProfile: ApprovedVisualStyleProfile;
  domain: ApprovedPromptDomainTemplate;
  intensityLevel: StyleIntensityLevel;
  metrics: StyleIntensityMetricSnapshot | null;
}): {
  pass: boolean;
  failedThresholds: StyleIntensityThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
} {
  if (!input.metrics) {
    return {
      pass: false,
      failedThresholds: [
        {
          metric: "previewReadability",
          actual: "unavailable",
          required: ">=95",
          recommendedRuntimeLayer: "camera and staging",
          reason: "No governed preview diagnostics were available for style intensity evaluation.",
        },
      ],
      recommendedRuntimeLayer: "camera and staging",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: StyleIntensityThresholdFailure[] = [];

  for (const [metric, required] of Object.entries(STYLE_INTENSITY_THRESHOLDS) as Array<[keyof typeof STYLE_INTENSITY_THRESHOLDS, (typeof STYLE_INTENSITY_THRESHOLDS)[keyof typeof STYLE_INTENSITY_THRESHOLDS]]>) {
    const actual = input.metrics[metric as keyof StyleIntensityMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric: metric as keyof StyleIntensityMetricSnapshot,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleIntensityMetricSnapshot],
          reason: "Rollback integrity must remain PASS during governed style intensity execution.",
        });
      }
      continue;
    }

    if (metric === "rollbackPressure") {
      const numericRequired = Number(required);
      if (typeof actual !== "number" || actual > numericRequired) {
        failures.push({
          metric: metric as keyof StyleIntensityMetricSnapshot,
          actual: typeof actual === "number" ? actual : "unavailable",
          required: `<=${numericRequired}`,
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleIntensityMetricSnapshot],
          reason: buildIntensityFailureReason({
            styleProfile: input.styleProfile,
            domain: input.domain,
            intensityLevel: input.intensityLevel,
            metric: metric as keyof StyleIntensityMetricSnapshot,
          }) ?? "Rollback pressure exceeded the governed intensity threshold.",
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric: metric as keyof StyleIntensityMetricSnapshot,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleIntensityMetricSnapshot],
        reason: buildIntensityFailureReason({
          styleProfile: input.styleProfile,
          domain: input.domain,
          intensityLevel: input.intensityLevel,
          metric: metric as keyof StyleIntensityMetricSnapshot,
        }) ?? `${metric} fell below the governed style intensity threshold.`,
      });
    }
  }

  return {
    pass: failures.length === 0,
    failedThresholds: failures,
    recommendedRuntimeLayer: failures[0]?.recommendedRuntimeLayer ?? null,
    strongestMetric: strongestMetric(input.metrics),
    weakestMetric: weakestMetric(input.metrics),
  };
}

export function evaluateStyleIntensityCompatibility(input: {
  styleProfile: ApprovedVisualStyleProfile;
  domain: ApprovedPromptDomainTemplate;
  preset: StyleIntensityPreset;
  metrics: StyleIntensityMetricSnapshot | null;
  highIntensityApproved: boolean;
}): StyleIntensityCompatibilityResult {
  const styleClassification = classifyVisualStyleProfile(input.styleProfile.id);
  const domainSafety = classifyPromptDomainSafety(input.domain.prompt);
  const domainCategory = inferPromptDomainCategory(input.domain.prompt);
  const highApprovalMissing = input.preset.level === "HIGH" && !input.highIntensityApproved;
  const thresholdEvaluation = evaluateStyleIntensityThresholds({
    styleProfile: input.styleProfile,
    domain: input.domain,
    intensityLevel: input.preset.level,
    metrics: input.metrics,
  });
  const compatibilityScore = average(input.metrics ? [
    input.metrics.sceneCohesion,
    input.metrics.styleReadability,
    input.metrics.lightingStability,
    input.metrics.reflectionContinuity,
    input.metrics.silhouetteReadability,
    input.metrics.previewReadability,
    input.metrics.finalComposition,
  ] : []);
  const reasons = [...styleClassification.reasons, ...domainSafety.reasons];
  if (highApprovalMissing) {
    reasons.push("HIGH intensity probes require explicit operator approval before preview execution.");
  }
  if (!thresholdEvaluation.pass && thresholdEvaluation.failedThresholds.length > 0) {
    reasons.push(thresholdEvaluation.failedThresholds[0].reason);
  }

  return {
    styleSafetyStatus: styleClassification.status,
    domainSafetyStatus: domainSafety.status,
    intensitySafetyStatus: highApprovalMissing ? "REJECTED" : "APPROVED",
    styleCategory: styleClassification.styleCategory,
    domainCategory,
    compatibilityScore,
    intensityValue: input.preset.value,
    styleReadabilityScore: input.metrics?.styleReadability ?? 0,
    lightingStabilityScore: input.metrics?.lightingStability ?? 0,
    reflectionContinuityScore: input.metrics?.reflectionContinuity ?? 0,
    rollbackCompatibilityScore: input.metrics?.rollbackIntegrityStatus === "PASS" && (input.metrics.rollbackPressure ?? 0) <= STYLE_INTENSITY_THRESHOLDS.rollbackPressure ? 100 : 0,
    pass: styleClassification.status === "APPROVED"
      && domainSafety.status === "APPROVED"
      && !highApprovalMissing
      && Boolean(domainCategory)
      && thresholdEvaluation.pass,
    failedThresholds: thresholdEvaluation.failedThresholds,
    recommendedRuntimeLayer: styleClassification.status === "REJECTED"
      ? "style governance"
      : domainSafety.status === "REJECTED"
        ? "prompt governance"
        : highApprovalMissing
          ? "operator high-intensity approval"
          : !domainCategory
            ? "prompt-domain governance"
            : thresholdEvaluation.recommendedRuntimeLayer,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
    reasons,
  };
}

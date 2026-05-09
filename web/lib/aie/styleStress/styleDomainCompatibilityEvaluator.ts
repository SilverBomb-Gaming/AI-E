import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import {
  classifyPromptDomainSafety,
  inferPromptDomainCategory,
} from "../promptDomains/domainCompatibilityEvaluator";
import type { ApprovedPromptDomainTemplate } from "../promptDomains/approvedPromptDomainTemplates";
import { classifyVisualStyleProfile } from "../styleProfiles/styleCompatibilityEvaluator";
import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type {
  StyleDomainCompatibilityResult,
  StyleStressMetricSnapshot,
  StyleStressThresholdFailure,
} from "./governedStyleStressState";

export const STYLE_STRESS_THRESHOLDS = {
  rollbackIntegrityStatus: "PASS",
  sceneCohesion: 95,
  styleCohesion: 95,
  domainCompatibility: 95,
  lightingStability: 94,
  reflectionContinuity: 94,
  silhouetteReadability: 95,
  transitionSmoothness: 95,
  focusContinuity: 95,
  tensionContinuity: 95,
  momentumContinuity: 95,
  previewReadability: 95,
  finalComposition: 94,
  rollbackPressure: 12,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof StyleStressMetricSnapshot, string> = {
  sceneCohesion: "scene cohesion",
  styleCohesion: "style profile tuning",
  domainCompatibility: "prompt-domain governance",
  lightingStability: "lighting layers",
  reflectionContinuity: "lighting and reflections",
  silhouetteReadability: "entity readability",
  transitionSmoothness: "transition blend",
  focusContinuity: "focus flow",
  tensionContinuity: "tension curves",
  momentumContinuity: "momentum flow",
  previewReadability: "camera and staging",
  finalComposition: "scene cohesion",
  rollbackIntegrityStatus: "rollback diagnostics",
  rollbackPressure: "rollback diagnostics",
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: StyleStressMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof StyleStressMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: StyleStressMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof StyleStressMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

function buildSpecialFailureReason(
  styleProfile: ApprovedVisualStyleProfile,
  domain: ApprovedPromptDomainTemplate,
  metric: keyof StyleStressMetricSnapshot,
): string | null {
  if (styleProfile.id === "STYLE_003" && metric === "silhouetteReadability") {
    return "Anime-inspired style collapsed silhouette readability below the governed threshold.";
  }
  if (styleProfile.id === "STYLE_002" && metric === "sceneCohesion") {
    return "Industrial realism reduced scene cohesion below the governed threshold.";
  }
  if (styleProfile.id === "STYLE_004" && (metric === "lightingStability" || metric === "reflectionContinuity")) {
    return "Neon dystopian glow overload destabilized lighting and reflection continuity.";
  }
  if (styleProfile.id === "STYLE_005" && (metric === "previewReadability" || metric === "silhouetteReadability")) {
    return "Painterly style reduced object readability below the governed threshold.";
  }
  if (domain.id === "DOMAIN_004" && (metric === "lightingStability" || metric === "reflectionContinuity")) {
    return "Reactive reflection sequence destabilized lighting and reflection continuity.";
  }
  if (metric === "rollbackPressure") {
    return "Rejected transition counts spiked unexpectedly during the style stress run.";
  }

  return null;
}

export function buildStyleStressMetricSnapshot(
  diagnostics: CinematicGovernedPreviewDiagnostics | null,
): StyleStressMetricSnapshot | null {
  if (!diagnostics) {
    return null;
  }

  const sceneCohesion = diagnostics.scene_cohesion_score ?? 0;
  const transitionSmoothness = diagnostics.transition_smoothness_score ?? diagnostics.shot_transition_smoothness_score ?? 0;
  const focusContinuity = diagnostics.focus_continuity_score ?? 0;
  const tensionContinuity = diagnostics.tension_continuity_score ?? 0;
  const momentumContinuity = diagnostics.momentum_continuity_score ?? 0;
  const previewReadability = diagnostics.readability_score ?? 0;
  const lightingStability = diagnostics.lighting_stability_score ?? diagnostics.lighting_consistency_score ?? 0;
  const reflectionContinuity = diagnostics.reflection_continuity_score ?? diagnostics.visual_continuity_score ?? 0;
  const silhouetteReadability = diagnostics.silhouette_readability_score ?? previewReadability;
  const styleCohesion = average([
    diagnostics.visual_continuity_score ?? 0,
    silhouetteReadability,
    previewReadability,
  ]);
  const domainCompatibility = average([
    sceneCohesion,
    focusContinuity,
    diagnostics.environment_identity_score ?? diagnostics.environment_coherence_score ?? 0,
    diagnostics.formation_identity_score ?? diagnostics.formation_stability_score ?? 0,
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
    styleCohesion,
    domainCompatibility,
    lightingStability,
    reflectionContinuity,
    silhouetteReadability,
    transitionSmoothness,
    focusContinuity,
    tensionContinuity,
    momentumContinuity,
    previewReadability,
    finalComposition: diagnostics.final_composition_score ?? diagnostics.scene_composition_score ?? 0,
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
    rollbackPressure,
  };
}

export function evaluateStyleStressThresholds(
  styleProfile: ApprovedVisualStyleProfile,
  domain: ApprovedPromptDomainTemplate,
  metrics: StyleStressMetricSnapshot | null,
): {
  pass: boolean;
  failedThresholds: StyleStressThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
} {
  if (!metrics) {
    return {
      pass: false,
      failedThresholds: [
        {
          metric: "previewReadability",
          actual: "unavailable",
          required: ">=95",
          recommendedRuntimeLayer: "camera and staging",
          reason: "No governed preview diagnostics were available for style stress evaluation.",
        },
      ],
      recommendedRuntimeLayer: "camera and staging",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: StyleStressThresholdFailure[] = [];

  for (const [metric, required] of Object.entries(STYLE_STRESS_THRESHOLDS) as Array<[keyof typeof STYLE_STRESS_THRESHOLDS, (typeof STYLE_STRESS_THRESHOLDS)[keyof typeof STYLE_STRESS_THRESHOLDS]]>) {
    const actual = metrics[metric as keyof StyleStressMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric: metric as keyof StyleStressMetricSnapshot,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleStressMetricSnapshot],
          reason: "Rollback integrity must remain PASS during governed style stress execution.",
        });
      }
      continue;
    }

    if (metric === "rollbackPressure") {
      const numericRequired = Number(required);
      if (typeof actual !== "number" || actual > numericRequired) {
        failures.push({
          metric: metric as keyof StyleStressMetricSnapshot,
          actual: typeof actual === "number" ? actual : "unavailable",
          required: `<=${numericRequired}`,
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleStressMetricSnapshot],
          reason: buildSpecialFailureReason(styleProfile, domain, metric as keyof StyleStressMetricSnapshot) ?? "Rollback pressure exceeded the governed threshold.",
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric: metric as keyof StyleStressMetricSnapshot,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof StyleStressMetricSnapshot],
        reason: buildSpecialFailureReason(styleProfile, domain, metric as keyof StyleStressMetricSnapshot)
          ?? `${metric} fell below the governed style stress threshold.`,
      });
    }
  }

  return {
    pass: failures.length === 0,
    failedThresholds: failures,
    recommendedRuntimeLayer: failures[0]?.recommendedRuntimeLayer ?? null,
    strongestMetric: strongestMetric(metrics),
    weakestMetric: weakestMetric(metrics),
  };
}

export function evaluateStyleDomainCompatibility(
  styleProfile: ApprovedVisualStyleProfile,
  domain: ApprovedPromptDomainTemplate,
  metrics: StyleStressMetricSnapshot | null,
): StyleDomainCompatibilityResult {
  const styleClassification = classifyVisualStyleProfile(styleProfile.id);
  const domainSafety = classifyPromptDomainSafety(domain.prompt);
  const domainCategory = inferPromptDomainCategory(domain.prompt);
  const thresholdEvaluation = evaluateStyleStressThresholds(styleProfile, domain, metrics);
  const compatibilityScore = average(metrics ? [
    metrics.sceneCohesion,
    metrics.styleCohesion,
    metrics.domainCompatibility,
    metrics.lightingStability,
    metrics.reflectionContinuity,
    metrics.previewReadability,
    metrics.finalComposition,
  ] : []);
  const reasons = [...styleClassification.reasons, ...domainSafety.reasons];
  if (!thresholdEvaluation.pass && thresholdEvaluation.failedThresholds.length > 0) {
    reasons.push(thresholdEvaluation.failedThresholds[0].reason);
  }

  return {
    styleSafetyStatus: styleClassification.status,
    domainSafetyStatus: domainSafety.status,
    styleCategory: styleClassification.styleCategory,
    domainCategory,
    compatibilityScore,
    styleConsistencyScore: metrics?.styleCohesion ?? 0,
    domainCompatibilityScore: metrics?.domainCompatibility ?? 0,
    readabilityScore: metrics?.previewReadability ?? 0,
    rollbackCompatibilityScore: metrics?.rollbackIntegrityStatus === "PASS" && (metrics.rollbackPressure ?? 0) <= STYLE_STRESS_THRESHOLDS.rollbackPressure ? 100 : 0,
    pass: styleClassification.status === "APPROVED"
      && domainSafety.status === "APPROVED"
      && Boolean(domainCategory)
      && thresholdEvaluation.pass,
    failedThresholds: thresholdEvaluation.failedThresholds,
    recommendedRuntimeLayer: styleClassification.status === "REJECTED"
      ? "style governance"
      : domainSafety.status === "REJECTED"
        ? "prompt governance"
        : !domainCategory
          ? "prompt-domain governance"
          : thresholdEvaluation.recommendedRuntimeLayer,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
    reasons,
  };
}
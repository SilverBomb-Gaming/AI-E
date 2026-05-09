import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  VisualStyleCategory,
  VisualStyleCompatibilityResult,
  VisualStyleMetricSnapshot,
  VisualStyleThresholdFailure,
} from "./governedVisualStyleRegistry";

export const VISUAL_STYLE_THRESHOLDS = {
  rollbackIntegrityStatus: "PASS",
  sceneCohesion: 95,
  phraseContinuity: 95,
  transitionSmoothness: 95,
  visualContinuity: 94,
  focusContinuity: 95,
  tensionContinuity: 95,
  momentumContinuity: 95,
  previewReadability: 95,
  finalComposition: 94,
  lightingStability: 94,
  reflectionContinuity: 94,
  silhouetteReadability: 95,
  environmentIdentity: 94,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof VisualStyleMetricSnapshot, string> = {
  sceneCohesion: "scene cohesion",
  phraseContinuity: "scene cohesion",
  transitionSmoothness: "transition blend",
  visualContinuity: "transition blend",
  focusContinuity: "focus flow",
  tensionContinuity: "tension curves",
  momentumContinuity: "momentum flow",
  previewReadability: "camera and staging",
  finalComposition: "scene cohesion",
  lightingStability: "lighting layers",
  reflectionContinuity: "lighting and reflections",
  silhouetteReadability: "entity readability",
  environmentIdentity: "staging and environment",
  rollbackIntegrityStatus: "rollback diagnostics",
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: VisualStyleMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus") as Array<[Exclude<keyof VisualStyleMetricSnapshot, "rollbackIntegrityStatus">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: VisualStyleMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus") as Array<[Exclude<keyof VisualStyleMetricSnapshot, "rollbackIntegrityStatus">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

export function classifyVisualStyleProfile(styleId: string): {
  status: "APPROVED" | "REJECTED";
  styleCategory: VisualStyleCategory | null;
  reasons: string[];
} {
  const normalized = styleId.trim().toUpperCase();
  switch (normalized) {
    case "STYLE_001":
      return { status: "APPROVED", styleCategory: "CINEMATIC_SCI_FI", reasons: [] };
    case "STYLE_002":
      return { status: "APPROVED", styleCategory: "INDUSTRIAL_REALISM", reasons: [] };
    case "STYLE_003":
      return {
        status: "APPROVED",
        styleCategory: "ANIME_INSPIRED",
        reasons: ["Anime-inspired style remains bounded to non-humanoid, dialogue-free, readability-first rendering."],
      };
    case "STYLE_004":
      return { status: "APPROVED", styleCategory: "NEON_DYSTOPIAN", reasons: [] };
    case "STYLE_005":
      return { status: "APPROVED", styleCategory: "ATMOSPHERIC_PAINTERLY", reasons: [] };
    default:
      return {
        status: "REJECTED",
        styleCategory: null,
        reasons: ["Style profile is outside the approved governed visual style registry for Phase 1."],
      };
  }
}

export function buildVisualStyleMetricSnapshot(
  diagnostics: CinematicGovernedPreviewDiagnostics | null,
): VisualStyleMetricSnapshot | null {
  if (!diagnostics) {
    return null;
  }

  return {
    sceneCohesion: diagnostics.scene_cohesion_score ?? 0,
    phraseContinuity: diagnostics.phrase_continuity_score ?? 0,
    transitionSmoothness: diagnostics.transition_smoothness_score ?? diagnostics.shot_transition_smoothness_score ?? 0,
    visualContinuity: diagnostics.visual_continuity_score ?? 0,
    focusContinuity: diagnostics.focus_continuity_score ?? 0,
    tensionContinuity: diagnostics.tension_continuity_score ?? 0,
    momentumContinuity: diagnostics.momentum_continuity_score ?? 0,
    previewReadability: diagnostics.readability_score ?? 0,
    finalComposition: diagnostics.final_composition_score ?? diagnostics.scene_composition_score ?? 0,
    lightingStability: diagnostics.lighting_stability_score ?? diagnostics.lighting_consistency_score ?? 0,
    reflectionContinuity: diagnostics.reflection_continuity_score ?? diagnostics.visual_continuity_score ?? 0,
    silhouetteReadability: diagnostics.silhouette_readability_score ?? diagnostics.readability_score ?? 0,
    environmentIdentity: diagnostics.environment_identity_score ?? diagnostics.environment_coherence_score ?? 0,
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
  };
}

export function evaluateVisualStyleThresholds(metrics: VisualStyleMetricSnapshot | null): {
  pass: boolean;
  failedThresholds: VisualStyleThresholdFailure[];
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
          reason: "No governed preview diagnostics were available for visual style comparison.",
        },
      ],
      recommendedRuntimeLayer: "camera and staging",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: VisualStyleThresholdFailure[] = [];

  for (const [metric, required] of Object.entries(VISUAL_STYLE_THRESHOLDS) as Array<[keyof typeof VISUAL_STYLE_THRESHOLDS, (typeof VISUAL_STYLE_THRESHOLDS)[keyof typeof VISUAL_STYLE_THRESHOLDS]]>) {
    const actual = metrics[metric as keyof VisualStyleMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric: metric as keyof VisualStyleMetricSnapshot,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof VisualStyleMetricSnapshot],
          reason: "Rollback integrity must remain PASS during governed visual style execution.",
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric: metric as keyof VisualStyleMetricSnapshot,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof VisualStyleMetricSnapshot],
        reason: `${metric} fell below the governed visual style threshold.`,
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

export function evaluateVisualStyleCompatibility(
  styleId: string,
  metrics: VisualStyleMetricSnapshot | null,
): VisualStyleCompatibilityResult {
  const classification = classifyVisualStyleProfile(styleId);
  const thresholdEvaluation = evaluateVisualStyleThresholds(metrics);
  const lightingStabilityCompatibility = metrics?.lightingStability ?? 0;
  const reflectionContinuityCompatibility = metrics?.reflectionContinuity ?? 0;
  const silhouetteReadabilityCompatibility = metrics?.silhouetteReadability ?? 0;
  const rollbackCompatibility = metrics?.rollbackIntegrityStatus === "PASS" ? 100 : 0;
  const compatibilityScore = average(metrics ? [
    metrics.sceneCohesion,
    metrics.transitionSmoothness,
    metrics.previewReadability,
    metrics.lightingStability,
    metrics.reflectionContinuity,
    metrics.silhouetteReadability,
  ] : []);

  const reasons = [...classification.reasons];
  if (!thresholdEvaluation.pass && thresholdEvaluation.failedThresholds.length > 0) {
    reasons.push(thresholdEvaluation.failedThresholds[0].reason);
  }

  return {
    status: classification.status,
    styleCategory: classification.styleCategory,
    compatibilityScore,
    readabilityScore: metrics?.previewReadability ?? 0,
    lightingStabilityCompatibility,
    reflectionContinuityCompatibility,
    silhouetteReadabilityCompatibility,
    rollbackCompatibility,
    pass: classification.status === "APPROVED" && thresholdEvaluation.pass,
    failedThresholds: thresholdEvaluation.failedThresholds,
    recommendedRuntimeLayer: classification.status === "REJECTED" ? "style governance" : thresholdEvaluation.recommendedRuntimeLayer,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
    reasons,
  };
}
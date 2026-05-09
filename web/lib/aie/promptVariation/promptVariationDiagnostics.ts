import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  PromptVariationDiagnosticSummary,
  PromptVariationMetricSnapshot,
  PromptVariationThresholdFailure,
  PromptVariationVariantReport,
} from "./promptVariationHarnessState";

export const PROMPT_VARIATION_THRESHOLDS = {
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
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof PromptVariationMetricSnapshot, string> = {
  sceneCohesion: "scene cohesion",
  phraseContinuity: "scene cohesion",
  transitionSmoothness: "transition blend",
  visualContinuity: "transition blend",
  focusContinuity: "focus flow",
  tensionContinuity: "tension curves",
  momentumContinuity: "momentum flow",
  previewReadability: "camera and staging",
  finalComposition: "scene cohesion",
  rollbackIntegrityStatus: "rollback diagnostics",
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function minimum(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.min(...values);
}

export function buildPromptVariationMetricSnapshot(
  diagnostics: CinematicGovernedPreviewDiagnostics | null,
): PromptVariationMetricSnapshot | null {
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
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
  };
}

export function evaluatePromptVariationThresholds(metrics: PromptVariationMetricSnapshot | null): {
  pass: boolean;
  failedThresholds: PromptVariationThresholdFailure[];
  recommendedRuntimeLayer: string | null;
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
          reason: "No governed preview diagnostics were available for threshold comparison.",
        },
      ],
      recommendedRuntimeLayer: "camera and staging",
    };
  }

  const failures: PromptVariationThresholdFailure[] = [];

  for (const [metric, required] of Object.entries(PROMPT_VARIATION_THRESHOLDS) as Array<[keyof typeof PROMPT_VARIATION_THRESHOLDS, (typeof PROMPT_VARIATION_THRESHOLDS)[keyof typeof PROMPT_VARIATION_THRESHOLDS]]>) {
    const actual = metrics[metric as keyof PromptVariationMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric: metric as keyof PromptVariationMetricSnapshot,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof PromptVariationMetricSnapshot],
          reason: "Rollback integrity must remain PASS for bounded prompt variation runs.",
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric: metric as keyof PromptVariationMetricSnapshot,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof PromptVariationMetricSnapshot],
        reason: `${metric} fell below the governed prompt variation threshold.`,
      });
    }
  }

  return {
    pass: failures.length === 0,
    failedThresholds: failures,
    recommendedRuntimeLayer: failures[0]?.recommendedRuntimeLayer ?? null,
  };
}

export function summarizePromptVariationDiagnostics(
  reports: PromptVariationVariantReport[],
): PromptVariationDiagnosticSummary {
  const metricReports = reports.filter((entry) => entry.metrics);
  const sceneCohesion = metricReports.map((entry) => entry.metrics?.sceneCohesion ?? 0);
  const transitionSmoothness = metricReports.map((entry) => entry.metrics?.transitionSmoothness ?? 0);
  const focusContinuity = metricReports.map((entry) => entry.metrics?.focusContinuity ?? 0);
  const tensionContinuity = metricReports.map((entry) => entry.metrics?.tensionContinuity ?? 0);
  const momentumContinuity = metricReports.map((entry) => entry.metrics?.momentumContinuity ?? 0);
  const visualContinuity = metricReports.map((entry) => entry.metrics?.visualContinuity ?? 0);
  const previewReadability = metricReports.map((entry) => entry.metrics?.previewReadability ?? 0);
  const rollbackPasses = metricReports.filter((entry) => entry.metrics?.rollbackIntegrityStatus === "PASS").length;
  const failedReports = reports.filter((entry) => !entry.pass);
  const rejectedVariantCount = reports.filter((entry) => entry.safetyStatus === "REJECTED").length;
  const recommendedRuntimeLayer = failedReports.find((entry) => entry.recommendedRuntimeLayer)?.recommendedRuntimeLayer ?? null;

  let recommendedNextAction: PromptVariationDiagnosticSummary["recommendedNextAction"] = "CONTINUE_VARIANTS";
  if (rejectedVariantCount > 0 || rollbackPasses < metricReports.length) {
    recommendedNextAction = "BLOCK_ESCALATION";
  } else if (failedReports.length > 0) {
    recommendedNextAction = "TUNE_RUNTIME";
  }

  return {
    variantCount: reports.length,
    passedVariantCount: reports.filter((entry) => entry.pass).length,
    rejectedVariantCount,
    averageSceneCohesion: average(sceneCohesion),
    minimumSceneCohesion: minimum(sceneCohesion),
    averageTransitionSmoothness: average(transitionSmoothness),
    minimumTransitionSmoothness: minimum(transitionSmoothness),
    averageFocusContinuity: average(focusContinuity),
    minimumFocusContinuity: minimum(focusContinuity),
    averageTensionContinuity: average(tensionContinuity),
    averageMomentumContinuity: average(momentumContinuity),
    averageVisualContinuity: average(visualContinuity),
    averagePreviewReadability: average(previewReadability),
    rollbackPassRate: metricReports.length === 0 ? 0 : Number((rollbackPasses / metricReports.length).toFixed(2)),
    recommendedNextAction,
    recommendedRuntimeLayer,
  };
}
import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import {
  classifyPromptSafety,
  type PromptSafetyResult,
} from "../promptVariation/promptSafetyClassifier";
import type {
  PromptDomainCategory,
  PromptDomainCompatibilityResult,
  PromptDomainMetricSnapshot,
  PromptDomainThresholdFailure,
} from "./governedPromptDomainRegistry";

export const PROMPT_DOMAIN_THRESHOLDS = {
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
  environmentIdentity: 94,
  formationIdentity: 94,
  reflectionContinuity: 94,
  lightingStability: 94,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof PromptDomainMetricSnapshot, string> = {
  sceneCohesion: "scene cohesion",
  phraseContinuity: "scene cohesion",
  transitionSmoothness: "transition blend",
  visualContinuity: "transition blend",
  focusContinuity: "focus flow",
  tensionContinuity: "tension curves",
  momentumContinuity: "momentum flow",
  previewReadability: "camera and staging",
  finalComposition: "scene cohesion",
  environmentIdentity: "staging and environment",
  formationIdentity: "entity formation",
  reflectionContinuity: "lighting and reflections",
  lightingStability: "lighting and reflections",
  rollbackIntegrityStatus: "rollback diagnostics",
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: PromptDomainMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus") as Array<[Exclude<keyof PromptDomainMetricSnapshot, "rollbackIntegrityStatus">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: PromptDomainMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus") as Array<[Exclude<keyof PromptDomainMetricSnapshot, "rollbackIntegrityStatus">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

export function inferPromptDomainCategory(prompt: string): PromptDomainCategory | null {
  const normalized = prompt.toLowerCase();
  if (normalized.includes("energy") || normalized.includes("core") || normalized.includes("pulse")) {
    return "ENERGY_PULSE";
  }
  if (normalized.includes("sentry") || normalized.includes("guard") || normalized.includes("stable stance")) {
    return "SENTRY_FORMATION";
  }
  if (normalized.includes("reflection") || normalized.includes("reflective") || normalized.includes("floor")) {
    return "ENVIRONMENTAL_REACTION";
  }
  if (normalized.includes("aperture") || normalized.includes("haze") || normalized.includes("atmospheric")) {
    return "ATMOSPHERIC_STAGING";
  }
  if (normalized.includes("mechanical") || normalized.includes("alignment") || normalized.includes("ritual")) {
    return "MECHANICAL_REVEAL";
  }
  if (normalized.includes("chamber") || normalized.includes("beacon") || normalized.includes("drone")) {
    return "SCI_FI_CHAMBER";
  }
  return null;
}

export function classifyPromptDomainSafety(prompt: string): PromptSafetyResult {
  return classifyPromptSafety(prompt);
}

export function buildPromptDomainMetricSnapshot(
  diagnostics: CinematicGovernedPreviewDiagnostics | null,
): PromptDomainMetricSnapshot | null {
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
    environmentIdentity: diagnostics.environment_identity_score ?? diagnostics.environment_coherence_score ?? 0,
    formationIdentity: diagnostics.formation_identity_score ?? diagnostics.formation_stability_score ?? 0,
    reflectionContinuity: diagnostics.reflection_continuity_score ?? diagnostics.visual_continuity_score ?? 0,
    lightingStability: diagnostics.lighting_stability_score ?? diagnostics.lighting_consistency_score ?? 0,
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
  };
}

export function evaluatePromptDomainThresholds(metrics: PromptDomainMetricSnapshot | null): {
  pass: boolean;
  failedThresholds: PromptDomainThresholdFailure[];
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
          reason: "No governed preview diagnostics were available for prompt domain comparison.",
        },
      ],
      recommendedRuntimeLayer: "camera and staging",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: PromptDomainThresholdFailure[] = [];

  for (const [metric, required] of Object.entries(PROMPT_DOMAIN_THRESHOLDS) as Array<[keyof typeof PROMPT_DOMAIN_THRESHOLDS, (typeof PROMPT_DOMAIN_THRESHOLDS)[keyof typeof PROMPT_DOMAIN_THRESHOLDS]]>) {
    const actual = metrics[metric as keyof PromptDomainMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric: metric as keyof PromptDomainMetricSnapshot,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof PromptDomainMetricSnapshot],
          reason: "Rollback integrity must remain PASS during bounded prompt domain execution.",
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric: metric as keyof PromptDomainMetricSnapshot,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric as keyof PromptDomainMetricSnapshot],
        reason: `${metric} fell below the governed prompt domain threshold.`,
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

export function evaluatePromptDomainCompatibility(
  prompt: string,
  metrics: PromptDomainMetricSnapshot | null,
): PromptDomainCompatibilityResult {
  const safety = classifyPromptDomainSafety(prompt);
  const category = inferPromptDomainCategory(prompt);
  const thresholdEvaluation = evaluatePromptDomainThresholds(metrics);
  const environmentContinuityScore = average(metrics ? [metrics.environmentIdentity, metrics.reflectionContinuity, metrics.lightingStability] : []);
  const formationCompatibilityScore = average(metrics ? [metrics.formationIdentity, metrics.focusContinuity] : []);
  const reflectionLightingScore = average(metrics ? [metrics.reflectionContinuity, metrics.lightingStability, metrics.visualContinuity] : []);
  const rollbackCompatibilityScore = metrics?.rollbackIntegrityStatus === "PASS" ? 100 : 0;
  const compatibilityScore = average(metrics ? [metrics.sceneCohesion, metrics.transitionSmoothness, metrics.tensionContinuity, metrics.momentumContinuity, environmentContinuityScore, formationCompatibilityScore] : []);

  const pass = safety.status === "APPROVED"
    && Boolean(category)
    && thresholdEvaluation.pass;

  return {
    safety,
    category,
    compatibilityScore,
    readabilityScore: metrics?.previewReadability ?? 0,
    environmentContinuityScore,
    formationCompatibilityScore,
    reflectionLightingScore,
    rollbackCompatibilityScore,
    pass,
    failedThresholds: thresholdEvaluation.failedThresholds,
    recommendedRuntimeLayer: safety.status === "REJECTED"
      ? null
      : !category
        ? "prompt governance"
        : thresholdEvaluation.recommendedRuntimeLayer,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
  };
}
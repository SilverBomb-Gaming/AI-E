import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import { classifyPromptDomainSafety, inferPromptDomainCategory } from "../promptDomains/domainCompatibilityEvaluator";
import { getApprovedPromptDomainTemplateById } from "../promptDomains/approvedPromptDomainTemplates";
import { getApprovedVisualStyleProfileById } from "../styleProfiles/approvedVisualStyleProfiles";
import { classifyVisualStyleProfile } from "../styleProfiles/styleCompatibilityEvaluator";
import {
  buildGovernedHighIntensityState,
  type GovernedHighIntensityState,
  type HighIntensityCompatibilityResult,
  type HighIntensityDiagnosticSummary,
  type HighIntensityExecutionPlan,
  type HighIntensityMetricSnapshot,
  type HighIntensityProbeCell,
  type HighIntensityProbeId,
  type HighIntensityReport,
  type HighIntensityThresholdFailure,
  type HighIntensityVisualCaps,
} from "./governedHighIntensityState";
import { buildHighIntensityApprovalSnapshot, validateHighIntensityApproval } from "./highIntensityApprovalState";
import { summarizeHighIntensityDiagnostics } from "./highIntensityDiagnostics";
import { classifyHighIntensityFailure } from "./highIntensityFailureAnalyzer";
import { recommendHighIntensityRecovery } from "./highIntensityRecovery";
import { buildHighIntensityVisualCaps, describeHighIntensityVisualCaps } from "./highIntensityVisualCaps";

export type HighIntensityRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunHighIntensityProbeInput = {
  probeId: string;
  governanceApproval: boolean;
  highProbeApproval: boolean;
  probeIndex: number;
  totalProbes: number;
  failedHighProbeCount?: number;
  priorReports?: HighIntensityReport[];
} & GovernedPreviewExecutionOptions;

export const HIGH_INTENSITY_MAX_PROBES = 4;

const HIGH_PROBE_DEFINITIONS: Array<{ probeId: HighIntensityProbeId; styleId: string; domainId: string }> = [
  { probeId: "ANIME_INSPIRED_HIGH", styleId: "STYLE_003", domainId: "DOMAIN_005" },
  { probeId: "NEON_DYSTOPIAN_HIGH", styleId: "STYLE_004", domainId: "DOMAIN_004" },
  { probeId: "ATMOSPHERIC_PAINTERLY_HIGH", styleId: "STYLE_005", domainId: "DOMAIN_003" },
  { probeId: "INDUSTRIAL_REALISM_HIGH", styleId: "STYLE_002", domainId: "DOMAIN_002" },
];

export const HIGH_INTENSITY_THRESHOLDS = {
  rollbackIntegrityStatus: "PASS",
  sceneCohesion: 95,
  styleReadability: 95,
  silhouetteReadability: 95,
  lightingStability: 94,
  reflectionContinuity: 94,
  transitionSmoothness: 95,
  visualContinuity: 94,
  previewReadability: 95,
  finalComposition: 94,
  rollbackPressure: 12,
} as const;

const RUNTIME_LAYER_BY_METRIC: Record<keyof HighIntensityMetricSnapshot, string> = {
  highReadabilityScore: "camera staging and readability",
  sceneCohesion: "scene cohesion",
  styleReadability: "high style caps",
  silhouettePreservation: "silhouette protection",
  silhouetteReadability: "silhouette protection",
  lightingStability: "lighting focus and glow caps",
  reflectionContinuity: "reflection continuity",
  environmentalIdentity: "environmental identity",
  transitionContinuity: "transition continuity",
  transitionSmoothness: "transition blend",
  visualContinuity: "visual continuity",
  compositionReadability: "composition readability",
  previewReadability: "camera staging and readability",
  finalComposition: "composition readability",
  materialClarity: "material detail density",
  atmosphereClarity: "atmosphere density",
  rollbackIntegrityStatus: "rollback diagnostics",
  rollbackPressure: "rollback diagnostics",
};

function resolveDependencies(overrides?: Partial<HighIntensityRunnerDependencies>): HighIntensityRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function strongestMetric(metrics: HighIntensityMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof HighIntensityMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => right[1] - left[1]);
  return candidates[0]?.[0] ?? null;
}

function weakestMetric(metrics: HighIntensityMetricSnapshot | null): string | null {
  if (!metrics) {
    return null;
  }

  const candidates = Object.entries(metrics)
    .filter(([metric]) => metric !== "rollbackIntegrityStatus" && metric !== "rollbackPressure") as Array<[Exclude<keyof HighIntensityMetricSnapshot, "rollbackIntegrityStatus" | "rollbackPressure">, number]>;
  candidates.sort((left, right) => left[1] - right[1]);
  return candidates[0]?.[0] ?? null;
}

function buildProbeCell(probeId: HighIntensityProbeId, styleId: string, domainId: string): HighIntensityProbeCell | null {
  const styleProfile = getApprovedVisualStyleProfileById(styleId);
  const domain = getApprovedPromptDomainTemplateById(domainId);
  if (!styleProfile || !domain) {
    return null;
  }

  return {
    probeId,
    cellId: `${styleId}__${domainId}__HIGH`,
    styleId: styleProfile.id,
    styleLabel: styleProfile.label,
    styleCategory: styleProfile.category,
    domainId: domain.id,
    domainLabel: domain.label,
    domainCategory: domain.category,
    intensityLevel: "HIGH",
    intensityValue: 0.85,
    approvalRequired: true,
    manualSelectionAllowed: true,
    rollbackRequired: true,
  };
}

function getHighIntensityProbeResources(probeId: string) {
  const normalized = probeId.trim().toUpperCase();
  const definition = HIGH_PROBE_DEFINITIONS.find((entry) => entry.probeId === normalized);
  if (!definition) {
    return null;
  }

  const cell = buildProbeCell(definition.probeId, definition.styleId, definition.domainId);
  const styleProfile = getApprovedVisualStyleProfileById(definition.styleId);
  const domain = getApprovedPromptDomainTemplateById(definition.domainId);
  if (!cell || !styleProfile || !domain) {
    return null;
  }

  return {
    cell,
    styleProfile,
    domain,
    visualCaps: buildHighIntensityVisualCaps(styleProfile),
  };
}

function buildHighProbeFormInput(input: {
  prompt: string;
  subject: string;
  motionIntent: string;
  style: string;
  durationSeconds: number;
  resolution: GovernedPreviewFormInput["resolution"];
  continuityPriority: GovernedPreviewFormInput["continuity_priority"];
  governanceApproval: boolean;
  packageGifPreview: boolean;
}): GovernedPreviewFormInput {
  return {
    prompt: input.prompt,
    subject: input.subject,
    motion_intent: input.motionIntent,
    style: input.style,
    duration_seconds: input.durationSeconds,
    resolution: input.resolution,
    continuity_priority: input.continuityPriority,
    governance_approval: input.governanceApproval,
    package_gif_preview: input.packageGifPreview,
  };
}

function buildNeutralCaps(probeId: string): HighIntensityVisualCaps {
  return {
    styleId: "STYLE_001",
    styleLabel: probeId,
    capProfileId: "rejected-high-probe-caps",
    silhouetteProtection: 0.95,
    glowBloomCap: 0,
    edgeSofteningCap: 0,
    reflectionAmplificationCap: 0,
    atmosphereDensityCap: 0,
    materialDetailDensityCap: 0,
    focusReadabilityFloor: 0.95,
    objectSeparationFloor: 0.95,
    visibleCaps: ["rejected before HIGH visual caps could execute"],
    deterministic: true,
    operatorVisible: true,
    mutationAllowed: false,
  };
}

function buildRejectedReport(input: {
  requestedProbeId: string;
  probeIndex: number;
  totalProbes: number;
  failedHighProbeCount: number;
  prerequisiteBefore: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>;
  failureReason: string;
  recommendedRuntimeLayer: string;
  visualCaps?: HighIntensityVisualCaps;
  cell?: HighIntensityProbeCell;
  highProbeApproved?: boolean;
}): HighIntensityReport {
  return {
    probeId: (input.cell?.probeId ?? input.requestedProbeId) as HighIntensityProbeId,
    cellId: input.cell?.cellId ?? input.requestedProbeId,
    probeIndex: input.probeIndex,
    totalProbes: input.totalProbes,
    styleId: input.cell?.styleId ?? "STYLE_001",
    styleLabel: input.cell?.styleLabel ?? input.requestedProbeId,
    styleCategory: input.cell?.styleCategory ?? "CINEMATIC_SCI_FI",
    domainId: input.cell?.domainId ?? "DOMAIN_001",
    domainLabel: input.cell?.domainLabel ?? input.requestedProbeId,
    domainCategory: input.cell?.domainCategory ?? "ENERGY_PULSE",
    intensityLevel: "HIGH",
    intensityValue: 0.85,
    highApprovalRequired: true,
    highProbeApproved: input.highProbeApproved ?? false,
    safetyStatus: "REJECTED",
    executionStatus: "FAILED",
    pass: false,
    failureReason: input.failureReason,
    compatibility: null,
    metrics: null,
    strongestMetric: null,
    weakestMetric: null,
    strongestMetricScore: null,
    weakestMetricScore: null,
    failedThresholds: [],
    failureAnalysis: {
      failureType: "STYLE_OVERPOWER",
      reason: input.failureReason,
      weakestSubsystem: input.recommendedRuntimeLayer,
      tuningDirection: "operator review required before any HIGH probe can continue",
      autoEscalationBlocked: true,
    },
    recoveryRecommendation: null,
    recommendedRuntimeLayer: input.recommendedRuntimeLayer,
    visualCaps: input.visualCaps ?? buildNeutralCaps(input.requestedProbeId),
    rollbackSnapshot: null,
    rollbackVisible: false,
    rollbackRestoredHighProbe: false,
    highProbeExecutionCount: 0,
    failedHighProbeCount: input.failedHighProbeCount + 1,
    diagnostics: null,
    prerequisiteBefore: input.prerequisiteBefore,
    prerequisiteAfter: input.prerequisiteBefore,
    microSequence: null,
    previewExecution: null,
    rollback: null,
  };
}

function buildThresholdFailureReason(metric: keyof HighIntensityMetricSnapshot, styleId: string): string {
  if (metric === "silhouetteReadability" || metric === "silhouettePreservation") {
    return "HIGH probe silhouette readability fell below the governed floor.";
  }
  if (metric === "lightingStability") {
    return styleId === "STYLE_004"
      ? "HIGH neon glow overloaded the governed lighting stability floor."
      : "HIGH probe lighting stability fell below the governed floor.";
  }
  if (metric === "reflectionContinuity") {
    return "HIGH probe reflection continuity became noisy below the governed floor.";
  }
  if (metric === "atmosphereClarity" || metric === "environmentalIdentity") {
    return "HIGH probe atmosphere density weakened environmental identity.";
  }
  if (metric === "materialClarity") {
    return "HIGH probe material detail density introduced clutter below the watchpoint floor.";
  }
  if (metric === "rollbackPressure" || metric === "rollbackIntegrityStatus") {
    return "Rollback integrity must remain PASS and rollback pressure must stay bounded during HIGH probing.";
  }

  return `${metric} fell below the governed HIGH probe threshold.`;
}

export function buildHighIntensityMetricSnapshot(diagnostics: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>["preview_diagnostics"] | null): HighIntensityMetricSnapshot | null {
  if (!diagnostics) {
    return null;
  }

  const sceneCohesion = diagnostics.scene_cohesion_score ?? 0;
  const transitionSmoothness = diagnostics.transition_smoothness_score ?? diagnostics.shot_transition_smoothness_score ?? 0;
  const visualContinuity = diagnostics.visual_continuity_score ?? 0;
  const previewReadability = diagnostics.readability_score ?? 0;
  const lightingStability = diagnostics.lighting_stability_score ?? diagnostics.lighting_consistency_score ?? 0;
  const reflectionContinuity = diagnostics.reflection_continuity_score ?? visualContinuity;
  const silhouetteReadability = diagnostics.silhouette_readability_score ?? diagnostics.multi_entity_silhouette_score ?? previewReadability;
  const materialClarity = diagnostics.object_fidelity_score ?? previewReadability;
  const environmentalIdentity = diagnostics.environment_identity_score ?? diagnostics.environment_coherence_score ?? 0;
  const atmosphereClarity = average([environmentalIdentity, previewReadability, lightingStability]);
  const styleReadability = average([visualContinuity, silhouetteReadability, previewReadability, materialClarity]);
  const transitionContinuity = average([transitionSmoothness, visualContinuity, diagnostics.momentum_continuity_score ?? 0]);
  const finalComposition = diagnostics.final_composition_score ?? diagnostics.scene_composition_score ?? 0;
  const compositionReadability = average([finalComposition, previewReadability, sceneCohesion]);
  const highReadabilityScore = average([styleReadability, silhouetteReadability, previewReadability, compositionReadability]);
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
    highReadabilityScore,
    sceneCohesion,
    styleReadability,
    silhouettePreservation: silhouetteReadability,
    silhouetteReadability,
    lightingStability,
    reflectionContinuity,
    environmentalIdentity,
    transitionContinuity,
    transitionSmoothness,
    visualContinuity,
    compositionReadability,
    previewReadability,
    finalComposition,
    materialClarity,
    atmosphereClarity,
    rollbackIntegrityStatus: diagnostics.rollback_integrity_status ?? "FAIL",
    rollbackPressure,
  };
}

export function evaluateHighIntensityThresholds(input: {
  metrics: HighIntensityMetricSnapshot | null;
  styleId: string;
}): {
  pass: boolean;
  failedThresholds: HighIntensityThresholdFailure[];
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
          recommendedRuntimeLayer: "camera staging and readability",
          reason: "No governed preview diagnostics were available for HIGH probe evaluation.",
        },
      ],
      recommendedRuntimeLayer: "camera staging and readability",
      strongestMetric: null,
      weakestMetric: null,
    };
  }

  const failures: HighIntensityThresholdFailure[] = [];
  for (const [metric, required] of Object.entries(HIGH_INTENSITY_THRESHOLDS) as Array<[keyof typeof HIGH_INTENSITY_THRESHOLDS, (typeof HIGH_INTENSITY_THRESHOLDS)[keyof typeof HIGH_INTENSITY_THRESHOLDS]]>) {
    const actual = input.metrics[metric as keyof HighIntensityMetricSnapshot];
    if (metric === "rollbackIntegrityStatus") {
      if (actual !== required) {
        failures.push({
          metric,
          actual: String(actual),
          required: String(required),
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric],
          reason: buildThresholdFailureReason(metric, input.styleId),
        });
      }
      continue;
    }

    if (metric === "rollbackPressure") {
      const numericRequired = Number(required);
      if (typeof actual !== "number" || actual > numericRequired) {
        failures.push({
          metric,
          actual: typeof actual === "number" ? actual : "unavailable",
          required: `<=${numericRequired}`,
          recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric],
          reason: buildThresholdFailureReason(metric, input.styleId),
        });
      }
      continue;
    }

    const numericRequired = Number(required);
    if (typeof actual !== "number" || actual < numericRequired) {
      failures.push({
        metric,
        actual: typeof actual === "number" ? actual : "unavailable",
        required: `>=${numericRequired}`,
        recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC[metric],
        reason: buildThresholdFailureReason(metric, input.styleId),
      });
    }
  }

  if (input.metrics.materialClarity < 90) {
    failures.push({
      metric: "materialClarity",
      actual: input.metrics.materialClarity,
      required: ">=90",
      recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC.materialClarity,
      reason: buildThresholdFailureReason("materialClarity", input.styleId),
    });
  }

  if (input.metrics.atmosphereClarity < 94) {
    failures.push({
      metric: "atmosphereClarity",
      actual: input.metrics.atmosphereClarity,
      required: ">=94",
      recommendedRuntimeLayer: RUNTIME_LAYER_BY_METRIC.atmosphereClarity,
      reason: buildThresholdFailureReason("atmosphereClarity", input.styleId),
    });
  }

  return {
    pass: failures.length === 0,
    failedThresholds: failures,
    recommendedRuntimeLayer: failures[0]?.recommendedRuntimeLayer ?? null,
    strongestMetric: strongestMetric(input.metrics),
    weakestMetric: weakestMetric(input.metrics),
  };
}

export function evaluateHighIntensityCompatibility(input: {
  cell: HighIntensityProbeCell;
  metrics: HighIntensityMetricSnapshot | null;
  highProbeApproved: boolean;
}): HighIntensityCompatibilityResult {
  const styleClassification = classifyVisualStyleProfile(input.cell.styleId);
  const domain = getApprovedPromptDomainTemplateById(input.cell.domainId);
  const domainSafety = classifyPromptDomainSafety(domain?.prompt ?? "");
  const domainCategory = inferPromptDomainCategory(domain?.prompt ?? "");
  const thresholdEvaluation = evaluateHighIntensityThresholds({ metrics: input.metrics, styleId: input.cell.styleId });
  const compatibilityScore = average(input.metrics ? [
    input.metrics.sceneCohesion,
    input.metrics.styleReadability,
    input.metrics.silhouetteReadability,
    input.metrics.lightingStability,
    input.metrics.reflectionContinuity,
    input.metrics.transitionSmoothness,
    input.metrics.visualContinuity,
    input.metrics.previewReadability,
    input.metrics.finalComposition,
  ] : []);
  const reasons = [...styleClassification.reasons, ...domainSafety.reasons];
  if (!input.highProbeApproved) {
    reasons.push("HIGH probes require explicit operator HIGH approval before preview execution.");
  }
  if (!thresholdEvaluation.pass && thresholdEvaluation.failedThresholds.length > 0) {
    reasons.push(thresholdEvaluation.failedThresholds[0].reason);
  }

  return {
    styleSafetyStatus: styleClassification.status,
    domainSafetyStatus: domainSafety.status,
    highApprovalStatus: input.highProbeApproved ? "APPROVED" : "REJECTED",
    compatibilityScore,
    pass: styleClassification.status === "APPROVED"
      && domainSafety.status === "APPROVED"
      && Boolean(domainCategory)
      && input.highProbeApproved
      && thresholdEvaluation.pass,
    failedThresholds: thresholdEvaluation.failedThresholds,
    strongestMetric: thresholdEvaluation.strongestMetric,
    weakestMetric: thresholdEvaluation.weakestMetric,
    recommendedRuntimeLayer: styleClassification.status === "REJECTED"
      ? "style governance"
      : domainSafety.status === "REJECTED"
        ? "prompt governance"
        : !input.highProbeApproved
          ? "operator high-intensity approval"
          : !domainCategory
            ? "prompt-domain governance"
            : thresholdEvaluation.recommendedRuntimeLayer,
    reasons,
  };
}

export function listGovernedHighIntensityProbeCells(): HighIntensityProbeCell[] {
  return HIGH_PROBE_DEFINITIONS
    .map((entry) => buildProbeCell(entry.probeId, entry.styleId, entry.domainId))
    .filter((entry): entry is HighIntensityProbeCell => Boolean(entry));
}

export function buildHighIntensityExecutionPlan(probeIds?: string[]): HighIntensityExecutionPlan {
  const approvedProbeIds = (probeIds?.length ? probeIds : listGovernedHighIntensityProbeCells().map((entry) => entry.probeId)).slice(0, HIGH_INTENSITY_MAX_PROBES) as HighIntensityProbeId[];

  return {
    planId: `high-intensity-plan-${approvedProbeIds.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    highApprovalRequired: true,
    maxHighProbes: HIGH_INTENSITY_MAX_PROBES,
    probeIds: approvedProbeIds,
    stages: [
      "validate-high-approval",
      "snapshot-runtime-state",
      "snapshot-style-state",
      "snapshot-domain-state",
      "apply-high-visual-caps",
      "execute-bounded-preview",
      "collect-high-diagnostics",
      "classify-high-failures",
      "restore-rollback-state-if-needed",
      "require-operator-review",
    ],
    automaticRepeatAllowed: false,
    automaticEscalationAllowed: false,
    automaticRetriesAllowed: false,
    unrestrictedHighGenerationAllowed: false,
    extremeModeAllowed: false,
    humanoidsAllowed: false,
    dialogueAllowed: false,
    longFormRenderingAllowed: false,
    crossRunPersistenceAllowed: false,
    runtimeMutationAllowed: false,
    recoveryAutoTuningAllowed: false,
  };
}

export function getHighIntensityProbeFormInput(probeId: string, governanceApproval: boolean): GovernedPreviewFormInput | null {
  const resources = getHighIntensityProbeResources(probeId);
  if (!resources) {
    return null;
  }

  const { styleProfile, domain, visualCaps } = resources;
  return buildHighProbeFormInput({
    prompt: domain.prompt,
    subject: domain.subject,
    motionIntent: domain.motion_intent,
    style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}; governed high intensity probe; ${describeHighIntensityVisualCaps(visualCaps)}`,
    durationSeconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
    resolution: styleProfile.resolution,
    continuityPriority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
      ? "high"
      : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
        ? "medium"
        : "low",
    governanceApproval,
    packageGifPreview: styleProfile.package_gif_preview || domain.package_gif_preview,
  });
}

export async function runGovernedHighIntensityProbeById(
  input: RunHighIntensityProbeInput,
  depsOverride?: Partial<HighIntensityRunnerDependencies>,
): Promise<HighIntensityReport> {
  const deps = resolveDependencies(depsOverride);
  const resources = getHighIntensityProbeResources(input.probeId);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });

  if (!resources) {
    return buildRejectedReport({
      requestedProbeId: input.probeId,
      probeIndex: input.probeIndex,
      totalProbes: input.totalProbes,
      failedHighProbeCount: input.failedHighProbeCount ?? 0,
      prerequisiteBefore,
      failureReason: `Unknown approved HIGH probe: ${input.probeId}`,
      recommendedRuntimeLayer: "high probe governance",
    });
  }

  const { cell, styleProfile, domain, visualCaps } = resources;
  const repeatedProbe = input.priorReports?.some((entry) => entry.probeId === cell.probeId && entry.microSequence !== null) ?? false;
  if (repeatedProbe) {
    return buildRejectedReport({
      requestedProbeId: cell.probeId,
      probeIndex: input.probeIndex,
      totalProbes: input.totalProbes,
      failedHighProbeCount: input.failedHighProbeCount ?? 0,
      prerequisiteBefore,
      failureReason: "HIGH probes cannot auto-repeat; clear the operator report or perform a fresh reviewed run before retrying this probe.",
      recommendedRuntimeLayer: "operator high-probe review",
      visualCaps,
      cell,
      highProbeApproved: input.highProbeApproval,
    });
  }

  const approvalSnapshot = buildHighIntensityApprovalSnapshot({
    governanceApproval: input.governanceApproval,
    highProbeApproval: input.highProbeApproval,
  });
  const approval = validateHighIntensityApproval({
    governanceApproval: input.governanceApproval,
    highProbeApproval: input.highProbeApproval,
  });
  if (!approval.approved) {
    return buildRejectedReport({
      requestedProbeId: cell.probeId,
      probeIndex: input.probeIndex,
      totalProbes: input.totalProbes,
      failedHighProbeCount: input.failedHighProbeCount ?? 0,
      prerequisiteBefore,
      failureReason: approval.failureReason ?? "HIGH probe approval was rejected.",
      recommendedRuntimeLayer: approval.recommendedRuntimeLayer ?? "operator high-intensity approval",
      visualCaps,
      cell,
      highProbeApproved: false,
    });
  }

  const rollbackSnapshot = {
    styleState: {
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      characteristics: [...styleProfile.characteristics],
    },
    domainState: {
      domainId: domain.id,
      domainLabel: domain.label,
      prompt: domain.prompt,
    },
    runtimeState: {
      durationSeconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
      resolution: styleProfile.resolution,
      continuityPriority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high" ? "high" : "medium",
      packageGifPreview: styleProfile.package_gif_preview || domain.package_gif_preview,
    },
    diagnosticsBaseline: prerequisiteBefore.preview_diagnostics,
    approvalState: approvalSnapshot,
  };

  const formInput = getHighIntensityProbeFormInput(cell.probeId, input.governanceApproval);
  if (!formInput) {
    return buildRejectedReport({
      requestedProbeId: cell.probeId,
      probeIndex: input.probeIndex,
      totalProbes: input.totalProbes,
      failedHighProbeCount: input.failedHighProbeCount ?? 0,
      prerequisiteBefore,
      failureReason: "Approved HIGH probe resources could not be compiled.",
      recommendedRuntimeLayer: "high probe resource binding",
      visualCaps,
      cell,
      highProbeApproved: input.highProbeApproval,
    });
  }

  const compiledRequest = deps.compileRequest(formInput);
  const microSequence = await deps.executeMicroSequence(compiledRequest, { root: input.root, deps: input.deps });
  const previewExecution = microSequence.status === "generated"
    ? await deps.executePreview(compiledRequest, { root: input.root, deps: input.deps })
    : null;
  const diagnostics = previewExecution?.preview_diagnostics ?? microSequence.preview_diagnostics ?? prerequisiteBefore.preview_diagnostics;
  const metrics = buildHighIntensityMetricSnapshot(diagnostics ?? null);
  const compatibility = evaluateHighIntensityCompatibility({
    cell,
    metrics,
    highProbeApproved: approval.approved,
  });
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failedThresholds = executionBlocked ? [] : compatibility.failedThresholds;
  const failureAnalysis = executionBlocked
    ? {
      failureType: "STYLE_OVERPOWER" as const,
      reason: [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed HIGH probe execution was blocked before preview completion.",
      weakestSubsystem: "preview governance",
      tuningDirection: "resolve preview governance blockers before continuing HIGH probes",
      autoEscalationBlocked: true as const,
    }
    : classifyHighIntensityFailure({
      styleId: styleProfile.id,
      domainId: domain.id,
      metrics,
      failedThresholds,
    });
  const recoveryRecommendation = recommendHighIntensityRecovery(failureAnalysis);
  const strongestMetricName = compatibility.strongestMetric;
  const weakestMetricName = compatibility.weakestMetric;
  const strongestMetricScore = strongestMetricName && metrics
    ? metrics[strongestMetricName as keyof HighIntensityMetricSnapshot] as number
    : null;
  const weakestMetricScore = weakestMetricName && metrics
    ? metrics[weakestMetricName as keyof HighIntensityMetricSnapshot] as number
    : null;
  const failureReason = pass
    ? null
    : executionBlocked
      ? failureAnalysis?.reason ?? "Governed HIGH probe execution was blocked before preview completion."
      : failureAnalysis?.reason ?? compatibility.failedThresholds[0]?.reason ?? compatibility.reasons[0] ?? "Governed HIGH probe thresholds were not met.";

  return {
    probeId: cell.probeId,
    cellId: cell.cellId,
    probeIndex: input.probeIndex,
    totalProbes: input.totalProbes,
    styleId: styleProfile.id,
    styleLabel: styleProfile.label,
    styleCategory: styleProfile.category,
    domainId: domain.id,
    domainLabel: domain.label,
    domainCategory: domain.category,
    intensityLevel: "HIGH",
    intensityValue: 0.85,
    highApprovalRequired: true,
    highProbeApproved: approval.approved,
    safetyStatus: compatibility.styleSafetyStatus === "APPROVED" && compatibility.domainSafetyStatus === "APPROVED" && compatibility.highApprovalStatus === "APPROVED" ? "APPROVED" : "REJECTED",
    executionStatus: pass ? "PASSED" : "FAILED",
    pass,
    failureReason,
    compatibility,
    metrics,
    strongestMetric: strongestMetricName,
    weakestMetric: weakestMetricName,
    strongestMetricScore,
    weakestMetricScore,
    failedThresholds,
    failureAnalysis,
    recoveryRecommendation,
    recommendedRuntimeLayer: failureAnalysis?.weakestSubsystem ?? compatibility.recommendedRuntimeLayer,
    visualCaps,
    rollbackSnapshot,
    rollbackVisible: Boolean(rollback || diagnostics?.rollback_integrity_status),
    rollbackRestoredHighProbe: rollback?.status === "rolled_back",
    highProbeExecutionCount: (input.priorReports?.filter((entry) => entry.microSequence !== null).length ?? 0) + 1,
    failedHighProbeCount: input.failedHighProbeCount ?? 0,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}

export function summarizeGovernedHighIntensityReports(reports: HighIntensityReport[]): HighIntensityDiagnosticSummary {
  return summarizeHighIntensityDiagnostics(reports);
}

export function buildGovernedHighIntensityHarnessState(reports: HighIntensityReport[]): GovernedHighIntensityState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedHighIntensityState({
    report: latest,
    priorReports: reports,
  });
}

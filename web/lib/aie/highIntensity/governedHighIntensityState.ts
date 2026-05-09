import type { ApprovedPromptDomainTemplate } from "../promptDomains/approvedPromptDomainTemplates";
import type { PromptDomainCategory } from "../promptDomains/governedPromptDomainRegistry";
import type { ApprovedVisualStyleProfile } from "../styleProfiles/approvedVisualStyleProfiles";
import type { VisualStyleCategory } from "../styleProfiles/governedVisualStyleRegistry";
import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "../governedPreviewGeneration";

export type HighIntensityFailureType =
  | "SILHOUETTE_COLLAPSE"
  | "LIGHTING_OVERLOAD"
  | "REFLECTION_NOISE"
  | "ATMOSPHERIC_OVERDENSITY"
  | "MATERIAL_CLUTTER"
  | "STYLE_OVERPOWER"
  | "TRANSITION_VISUAL_BREAKDOWN"
  | "READABILITY_COLLAPSE";

export type HighIntensityProbeId =
  | "ANIME_INSPIRED_HIGH"
  | "NEON_DYSTOPIAN_HIGH"
  | "ATMOSPHERIC_PAINTERLY_HIGH"
  | "INDUSTRIAL_REALISM_HIGH";

export type HighIntensityExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";
export type HighIntensitySafetyStatus = "APPROVED" | "REJECTED";

export type GovernedHighIntensityState = {
  activeStyleId: string;
  activeDomainId: string;
  approvedHighExecution: boolean;
  highProbeExecutionCount: number;
  failedHighProbeCount: number;
  rollbackRestoredHighProbe: boolean;
  lastFailureType: HighIntensityFailureType | null;
};

export type HighIntensityProbeCell = {
  probeId: HighIntensityProbeId;
  cellId: string;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  styleCategory: VisualStyleCategory;
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  domainCategory: PromptDomainCategory;
  intensityLevel: "HIGH";
  intensityValue: 0.85;
  approvalRequired: true;
  manualSelectionAllowed: true;
  rollbackRequired: true;
};

export type HighIntensityVisualCaps = {
  styleId: string;
  styleLabel: string;
  capProfileId: string;
  silhouetteProtection: number;
  glowBloomCap: number;
  edgeSofteningCap: number;
  reflectionAmplificationCap: number;
  atmosphereDensityCap: number;
  materialDetailDensityCap: number;
  focusReadabilityFloor: number;
  objectSeparationFloor: number;
  visibleCaps: string[];
  deterministic: true;
  operatorVisible: true;
  mutationAllowed: false;
};

export type HighIntensityApprovalSnapshot = {
  governanceApproval: boolean;
  highProbeApproval: boolean;
  approvedHighExecution: boolean;
  approvalRequired: true;
  approvalScope: "single-high-probe";
  automaticRepeatAllowed: false;
  automaticEscalationAllowed: false;
  crossRunPersistenceAllowed: false;
};

export type HighIntensityRollbackSnapshot = {
  styleState: {
    styleId: string;
    styleLabel: string;
    characteristics: string[];
  };
  domainState: {
    domainId: string;
    domainLabel: string;
    prompt: string;
  };
  runtimeState: {
    durationSeconds: number;
    resolution: string;
    continuityPriority: string;
    packageGifPreview: boolean;
  };
  diagnosticsBaseline: CinematicGovernedPreviewDiagnostics | null;
  approvalState: HighIntensityApprovalSnapshot;
};

export type HighIntensityMetricSnapshot = {
  highReadabilityScore: number;
  sceneCohesion: number;
  styleReadability: number;
  silhouettePreservation: number;
  silhouetteReadability: number;
  lightingStability: number;
  reflectionContinuity: number;
  environmentalIdentity: number;
  transitionContinuity: number;
  transitionSmoothness: number;
  visualContinuity: number;
  compositionReadability: number;
  previewReadability: number;
  finalComposition: number;
  materialClarity: number;
  atmosphereClarity: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
  rollbackPressure: number;
};

export type HighIntensityThresholdFailure = {
  metric: keyof HighIntensityMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type HighIntensityFailureAnalysis = {
  failureType: HighIntensityFailureType;
  reason: string;
  weakestSubsystem: string;
  tuningDirection: string;
  autoEscalationBlocked: true;
};

export type HighIntensityRecoveryRecommendation = {
  failureType: HighIntensityFailureType;
  recommendation: string;
  targetCap: string;
  autonomousTuningAllowed: false;
  operatorReviewRequired: true;
};

export type HighIntensityCompatibilityResult = {
  styleSafetyStatus: HighIntensitySafetyStatus;
  domainSafetyStatus: HighIntensitySafetyStatus;
  highApprovalStatus: HighIntensitySafetyStatus;
  compatibilityScore: number;
  pass: boolean;
  failedThresholds: HighIntensityThresholdFailure[];
  strongestMetric: string | null;
  weakestMetric: string | null;
  recommendedRuntimeLayer: string | null;
  reasons: string[];
};

export type HighIntensityReport = {
  probeId: HighIntensityProbeId;
  cellId: string;
  probeIndex: number;
  totalProbes: number;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  styleCategory: VisualStyleCategory;
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  domainCategory: PromptDomainCategory;
  intensityLevel: "HIGH";
  intensityValue: 0.85;
  highApprovalRequired: true;
  highProbeApproved: boolean;
  safetyStatus: HighIntensitySafetyStatus;
  executionStatus: HighIntensityExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: HighIntensityCompatibilityResult | null;
  metrics: HighIntensityMetricSnapshot | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  strongestMetricScore: number | null;
  weakestMetricScore: number | null;
  failedThresholds: HighIntensityThresholdFailure[];
  failureAnalysis: HighIntensityFailureAnalysis | null;
  recoveryRecommendation: HighIntensityRecoveryRecommendation | null;
  recommendedRuntimeLayer: string | null;
  visualCaps: HighIntensityVisualCaps;
  rollbackSnapshot: HighIntensityRollbackSnapshot | null;
  rollbackVisible: boolean;
  rollbackRestoredHighProbe: boolean;
  highProbeExecutionCount: number;
  failedHighProbeCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type HighIntensityDiagnosticSummary = {
  testedHighProbeCount: number;
  passedHighProbeCount: number;
  failedHighProbeCount: number;
  safestHighStyleId: string | null;
  riskiestHighStyleId: string | null;
  averageHighReadability: number;
  averageHighLightingStability: number;
  averageHighReflectionContinuity: number;
  averageHighSilhouettePreservation: number;
  averageHighEnvironmentalIdentity: number;
  averageHighTransitionContinuity: number;
  averageHighCompositionReadability: number;
  rollbackPassRate: number;
  strongestProbeId: string | null;
  weakestProbeId: string | null;
  recommendedNextAction:
    | "CONTINUE_HIGH_PROBES"
    | "TUNE_VISUAL_CAPS"
    | "BLOCK_HIGH_ESCALATION";
  recommendedRuntimeLayer: string | null;
};

export type HighIntensityExecutionPlanStage =
  | "validate-high-approval"
  | "snapshot-runtime-state"
  | "snapshot-style-state"
  | "snapshot-domain-state"
  | "apply-high-visual-caps"
  | "execute-bounded-preview"
  | "collect-high-diagnostics"
  | "classify-high-failures"
  | "restore-rollback-state-if-needed"
  | "require-operator-review";

export type HighIntensityExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  highApprovalRequired: true;
  maxHighProbes: 4;
  probeIds: HighIntensityProbeId[];
  stages: HighIntensityExecutionPlanStage[];
  automaticRepeatAllowed: false;
  automaticEscalationAllowed: false;
  automaticRetriesAllowed: false;
  unrestrictedHighGenerationAllowed: false;
  extremeModeAllowed: false;
  humanoidsAllowed: false;
  dialogueAllowed: false;
  longFormRenderingAllowed: false;
  crossRunPersistenceAllowed: false;
  runtimeMutationAllowed: false;
  recoveryAutoTuningAllowed: false;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildGovernedHighIntensityState(input: {
  report: Pick<HighIntensityReport, "styleId" | "domainId" | "highProbeApproved" | "rollbackRestoredHighProbe" | "failureAnalysis">;
  priorReports?: HighIntensityReport[];
}): GovernedHighIntensityState {
  const priorReports = input.priorReports ?? [];
  const failedReports = priorReports.filter((entry) => !entry.pass);

  return {
    activeStyleId: input.report.styleId,
    activeDomainId: input.report.domainId,
    approvedHighExecution: input.report.highProbeApproved,
    highProbeExecutionCount: priorReports.length,
    failedHighProbeCount: failedReports.length,
    rollbackRestoredHighProbe: input.report.rollbackRestoredHighProbe,
    lastFailureType: input.report.failureAnalysis?.failureType ?? null,
  };
}

export function averageHighIntensityMetric(reports: HighIntensityReport[], selector: (report: HighIntensityReport) => number): number {
  return average(reports.filter((entry) => entry.metrics).map(selector));
}

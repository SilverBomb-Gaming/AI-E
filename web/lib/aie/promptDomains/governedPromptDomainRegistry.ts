import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "../governedPreviewGeneration";
import type { PromptSafetyResult } from "../promptVariation/promptSafetyClassifier";

export type PromptDomainCategory =
  | "SCI_FI_CHAMBER"
  | "MECHANICAL_REVEAL"
  | "ENVIRONMENTAL_REACTION"
  | "SENTRY_FORMATION"
  | "ENERGY_PULSE"
  | "ATMOSPHERIC_STAGING";

export type PromptDomainSafetyStatus = "APPROVED" | "REJECTED";
export type PromptDomainExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";

export type GovernedPromptDomainState = {
  activeDomainId: string;
  activeDomainLabel: string;
  domainCategory: PromptDomainCategory;
  approvedVariantCount: number;
  domainCompatibilityScore: number;
  domainReadabilityScore: number;
  rollbackRestoredDomain: boolean;
  rejectedDomainCount: number;
};

export type PromptDomainMetricSnapshot = {
  sceneCohesion: number;
  phraseContinuity: number;
  transitionSmoothness: number;
  visualContinuity: number;
  focusContinuity: number;
  tensionContinuity: number;
  momentumContinuity: number;
  previewReadability: number;
  finalComposition: number;
  environmentIdentity: number;
  formationIdentity: number;
  reflectionContinuity: number;
  lightingStability: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
};

export type PromptDomainThresholdFailure = {
  metric: keyof PromptDomainMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type PromptDomainCompatibilityResult = {
  safety: PromptSafetyResult;
  category: PromptDomainCategory | null;
  compatibilityScore: number;
  readabilityScore: number;
  environmentContinuityScore: number;
  formationCompatibilityScore: number;
  reflectionLightingScore: number;
  rollbackCompatibilityScore: number;
  pass: boolean;
  failedThresholds: PromptDomainThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
};

export type PromptDomainReport = {
  domainId: string;
  domainLabel: string;
  domainCategory: PromptDomainCategory;
  domainIndex: number;
  totalDomains: number;
  promptTemplate: string;
  safety: PromptSafetyResult;
  safetyStatus: PromptDomainSafetyStatus;
  executionStatus: PromptDomainExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: PromptDomainCompatibilityResult | null;
  metrics: PromptDomainMetricSnapshot | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  failedThresholds: PromptDomainThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  rollbackVisible: boolean;
  rollbackRestoredDomain: boolean;
  rejectedDomainCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type PromptDomainDiagnosticSummary = {
  testedDomainCount: number;
  passedDomainCount: number;
  rejectedDomainCount: number;
  strongestDomain: string | null;
  weakestDomain: string | null;
  averageSceneCohesion: number;
  averageTransitionSmoothness: number;
  averageTensionContinuity: number;
  averageMomentumContinuity: number;
  averagePreviewReadability: number;
  rollbackPassRate: number;
  recommendedNextAction:
    | "CONTINUE_DOMAIN_EXPANSION"
    | "TUNE_COHESION_LAYER"
    | "BLOCK_ESCALATION";
  recommendedRuntimeLayer: string | null;
};

export type PromptDomainExecutionPlanStage =
  | "classify-domain"
  | "validate-allowed-vocabulary"
  | "execute-governed-preview"
  | "collect-diagnostics"
  | "compare-thresholds"
  | "aggregate-domain-report"
  | "require-operator-review";

export type PromptDomainExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  maxDomains: number;
  domainIds: string[];
  stages: PromptDomainExecutionPlanStage[];
  autonomousContinuationAllowed: false;
  longFormRenderingAllowed: false;
};

export function buildGovernedPromptDomainState(input: {
  report: Pick<PromptDomainReport, "domainId" | "domainLabel" | "domainCategory" | "rollbackRestoredDomain" | "rejectedDomainCount">;
  priorReports?: Array<Pick<PromptDomainReport, "metrics" | "compatibility">>;
}): GovernedPromptDomainState {
  const prior = input.priorReports ?? [];
  const compatibilityScores = prior
    .map((entry) => entry.compatibility?.compatibilityScore)
    .filter((value): value is number => typeof value === "number");
  const readabilityScores = prior
    .map((entry) => entry.metrics?.previewReadability)
    .filter((value): value is number => typeof value === "number");

  return {
    activeDomainId: input.report.domainId,
    activeDomainLabel: input.report.domainLabel,
    domainCategory: input.report.domainCategory,
    approvedVariantCount: prior.length,
    domainCompatibilityScore: compatibilityScores.length === 0
      ? 0
      : Number((compatibilityScores.reduce((sum, value) => sum + value, 0) / compatibilityScores.length).toFixed(2)),
    domainReadabilityScore: readabilityScores.length === 0
      ? 0
      : Number((readabilityScores.reduce((sum, value) => sum + value, 0) / readabilityScores.length).toFixed(2)),
    rollbackRestoredDomain: input.report.rollbackRestoredDomain,
    rejectedDomainCount: input.report.rejectedDomainCount,
  };
}
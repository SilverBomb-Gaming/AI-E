import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "../governedPreviewGeneration";
import type { PromptSafetyResult } from "./promptSafetyClassifier";

export type PromptVariationDomain =
  | "SCI_FI_BEACON_CHAMBER"
  | "DRONE_FORMATION_REVEAL"
  | "ENVIRONMENTAL_PULSE_REACTION"
  | "MECHANICAL_RITUAL_STAGING";

export type PromptVariationSafetyStatus = "APPROVED" | "REJECTED";
export type PromptVariationExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";

export type PromptVariationHarnessState = {
  activeVariantId: string;
  activeVariantLabel: string;
  variantIndex: number;
  totalVariants: number;
  approvedDomain: PromptVariationDomain;
  variantSafetyStatus: PromptVariationSafetyStatus;
  variantExecutionStatus: PromptVariationExecutionStatus;
  crossVariantCohesionScore: number;
  crossVariantReadabilityScore: number;
  rollbackRestoredVariant: boolean;
  rejectedVariantCount: number;
};

export type PromptVariationMetricSnapshot = {
  sceneCohesion: number;
  phraseContinuity: number;
  transitionSmoothness: number;
  visualContinuity: number;
  focusContinuity: number;
  tensionContinuity: number;
  momentumContinuity: number;
  previewReadability: number;
  finalComposition: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
};

export type PromptVariationThresholdFailure = {
  metric: keyof PromptVariationMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type PromptVariationVariantReport = {
  variantId: string;
  variantLabel: string;
  variantIndex: number;
  totalVariants: number;
  domain: PromptVariationDomain;
  prompt: string;
  safety: PromptSafetyResult;
  safetyStatus: PromptVariationSafetyStatus;
  executionStatus: PromptVariationExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  metrics: PromptVariationMetricSnapshot | null;
  failedThresholds: PromptVariationThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  rollbackVisible: boolean;
  rollbackRestoredVariant: boolean;
  rejectedVariantCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type PromptVariationDiagnosticSummary = {
  variantCount: number;
  passedVariantCount: number;
  rejectedVariantCount: number;
  averageSceneCohesion: number;
  minimumSceneCohesion: number;
  averageTransitionSmoothness: number;
  minimumTransitionSmoothness: number;
  averageFocusContinuity: number;
  minimumFocusContinuity: number;
  averageTensionContinuity: number;
  averageMomentumContinuity: number;
  averageVisualContinuity: number;
  averagePreviewReadability: number;
  rollbackPassRate: number;
  recommendedNextAction: "CONTINUE_VARIANTS" | "TUNE_RUNTIME" | "BLOCK_ESCALATION";
  recommendedRuntimeLayer: string | null;
};

export type PromptVariationExecutionPlanStage =
  | "classify-prompt"
  | "confirm-approved-domain"
  | "run-governed-micro-sequence"
  | "run-governed-preview"
  | "collect-diagnostics"
  | "compare-thresholds"
  | "produce-operator-report";

export type PromptVariationExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  maxVariants: number;
  variantIds: string[];
  stages: PromptVariationExecutionPlanStage[];
  autonomousContinuationAllowed: false;
  longFormRenderingAllowed: false;
};
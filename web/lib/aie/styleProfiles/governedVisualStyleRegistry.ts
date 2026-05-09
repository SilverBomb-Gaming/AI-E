import type { CinematicGovernedPreviewDiagnostics } from "../cinematicProductionMemory";
import type {
  GovernedPreviewExecutionResult,
  GovernedPreviewMicroSequenceResult,
  GovernedPreviewPrerequisiteState,
  GovernedPreviewRollbackResult,
} from "../governedPreviewGeneration";

export type VisualStyleCategory =
  | "CINEMATIC_SCI_FI"
  | "INDUSTRIAL_REALISM"
  | "ANIME_INSPIRED"
  | "NEON_DYSTOPIAN"
  | "ATMOSPHERIC_PAINTERLY";

export type VisualStyleExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";
export type VisualStyleSafetyStatus = "APPROVED" | "REJECTED";

export type GovernedVisualStyleState = {
  activeStyleId: string;
  activeStyleLabel: string;
  styleCategory: VisualStyleCategory;
  styleCompatibilityScore: number;
  styleReadabilityScore: number;
  rollbackRestoredStyle: boolean;
  rejectedStyleCount: number;
};

export type VisualStyleMetricSnapshot = {
  sceneCohesion: number;
  phraseContinuity: number;
  transitionSmoothness: number;
  visualContinuity: number;
  focusContinuity: number;
  tensionContinuity: number;
  momentumContinuity: number;
  previewReadability: number;
  finalComposition: number;
  lightingStability: number;
  reflectionContinuity: number;
  silhouetteReadability: number;
  environmentIdentity: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
};

export type VisualStyleThresholdFailure = {
  metric: keyof VisualStyleMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type VisualStyleCompatibilityResult = {
  status: VisualStyleSafetyStatus;
  styleCategory: VisualStyleCategory | null;
  compatibilityScore: number;
  readabilityScore: number;
  lightingStabilityCompatibility: number;
  reflectionContinuityCompatibility: number;
  silhouetteReadabilityCompatibility: number;
  rollbackCompatibility: number;
  pass: boolean;
  failedThresholds: VisualStyleThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  reasons: string[];
};

export type VisualStyleReport = {
  styleId: string;
  styleLabel: string;
  styleCategory: VisualStyleCategory;
  styleIndex: number;
  totalStyles: number;
  styleCharacteristics: string[];
  styleDescription: string;
  safetyStatus: VisualStyleSafetyStatus;
  executionStatus: VisualStyleExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: VisualStyleCompatibilityResult | null;
  metrics: VisualStyleMetricSnapshot | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  failedThresholds: VisualStyleThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  rollbackVisible: boolean;
  rollbackRestoredStyle: boolean;
  rejectedStyleCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type VisualStyleDiagnosticSummary = {
  testedStyleCount: number;
  passedStyleCount: number;
  rejectedStyleCount: number;
  strongestStyle: string | null;
  weakestStyle: string | null;
  averageSceneCohesion: number;
  averageTransitionSmoothness: number;
  averageLightingStability: number;
  averageReflectionContinuity: number;
  averageSilhouetteReadability: number;
  averagePreviewReadability: number;
  rollbackPassRate: number;
  recommendedNextAction:
    | "CONTINUE_STYLE_EXPANSION"
    | "TUNE_VISUAL_LAYERS"
    | "BLOCK_ESCALATION";
  recommendedRuntimeLayer: string | null;
};

export type VisualStyleExecutionPlanStage =
  | "classify-style"
  | "validate-style-profile"
  | "execute-governed-preview"
  | "collect-diagnostics"
  | "compare-thresholds"
  | "aggregate-style-report"
  | "require-operator-review";

export type VisualStyleExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  maxStyles: number;
  styleIds: string[];
  stages: VisualStyleExecutionPlanStage[];
  autonomousContinuationAllowed: false;
  longFormRenderingAllowed: false;
};

export function buildGovernedVisualStyleState(input: {
  report: Pick<VisualStyleReport, "styleId" | "styleLabel" | "styleCategory" | "rollbackRestoredStyle" | "rejectedStyleCount">;
  priorReports?: Array<Pick<VisualStyleReport, "metrics" | "compatibility">>;
}): GovernedVisualStyleState {
  const prior = input.priorReports ?? [];
  const compatibilityScores = prior
    .map((entry) => entry.compatibility?.compatibilityScore)
    .filter((value): value is number => typeof value === "number");
  const readabilityScores = prior
    .map((entry) => entry.metrics?.previewReadability)
    .filter((value): value is number => typeof value === "number");

  return {
    activeStyleId: input.report.styleId,
    activeStyleLabel: input.report.styleLabel,
    styleCategory: input.report.styleCategory,
    styleCompatibilityScore: compatibilityScores.length === 0
      ? 0
      : Number((compatibilityScores.reduce((sum, value) => sum + value, 0) / compatibilityScores.length).toFixed(2)),
    styleReadabilityScore: readabilityScores.length === 0
      ? 0
      : Number((readabilityScores.reduce((sum, value) => sum + value, 0) / readabilityScores.length).toFixed(2)),
    rollbackRestoredStyle: input.report.rollbackRestoredStyle,
    rejectedStyleCount: input.report.rejectedStyleCount,
  };
}
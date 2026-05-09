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

export type StyleStressFailureCode =
  | "SILHOUETTE_COLLAPSE"
  | "LIGHTING_OVERLOAD"
  | "REFLECTION_INSTABILITY"
  | "STYLE_COHESION_LOSS"
  | "DOMAIN_COMPATIBILITY_FAILURE"
  | "CAMERA_COMPATIBILITY_DROP"
  | "ROLLBACK_PRESSURE_SPIKE"
  | "PREVIEW_READABILITY_DROP";

export type StyleStressExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";
export type StyleStressSafetyStatus = "APPROVED" | "REJECTED";

export type GovernedStyleStressState = {
  activeStyleId: string;
  activeDomainId: string;
  matrixCellId: string;
  testedCellCount: number;
  passedCellCount: number;
  failedCellCount: number;
  weakestStyleId: string | null;
  weakestDomainId: string | null;
  rollbackRestoredStressRun: boolean;
};

export type StyleStressMatrixCell = {
  cellId: string;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  starter: boolean;
  manualSelectionAllowed: true;
};

export type StyleStressMetricSnapshot = {
  sceneCohesion: number;
  styleCohesion: number;
  domainCompatibility: number;
  lightingStability: number;
  reflectionContinuity: number;
  silhouetteReadability: number;
  transitionSmoothness: number;
  focusContinuity: number;
  tensionContinuity: number;
  momentumContinuity: number;
  previewReadability: number;
  finalComposition: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
  rollbackPressure: number;
};

export type StyleStressThresholdFailure = {
  metric: keyof StyleStressMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type StyleStressFailureClassification = {
  code: StyleStressFailureCode;
  reason: string;
  inspectLayer: string;
};

export type StyleDomainCompatibilityResult = {
  styleSafetyStatus: StyleStressSafetyStatus;
  domainSafetyStatus: StyleStressSafetyStatus;
  styleCategory: VisualStyleCategory | null;
  domainCategory: PromptDomainCategory | null;
  compatibilityScore: number;
  styleConsistencyScore: number;
  domainCompatibilityScore: number;
  readabilityScore: number;
  rollbackCompatibilityScore: number;
  pass: boolean;
  failedThresholds: StyleStressThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  reasons: string[];
};

export type StyleStressReport = {
  cellId: string;
  cellIndex: number;
  totalCells: number;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  styleCategory: VisualStyleCategory;
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  domainCategory: PromptDomainCategory;
  starter: boolean;
  safetyStatus: StyleStressSafetyStatus;
  executionStatus: StyleStressExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: StyleDomainCompatibilityResult | null;
  metrics: StyleStressMetricSnapshot | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  strongestMetricScore: number | null;
  weakestMetricScore: number | null;
  failedThresholds: StyleStressThresholdFailure[];
  failureClassification: StyleStressFailureClassification | null;
  recommendedRuntimeLayer: string | null;
  rollbackVisible: boolean;
  rollbackRestoredStressRun: boolean;
  rejectedCellCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type StyleStressDiagnosticSummary = {
  testedCellCount: number;
  passedCellCount: number;
  failedCellCount: number;
  strongestStyleId: string | null;
  weakestStyleId: string | null;
  strongestDomainId: string | null;
  weakestDomainId: string | null;
  styleDomainPassRate: number;
  averageSceneCohesion: number;
  averageStyleReadability: number;
  averageLightingStability: number;
  averageReflectionContinuity: number;
  rollbackPassRate: number;
  strongestCellId: string | null;
  weakestCellId: string | null;
  recommendedNextAction:
    | "CONTINUE_STYLE_TESTING"
    | "TUNE_STYLE_PROFILE"
    | "BLOCK_STYLE_ESCALATION";
  recommendedRuntimeLayer: string | null;
};

export type StyleStressExecutionPlanStage =
  | "validate-style-profile"
  | "validate-prompt-domain"
  | "snapshot-prerequisites"
  | "execute-governed-preview"
  | "collect-diagnostics"
  | "compare-thresholds"
  | "classify-style-failure"
  | "aggregate-stress-report"
  | "require-operator-review";

export type StyleStressExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  maxCells: number;
  cellIds: string[];
  starterCellIds: string[];
  stages: StyleStressExecutionPlanStage[];
  autonomousContinuationAllowed: false;
  fullMatrixAutoplayAllowed: false;
  automaticRetriesAllowed: false;
  longFormRenderingAllowed: false;
};

function sortStyleOrDomainByCompatibility(
  reports: StyleStressReport[],
  dimension: "styleId" | "domainId",
  direction: "strongest" | "weakest",
): string | null {
  const groups = new Map<string, number[]>();
  for (const report of reports) {
    if (!report.compatibility) {
      continue;
    }

    const key = report[dimension];
    const current = groups.get(key) ?? [];
    current.push(report.compatibility.compatibilityScore);
    groups.set(key, current);
  }

  if (groups.size === 0) {
    return null;
  }

  const ranked = [...groups.entries()].map(([key, values]) => ({
    key,
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
  }));
  ranked.sort((left, right) => direction === "strongest" ? right.average - left.average : left.average - right.average);
  return ranked[0]?.key ?? null;
}

export function buildGovernedStyleStressState(input: {
  report: Pick<StyleStressReport, "styleId" | "domainId" | "cellId" | "rollbackRestoredStressRun">;
  priorReports?: Array<Pick<StyleStressReport, "styleId" | "domainId" | "pass">>;
}): GovernedStyleStressState {
  const priorReports = input.priorReports ?? [];

  return {
    activeStyleId: input.report.styleId,
    activeDomainId: input.report.domainId,
    matrixCellId: input.report.cellId,
    testedCellCount: priorReports.length,
    passedCellCount: priorReports.filter((entry) => entry.pass).length,
    failedCellCount: priorReports.filter((entry) => !entry.pass).length,
    weakestStyleId: sortStyleOrDomainByCompatibility(priorReports as StyleStressReport[], "styleId", "weakest"),
    weakestDomainId: sortStyleOrDomainByCompatibility(priorReports as StyleStressReport[], "domainId", "weakest"),
    rollbackRestoredStressRun: input.report.rollbackRestoredStressRun,
  };
}
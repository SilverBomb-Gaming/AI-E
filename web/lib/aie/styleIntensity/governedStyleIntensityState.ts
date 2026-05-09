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

export type StyleIntensityLevel = "LOW" | "MEDIUM" | "HIGH";

export type StyleIntensityFailureCode =
  | "STYLE_OVERPOWER"
  | "SILHOUETTE_COLLAPSE"
  | "LIGHTING_OVERLOAD"
  | "REFLECTION_INSTABILITY"
  | "ATMOSPHERE_OVERDENSITY"
  | "MATERIAL_NOISE"
  | "FOCUS_READABILITY_DROP"
  | "TRANSITION_VISUAL_NOISE"
  | "ROLLBACK_PRESSURE_SPIKE";

export type StyleIntensityExecutionStatus = "PENDING" | "RUNNING" | "PASSED" | "FAILED";
export type StyleIntensitySafetyStatus = "APPROVED" | "REJECTED";

export type GovernedStyleIntensityState = {
  activeStyleId: string;
  activeDomainId: string;
  activeIntensityLevel: StyleIntensityLevel;
  intensityValue: number;
  matrixCellId: string;
  testedIntensityCount: number;
  passedIntensityCount: number;
  failedIntensityCount: number;
  weakestIntensityLevel: StyleIntensityLevel | null;
  rollbackRestoredIntensityRun: boolean;
};

export type StyleIntensityPreset = {
  level: StyleIntensityLevel;
  value: number;
  label: string;
  styleInfluence: number;
  lightingAmplification: "mild" | "moderate" | "strong_bounded";
  reflectionAmplification: "mild" | "moderate" | "strong_bounded";
  atmosphereAmplification: "mild" | "moderate" | "strong_bounded";
  silhouetteProtection: "strong" | "mandatory";
  unrestricted: false;
  extremeMode: false;
};

export type StyleDomainIntensityMatrixCell = {
  cellId: string;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  intensityLevel: StyleIntensityLevel;
  intensityValue: number;
  starter: boolean;
  guardedHighProbe: boolean;
  highProbeApprovalRequired: boolean;
  manualSelectionAllowed: true;
};

export type StyleIntensityMetricSnapshot = {
  sceneCohesion: number;
  styleReadability: number;
  scenePhraseContinuity: number;
  transitionSmoothness: number;
  visualContinuity: number;
  lightingStability: number;
  reflectionContinuity: number;
  silhouetteReadability: number;
  previewReadability: number;
  atmosphereClarity: number;
  focusContinuity: number;
  momentumContinuity: number;
  finalComposition: number;
  materialClarity: number;
  rollbackIntegrityStatus: "PASS" | "WATCH" | "FAIL";
  rollbackPressure: number;
};

export type StyleIntensityThresholdFailure = {
  metric: keyof StyleIntensityMetricSnapshot;
  actual: number | string;
  required: string;
  recommendedRuntimeLayer: string;
  reason: string;
};

export type StyleIntensityFailureClassification = {
  code: StyleIntensityFailureCode;
  reason: string;
  inspectLayer: string;
};

export type StyleIntensityCompatibilityResult = {
  styleSafetyStatus: StyleIntensitySafetyStatus;
  domainSafetyStatus: StyleIntensitySafetyStatus;
  intensitySafetyStatus: StyleIntensitySafetyStatus;
  styleCategory: VisualStyleCategory | null;
  domainCategory: PromptDomainCategory | null;
  compatibilityScore: number;
  intensityValue: number;
  styleReadabilityScore: number;
  lightingStabilityScore: number;
  reflectionContinuityScore: number;
  rollbackCompatibilityScore: number;
  pass: boolean;
  failedThresholds: StyleIntensityThresholdFailure[];
  recommendedRuntimeLayer: string | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  reasons: string[];
};

export type StyleIntensityReport = {
  cellId: string;
  cellIndex: number;
  totalCells: number;
  styleId: ApprovedVisualStyleProfile["id"];
  styleLabel: ApprovedVisualStyleProfile["label"];
  styleCategory: VisualStyleCategory;
  domainId: ApprovedPromptDomainTemplate["id"];
  domainLabel: ApprovedPromptDomainTemplate["label"];
  domainCategory: PromptDomainCategory;
  intensityLevel: StyleIntensityLevel;
  intensityValue: number;
  starter: boolean;
  guardedHighProbe: boolean;
  highProbeApprovalRequired: boolean;
  highProbeApproved: boolean;
  safetyStatus: StyleIntensitySafetyStatus;
  executionStatus: StyleIntensityExecutionStatus;
  pass: boolean;
  failureReason: string | null;
  compatibility: StyleIntensityCompatibilityResult | null;
  metrics: StyleIntensityMetricSnapshot | null;
  strongestMetric: string | null;
  weakestMetric: string | null;
  strongestMetricScore: number | null;
  weakestMetricScore: number | null;
  failedThresholds: StyleIntensityThresholdFailure[];
  failureClassification: StyleIntensityFailureClassification | null;
  recommendedRuntimeLayer: string | null;
  rollbackVisible: boolean;
  rollbackRestoredIntensityRun: boolean;
  rejectedIntensityCount: number;
  diagnostics: CinematicGovernedPreviewDiagnostics | null;
  prerequisiteBefore: GovernedPreviewPrerequisiteState | null;
  prerequisiteAfter: GovernedPreviewPrerequisiteState | null;
  microSequence: GovernedPreviewMicroSequenceResult | null;
  previewExecution: GovernedPreviewExecutionResult | null;
  rollback: GovernedPreviewRollbackResult | null;
};

export type StyleIntensityDiagnosticSummary = {
  testedIntensityCount: number;
  passedIntensityCount: number;
  failedIntensityCount: number;
  strongestIntensityLevelByStyle: Record<string, StyleIntensityLevel>;
  weakestIntensityLevelByStyle: Record<string, StyleIntensityLevel>;
  safestHighIntensityStyleId: string | null;
  riskiestHighIntensityStyleId: string | null;
  averageSceneCohesion: number;
  averageStyleReadability: number;
  averageLightingStability: number;
  averageReflectionContinuity: number;
  rollbackPassRate: number;
  averageSceneCohesionByIntensity: Record<StyleIntensityLevel, number>;
  averageStyleReadabilityByIntensity: Record<StyleIntensityLevel, number>;
  averageLightingStabilityByIntensity: Record<StyleIntensityLevel, number>;
  averageReflectionContinuityByIntensity: Record<StyleIntensityLevel, number>;
  rollbackPassRateByIntensity: Record<StyleIntensityLevel, number>;
  strongestCellId: string | null;
  weakestCellId: string | null;
  recommendedNextAction:
    | "CONTINUE_INTENSITY_TESTING"
    | "TUNE_STYLE_INTENSITY"
    | "BLOCK_HIGH_INTENSITY";
  recommendedRuntimeLayer: string | null;
};

export type StyleIntensityExecutionPlanStage =
  | "validate-style-profile"
  | "validate-prompt-domain"
  | "validate-intensity-preset"
  | "snapshot-prerequisites"
  | "execute-governed-preview"
  | "collect-diagnostics"
  | "compare-intensity-thresholds"
  | "classify-intensity-failure"
  | "aggregate-intensity-report"
  | "require-operator-review";

export type StyleIntensityExecutionPlan = {
  planId: string;
  bounded: true;
  operatorTriggeredOnly: true;
  manualApprovalRequired: true;
  highIntensityExplicitApprovalRequired: true;
  maxCells: number;
  cellIds: string[];
  starterCellIds: string[];
  guardedHighProbeCellIds: string[];
  intensityLevels: StyleIntensityLevel[];
  stages: StyleIntensityExecutionPlanStage[];
  autonomousContinuationAllowed: false;
  autonomousIntensityRampingAllowed: false;
  unrestrictedIntensityAllowed: false;
  extremeModeAllowed: false;
  crossRunPersistenceAllowed: false;
  automaticRetriesAllowed: false;
  longFormRenderingAllowed: false;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function weakestIntensityByCompatibility(reports: StyleIntensityReport[]): StyleIntensityLevel | null {
  const comparable = reports.filter((entry) => entry.compatibility);
  if (comparable.length === 0) {
    return null;
  }

  const grouped = new Map<StyleIntensityLevel, number[]>();
  for (const report of comparable) {
    const current = grouped.get(report.intensityLevel) ?? [];
    current.push(report.compatibility?.compatibilityScore ?? 0);
    grouped.set(report.intensityLevel, current);
  }

  const ranked = [...grouped.entries()].map(([level, values]) => ({ level, average: average(values) }));
  ranked.sort((left, right) => left.average - right.average);
  return ranked[0]?.level ?? null;
}

export function buildGovernedStyleIntensityState(input: {
  report: Pick<StyleIntensityReport, "styleId" | "domainId" | "intensityLevel" | "intensityValue" | "cellId" | "rollbackRestoredIntensityRun">;
  priorReports?: StyleIntensityReport[];
}): GovernedStyleIntensityState {
  const priorReports = input.priorReports ?? [];

  return {
    activeStyleId: input.report.styleId,
    activeDomainId: input.report.domainId,
    activeIntensityLevel: input.report.intensityLevel,
    intensityValue: input.report.intensityValue,
    matrixCellId: input.report.cellId,
    testedIntensityCount: priorReports.length,
    passedIntensityCount: priorReports.filter((entry) => entry.pass).length,
    failedIntensityCount: priorReports.filter((entry) => !entry.pass).length,
    weakestIntensityLevel: weakestIntensityByCompatibility(priorReports),
    rollbackRestoredIntensityRun: input.report.rollbackRestoredIntensityRun,
  };
}

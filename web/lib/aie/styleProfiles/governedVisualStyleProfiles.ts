import {
  getApprovedVisualStyleProfileById,
  listApprovedVisualStyleProfiles,
  VISUAL_STYLE_MAX_PROFILES,
  type ApprovedVisualStyleProfile,
} from "./approvedVisualStyleProfiles";
import { summarizeVisualStyleDiagnostics } from "./styleProfileDiagnostics";
import { classifyVisualStyleProfile } from "./styleCompatibilityEvaluator";
import {
  buildGovernedVisualStyleState,
  type GovernedVisualStyleState,
  type VisualStyleDiagnosticSummary,
  type VisualStyleExecutionPlan,
  type VisualStyleReport,
} from "./governedVisualStyleRegistry";
import {
  runGovernedVisualStyleProfile,
  type VisualStyleRunnerDependencies,
} from "./governedStyleProfileRunner";

export function buildVisualStyleExecutionPlan(styleIds?: string[]): VisualStyleExecutionPlan {
  const approvedIds = (styleIds?.length ? styleIds : listApprovedVisualStyleProfiles().map((entry) => entry.id)).slice(0, VISUAL_STYLE_MAX_PROFILES);

  return {
    planId: `visual-style-plan-${approvedIds.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    maxStyles: VISUAL_STYLE_MAX_PROFILES,
    styleIds: approvedIds,
    stages: [
      "classify-style",
      "validate-style-profile",
      "execute-governed-preview",
      "collect-diagnostics",
      "compare-thresholds",
      "aggregate-style-report",
      "require-operator-review",
    ],
    autonomousContinuationAllowed: false,
    longFormRenderingAllowed: false,
  };
}

export function listGovernedVisualStyleProfiles(): ApprovedVisualStyleProfile[] {
  return listApprovedVisualStyleProfiles();
}

export function classifyGovernedVisualStyleProfile(styleId: string) {
  return classifyVisualStyleProfile(styleId);
}

export async function runGovernedVisualStyleProfileById(
  input: {
    styleId: string;
    governanceApproval: boolean;
    styleIndex: number;
    totalStyles: number;
    rejectedStyleCount?: number;
  },
  depsOverride?: Partial<VisualStyleRunnerDependencies>,
): Promise<VisualStyleReport> {
  const styleProfile = getApprovedVisualStyleProfileById(input.styleId);
  if (!styleProfile) {
    const classification = classifyVisualStyleProfile(input.styleId);
    return {
      styleId: input.styleId,
      styleLabel: input.styleId,
      styleCategory: "CINEMATIC_SCI_FI",
      styleIndex: input.styleIndex,
      totalStyles: input.totalStyles,
      styleCharacteristics: [],
      styleDescription: "",
      safetyStatus: classification.status,
      executionStatus: "FAILED",
      pass: false,
      failureReason: classification.reasons[0] ?? `Unknown approved visual style: ${input.styleId}`,
      compatibility: {
        status: classification.status,
        styleCategory: classification.styleCategory,
        compatibilityScore: 0,
        readabilityScore: 0,
        lightingStabilityCompatibility: 0,
        reflectionContinuityCompatibility: 0,
        silhouetteReadabilityCompatibility: 0,
        rollbackCompatibility: 0,
        pass: false,
        failedThresholds: [],
        recommendedRuntimeLayer: "style governance",
        strongestMetric: null,
        weakestMetric: null,
        reasons: classification.reasons,
      },
      metrics: null,
      strongestMetric: null,
      weakestMetric: null,
      failedThresholds: [],
      recommendedRuntimeLayer: "style governance",
      rollbackVisible: false,
      rollbackRestoredStyle: false,
      rejectedStyleCount: (input.rejectedStyleCount ?? 0) + 1,
      diagnostics: null,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  return runGovernedVisualStyleProfile({ ...input, styleProfile }, depsOverride);
}

export function summarizeGovernedVisualStyleReports(reports: VisualStyleReport[]): VisualStyleDiagnosticSummary {
  return summarizeVisualStyleDiagnostics(reports);
}

export function buildGovernedVisualStyleHarnessState(reports: VisualStyleReport[]): GovernedVisualStyleState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedVisualStyleState({
    report: latest,
    priorReports: reports,
  });
}
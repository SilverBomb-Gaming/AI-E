import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import {
  getStyleStressCellResources,
  listStarterStyleStressMatrixCells,
  listStyleStressMatrixCells,
  STYLE_STRESS_MAX_CELLS,
} from "./styleDomainMatrix";
import {
  buildGovernedStyleStressState,
  type GovernedStyleStressState,
  type StyleStressDiagnosticSummary,
  type StyleStressExecutionPlan,
  type StyleStressReport,
} from "./governedStyleStressState";
import {
  buildStyleStressMetricSnapshot,
  evaluateStyleDomainCompatibility,
} from "./styleDomainCompatibilityEvaluator";
import { summarizeStyleStressDiagnostics } from "./styleStressDiagnostics";
import { classifyStyleStressFailure } from "./styleFailureClassifier";

export type StyleStressRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunStyleStressCellInput = {
  cellId: string;
  governanceApproval: boolean;
  cellIndex: number;
  totalCells: number;
  rejectedCellCount?: number;
} & GovernedPreviewExecutionOptions;

function resolveDependencies(overrides?: Partial<StyleStressRunnerDependencies>): StyleStressRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

function buildStyleStressFormInput(input: {
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

export function buildStyleStressExecutionPlan(cellIds?: string[]): StyleStressExecutionPlan {
  const approvedCells = (cellIds?.length ? cellIds : listStyleStressMatrixCells().map((entry) => entry.cellId)).slice(0, STYLE_STRESS_MAX_CELLS);
  const starterCellIds = listStarterStyleStressMatrixCells().map((entry) => entry.cellId);

  return {
    planId: `style-stress-plan-${approvedCells.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    maxCells: STYLE_STRESS_MAX_CELLS,
    cellIds: approvedCells,
    starterCellIds,
    stages: [
      "validate-style-profile",
      "validate-prompt-domain",
      "snapshot-prerequisites",
      "execute-governed-preview",
      "collect-diagnostics",
      "compare-thresholds",
      "classify-style-failure",
      "aggregate-stress-report",
      "require-operator-review",
    ],
    autonomousContinuationAllowed: false,
    fullMatrixAutoplayAllowed: false,
    automaticRetriesAllowed: false,
    longFormRenderingAllowed: false,
  };
}

export function listGovernedStyleStressCells() {
  return listStyleStressMatrixCells();
}

export function listGovernedStyleStressStarterCells() {
  return listStarterStyleStressMatrixCells();
}

export async function runGovernedStyleStressCellById(
  input: RunStyleStressCellInput,
  depsOverride?: Partial<StyleStressRunnerDependencies>,
): Promise<StyleStressReport> {
  const deps = resolveDependencies(depsOverride);
  const resources = getStyleStressCellResources(input.cellId);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });

  if (!resources) {
    return {
      cellId: input.cellId,
      cellIndex: input.cellIndex,
      totalCells: input.totalCells,
      styleId: "STYLE_001",
      styleLabel: input.cellId,
      styleCategory: "CINEMATIC_SCI_FI",
      domainId: "DOMAIN_001",
      domainLabel: input.cellId,
      domainCategory: "ENERGY_PULSE",
      starter: false,
      safetyStatus: "REJECTED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: `Unknown approved style stress cell: ${input.cellId}`,
      compatibility: null,
      metrics: null,
      strongestMetric: null,
      weakestMetric: null,
      strongestMetricScore: null,
      weakestMetricScore: null,
      failedThresholds: [],
      failureClassification: null,
      recommendedRuntimeLayer: "style stress governance",
      rollbackVisible: false,
      rollbackRestoredStressRun: false,
      rejectedCellCount: (input.rejectedCellCount ?? 0) + 1,
      diagnostics: null,
      prerequisiteBefore,
      prerequisiteAfter: prerequisiteBefore,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  const { cell, styleProfile, domain } = resources;
  const compiledRequest = deps.compileRequest(buildStyleStressFormInput({
    prompt: domain.prompt,
    subject: domain.subject,
    motionIntent: domain.motion_intent,
    style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}`,
    durationSeconds: Math.min(styleProfile.duration_seconds, domain.duration_seconds),
    resolution: styleProfile.resolution,
    continuityPriority: styleProfile.continuity_priority === "high" || domain.continuity_priority === "high"
      ? "high"
      : styleProfile.continuity_priority === "medium" || domain.continuity_priority === "medium"
        ? "medium"
        : "low",
    governanceApproval: input.governanceApproval,
    packageGifPreview: styleProfile.package_gif_preview || domain.package_gif_preview,
  }));
  const microSequence = await deps.executeMicroSequence(compiledRequest, { root: input.root, deps: input.deps });
  const previewExecution = microSequence.status === "generated"
    ? await deps.executePreview(compiledRequest, { root: input.root, deps: input.deps })
    : null;
  const diagnostics = previewExecution?.preview_diagnostics ?? microSequence.preview_diagnostics ?? prerequisiteBefore.preview_diagnostics;
  const metrics = buildStyleStressMetricSnapshot(diagnostics ?? null);
  const compatibility = evaluateStyleDomainCompatibility(styleProfile, domain, metrics);
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failedThresholds = executionBlocked
    ? []
    : compatibility.failedThresholds;
  const failureClassification = executionBlocked
    ? {
      code: "DOMAIN_COMPATIBILITY_FAILURE" as const,
      reason: [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed style stress execution was blocked before preview completion.",
      inspectLayer: "preview governance",
    }
    : classifyStyleStressFailure({
      styleProfile,
      domain,
      metrics,
      failedThresholds,
    });
  const strongestMetricScore = compatibility.strongestMetric && metrics
    ? metrics[compatibility.strongestMetric as keyof typeof metrics] as number
    : null;
  const weakestMetricScore = compatibility.weakestMetric && metrics
    ? metrics[compatibility.weakestMetric as keyof typeof metrics] as number
    : null;
  const failureReason = pass
    ? null
    : executionBlocked
      ? [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed style stress execution was blocked before preview completion."
      : failureClassification?.reason ?? compatibility.failedThresholds[0]?.reason ?? compatibility.reasons[0] ?? "Governed style stress thresholds were not met.";

  return {
    cellId: cell.cellId,
    cellIndex: input.cellIndex,
    totalCells: input.totalCells,
    styleId: styleProfile.id,
    styleLabel: styleProfile.label,
    styleCategory: styleProfile.category,
    domainId: domain.id,
    domainLabel: domain.label,
    domainCategory: compatibility.domainCategory ?? domain.category,
    starter: cell.starter,
    safetyStatus: compatibility.styleSafetyStatus === "APPROVED" && compatibility.domainSafetyStatus === "APPROVED" ? "APPROVED" : "REJECTED",
    executionStatus: pass ? "PASSED" : "FAILED",
    pass,
    failureReason,
    compatibility,
    metrics,
    strongestMetric: compatibility.strongestMetric,
    weakestMetric: compatibility.weakestMetric,
    strongestMetricScore,
    weakestMetricScore,
    failedThresholds,
    failureClassification,
    recommendedRuntimeLayer: failureClassification?.inspectLayer ?? compatibility.recommendedRuntimeLayer,
    rollbackVisible: Boolean(rollback || diagnostics?.rollback_integrity_status),
    rollbackRestoredStressRun: rollback?.status === "rolled_back",
    rejectedCellCount: input.rejectedCellCount ?? 0,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}

export function summarizeGovernedStyleStressReports(reports: StyleStressReport[]): StyleStressDiagnosticSummary {
  return summarizeStyleStressDiagnostics(reports);
}

export function buildGovernedStyleStressHarnessState(reports: StyleStressReport[]): GovernedStyleStressState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedStyleStressState({
    report: latest,
    priorReports: reports,
  });
}
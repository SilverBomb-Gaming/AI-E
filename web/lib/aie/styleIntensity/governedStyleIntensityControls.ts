import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import {
  getStyleDomainIntensityCellResources,
  listGuardedHighIntensityProbeCells,
  listStarterStyleIntensityCells,
  listStyleDomainIntensityMatrixCells,
  STYLE_INTENSITY_MAX_CELLS,
} from "./styleDomainIntensityMatrix";
import {
  buildGovernedStyleIntensityState,
  type GovernedStyleIntensityState,
  type StyleIntensityDiagnosticSummary,
  type StyleIntensityExecutionPlan,
  type StyleIntensityReport,
} from "./governedStyleIntensityState";
import { describeStyleIntensityPreset, listStyleIntensityPresets } from "./styleIntensityPresets";
import {
  buildStyleIntensityMetricSnapshot,
  evaluateStyleIntensityCompatibility,
} from "./styleIntensityCompatibilityEvaluator";
import { summarizeStyleIntensityDiagnostics } from "./styleIntensityDiagnostics";
import { classifyStyleIntensityFailure } from "./styleIntensityFailureClassifier";

export type StyleIntensityRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunStyleIntensityCellInput = {
  cellId: string;
  governanceApproval: boolean;
  highIntensityApproval?: boolean;
  cellIndex: number;
  totalCells: number;
  rejectedIntensityCount?: number;
} & GovernedPreviewExecutionOptions;

function resolveDependencies(overrides?: Partial<StyleIntensityRunnerDependencies>): StyleIntensityRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

function buildStyleIntensityFormInput(input: {
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

export function buildStyleIntensityExecutionPlan(cellIds?: string[]): StyleIntensityExecutionPlan {
  const approvedCells = (cellIds?.length ? cellIds : listStyleDomainIntensityMatrixCells().map((entry) => entry.cellId)).slice(0, STYLE_INTENSITY_MAX_CELLS);
  const starterCellIds = listStarterStyleIntensityCells().map((entry) => entry.cellId);
  const guardedHighProbeCellIds = listGuardedHighIntensityProbeCells().map((entry) => entry.cellId);

  return {
    planId: `style-intensity-plan-${approvedCells.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    highIntensityExplicitApprovalRequired: true,
    maxCells: STYLE_INTENSITY_MAX_CELLS,
    cellIds: approvedCells,
    starterCellIds,
    guardedHighProbeCellIds,
    intensityLevels: listStyleIntensityPresets().map((entry) => entry.level),
    stages: [
      "validate-style-profile",
      "validate-prompt-domain",
      "validate-intensity-preset",
      "snapshot-prerequisites",
      "execute-governed-preview",
      "collect-diagnostics",
      "compare-intensity-thresholds",
      "classify-intensity-failure",
      "aggregate-intensity-report",
      "require-operator-review",
    ],
    autonomousContinuationAllowed: false,
    autonomousIntensityRampingAllowed: false,
    unrestrictedIntensityAllowed: false,
    extremeModeAllowed: false,
    crossRunPersistenceAllowed: false,
    automaticRetriesAllowed: false,
    longFormRenderingAllowed: false,
  };
}

export function listGovernedStyleIntensityCells() {
  return listStyleDomainIntensityMatrixCells();
}

export function listGovernedStyleIntensityStarterCells() {
  return listStarterStyleIntensityCells();
}

export function listGovernedStyleIntensityHighProbeCells() {
  return listGuardedHighIntensityProbeCells();
}

export function listGovernedStyleIntensityPresets() {
  return listStyleIntensityPresets();
}

function buildRejectedReport(input: {
  requestedCellId: string;
  cellIndex: number;
  totalCells: number;
  rejectedIntensityCount: number;
  prerequisiteBefore: Awaited<ReturnType<typeof readGovernedPreviewPrerequisiteState>>;
  failureReason: string;
  recommendedRuntimeLayer: string;
}): StyleIntensityReport {
  return {
    cellId: input.requestedCellId,
    cellIndex: input.cellIndex,
    totalCells: input.totalCells,
    styleId: "STYLE_001",
    styleLabel: input.requestedCellId,
    styleCategory: "CINEMATIC_SCI_FI",
    domainId: "DOMAIN_001",
    domainLabel: input.requestedCellId,
    domainCategory: "ENERGY_PULSE",
    intensityLevel: "LOW",
    intensityValue: 0.35,
    starter: false,
    guardedHighProbe: false,
    highProbeApprovalRequired: false,
    highProbeApproved: false,
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
    failureClassification: {
      code: "STYLE_OVERPOWER",
      reason: input.failureReason,
      inspectLayer: input.recommendedRuntimeLayer,
    },
    recommendedRuntimeLayer: input.recommendedRuntimeLayer,
    rollbackVisible: false,
    rollbackRestoredIntensityRun: false,
    rejectedIntensityCount: input.rejectedIntensityCount + 1,
    diagnostics: null,
    prerequisiteBefore: input.prerequisiteBefore,
    prerequisiteAfter: input.prerequisiteBefore,
    microSequence: null,
    previewExecution: null,
    rollback: null,
  };
}

export async function runGovernedStyleIntensityCellById(
  input: RunStyleIntensityCellInput,
  depsOverride?: Partial<StyleIntensityRunnerDependencies>,
): Promise<StyleIntensityReport> {
  const deps = resolveDependencies(depsOverride);
  const resources = getStyleDomainIntensityCellResources(input.cellId);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });

  if (!resources) {
    return buildRejectedReport({
      requestedCellId: input.cellId,
      cellIndex: input.cellIndex,
      totalCells: input.totalCells,
      rejectedIntensityCount: input.rejectedIntensityCount ?? 0,
      prerequisiteBefore,
      failureReason: `Unknown approved style-domain-intensity cell: ${input.cellId}`,
      recommendedRuntimeLayer: "style intensity governance",
    });
  }

  const { cell, styleProfile, domain, preset } = resources;
  const highIntensityApproved = preset.level !== "HIGH" || input.highIntensityApproval === true;
  if (preset.level === "HIGH" && !highIntensityApproved) {
    return {
      ...buildRejectedReport({
        requestedCellId: cell.cellId,
        cellIndex: input.cellIndex,
        totalCells: input.totalCells,
        rejectedIntensityCount: input.rejectedIntensityCount ?? 0,
        prerequisiteBefore,
        failureReason: "HIGH intensity probes require explicit operator approval before preview execution.",
        recommendedRuntimeLayer: "operator high-intensity approval",
      }),
      styleId: styleProfile.id,
      styleLabel: styleProfile.label,
      styleCategory: styleProfile.category,
      domainId: domain.id,
      domainLabel: domain.label,
      domainCategory: domain.category,
      intensityLevel: preset.level,
      intensityValue: preset.value,
      starter: cell.starter,
      guardedHighProbe: cell.guardedHighProbe,
      highProbeApprovalRequired: cell.highProbeApprovalRequired,
      highProbeApproved: false,
    };
  }

  const compiledRequest = deps.compileRequest(buildStyleIntensityFormInput({
    prompt: domain.prompt,
    subject: domain.subject,
    motionIntent: domain.motion_intent,
    style: `${styleProfile.style}; ${styleProfile.characteristics.join(", ")}; governed ${preset.level.toLowerCase()} intensity; ${describeStyleIntensityPreset(preset)}`,
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
  const metrics = buildStyleIntensityMetricSnapshot(diagnostics ?? null);
  const compatibility = evaluateStyleIntensityCompatibility({
    styleProfile,
    domain,
    preset,
    metrics,
    highIntensityApproved,
  });
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failedThresholds = executionBlocked
    ? []
    : compatibility.failedThresholds;
  const failureClassification = executionBlocked
    ? {
      code: "STYLE_OVERPOWER" as const,
      reason: [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed style intensity execution was blocked before preview completion.",
      inspectLayer: "preview governance",
    }
    : classifyStyleIntensityFailure({
      styleProfile,
      domain,
      intensityLevel: preset.level,
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
      ? [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed style intensity execution was blocked before preview completion."
      : failureClassification?.reason ?? compatibility.failedThresholds[0]?.reason ?? compatibility.reasons[0] ?? "Governed style intensity thresholds were not met.";

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
    intensityLevel: preset.level,
    intensityValue: preset.value,
    starter: cell.starter,
    guardedHighProbe: cell.guardedHighProbe,
    highProbeApprovalRequired: cell.highProbeApprovalRequired,
    highProbeApproved: highIntensityApproved,
    safetyStatus: compatibility.styleSafetyStatus === "APPROVED" && compatibility.domainSafetyStatus === "APPROVED" && compatibility.intensitySafetyStatus === "APPROVED" ? "APPROVED" : "REJECTED",
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
    rollbackRestoredIntensityRun: rollback?.status === "rolled_back",
    rejectedIntensityCount: input.rejectedIntensityCount ?? 0,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}

export function summarizeGovernedStyleIntensityReports(reports: StyleIntensityReport[]): StyleIntensityDiagnosticSummary {
  return summarizeStyleIntensityDiagnostics(reports);
}

export function buildGovernedStyleIntensityControlsState(reports: StyleIntensityReport[]): GovernedStyleIntensityState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedStyleIntensityState({
    report: latest,
    priorReports: reports,
  });
}

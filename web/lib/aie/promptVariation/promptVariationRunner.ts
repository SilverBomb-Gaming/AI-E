import type { GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  compileGovernedPreviewRequest,
} from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import type { ApprovedPromptVariant } from "./approvedPromptVariants";
import {
  buildPromptVariationMetricSnapshot,
  evaluatePromptVariationThresholds,
} from "./promptVariationDiagnostics";
import { classifyPromptSafety } from "./promptSafetyClassifier";
import type {
  PromptVariationHarnessState,
  PromptVariationVariantReport,
} from "./promptVariationHarnessState";

export type PromptVariationRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunPromptVariationVariantInput = {
  variant: ApprovedPromptVariant;
  governanceApproval: boolean;
  variantIndex: number;
  totalVariants: number;
  rejectedVariantCount?: number;
} & GovernedPreviewExecutionOptions;

function resolveDependencies(overrides?: Partial<PromptVariationRunnerDependencies>): PromptVariationRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

export function buildPromptVariationHarnessState(input: {
  report: Pick<PromptVariationVariantReport, "variantId" | "variantLabel" | "variantIndex" | "totalVariants" | "domain" | "safetyStatus" | "executionStatus" | "rollbackRestoredVariant" | "rejectedVariantCount">;
  priorReports?: Array<Pick<PromptVariationVariantReport, "metrics">>;
}): PromptVariationHarnessState {
  const priorMetrics = (input.priorReports ?? []).map((entry) => entry.metrics).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const cohesionScores = priorMetrics.map((entry) => entry.sceneCohesion);
  const readabilityScores = priorMetrics.map((entry) => entry.previewReadability);

  return {
    activeVariantId: input.report.variantId,
    activeVariantLabel: input.report.variantLabel,
    variantIndex: input.report.variantIndex,
    totalVariants: input.report.totalVariants,
    approvedDomain: input.report.domain,
    variantSafetyStatus: input.report.safetyStatus,
    variantExecutionStatus: input.report.executionStatus,
    crossVariantCohesionScore: cohesionScores.length === 0 ? 0 : Number((cohesionScores.reduce((sum, value) => sum + value, 0) / cohesionScores.length).toFixed(2)),
    crossVariantReadabilityScore: readabilityScores.length === 0 ? 0 : Number((readabilityScores.reduce((sum, value) => sum + value, 0) / readabilityScores.length).toFixed(2)),
    rollbackRestoredVariant: input.report.rollbackRestoredVariant,
    rejectedVariantCount: input.report.rejectedVariantCount,
  };
}

function buildVariantFormInput(variant: ApprovedPromptVariant, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: variant.prompt,
    subject: variant.subject,
    motion_intent: variant.motion_intent,
    style: variant.style,
    duration_seconds: variant.duration_seconds,
    resolution: variant.resolution,
    continuity_priority: variant.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: variant.package_gif_preview,
  };
}

export async function runPromptVariationVariant(
  input: RunPromptVariationVariantInput,
  depsOverride?: Partial<PromptVariationRunnerDependencies>,
): Promise<PromptVariationVariantReport> {
  const deps = resolveDependencies(depsOverride);
  const safety = classifyPromptSafety(input.variant.prompt);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });
  const rejectedVariantCount = (input.rejectedVariantCount ?? 0) + (safety.status === "REJECTED" ? 1 : 0);

  if (safety.status === "REJECTED") {
    return {
      variantId: input.variant.id,
      variantLabel: input.variant.label,
      variantIndex: input.variantIndex,
      totalVariants: input.totalVariants,
      domain: input.variant.domain,
      prompt: input.variant.prompt,
      safety,
      safetyStatus: "REJECTED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: safety.reasons.join(" "),
      metrics: null,
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: false,
      rollbackRestoredVariant: false,
      rejectedVariantCount,
      diagnostics: null,
      prerequisiteBefore,
      prerequisiteAfter: prerequisiteBefore,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  const compiledRequest = deps.compileRequest(buildVariantFormInput(input.variant, input.governanceApproval));
  const microSequence = await deps.executeMicroSequence(compiledRequest, { root: input.root, deps: input.deps });
  let previewExecution = null;
  if (microSequence.status === "generated") {
    previewExecution = await deps.executePreview(compiledRequest, { root: input.root, deps: input.deps });
  }

  const diagnostics = previewExecution?.preview_diagnostics ?? microSequence.preview_diagnostics ?? prerequisiteBefore.preview_diagnostics;
  const metrics = buildPromptVariationMetricSnapshot(diagnostics ?? null);
  const thresholdEvaluation = evaluatePromptVariationThresholds(metrics);
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && thresholdEvaluation.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failureReason = pass
    ? null
    : executionBlocked
      ? [
        ...microSequence.blockers,
        ...(previewExecution?.blockers ?? []),
      ].join(" ") || "Governed prompt variation execution was blocked before preview completion."
      : thresholdEvaluation.failedThresholds[0]?.reason ?? "Governed prompt variation thresholds were not met.";

  return {
    variantId: input.variant.id,
    variantLabel: input.variant.label,
    variantIndex: input.variantIndex,
    totalVariants: input.totalVariants,
    domain: input.variant.domain,
    prompt: input.variant.prompt,
    safety,
    safetyStatus: "APPROVED",
    executionStatus: pass ? "PASSED" : "FAILED",
    pass,
    failureReason,
    metrics,
    failedThresholds: thresholdEvaluation.failedThresholds,
    recommendedRuntimeLayer: thresholdEvaluation.recommendedRuntimeLayer,
    rollbackVisible: Boolean(rollback || diagnostics?.rollback_integrity_status),
    rollbackRestoredVariant: rollback?.status === "rolled_back",
    rejectedVariantCount,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}
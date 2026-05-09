import {
  getApprovedPromptVariantById,
  listApprovedPromptVariants,
  PROMPT_VARIATION_MAX_VARIANTS,
  type ApprovedPromptVariant,
} from "./approvedPromptVariants";
import { summarizePromptVariationDiagnostics } from "./promptVariationDiagnostics";
import { classifyPromptSafety } from "./promptSafetyClassifier";
import {
  buildPromptVariationHarnessState,
  runPromptVariationVariant,
  type PromptVariationRunnerDependencies,
  type RunPromptVariationVariantInput,
} from "./promptVariationRunner";
import type {
  PromptVariationDiagnosticSummary,
  PromptVariationExecutionPlan,
  PromptVariationVariantReport,
} from "./promptVariationHarnessState";

export function buildPromptVariationExecutionPlan(variantIds?: string[]): PromptVariationExecutionPlan {
  const approvedIds = (variantIds?.length ? variantIds : listApprovedPromptVariants().map((entry) => entry.id)).slice(0, PROMPT_VARIATION_MAX_VARIANTS);
  return {
    planId: `prompt-variation-plan-${approvedIds.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    maxVariants: PROMPT_VARIATION_MAX_VARIANTS,
    variantIds: approvedIds,
    stages: [
      "classify-prompt",
      "confirm-approved-domain",
      "run-governed-micro-sequence",
      "run-governed-preview",
      "collect-diagnostics",
      "compare-thresholds",
      "produce-operator-report",
    ],
    autonomousContinuationAllowed: false,
    longFormRenderingAllowed: false,
  };
}

export function listGovernedPromptVariationVariants(): ApprovedPromptVariant[] {
  return listApprovedPromptVariants();
}

export function classifyGovernedPromptVariationPrompt(prompt: string) {
  return classifyPromptSafety(prompt);
}

export async function runGovernedPromptVariationVariant(
  input: Omit<RunPromptVariationVariantInput, "variant"> & { variantId: string },
  depsOverride?: Partial<PromptVariationRunnerDependencies>,
): Promise<PromptVariationVariantReport> {
  const variant = getApprovedPromptVariantById(input.variantId);
  if (!variant) {
    const safety = classifyPromptSafety("");
    return {
      variantId: input.variantId,
      variantLabel: input.variantId,
      variantIndex: input.variantIndex,
      totalVariants: input.totalVariants,
      domain: "SCI_FI_BEACON_CHAMBER",
      prompt: "",
      safety,
      safetyStatus: "REJECTED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: `Unknown approved prompt variant: ${input.variantId}`,
      metrics: null,
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: false,
      rollbackRestoredVariant: false,
      rejectedVariantCount: input.rejectedVariantCount ?? 0,
      diagnostics: null,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  return runPromptVariationVariant({ ...input, variant }, depsOverride);
}

export function summarizeGovernedPromptVariationReports(
  reports: PromptVariationVariantReport[],
): PromptVariationDiagnosticSummary {
  return summarizePromptVariationDiagnostics(reports);
}

export function buildGovernedPromptVariationHarnessState(reports: PromptVariationVariantReport[]) {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildPromptVariationHarnessState({
    report: latest,
    priorReports: reports,
  });
}
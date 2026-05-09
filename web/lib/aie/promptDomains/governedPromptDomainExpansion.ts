import {
  getApprovedPromptDomainTemplateById,
  listApprovedPromptDomainTemplates,
  PROMPT_DOMAIN_MAX_VARIANTS,
  type ApprovedPromptDomainTemplate,
} from "./approvedPromptDomainTemplates";
import {
  classifyPromptDomainSafety,
} from "./domainCompatibilityEvaluator";
import { summarizePromptDomainDiagnostics } from "./promptDomainDiagnostics";
import {
  buildGovernedPromptDomainState,
  type GovernedPromptDomainState,
  type PromptDomainDiagnosticSummary,
  type PromptDomainExecutionPlan,
  type PromptDomainReport,
} from "./governedPromptDomainRegistry";
import {
  runGovernedPromptDomain,
  type PromptDomainRunnerDependencies,
} from "./governedPromptDomainRunner";

export function buildPromptDomainExecutionPlan(domainIds?: string[]): PromptDomainExecutionPlan {
  const approvedIds = (domainIds?.length ? domainIds : listApprovedPromptDomainTemplates().map((entry) => entry.id)).slice(0, PROMPT_DOMAIN_MAX_VARIANTS);

  return {
    planId: `prompt-domain-plan-${approvedIds.join("-").toLowerCase()}`,
    bounded: true,
    operatorTriggeredOnly: true,
    manualApprovalRequired: true,
    maxDomains: PROMPT_DOMAIN_MAX_VARIANTS,
    domainIds: approvedIds,
    stages: [
      "classify-domain",
      "validate-allowed-vocabulary",
      "execute-governed-preview",
      "collect-diagnostics",
      "compare-thresholds",
      "aggregate-domain-report",
      "require-operator-review",
    ],
    autonomousContinuationAllowed: false,
    longFormRenderingAllowed: false,
  };
}

export function listGovernedPromptDomains(): ApprovedPromptDomainTemplate[] {
  return listApprovedPromptDomainTemplates();
}

export function classifyGovernedPromptDomainPrompt(prompt: string) {
  return classifyPromptDomainSafety(prompt);
}

export async function runGovernedPromptDomainById(
  input: {
    domainId: string;
    governanceApproval: boolean;
    domainIndex: number;
    totalDomains: number;
    rejectedDomainCount?: number;
  },
  depsOverride?: Partial<PromptDomainRunnerDependencies>,
): Promise<PromptDomainReport> {
  const domain = getApprovedPromptDomainTemplateById(input.domainId);
  if (!domain) {
    const safety = classifyPromptDomainSafety("");
    return {
      domainId: input.domainId,
      domainLabel: input.domainId,
      domainCategory: "SCI_FI_CHAMBER",
      domainIndex: input.domainIndex,
      totalDomains: input.totalDomains,
      promptTemplate: "",
      safety,
      safetyStatus: "REJECTED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: `Unknown approved prompt domain: ${input.domainId}`,
      compatibility: null,
      metrics: null,
      strongestMetric: null,
      weakestMetric: null,
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: false,
      rollbackRestoredDomain: false,
      rejectedDomainCount: input.rejectedDomainCount ?? 0,
      diagnostics: null,
      prerequisiteBefore: null,
      prerequisiteAfter: null,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  return runGovernedPromptDomain({ ...input, domain }, depsOverride);
}

export function summarizeGovernedPromptDomainReports(reports: PromptDomainReport[]): PromptDomainDiagnosticSummary {
  return summarizePromptDomainDiagnostics(reports);
}

export function buildGovernedPromptDomainHarnessState(reports: PromptDomainReport[]): GovernedPromptDomainState | null {
  const latest = reports.at(-1);
  if (!latest) {
    return null;
  }

  return buildGovernedPromptDomainState({
    report: latest,
    priorReports: reports,
  });
}
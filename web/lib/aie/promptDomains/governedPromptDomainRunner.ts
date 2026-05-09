import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import type { ApprovedPromptDomainTemplate } from "./approvedPromptDomainTemplates";
import {
  buildPromptDomainMetricSnapshot,
  classifyPromptDomainSafety,
  evaluatePromptDomainCompatibility,
} from "./domainCompatibilityEvaluator";
import type {
  PromptDomainReport,
} from "./governedPromptDomainRegistry";

export type PromptDomainRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunPromptDomainInput = {
  domain: ApprovedPromptDomainTemplate;
  governanceApproval: boolean;
  domainIndex: number;
  totalDomains: number;
  rejectedDomainCount?: number;
} & GovernedPreviewExecutionOptions;

function resolveDependencies(overrides?: Partial<PromptDomainRunnerDependencies>): PromptDomainRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

function buildDomainFormInput(domain: ApprovedPromptDomainTemplate, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: domain.prompt,
    subject: domain.subject,
    motion_intent: domain.motion_intent,
    style: domain.style,
    duration_seconds: domain.duration_seconds,
    resolution: domain.resolution,
    continuity_priority: domain.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: domain.package_gif_preview,
  };
}

export async function runGovernedPromptDomain(
  input: RunPromptDomainInput,
  depsOverride?: Partial<PromptDomainRunnerDependencies>,
): Promise<PromptDomainReport> {
  const deps = resolveDependencies(depsOverride);
  const safety = classifyPromptDomainSafety(input.domain.prompt);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });
  const rejectedDomainCount = (input.rejectedDomainCount ?? 0) + (safety.status === "REJECTED" ? 1 : 0);

  if (safety.status === "REJECTED") {
    return {
      domainId: input.domain.id,
      domainLabel: input.domain.label,
      domainCategory: input.domain.category,
      domainIndex: input.domainIndex,
      totalDomains: input.totalDomains,
      promptTemplate: input.domain.prompt,
      safety,
      safetyStatus: "REJECTED",
      executionStatus: "FAILED",
      pass: false,
      failureReason: safety.reasons.join(" "),
      compatibility: null,
      metrics: null,
      strongestMetric: null,
      weakestMetric: null,
      failedThresholds: [],
      recommendedRuntimeLayer: null,
      rollbackVisible: false,
      rollbackRestoredDomain: false,
      rejectedDomainCount,
      diagnostics: null,
      prerequisiteBefore,
      prerequisiteAfter: prerequisiteBefore,
      microSequence: null,
      previewExecution: null,
      rollback: null,
    };
  }

  const compiledRequest = deps.compileRequest(buildDomainFormInput(input.domain, input.governanceApproval));
  const microSequence = await deps.executeMicroSequence(compiledRequest, { root: input.root, deps: input.deps });
  const previewExecution = microSequence.status === "generated"
    ? await deps.executePreview(compiledRequest, { root: input.root, deps: input.deps })
    : null;

  const diagnostics = previewExecution?.preview_diagnostics ?? microSequence.preview_diagnostics ?? prerequisiteBefore.preview_diagnostics;
  const metrics = buildPromptDomainMetricSnapshot(diagnostics ?? null);
  const compatibility = evaluatePromptDomainCompatibility(input.domain.prompt, metrics);
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failureReason = pass
    ? null
    : executionBlocked
      ? [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed prompt domain execution was blocked before preview completion."
      : compatibility.failedThresholds[0]?.reason ?? "Governed prompt domain thresholds were not met.";

  return {
    domainId: input.domain.id,
    domainLabel: input.domain.label,
    domainCategory: input.domain.category,
    domainIndex: input.domainIndex,
    totalDomains: input.totalDomains,
    promptTemplate: input.domain.prompt,
    safety,
    safetyStatus: "APPROVED",
    executionStatus: pass ? "PASSED" : "FAILED",
    pass,
    failureReason,
    compatibility,
    metrics,
    strongestMetric: compatibility.strongestMetric,
    weakestMetric: compatibility.weakestMetric,
    failedThresholds: compatibility.failedThresholds,
    recommendedRuntimeLayer: compatibility.recommendedRuntimeLayer,
    rollbackVisible: Boolean(rollback || diagnostics?.rollback_integrity_status),
    rollbackRestoredDomain: rollback?.status === "rolled_back",
    rejectedDomainCount,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}
import { compileGovernedPreviewRequest, type GovernedPreviewFormInput } from "../governedPreviewGenerationContract";
import {
  executeGovernedPreviewMicroSequenceRequest,
  executeGovernedPreviewRequest,
  readGovernedPreviewPrerequisiteState,
  rollbackGovernedPreviewSandbox,
  type GovernedPreviewExecutionOptions,
} from "../governedPreviewGeneration";
import type { ApprovedVisualStyleProfile } from "./approvedVisualStyleProfiles";
import {
  buildVisualStyleMetricSnapshot,
  evaluateVisualStyleCompatibility,
} from "./styleCompatibilityEvaluator";
import type { VisualStyleReport } from "./governedVisualStyleRegistry";

export type VisualStyleRunnerDependencies = {
  compileRequest: typeof compileGovernedPreviewRequest;
  readPrerequisiteState: typeof readGovernedPreviewPrerequisiteState;
  executeMicroSequence: typeof executeGovernedPreviewMicroSequenceRequest;
  executePreview: typeof executeGovernedPreviewRequest;
  rollbackPreviewSandbox: typeof rollbackGovernedPreviewSandbox;
};

export type RunVisualStyleInput = {
  styleProfile: ApprovedVisualStyleProfile;
  governanceApproval: boolean;
  styleIndex: number;
  totalStyles: number;
  rejectedStyleCount?: number;
} & GovernedPreviewExecutionOptions;

function resolveDependencies(overrides?: Partial<VisualStyleRunnerDependencies>): VisualStyleRunnerDependencies {
  return {
    compileRequest: overrides?.compileRequest ?? compileGovernedPreviewRequest,
    readPrerequisiteState: overrides?.readPrerequisiteState ?? readGovernedPreviewPrerequisiteState,
    executeMicroSequence: overrides?.executeMicroSequence ?? executeGovernedPreviewMicroSequenceRequest,
    executePreview: overrides?.executePreview ?? executeGovernedPreviewRequest,
    rollbackPreviewSandbox: overrides?.rollbackPreviewSandbox ?? rollbackGovernedPreviewSandbox,
  };
}

function buildStyleFormInput(styleProfile: ApprovedVisualStyleProfile, governanceApproval: boolean): GovernedPreviewFormInput {
  return {
    prompt: styleProfile.prompt,
    subject: styleProfile.subject,
    motion_intent: styleProfile.motion_intent,
    style: styleProfile.style,
    duration_seconds: styleProfile.duration_seconds,
    resolution: styleProfile.resolution,
    continuity_priority: styleProfile.continuity_priority,
    governance_approval: governanceApproval,
    package_gif_preview: styleProfile.package_gif_preview,
  };
}

export async function runGovernedVisualStyleProfile(
  input: RunVisualStyleInput,
  depsOverride?: Partial<VisualStyleRunnerDependencies>,
): Promise<VisualStyleReport> {
  const deps = resolveDependencies(depsOverride);
  const prerequisiteBefore = await deps.readPrerequisiteState({ root: input.root, deps: input.deps });
  const compiledRequest = deps.compileRequest(buildStyleFormInput(input.styleProfile, input.governanceApproval));
  const microSequence = await deps.executeMicroSequence(compiledRequest, { root: input.root, deps: input.deps });
  const previewExecution = microSequence.status === "generated"
    ? await deps.executePreview(compiledRequest, { root: input.root, deps: input.deps })
    : null;

  const diagnostics = previewExecution?.preview_diagnostics ?? microSequence.preview_diagnostics ?? prerequisiteBefore.preview_diagnostics;
  const metrics = buildVisualStyleMetricSnapshot(diagnostics ?? null);
  const compatibility = evaluateVisualStyleCompatibility(input.styleProfile.id, metrics);
  const executionBlocked = microSequence.status !== "generated" || previewExecution?.status === "blocked";
  const pass = !executionBlocked && compatibility.pass;
  const rollback = pass ? null : await deps.rollbackPreviewSandbox({ root: input.root, deps: input.deps });
  const prerequisiteAfter = previewExecution?.prerequisite_state ?? microSequence.prerequisite_state ?? prerequisiteBefore;
  const failureReason = pass
    ? null
    : executionBlocked
      ? [...microSequence.blockers, ...(previewExecution?.blockers ?? [])].join(" ") || "Governed visual style execution was blocked before preview completion."
      : compatibility.failedThresholds[0]?.reason ?? compatibility.reasons[0] ?? "Governed visual style thresholds were not met.";

  return {
    styleId: input.styleProfile.id,
    styleLabel: input.styleProfile.label,
    styleCategory: input.styleProfile.category,
    styleIndex: input.styleIndex,
    totalStyles: input.totalStyles,
    styleCharacteristics: [...input.styleProfile.characteristics],
    styleDescription: input.styleProfile.description,
    safetyStatus: compatibility.status,
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
    rollbackRestoredStyle: rollback?.status === "rolled_back",
    rejectedStyleCount: input.rejectedStyleCount ?? 0,
    diagnostics: diagnostics ?? null,
    prerequisiteBefore,
    prerequisiteAfter,
    microSequence,
    previewExecution,
    rollback,
  };
}
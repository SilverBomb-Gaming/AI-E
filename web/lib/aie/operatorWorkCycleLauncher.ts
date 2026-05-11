import { runIterativeAutonomousWorkCycle, type IterativeRetryMode, type IterativeWorkCycleCheckpoint, type IterativeWorkCycleState } from "./iterativeAutonomousWorkCycleRuntime";
import type { PatchMutationScope, PatchValidationPlan, ScopedRepoPatchRequest } from "./scopedRepoMutationRuntime";

export type OperatorWorkCycleStatus = "prepared" | "awaiting_approval" | "approved" | "running" | "completed" | "failed" | "blocked" | "interrupted" | "restored";
export type IndependentExclusiveExecutionStatus = "not_real" | "partial" | "supervised_real" | "autonomous_real";

export type OperatorWorkCycleRequest = {
  cycleRequestId: string;
  cycleIntent: string;
  targetFiles: string[];
  validationPlan: PatchValidationPlan;
  rollbackPlan: string;
  retryLimit: number;
  mutationScope: PatchMutationScope;
  requiresApproval: boolean;
  approvalStatus: "pending" | "approved" | "rejected";
  cycleStatus: OperatorWorkCycleStatus;
  proposedChanges: { filePath: string; proposedContent: string }[];
  retryMode: IterativeRetryMode;
  rollbackOnValidationFailure: boolean;
  stageHistory: IterativeWorkCycleState["completedStages"];
  checkpointHistory: IterativeWorkCycleCheckpoint[];
  summaryReport?: OperatorWorkCycleSummaryReport;
};

export type OperatorWorkCycleSummaryReport = {
  phaseId: "OPERATOR_WORK_CYCLE_LAUNCHER_PHASE1";
  cycleRequestId: string;
  cycleStatus: OperatorWorkCycleStatus;
  operationalStageCount: number;
  retryCount: number;
  rollbackCount: number;
  checkpointCount: number;
  elapsedRuntimeMs: number;
  continuationOccurred: boolean;
  iterativeLoopExecuted: boolean;
  runtimeExecutedThroughOperatorWorkflow: boolean;
  independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus;
  currentStage: string;
  completedStages: string[];
  failedStages: string[];
  validationState: string;
  blockedState?: string;
  truthfulnessLabel: "operator_workflow_executed" | "operator_workflow_partial" | "operator_workflow_blocked" | "operator_workflow_not_real";
  summary: string;
};

export type OperatorWorkCycleLaunchOptions = {
  trustedRepoRoot: string;
  enableMutation?: boolean;
  now?: () => string;
};

const activeCycles = new Map<string, OperatorWorkCycleSummaryReport>();
const checkpoints = new Map<string, IterativeWorkCycleCheckpoint[]>();

function patchRequestFromOperatorRequest(request: OperatorWorkCycleRequest): ScopedRepoPatchRequest {
  return {
    patchRequestId: `${request.cycleRequestId}-patch-1`,
    targetFiles: request.proposedChanges,
    patchIntent: request.cycleIntent,
    proposedChangesSummary: `Operator-launched bounded work cycle for ${request.cycleIntent}.`,
    riskLevel: "LOW",
    requiresApproval: request.requiresApproval,
    approvalStatus: request.approvalStatus,
    rollbackPlan: request.rollbackPlan,
    validationPlan: request.validationPlan,
    mutationScope: request.mutationScope,
    patchStatus: "prepared",
    diffPreview: "",
    validationResults: [],
    mutationTruthfulnessLabel: "preview_only_no_mutation",
  };
}

function statusFromState(state: IterativeWorkCycleState): OperatorWorkCycleStatus {
  if (state.failedStages.length > 0 && state.retryCount === 0 && state.rollbackCount === 0) {
    return "failed";
  }
  return "completed";
}

function independentStatus(request: OperatorWorkCycleRequest, state?: IterativeWorkCycleState, blocked?: string): IndependentExclusiveExecutionStatus {
  if (blocked || request.approvalStatus !== "approved") {
    return "not_real";
  }
  if (!state) {
    return "partial";
  }
  const realMutation = state.completedStages.some((stage) => stage.truthfulnessLabel === "real_mutation_stage");
  return realMutation ? "supervised_real" : "partial";
}

function summaryFor(request: OperatorWorkCycleRequest, state: IterativeWorkCycleState | undefined, blockedState?: string): OperatorWorkCycleSummaryReport {
  const status = state ? statusFromState(state) : blockedState ? "blocked" : request.approvalStatus === "approved" ? "approved" : "awaiting_approval";
  const runtimeExecutedThroughOperatorWorkflow = Boolean(state);
  const independentExclusiveExecutionStatus = independentStatus(request, state, blockedState);
  const completedStages = state?.completedStages.map((stage) => stage.stageKind) ?? [];
  const failedStages = state?.failedStages.map((stage) => stage.stageKind) ?? [];
  const validationState = state?.validationOutcomes.at(-1) ?? "No validation executed.";
  const truthfulnessLabel = blockedState
    ? "operator_workflow_blocked"
    : independentExclusiveExecutionStatus === "supervised_real"
      ? "operator_workflow_executed"
      : runtimeExecutedThroughOperatorWorkflow
        ? "operator_workflow_partial"
        : "operator_workflow_not_real";
  const summary = state
    ? `Operator workflow launched AI-E runtime for ${request.cycleIntent}. ${state.finalSummary}`
    : blockedState ?? "Operator workflow prepared a cycle request but did not execute runtime stages.";

  return {
    phaseId: "OPERATOR_WORK_CYCLE_LAUNCHER_PHASE1",
    cycleRequestId: request.cycleRequestId,
    cycleStatus: status,
    operationalStageCount: state?.operationalStageCount ?? 0,
    retryCount: state?.retryCount ?? 0,
    rollbackCount: state?.rollbackCount ?? 0,
    checkpointCount: state?.checkpointCount ?? 0,
    elapsedRuntimeMs: state?.elapsedRuntimeMs ?? 0,
    continuationOccurred: state?.continuationOccurred ?? false,
    iterativeLoopExecuted: state?.iterativeLoopExecuted ?? false,
    runtimeExecutedThroughOperatorWorkflow,
    independentExclusiveExecutionStatus,
    currentStage: state?.completedStages.at(-1)?.stageKind ?? status,
    completedStages,
    failedStages,
    validationState,
    blockedState,
    truthfulnessLabel,
    summary,
  };
}

export function prepareOperatorWorkCycleRequest(input: {
  cycleRequestId: string;
  cycleIntent: string;
  targetFiles: string[];
  proposedChanges: { filePath: string; proposedContent: string }[];
  validationPlan?: PatchValidationPlan;
  rollbackPlan: string;
  retryLimit?: number;
  mutationScope: PatchMutationScope;
  retryMode?: IterativeRetryMode;
  rollbackOnValidationFailure?: boolean;
}): OperatorWorkCycleRequest {
  return {
    cycleRequestId: input.cycleRequestId,
    cycleIntent: input.cycleIntent,
    targetFiles: [...input.targetFiles],
    validationPlan: input.validationPlan ?? { commands: [] },
    rollbackPlan: input.rollbackPlan,
    retryLimit: input.retryLimit ?? 1,
    mutationScope: { ...input.mutationScope, approvedDirectories: [...input.mutationScope.approvedDirectories], approvedFiles: [...input.mutationScope.approvedFiles] },
    requiresApproval: true,
    approvalStatus: "pending",
    cycleStatus: "prepared",
    proposedChanges: input.proposedChanges.map((change) => ({ ...change })),
    retryMode: input.retryMode ?? "supervised_retry",
    rollbackOnValidationFailure: input.rollbackOnValidationFailure ?? true,
    stageHistory: [],
    checkpointHistory: [],
  };
}

export async function launchOperatorWorkCycle(request: OperatorWorkCycleRequest, options: OperatorWorkCycleLaunchOptions): Promise<OperatorWorkCycleRequest> {
  if (request.requiresApproval && request.approvalStatus !== "approved") {
    const summaryReport = summaryFor(request, undefined, "Operator work cycle requires approval before launch.");
    return { ...request, cycleStatus: "awaiting_approval", summaryReport };
  }
  if (request.retryLimit < 0 || request.retryLimit > 2) {
    const summaryReport = summaryFor(request, undefined, "Retry limit must be between 0 and 2 for Phase 1 operator work cycles.");
    return { ...request, cycleStatus: "blocked", summaryReport };
  }

  const state = await runIterativeAutonomousWorkCycle({
    cycleId: request.cycleRequestId,
    activeWorkItem: request.cycleIntent,
    initialPatchRequest: patchRequestFromOperatorRequest(request),
    retryMode: request.retryMode,
    maxRetries: request.retryLimit,
    rollbackOnValidationFailure: request.rollbackOnValidationFailure,
    checkpointAfterEachStage: true,
  }, {
    trustedRepoRoot: options.trustedRepoRoot,
    enableMutation: options.enableMutation,
    now: options.now,
  });
  const summaryReport = summaryFor(request, state);
  activeCycles.set(request.cycleRequestId, summaryReport);
  checkpoints.set(request.cycleRequestId, state.checkpoints);

  return {
    ...request,
    cycleStatus: summaryReport.cycleStatus,
    stageHistory: state.completedStages,
    checkpointHistory: state.checkpoints,
    summaryReport,
  };
}

export function restoreOperatorWorkCycleCheckpoint(cycleRequestId: string, checkpointId?: string): OperatorWorkCycleSummaryReport | undefined {
  const cycleCheckpoints = checkpoints.get(cycleRequestId);
  const activeSummary = activeCycles.get(cycleRequestId);
  if (!cycleCheckpoints || !activeSummary) {
    return undefined;
  }
  const restoredCheckpoint = checkpointId ? cycleCheckpoints.find((checkpoint) => checkpoint.checkpointId === checkpointId) : cycleCheckpoints.at(-1);
  if (!restoredCheckpoint) {
    return undefined;
  }
  return {
    ...activeSummary,
    cycleStatus: "restored",
    currentStage: "checkpoint",
    checkpointCount: restoredCheckpoint.checkpointIndex,
    elapsedRuntimeMs: restoredCheckpoint.elapsedRuntimeMs,
    summary: `Restored checkpoint ${restoredCheckpoint.checkpointId} for ${cycleRequestId}.`,
  };
}

export function interruptOperatorWorkCycle(request: OperatorWorkCycleRequest, reason: string): OperatorWorkCycleRequest {
  const summaryReport = summaryFor(request, undefined, reason);
  const interrupted = { ...request, cycleStatus: "interrupted" as const, summaryReport: { ...summaryReport, cycleStatus: "interrupted" as const, currentStage: "interrupted" } };
  activeCycles.set(request.cycleRequestId, interrupted.summaryReport);
  return interrupted;
}
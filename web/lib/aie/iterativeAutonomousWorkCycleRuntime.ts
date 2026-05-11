import { createSupervisedPatchRetry, rollbackScopedRepoPatch, runScopedRepoPatch, type PatchValidationRunner, type ScopedRepoPatchReport, type ScopedRepoPatchRequest } from "./scopedRepoMutationRuntime";

export type IterativeWorkCycleStageKind = "inspect" | "execution" | "mutation" | "validation" | "retry" | "rollback" | "checkpoint" | "summarize";
export type IterativeWorkCycleStageStatus = "completed" | "failed" | "blocked" | "skipped";
export type IterativeRetryMode = "none" | "supervised_retry" | "automatic_retry";
export type IterativeStageTruthfulnessLabel = "real_execution_stage" | "supervised_retry" | "automatic_retry" | "blocked_retry" | "skipped_validation" | "simulated_stage" | "real_mutation_stage" | "real_rollback_stage";

export type IterativeWorkCycleStage = {
  stageId: string;
  stageKind: IterativeWorkCycleStageKind;
  status: IterativeWorkCycleStageStatus;
  timestamp: string;
  summary: string;
  truthfulnessLabel: IterativeStageTruthfulnessLabel;
};

export type IterativeWorkCycleCheckpoint = {
  checkpointId: string;
  checkpointIndex: number;
  checkpointTime: string;
  completedStages: IterativeWorkCycleStageKind[];
  failedStages: IterativeWorkCycleStageKind[];
  retryCount: number;
  rollbackCount: number;
  elapsedRuntimeMs: number;
  activeWorkItem: string;
  latestMutationSummary: string;
  validationOutcomeSummary: string;
};

export type IterativeWorkCycleInput = {
  cycleId: string;
  activeWorkItem: string;
  initialPatchRequest: ScopedRepoPatchRequest;
  retryPatchRequest?: ScopedRepoPatchRequest;
  retryMode: IterativeRetryMode;
  maxRetries: number;
  rollbackOnValidationFailure?: boolean;
  checkpointAfterEachStage?: boolean;
};

export type IterativeWorkCycleOptions = {
  trustedRepoRoot: string;
  enableMutation?: boolean;
  now?: () => string;
  validationRunner?: PatchValidationRunner;
};

export type IterativeWorkCycleState = {
  phaseId: "ITERATIVE_AUTONOMOUS_WORK_CYCLE_PHASE1";
  cycleId: string;
  activeWorkItem: string;
  completedStages: IterativeWorkCycleStage[];
  failedStages: IterativeWorkCycleStage[];
  retryHistory: ScopedRepoPatchReport[];
  rollbackHistory: ScopedRepoPatchReport[];
  checkpoints: IterativeWorkCycleCheckpoint[];
  elapsedRuntimeMs: number;
  latestMutationSummary: string;
  validationOutcomes: string[];
  retryCount: number;
  rollbackCount: number;
  checkpointCount: number;
  operationalStageCount: number;
  continuationOccurred: boolean;
  iterativeLoopExecuted: boolean;
  executionRemainedSupervised: true;
  longRunningClaimAllowed: boolean;
  truthfulnessWarnings: string[];
  finalSummary: string;
};

const longRunningThresholdMs = 60 * 60 * 1000;

function parseTime(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid iterative work cycle timestamp: ${timestamp}`);
  }
  return parsed;
}

function elapsedMs(start: string, end: string): number {
  return Math.max(0, parseTime(end) - parseTime(start));
}

function stage(stageId: string, stageKind: IterativeWorkCycleStageKind, status: IterativeWorkCycleStageStatus, timestamp: string, summary: string, truthfulnessLabel: IterativeStageTruthfulnessLabel): IterativeWorkCycleStage {
  return { stageId, stageKind, status, timestamp, summary, truthfulnessLabel };
}

function validationSummary(report: ScopedRepoPatchReport): string {
  if (report.validationResults.length === 0) {
    return "No validation commands were configured.";
  }
  return report.validationResults.map((result) => `${result.command}: ${result.status}`).join("; ");
}

function checkpoint(input: {
  cycleId: string;
  checkpointIndex: number;
  checkpointTime: string;
  startTime: string;
  activeWorkItem: string;
  completedStages: IterativeWorkCycleStage[];
  failedStages: IterativeWorkCycleStage[];
  retryCount: number;
  rollbackCount: number;
  latestMutationSummary: string;
  validationOutcomeSummary: string;
}): IterativeWorkCycleCheckpoint {
  return {
    checkpointId: `${input.cycleId}-checkpoint-${input.checkpointIndex}`,
    checkpointIndex: input.checkpointIndex,
    checkpointTime: input.checkpointTime,
    completedStages: input.completedStages.map((entry) => entry.stageKind),
    failedStages: input.failedStages.map((entry) => entry.stageKind),
    retryCount: input.retryCount,
    rollbackCount: input.rollbackCount,
    elapsedRuntimeMs: elapsedMs(input.startTime, input.checkpointTime),
    activeWorkItem: input.activeWorkItem,
    latestMutationSummary: input.latestMutationSummary,
    validationOutcomeSummary: input.validationOutcomeSummary,
  };
}

function formatElapsed(elapsedRuntimeMs: number): string {
  const totalSeconds = Math.floor(elapsedRuntimeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function buildFinalSummary(state: Omit<IterativeWorkCycleState, "finalSummary">): string {
  const duration = formatElapsed(state.elapsedRuntimeMs);
  const runtimeLabel = state.longRunningClaimAllowed ? "Longer-running multi-stage behavior is supported by this run." : "Completed rapidly; do not describe this as a long-running campaign.";
  return [
    `Completed ${state.operationalStageCount} operational stage(s) in ${duration}.`,
    `Retries: ${state.retryCount}. Rollbacks: ${state.rollbackCount}. Checkpoints: ${state.checkpointCount}.`,
    `Continuation occurred: ${state.continuationOccurred}. Iterative loop executed: ${state.iterativeLoopExecuted}.`,
    runtimeLabel,
  ].join(" ");
}

export async function runIterativeAutonomousWorkCycle(input: IterativeWorkCycleInput, options: IterativeWorkCycleOptions): Promise<IterativeWorkCycleState> {
  const now = options.now ?? (() => new Date().toISOString());
  const startTime = now();
  const completedStages: IterativeWorkCycleStage[] = [];
  const failedStages: IterativeWorkCycleStage[] = [];
  const checkpoints: IterativeWorkCycleCheckpoint[] = [];
  const retryHistory: ScopedRepoPatchReport[] = [];
  const rollbackHistory: ScopedRepoPatchReport[] = [];
  const validationOutcomes: string[] = [];
  let checkpointIndex = 0;
  let retryCount = 0;
  let rollbackCount = 0;
  let latestMutationSummary = "No mutation attempted yet.";

  function recordCheckpoint(summary: string) {
    checkpointIndex += 1;
    const checkpointTime = now();
    checkpoints.push(checkpoint({
      cycleId: input.cycleId,
      checkpointIndex,
      checkpointTime,
      startTime,
      activeWorkItem: input.activeWorkItem,
      completedStages,
      failedStages,
      retryCount,
      rollbackCount,
      latestMutationSummary,
      validationOutcomeSummary: validationOutcomes.at(-1) ?? summary,
    }));
    completedStages.push(stage(`${input.cycleId}-checkpoint-${checkpointIndex}`, "checkpoint", "completed", checkpointTime, summary, "real_execution_stage"));
  }

  completedStages.push(stage(`${input.cycleId}-inspect`, "inspect", "completed", now(), `Inspected work item '${input.activeWorkItem}' and ${input.initialPatchRequest.targetFiles.length} target file(s).`, "real_execution_stage"));
  if (input.checkpointAfterEachStage) {
    recordCheckpoint("Checkpoint after inspect stage.");
  }

  const firstReport = await runScopedRepoPatch(input.initialPatchRequest, {
    trustedRepoRoot: options.trustedRepoRoot,
    approvalStatus: input.initialPatchRequest.approvalStatus,
    enableMutation: options.enableMutation,
    validationRunner: options.validationRunner,
    now,
  });
  latestMutationSummary = firstReport.proposedChangesSummary;
  completedStages.push(stage(`${input.cycleId}-execution-1`, "execution", firstReport.blockedReason ? "blocked" : "completed", now(), firstReport.blockedReason ?? "Initial supervised patch execution completed.", firstReport.mutationTrulyExecuted ? "real_mutation_stage" : "simulated_stage"));
  if (firstReport.mutationTrulyExecuted) {
    completedStages.push(stage(`${input.cycleId}-mutation-1`, "mutation", "completed", firstReport.appliedAt ?? now(), firstReport.recommendedNextAction, "real_mutation_stage"));
  }
  const firstValidationSummary = validationSummary(firstReport);
  validationOutcomes.push(firstValidationSummary);
  if (firstReport.validationResults.length === 0 || firstReport.validationResults.every((result) => result.status === "skipped")) {
    completedStages.push(stage(`${input.cycleId}-validation-1`, "validation", "skipped", now(), firstValidationSummary, "skipped_validation"));
  } else if (firstReport.patchStatus === "validation_failed") {
    failedStages.push(stage(`${input.cycleId}-validation-1`, "validation", "failed", now(), firstValidationSummary, "real_execution_stage"));
  } else {
    completedStages.push(stage(`${input.cycleId}-validation-1`, "validation", "completed", now(), firstValidationSummary, "real_execution_stage"));
  }
  recordCheckpoint("Checkpoint after initial mutation and validation stage.");

  let latestReport = firstReport;
  if (firstReport.patchStatus === "validation_failed") {
    if (input.rollbackOnValidationFailure) {
      const rollbackReport = await rollbackScopedRepoPatch(firstReport, {
        trustedRepoRoot: options.trustedRepoRoot,
        approvedFiles: firstReport.mutationScope.approvedFiles,
        now,
      });
      rollbackHistory.push(rollbackReport);
      rollbackCount += 1;
      completedStages.push(stage(`${input.cycleId}-rollback-1`, "rollback", rollbackReport.patchStatus === "reverted" ? "completed" : "blocked", rollbackReport.revertedAt ?? now(), rollbackReport.recommendedNextAction, rollbackReport.patchStatus === "reverted" ? "real_rollback_stage" : "blocked_retry"));
      latestReport = rollbackReport;
      recordCheckpoint("Checkpoint after rollback stage.");
    }

    if (input.retryMode === "none") {
      completedStages.push(stage(`${input.cycleId}-retry-blocked`, "retry", "skipped", now(), "Retry was not configured for this supervised cycle.", "blocked_retry"));
    } else if (input.maxRetries <= 0) {
      completedStages.push(stage(`${input.cycleId}-retry-limit`, "retry", "blocked", now(), "Retry limit reached before retry execution.", "blocked_retry"));
    } else {
      const retryRequest = input.retryPatchRequest ?? createSupervisedPatchRetry(firstReport, `${input.initialPatchRequest.patchRequestId}-retry-1`, input.initialPatchRequest.targetFiles);
      retryCount += 1;
      const retryLabel = input.retryMode === "automatic_retry" ? "automatic_retry" : "supervised_retry";
      completedStages.push(stage(`${input.cycleId}-retry-1`, "retry", "completed", now(), `${input.retryMode} prepared retry patch ${retryRequest.patchRequestId}.`, retryLabel));
      const retryReport = await runScopedRepoPatch(retryRequest, {
        trustedRepoRoot: options.trustedRepoRoot,
        approvalStatus: retryRequest.approvalStatus,
        enableMutation: options.enableMutation,
        validationRunner: options.validationRunner,
        now,
      });
      retryHistory.push(retryReport);
      latestReport = retryReport;
      latestMutationSummary = retryReport.proposedChangesSummary;
      if (retryReport.mutationTrulyExecuted) {
        completedStages.push(stage(`${input.cycleId}-mutation-retry-1`, "mutation", "completed", retryReport.appliedAt ?? now(), retryReport.recommendedNextAction, "real_mutation_stage"));
      }
      const retryValidationSummary = validationSummary(retryReport);
      validationOutcomes.push(retryValidationSummary);
      if (retryReport.patchStatus === "validation_failed") {
        failedStages.push(stage(`${input.cycleId}-validation-retry-1`, "validation", "failed", now(), retryValidationSummary, "real_execution_stage"));
      } else {
        completedStages.push(stage(`${input.cycleId}-validation-retry-1`, "validation", retryReport.validationResults.every((result) => result.status === "skipped") ? "skipped" : "completed", now(), retryValidationSummary, retryReport.validationResults.every((result) => result.status === "skipped") ? "skipped_validation" : "real_execution_stage"));
      }
      recordCheckpoint("Checkpoint after supervised retry stage.");
    }
  }

  completedStages.push(stage(`${input.cycleId}-summarize`, "summarize", "completed", now(), `Latest patch status: ${latestReport.patchStatus}.`, "real_execution_stage"));
  recordCheckpoint("Final checkpoint after summary stage.");
  const endTime = now();
  const elapsedRuntimeMs = elapsedMs(startTime, endTime);
  const operationalStageCount = completedStages.length + failedStages.length;
  const continuationOccurred = checkpoints.length > 1;
  const iterativeLoopExecuted = retryCount > 0 || rollbackCount > 0;
  const longRunningClaimAllowed = elapsedRuntimeMs >= longRunningThresholdMs && operationalStageCount > 3 && iterativeLoopExecuted;
  const stateWithoutSummary: Omit<IterativeWorkCycleState, "finalSummary"> = {
    phaseId: "ITERATIVE_AUTONOMOUS_WORK_CYCLE_PHASE1",
    cycleId: input.cycleId,
    activeWorkItem: input.activeWorkItem,
    completedStages,
    failedStages,
    retryHistory,
    rollbackHistory,
    checkpoints,
    elapsedRuntimeMs,
    latestMutationSummary,
    validationOutcomes,
    retryCount,
    rollbackCount,
    checkpointCount: checkpoints.length,
    operationalStageCount,
    continuationOccurred,
    iterativeLoopExecuted,
    executionRemainedSupervised: true,
    longRunningClaimAllowed,
    truthfulnessWarnings: [
      "This Phase 1 cycle chains bounded supervised stages; it is not unattended infinite autonomy.",
      "Do not claim long-running behavior unless elapsed runtime and actual staged continuation support it.",
      "Repo mutation remains constrained by the scoped patch runtime approval, scope, rollback, and validation gates.",
    ],
  };

  return {
    ...stateWithoutSummary,
    finalSummary: buildFinalSummary(stateWithoutSummary),
  };
}
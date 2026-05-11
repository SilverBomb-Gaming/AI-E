import { launchOperatorWorkCycle, type IndependentExclusiveExecutionStatus, type OperatorWorkCycleRequest } from "./operatorWorkCycleLauncher";
import type { DurableMeaningfulLongRunCheckpoint, DurableMeaningfulLongRunRecord, DurableProjectMemoryStore } from "./durableProjectMemoryStore";

export type MeaningfulLongRunMode = "test_mode" | "supervised_mode" | "campaign_mode";

export type MeaningfulLongRunSupervisedOperationInput = {
  sessionId: string;
  projectId: string;
  mode: MeaningfulLongRunMode;
  targetRuntimeMs: number;
  checkpointIntervalMs: number;
  approvedCycleRequests: OperatorWorkCycleRequest[];
  failureLimit: number;
  meaningfulProofThresholdMs: number;
};

export type MeaningfulLongRunSupervisedOperationOptions = {
  trustedRepoRoot: string;
  durableStore: DurableProjectMemoryStore;
  enableMutation?: boolean;
};

export type MeaningfulLongRunSupervisedOperationReport = DurableMeaningfulLongRunRecord & {
  cycleIds: string[];
  validationOutcomes: string[];
  persistedToDurableMemory: boolean;
  usefulWorkLimited: boolean;
  blockedReason?: string;
};

const modeMinimums: Record<MeaningfulLongRunMode, number> = {
  test_mode: 1,
  supervised_mode: 30 * 60 * 1000,
  campaign_mode: 2 * 60 * 60 * 1000,
};

function nowMs(): number {
  return Date.now();
}

function iso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function mergeStatus(current: IndependentExclusiveExecutionStatus, next: IndependentExclusiveExecutionStatus): IndependentExclusiveExecutionStatus {
  const rank: Record<IndependentExclusiveExecutionStatus, number> = { not_real: 0, partial: 1, supervised_real: 2, autonomous_real: 3 };
  return rank[next] > rank[current] ? next : current;
}

function createCheckpoint(input: {
  sessionId: string;
  checkpointIndex: number;
  checkpointAtMs: number;
  startedAtMs: number;
  cycleCount: number;
  milestoneCount: number;
  summary: string;
}): DurableMeaningfulLongRunCheckpoint {
  return {
    checkpointId: `${input.sessionId}-checkpoint-${input.checkpointIndex}`,
    sessionId: input.sessionId,
    checkpointIndex: input.checkpointIndex,
    checkpointAt: iso(input.checkpointAtMs),
    elapsedRuntimeMs: Math.max(0, input.checkpointAtMs - input.startedAtMs),
    cycleCount: input.cycleCount,
    milestoneCount: input.milestoneCount,
    summary: input.summary,
  };
}

function blockedReport(input: MeaningfulLongRunSupervisedOperationInput, startedAtMs: number, blockedReason: string): MeaningfulLongRunSupervisedOperationReport {
  const endedAtMs = nowMs();
  return {
    phaseId: "MEANINGFUL_LONG_RUN_SUPERVISED_OPERATION_PHASE1",
    sessionId: input.sessionId,
    projectId: input.projectId,
    startedAt: iso(startedAtMs),
    endedAt: iso(endedAtMs),
    targetRuntimeMs: input.targetRuntimeMs,
    actualRuntimeMs: Math.max(0, endedAtMs - startedAtMs),
    targetRuntimeMet: false,
    mode: input.mode,
    cycleCount: 0,
    milestoneCount: 0,
    checkpointCount: 0,
    retryCount: 0,
    rollbackCount: 0,
    failureCount: 0,
    usefulWorkOccurred: false,
    meaningfulLongRunProof: false,
    stopReason: "blocked_no_cycles",
    independentExclusiveExecutionStatus: "not_real",
    truthfulnessLabel: "blocked_no_long_run",
    checkpoints: [],
    summary: blockedReason,
    cycleIds: [],
    validationOutcomes: [],
    persistedToDurableMemory: false,
    usefulWorkLimited: true,
    blockedReason,
  };
}

export async function runMeaningfulLongRunSupervisedOperation(input: MeaningfulLongRunSupervisedOperationInput, options: MeaningfulLongRunSupervisedOperationOptions): Promise<MeaningfulLongRunSupervisedOperationReport> {
  const startedAtMs = nowMs();
  if (input.targetRuntimeMs <= 0 || input.checkpointIntervalMs <= 0) {
    return blockedReport(input, startedAtMs, "Target runtime and checkpoint interval must be greater than zero.");
  }
  if (input.approvedCycleRequests.length === 0) {
    return blockedReport(input, startedAtMs, "Meaningful long-run operation requires at least one approved bounded cycle request.");
  }
  if (input.approvedCycleRequests.some((request) => request.approvalStatus !== "approved")) {
    return { ...blockedReport(input, startedAtMs, "All long-run cycle requests must be explicitly approved before execution."), stopReason: "blocked_unapproved_cycle" };
  }

  const checkpoints: DurableMeaningfulLongRunCheckpoint[] = [];
  const cycleIds: string[] = [];
  const validationOutcomes: string[] = [];
  let previousCycleId: string | undefined;
  let milestoneCount = 0;
  let retryCount = 0;
  let rollbackCount = 0;
  let failureCount = 0;
  let independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus = "not_real";
  let nextCheckpointAtMs = startedAtMs + input.checkpointIntervalMs;
  let cycleIndex = 0;
  let usefulWorkOccurred = false;
  let stopReason: DurableMeaningfulLongRunRecord["stopReason"] = "target_not_met";

  function recordCheckpoint(summary: string) {
    const checkpointAtMs = nowMs();
    checkpoints.push(createCheckpoint({
      sessionId: input.sessionId,
      checkpointIndex: checkpoints.length + 1,
      checkpointAtMs,
      startedAtMs,
      cycleCount: cycleIds.length,
      milestoneCount,
      summary,
    }));
    nextCheckpointAtMs = checkpointAtMs + input.checkpointIntervalMs;
  }

  while (nowMs() - startedAtMs < input.targetRuntimeMs) {
    if (failureCount >= input.failureLimit) {
      stopReason = "failure_limit_reached";
      break;
    }

    if (cycleIndex < input.approvedCycleRequests.length) {
      const request = input.approvedCycleRequests[cycleIndex];
      const launched = await launchOperatorWorkCycle(request, {
        trustedRepoRoot: options.trustedRepoRoot,
        enableMutation: options.enableMutation,
      });
      await options.durableStore.recordOperatorCycle(launched, previousCycleId);
      previousCycleId = launched.cycleRequestId;
      cycleIds.push(launched.cycleRequestId);
      cycleIndex += 1;
      const summary = launched.summaryReport;
      if (summary) {
        milestoneCount += summary.operationalStageCount;
        retryCount += summary.retryCount;
        rollbackCount += summary.rollbackCount;
        validationOutcomes.push(summary.validationState);
        independentExclusiveExecutionStatus = mergeStatus(independentExclusiveExecutionStatus, summary.independentExclusiveExecutionStatus);
        usefulWorkOccurred = usefulWorkOccurred || summary.independentExclusiveExecutionStatus === "supervised_real" || summary.independentExclusiveExecutionStatus === "partial";
        if (summary.cycleStatus === "failed" || summary.cycleStatus === "blocked" || summary.blockedState || summary.independentExclusiveExecutionStatus === "not_real" || launched.stageHistory.some((stage) => stage.status === "blocked" || stage.status === "failed")) {
          failureCount += 1;
        }
      } else {
        failureCount += 1;
      }
      recordCheckpoint(`Checkpoint after approved cycle ${launched.cycleRequestId}.`);
      continue;
    }

    const remainingUntilTarget = input.targetRuntimeMs - (nowMs() - startedAtMs);
    const remainingUntilCheckpoint = Math.max(0, nextCheckpointAtMs - nowMs());
    await wait(Math.min(Math.max(1, remainingUntilTarget), Math.max(1, remainingUntilCheckpoint)));
    if (nowMs() >= nextCheckpointAtMs || nowMs() - startedAtMs >= input.targetRuntimeMs) {
      recordCheckpoint("Periodic checkpoint after approved work completed; no additional approved cycle was available.");
    }
  }

  const endedAtMs = nowMs();
  const actualRuntimeMs = Math.max(0, endedAtMs - startedAtMs);
  const targetRuntimeMet = actualRuntimeMs >= input.targetRuntimeMs;
  if (stopReason !== "failure_limit_reached") {
    stopReason = targetRuntimeMet ? "target_met" : "target_not_met";
  }
  const usefulWorkLimited = cycleIds.length < 2 || !usefulWorkOccurred;
  const meaningfulLongRunProof = targetRuntimeMet && input.mode !== "test_mode" && actualRuntimeMs >= Math.max(input.meaningfulProofThresholdMs, modeMinimums[input.mode]) && usefulWorkOccurred;
  const truthfulnessLabel: DurableMeaningfulLongRunRecord["truthfulnessLabel"] = stopReason === "failure_limit_reached"
    ? "target_not_met"
    : meaningfulLongRunProof
      ? "meaningful_supervised_long_run"
      : input.mode === "test_mode"
        ? "test_mode_real_elapsed"
        : targetRuntimeMet
          ? "test_mode_real_elapsed"
          : "target_not_met";
  const report: MeaningfulLongRunSupervisedOperationReport = {
    phaseId: "MEANINGFUL_LONG_RUN_SUPERVISED_OPERATION_PHASE1",
    sessionId: input.sessionId,
    projectId: input.projectId,
    startedAt: iso(startedAtMs),
    endedAt: iso(endedAtMs),
    targetRuntimeMs: input.targetRuntimeMs,
    actualRuntimeMs,
    targetRuntimeMet,
    mode: input.mode,
    cycleCount: cycleIds.length,
    milestoneCount,
    checkpointCount: checkpoints.length,
    retryCount,
    rollbackCount,
    failureCount,
    usefulWorkOccurred,
    meaningfulLongRunProof,
    lastCheckpointAt: checkpoints.at(-1)?.checkpointAt,
    stopReason,
    independentExclusiveExecutionStatus,
    truthfulnessLabel,
    checkpoints,
    summary: `Ran ${cycleIds.length} approved supervised cycle(s) for ${actualRuntimeMs}ms against a ${input.targetRuntimeMs}ms target. Target met: ${targetRuntimeMet}. Useful work occurred: ${usefulWorkOccurred}. Meaningful long-run proof: ${meaningfulLongRunProof}.`,
    cycleIds,
    validationOutcomes,
    persistedToDurableMemory: false,
    usefulWorkLimited,
  };
  await options.durableStore.recordMeaningfulLongRunSession(report);
  return { ...report, persistedToDurableMemory: true };
}
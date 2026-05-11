import { launchOperatorWorkCycle, type IndependentExclusiveExecutionStatus, type OperatorWorkCycleRequest } from "./operatorWorkCycleLauncher";
import type { DurableActiveOperationRecord, DurableProjectMemoryStore } from "./durableProjectMemoryStore";

export type RealLongDurationActiveOperationInput = {
  sessionId: string;
  projectId: string;
  cycleRequests: OperatorWorkCycleRequest[];
  minimumRealElapsedMs: number;
  waitBetweenCyclesMs: number;
};

export type RealLongDurationActiveOperationOptions = {
  trustedRepoRoot: string;
  durableStore: DurableProjectMemoryStore;
  enableMutation?: boolean;
};

export type RealLongDurationActiveOperationReport = DurableActiveOperationRecord & {
  cycleIds: string[];
  validationOutcomes: string[];
  blockedReason?: string;
  persistedToDurableMemory: boolean;
  persistedStateFilePath: string;
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

function blockedReport(input: RealLongDurationActiveOperationInput, startedAtMs: number, blockedReason: string, storePath: string): RealLongDurationActiveOperationReport {
  const completedAtMs = nowMs();
  return {
    phaseId: "REAL_LONG_DURATION_ACTIVE_OPERATION_PHASE1",
    sessionId: input.sessionId,
    projectId: input.projectId,
    startedAt: iso(startedAtMs),
    completedAt: iso(completedAtMs),
    elapsedRuntimeMs: Math.max(0, completedAtMs - startedAtMs),
    cycleCount: 0,
    milestoneCount: 0,
    checkpointCount: 0,
    retryCount: 0,
    rollbackCount: 0,
    durableCheckpointCount: 0,
    activeAcrossMultipleRealOperationalStages: false,
    operatorApprovedContinuation: false,
    durableStateUsed: false,
    independentExclusiveExecutionStatus: "not_real",
    runtimeTruthfulnessLabel: "blocked_no_active_operation",
    summary: blockedReason,
    cycleIds: [],
    validationOutcomes: [],
    blockedReason,
    persistedToDurableMemory: false,
    persistedStateFilePath: storePath,
  };
}

export async function runRealLongDurationActiveOperation(input: RealLongDurationActiveOperationInput, options: RealLongDurationActiveOperationOptions): Promise<RealLongDurationActiveOperationReport> {
  const startedAtMs = nowMs();
  if (input.cycleRequests.length < 2) {
    return blockedReport(input, startedAtMs, "Real long-duration active operation requires at least two supervised cycle requests.", options.durableStore.stateFilePath);
  }
  if (input.minimumRealElapsedMs <= 0) {
    return blockedReport(input, startedAtMs, "Real elapsed threshold must be greater than zero; zero-duration sessions are not long-duration evidence.", options.durableStore.stateFilePath);
  }
  if (input.cycleRequests.some((request) => request.approvalStatus !== "approved")) {
    return blockedReport(input, startedAtMs, "Every cycle continuation must be explicitly operator-approved before active operation can run.", options.durableStore.stateFilePath);
  }

  let previousCycleId: string | undefined;
  let independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus = "not_real";
  const cycleIds: string[] = [];
  const validationOutcomes: string[] = [];
  let milestoneCount = 0;
  let checkpointCount = 0;
  let retryCount = 0;
  let rollbackCount = 0;

  for (const [index, request] of input.cycleRequests.entries()) {
    if (index > 0) {
      await wait(input.waitBetweenCyclesMs);
    }
    const launched = await launchOperatorWorkCycle(request, {
      trustedRepoRoot: options.trustedRepoRoot,
      enableMutation: options.enableMutation,
    });
    await options.durableStore.recordOperatorCycle(launched, previousCycleId);
    previousCycleId = launched.cycleRequestId;
    cycleIds.push(launched.cycleRequestId);
    const summary = launched.summaryReport;
    if (summary) {
      independentExclusiveExecutionStatus = mergeStatus(independentExclusiveExecutionStatus, summary.independentExclusiveExecutionStatus);
      validationOutcomes.push(summary.validationState);
      milestoneCount += summary.operationalStageCount;
      checkpointCount += summary.checkpointCount;
      retryCount += summary.retryCount;
      rollbackCount += summary.rollbackCount;
    }
  }

  const elapsedBeforeThresholdWait = nowMs() - startedAtMs;
  if (elapsedBeforeThresholdWait < input.minimumRealElapsedMs) {
    await wait(input.minimumRealElapsedMs - elapsedBeforeThresholdWait);
  }

  const completedAtMs = nowMs();
  const elapsedRuntimeMs = Math.max(0, completedAtMs - startedAtMs);
  const activeAcrossMultipleRealOperationalStages = input.cycleRequests.length > 1 && milestoneCount > input.cycleRequests.length && elapsedRuntimeMs >= input.minimumRealElapsedMs;
  const durableState = await options.durableStore.load();
  const durableCheckpointCount = durableState?.checkpointHistory.length ?? 0;
  const report: RealLongDurationActiveOperationReport = {
    phaseId: "REAL_LONG_DURATION_ACTIVE_OPERATION_PHASE1",
    sessionId: input.sessionId,
    projectId: input.projectId,
    startedAt: iso(startedAtMs),
    completedAt: iso(completedAtMs),
    elapsedRuntimeMs,
    cycleCount: cycleIds.length,
    milestoneCount,
    checkpointCount,
    retryCount,
    rollbackCount,
    durableCheckpointCount,
    activeAcrossMultipleRealOperationalStages,
    operatorApprovedContinuation: true,
    durableStateUsed: Boolean(durableState),
    independentExclusiveExecutionStatus,
    runtimeTruthfulnessLabel: "real_elapsed_supervised_active_operation",
    summary: `Ran ${cycleIds.length} operator-approved supervised cycle(s) across ${elapsedRuntimeMs}ms of real elapsed time. Checkpoints: ${checkpointCount}. Retries: ${retryCount}. Rollbacks: ${rollbackCount}. This is supervised active operation, not unattended autonomy.`,
    cycleIds,
    validationOutcomes,
    persistedToDurableMemory: false,
    persistedStateFilePath: options.durableStore.stateFilePath,
  };
  await options.durableStore.recordActiveOperationSession(report);
  return { ...report, persistedToDurableMemory: true };
}
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IndependentExclusiveExecutionStatus, OperatorWorkCycleRequest, OperatorWorkCycleSummaryReport } from "./operatorWorkCycleLauncher";
import type { IterativeWorkCycleCheckpoint } from "./iterativeAutonomousWorkCycleRuntime";

export type RuntimeTruthfulnessLabel = "local_json_file_backed_continuity" | "restored_summary_only" | "no_durable_state_found" | "blocked_no_autonomy";
export type DurablePersistenceBoundary = "local_json_file";

export type DurableRuntimeMilestone = {
  milestoneId: string;
  cycleId?: string;
  status: "completed" | "failed";
  summary: string;
  timestamp: string;
};

export type DurableRuntimeHistoryEntry = {
  entryId: string;
  cycleId?: string;
  summary: string;
  timestamp: string;
  truthfulnessLabel: string;
};

export type DurableActiveOperationRecord = {
  phaseId: "REAL_LONG_DURATION_ACTIVE_OPERATION_PHASE1";
  sessionId: string;
  projectId: string;
  startedAt: string;
  completedAt: string;
  elapsedRuntimeMs: number;
  cycleCount: number;
  milestoneCount: number;
  checkpointCount: number;
  retryCount: number;
  rollbackCount: number;
  durableCheckpointCount: number;
  activeAcrossMultipleRealOperationalStages: boolean;
  operatorApprovedContinuation: boolean;
  durableStateUsed: boolean;
  independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus;
  runtimeTruthfulnessLabel: "real_elapsed_supervised_active_operation" | "blocked_no_active_operation";
  summary: string;
};

export type DurableMeaningfulLongRunCheckpoint = {
  checkpointId: string;
  sessionId: string;
  checkpointIndex: number;
  checkpointAt: string;
  elapsedRuntimeMs: number;
  cycleCount: number;
  milestoneCount: number;
  summary: string;
};

export type DurableMeaningfulLongRunRecord = {
  phaseId: "MEANINGFUL_LONG_RUN_SUPERVISED_OPERATION_PHASE1";
  sessionId: string;
  projectId: string;
  startedAt: string;
  endedAt: string;
  targetRuntimeMs: number;
  actualRuntimeMs: number;
  targetRuntimeMet: boolean;
  mode: "test_mode" | "supervised_mode" | "campaign_mode";
  cycleCount: number;
  milestoneCount: number;
  checkpointCount: number;
  retryCount: number;
  rollbackCount: number;
  failureCount: number;
  usefulWorkOccurred: boolean;
  meaningfulLongRunProof: boolean;
  lastCheckpointAt?: string;
  stopReason: "target_met" | "failure_limit_reached" | "blocked_unapproved_cycle" | "blocked_no_cycles" | "target_not_met";
  independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus;
  truthfulnessLabel: "test_mode_real_elapsed" | "meaningful_supervised_long_run" | "blocked_no_long_run" | "target_not_met";
  checkpoints: DurableMeaningfulLongRunCheckpoint[];
  summary: string;
};

export type DurableProjectRuntimeState = {
  phaseId: "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1";
  projectId: string;
  activeCampaignId?: string;
  activeCycleId?: string;
  completedMilestones: DurableRuntimeMilestone[];
  failedMilestones: DurableRuntimeMilestone[];
  checkpointHistory: IterativeWorkCycleCheckpoint[];
  retryHistory: DurableRuntimeHistoryEntry[];
  rollbackHistory: DurableRuntimeHistoryEntry[];
  mutationHistory: DurableRuntimeHistoryEntry[];
  validationHistory: DurableRuntimeHistoryEntry[];
  executionHistory: DurableRuntimeHistoryEntry[];
  campaignSummaries: DurableRuntimeHistoryEntry[];
  activeOperationHistory: DurableActiveOperationRecord[];
  meaningfulLongRunHistory: DurableMeaningfulLongRunRecord[];
  activeWorkItems: OperatorWorkCycleRequest[];
  runtimeSummary: string;
  latestExecutionStatus: string;
  independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus;
  lastResumeTime?: string;
  lastInterruptionTime?: string;
  runtimeTruthfulnessLabel: RuntimeTruthfulnessLabel;
  persistenceBoundary: DurablePersistenceBoundary;
  persistenceLimitations: string[];
  previousCycleReferences: { cycleId: string; previousCycleId?: string; timestamp: string }[];
  totalCycleCount: number;
  cumulativeRuntimeMs: number;
  updatedAt: string;
};

export type DurableRuntimeContinuityReport = {
  phaseId: "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1";
  projectId: string;
  activeCampaignId?: string;
  activeCycleId?: string;
  totalCycleCount: number;
  cycleCountResumed: number;
  checkpointCountRestored: number;
  durableRestorationOccurred: boolean;
  checkpointRecoveryOccurred: boolean;
  interruptionRecoveryOccurred: boolean;
  runtimeContinuitySurvivedRestart: boolean;
  cumulativeRuntimeMs: number;
  latestExecutionStatus: string;
  independentExclusiveExecutionStatus: IndependentExclusiveExecutionStatus;
  runtimeTruthfulnessLabel: RuntimeTruthfulnessLabel;
  persistenceBoundary: DurablePersistenceBoundary;
  persistenceLimitations: string[];
  safelyResumable: boolean;
  blockedReason?: string;
  summary: string;
};

export type DurableProjectMemoryStore = {
  stateFilePath: string;
  load: () => Promise<DurableProjectRuntimeState | undefined>;
  save: (state: DurableProjectRuntimeState) => Promise<DurableProjectRuntimeState>;
  recordOperatorCycle: (request: OperatorWorkCycleRequest, previousCycleId?: string) => Promise<DurableProjectRuntimeState>;
  recordInterruption: (request: OperatorWorkCycleRequest, reason: string) => Promise<DurableProjectRuntimeState>;
  recordActiveOperationSession: (record: DurableActiveOperationRecord) => Promise<DurableProjectRuntimeState>;
  recordMeaningfulLongRunSession: (record: DurableMeaningfulLongRunRecord) => Promise<DurableProjectRuntimeState>;
  restoreRuntimeContinuity: (now?: () => string) => Promise<DurableRuntimeContinuityReport>;
};

function sanitizeProjectId(projectId: string): string {
  return projectId.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80) || "default-project";
}

function stateFilePath(storageRoot: string, projectId: string): string {
  return path.join(storageRoot, `${sanitizeProjectId(projectId)}.runtime-state.json`);
}

function defaultLimitations(): string[] {
  return [
    "Persistence is local JSON file-backed state for this repo/runtime only.",
    "It is not cloud persistence, distributed orchestration, or a persistent background agent.",
    "Restoration resumes summaries and safely bounded requests only; execution still requires operator approval and scoped runtime gates.",
  ];
}

export function createInitialDurableProjectRuntimeState(projectId: string, now: () => string = () => new Date().toISOString()): DurableProjectRuntimeState {
  const timestamp = now();
  return {
    phaseId: "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1",
    projectId,
    completedMilestones: [],
    failedMilestones: [],
    checkpointHistory: [],
    retryHistory: [],
    rollbackHistory: [],
    mutationHistory: [],
    validationHistory: [],
    executionHistory: [],
    campaignSummaries: [],
    activeOperationHistory: [],
    meaningfulLongRunHistory: [],
    activeWorkItems: [],
    runtimeSummary: "No durable runtime history has been recorded yet.",
    latestExecutionStatus: "no_durable_state",
    independentExclusiveExecutionStatus: "not_real",
    runtimeTruthfulnessLabel: "local_json_file_backed_continuity",
    persistenceBoundary: "local_json_file",
    persistenceLimitations: defaultLimitations(),
    previousCycleReferences: [],
    totalCycleCount: 0,
    cumulativeRuntimeMs: 0,
    updatedAt: timestamp,
  };
}

async function loadState(filePath: string): Promise<DurableProjectRuntimeState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as DurableProjectRuntimeState;
    if (parsed.phaseId !== "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1") {
      return undefined;
    }
    return { ...parsed, activeOperationHistory: parsed.activeOperationHistory ?? [], meaningfulLongRunHistory: parsed.meaningfulLongRunHistory ?? [] };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function saveState(filePath: string, state: DurableProjectRuntimeState): Promise<DurableProjectRuntimeState> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

function history(entryId: string, cycleId: string | undefined, summary: string, timestamp: string, truthfulnessLabel: string): DurableRuntimeHistoryEntry {
  return { entryId, cycleId, summary, timestamp, truthfulnessLabel };
}

function mergedIndependentStatus(current: IndependentExclusiveExecutionStatus, next: IndependentExclusiveExecutionStatus): IndependentExclusiveExecutionStatus {
  const rank: Record<IndependentExclusiveExecutionStatus, number> = { not_real: 0, partial: 1, supervised_real: 2, autonomous_real: 3 };
  return rank[next] > rank[current] ? next : current;
}

function buildRuntimeSummary(state: DurableProjectRuntimeState): string {
  return [
    `Durable local runtime state for ${state.projectId}: ${state.totalCycleCount} cycle(s), ${state.checkpointHistory.length} checkpoint(s), ${state.retryHistory.length} retry record(s), ${state.rollbackHistory.length} rollback record(s).`,
    `Active operation sessions: ${state.activeOperationHistory.length}. Meaningful long-run sessions: ${state.meaningfulLongRunHistory.length}.`,
    `Latest execution status: ${state.latestExecutionStatus}. Independent status: ${state.independentExclusiveExecutionStatus}.`,
    "Continuity is local JSON-backed and supervised; no unattended background agent or autonomous_real execution is claimed.",
  ].join(" ");
}

function applyOperatorCycle(state: DurableProjectRuntimeState, request: OperatorWorkCycleRequest, timestamp: string, previousCycleId?: string): DurableProjectRuntimeState {
  const summary = request.summaryReport;
  const completedMilestones = summary?.completedStages.map((stageKind, index) => ({
    milestoneId: `${request.cycleRequestId}-${stageKind}-${index + 1}`,
    cycleId: request.cycleRequestId,
    status: "completed" as const,
    summary: `${stageKind} completed for ${request.cycleIntent}.`,
    timestamp,
  })) ?? [];
  const failedMilestones = summary?.failedStages.map((stageKind, index) => ({
    milestoneId: `${request.cycleRequestId}-${stageKind}-failed-${index + 1}`,
    cycleId: request.cycleRequestId,
    status: "failed" as const,
    summary: `${stageKind} failed for ${request.cycleIntent}.`,
    timestamp,
  })) ?? [];
  const validationSummary = summary?.validationState ?? "No validation state recorded.";
  const nextState: DurableProjectRuntimeState = {
    ...state,
    activeCampaignId: state.activeCampaignId ?? `campaign-${state.projectId}`,
    activeCycleId: request.cycleRequestId,
    completedMilestones: [...state.completedMilestones, ...completedMilestones],
    failedMilestones: [...state.failedMilestones, ...failedMilestones],
    checkpointHistory: [...state.checkpointHistory, ...request.checkpointHistory],
    retryHistory: summary && summary.retryCount > 0 ? [...state.retryHistory, history(`${request.cycleRequestId}-retry`, request.cycleRequestId, `${summary.retryCount} retry stage(s) recorded.`, timestamp, summary.truthfulnessLabel)] : state.retryHistory,
    rollbackHistory: summary && summary.rollbackCount > 0 ? [...state.rollbackHistory, history(`${request.cycleRequestId}-rollback`, request.cycleRequestId, `${summary.rollbackCount} rollback stage(s) recorded.`, timestamp, summary.truthfulnessLabel)] : state.rollbackHistory,
    mutationHistory: summary ? [...state.mutationHistory, history(`${request.cycleRequestId}-mutation`, request.cycleRequestId, `Mutation status: ${summary.independentExclusiveExecutionStatus}.`, timestamp, summary.truthfulnessLabel)] : state.mutationHistory,
    validationHistory: summary ? [...state.validationHistory, history(`${request.cycleRequestId}-validation`, request.cycleRequestId, validationSummary, timestamp, summary.truthfulnessLabel)] : state.validationHistory,
    executionHistory: summary ? [...state.executionHistory, history(`${request.cycleRequestId}-execution`, request.cycleRequestId, summary.summary, timestamp, summary.truthfulnessLabel)] : state.executionHistory,
    campaignSummaries: summary ? [...state.campaignSummaries, history(`${request.cycleRequestId}-campaign-summary`, request.cycleRequestId, summary.summary, timestamp, summary.truthfulnessLabel)] : state.campaignSummaries,
    activeWorkItems: [...state.activeWorkItems.filter((entry) => entry.cycleRequestId !== request.cycleRequestId), request],
    latestExecutionStatus: request.cycleStatus,
    independentExclusiveExecutionStatus: summary ? mergedIndependentStatus(state.independentExclusiveExecutionStatus, summary.independentExclusiveExecutionStatus) : state.independentExclusiveExecutionStatus,
    previousCycleReferences: [...state.previousCycleReferences, { cycleId: request.cycleRequestId, previousCycleId, timestamp }],
    totalCycleCount: state.previousCycleReferences.some((entry) => entry.cycleId === request.cycleRequestId) ? state.totalCycleCount : state.totalCycleCount + 1,
    cumulativeRuntimeMs: state.cumulativeRuntimeMs + (summary?.elapsedRuntimeMs ?? 0),
    updatedAt: timestamp,
  };
  return { ...nextState, runtimeSummary: buildRuntimeSummary(nextState) };
}

function reportFor(state: DurableProjectRuntimeState | undefined, timestamp: string): DurableRuntimeContinuityReport {
  if (!state) {
    return {
      phaseId: "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1",
      projectId: "unknown",
      totalCycleCount: 0,
      cycleCountResumed: 0,
      checkpointCountRestored: 0,
      durableRestorationOccurred: false,
      checkpointRecoveryOccurred: false,
      interruptionRecoveryOccurred: false,
      runtimeContinuitySurvivedRestart: false,
      cumulativeRuntimeMs: 0,
      latestExecutionStatus: "no_durable_state",
      independentExclusiveExecutionStatus: "not_real",
      runtimeTruthfulnessLabel: "no_durable_state_found",
      persistenceBoundary: "local_json_file",
      persistenceLimitations: defaultLimitations(),
      safelyResumable: false,
      blockedReason: "No local durable runtime state file was found.",
      summary: "No durable runtime state exists yet, so AI-E cannot truthfully restore a previous campaign.",
    };
  }
  const checkpointCountRestored = state.checkpointHistory.length;
  const interruptionRecoveryOccurred = Boolean(state.lastInterruptionTime);
  const safelyResumable = state.activeWorkItems.length > 0 && state.latestExecutionStatus !== "blocked" && state.latestExecutionStatus !== "failed";
  return {
    phaseId: "DURABLE_PROJECT_MEMORY_AND_MULTI_CYCLE_RUNTIME_PHASE1",
    projectId: state.projectId,
    activeCampaignId: state.activeCampaignId,
    activeCycleId: state.activeCycleId,
    totalCycleCount: state.totalCycleCount,
    cycleCountResumed: state.totalCycleCount,
    checkpointCountRestored,
    durableRestorationOccurred: true,
    checkpointRecoveryOccurred: checkpointCountRestored > 0,
    interruptionRecoveryOccurred,
    runtimeContinuitySurvivedRestart: true,
    cumulativeRuntimeMs: state.cumulativeRuntimeMs,
    latestExecutionStatus: state.latestExecutionStatus,
    independentExclusiveExecutionStatus: state.independentExclusiveExecutionStatus,
    runtimeTruthfulnessLabel: interruptionRecoveryOccurred ? "restored_summary_only" : state.runtimeTruthfulnessLabel,
    persistenceBoundary: state.persistenceBoundary,
    persistenceLimitations: state.persistenceLimitations,
    safelyResumable,
    blockedReason: safelyResumable ? undefined : "No safely resumable approved work item is available from durable state.",
    summary: `Restored local durable state at ${timestamp}. ${state.runtimeSummary}`,
  };
}

export function createFileBackedDurableProjectMemoryStore(input: { storageRoot: string; projectId: string; now?: () => string }): DurableProjectMemoryStore {
  const now = input.now ?? (() => new Date().toISOString());
  const filePath = stateFilePath(input.storageRoot, input.projectId);
  return {
    stateFilePath: filePath,
    load: () => loadState(filePath),
    save: (state) => saveState(filePath, { ...state, updatedAt: now() }),
    recordOperatorCycle: async (request, previousCycleId) => {
      const existing = await loadState(filePath) ?? createInitialDurableProjectRuntimeState(input.projectId, now);
      return saveState(filePath, applyOperatorCycle(existing, request, now(), previousCycleId));
    },
    recordInterruption: async (request, reason) => {
      const existing = await loadState(filePath) ?? createInitialDurableProjectRuntimeState(input.projectId, now);
      const timestamp = now();
      const interrupted: DurableProjectRuntimeState = {
        ...existing,
        activeCycleId: request.cycleRequestId,
        activeWorkItems: [...existing.activeWorkItems.filter((entry) => entry.cycleRequestId !== request.cycleRequestId), request],
        latestExecutionStatus: "interrupted",
        lastInterruptionTime: timestamp,
        executionHistory: [...existing.executionHistory, history(`${request.cycleRequestId}-interrupted`, request.cycleRequestId, reason, timestamp, "blocked_no_autonomy")],
        updatedAt: timestamp,
      };
      return saveState(filePath, { ...interrupted, runtimeSummary: buildRuntimeSummary(interrupted) });
    },
    recordActiveOperationSession: async (record) => {
      const existing = await loadState(filePath) ?? createInitialDurableProjectRuntimeState(input.projectId, now);
      const timestamp = now();
      const nextState: DurableProjectRuntimeState = {
        ...existing,
        activeCampaignId: existing.activeCampaignId ?? `campaign-${existing.projectId}`,
        latestExecutionStatus: record.runtimeTruthfulnessLabel === "real_elapsed_supervised_active_operation" ? "active_operation_completed" : "active_operation_blocked",
        independentExclusiveExecutionStatus: mergedIndependentStatus(existing.independentExclusiveExecutionStatus, record.independentExclusiveExecutionStatus),
        activeOperationHistory: [...existing.activeOperationHistory, record],
        campaignSummaries: [...existing.campaignSummaries, history(`${record.sessionId}-active-operation`, existing.activeCycleId, record.summary, timestamp, record.runtimeTruthfulnessLabel)],
        cumulativeRuntimeMs: existing.cumulativeRuntimeMs + record.elapsedRuntimeMs,
        updatedAt: timestamp,
      };
      return saveState(filePath, { ...nextState, runtimeSummary: buildRuntimeSummary(nextState) });
    },
    recordMeaningfulLongRunSession: async (record) => {
      const existing = await loadState(filePath) ?? createInitialDurableProjectRuntimeState(input.projectId, now);
      const timestamp = now();
      const nextState: DurableProjectRuntimeState = {
        ...existing,
        activeCampaignId: existing.activeCampaignId ?? `campaign-${existing.projectId}`,
        latestExecutionStatus: record.stopReason,
        independentExclusiveExecutionStatus: mergedIndependentStatus(existing.independentExclusiveExecutionStatus, record.independentExclusiveExecutionStatus),
        meaningfulLongRunHistory: [...existing.meaningfulLongRunHistory, record],
        campaignSummaries: [...existing.campaignSummaries, history(`${record.sessionId}-meaningful-long-run`, existing.activeCycleId, record.summary, timestamp, record.truthfulnessLabel)],
        cumulativeRuntimeMs: existing.cumulativeRuntimeMs + record.actualRuntimeMs,
        updatedAt: timestamp,
      };
      return saveState(filePath, { ...nextState, runtimeSummary: buildRuntimeSummary(nextState) });
    },
    restoreRuntimeContinuity: async (overrideNow) => {
      const timestamp = (overrideNow ?? now)();
      const existing = await loadState(filePath);
      if (!existing) {
        return reportFor(undefined, timestamp);
      }
      const resumed = { ...existing, lastResumeTime: timestamp, updatedAt: timestamp };
      await saveState(filePath, resumed);
      return reportFor(resumed, timestamp);
    },
  };
}
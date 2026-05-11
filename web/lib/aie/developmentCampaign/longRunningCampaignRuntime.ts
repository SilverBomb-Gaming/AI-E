export type CampaignRuntimeStatus =
  | "running"
  | "checkpointed"
  | "resuming"
  | "recovering"
  | "stabilizing"
  | "cooldown"
  | "blocked"
  | "interrupted";

export type CampaignCheckpointPersistenceScope = "in_memory_only" | "durable" | "partial_persistence";

export type CampaignRuntimeHistoryEntry = {
  iteration: number;
  timestamp: string;
  activeLayer: string;
  runtimeStatus: CampaignRuntimeStatus;
  summary: string;
};

export type CampaignRuntimeResultRecord = {
  timestamp: string;
  passed: boolean;
  summary: string;
};

export type CampaignRuntimeFailure = {
  timestamp: string;
  layerId: string;
  recoverable: boolean;
  summary: string;
};

export type CampaignRuntimeRecovery = {
  timestamp: string;
  layerId: string;
  summary: string;
};

export type CampaignRuntimeMetrics = {
  totalRuntimeMs: number;
  layerCompletionVelocityPerHour: number;
  testPassHistory: CampaignRuntimeResultRecord[];
  buildHistory: CampaignRuntimeResultRecord[];
  rollbackHistory: CampaignRuntimeResultRecord[];
  failureFrequency: number;
  interruptionCount: number;
};

export type CampaignRuntimeState = {
  layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1";
  campaignStartTime: string;
  lastCheckpointTime: string;
  elapsedRuntimeMs: number;
  completedLayerCount: number;
  completedLayers: string[];
  activeLayer: string;
  queuedLayers: string[];
  blockedLayers: string[];
  runtimeStatus: CampaignRuntimeStatus;
  runtimeIteration: number;
  lastFailure?: CampaignRuntimeFailure;
  lastRecovery?: CampaignRuntimeRecovery;
  nextSuggestedAction: string;
  iterationHistory: CampaignRuntimeHistoryEntry[];
  previousLayerHistory: string[];
  metrics: CampaignRuntimeMetrics;
  checkpointPersistenceScope: CampaignCheckpointPersistenceScope;
  truthfulnessWarnings: string[];
};

export type CampaignRuntimeCheckpoint = {
  checkpointId: string;
  checkpointTime: string;
  persistenceScope: CampaignCheckpointPersistenceScope;
  persistenceLabel: string;
  state: CampaignRuntimeState;
  continuationMetadata: {
    resumeActiveLayer: string;
    resumeIteration: number;
    continueExistingCampaign: true;
    restartFromScratch: false;
    elapsedRuntimeMs: number;
  };
};

export type CampaignRuntimeInput = {
  campaignStartTime: string;
  now: string;
  completedLayers: string[];
  activeLayer: string;
  queuedLayers: string[];
  blockedLayers: string[];
  runtimeStatus?: CampaignRuntimeStatus;
  runtimeIteration?: number;
  testPassHistory?: CampaignRuntimeResultRecord[];
  buildHistory?: CampaignRuntimeResultRecord[];
  rollbackHistory?: CampaignRuntimeResultRecord[];
  failures?: CampaignRuntimeFailure[];
  interruptionCount?: number;
  checkpointPersistenceScope?: CampaignCheckpointPersistenceScope;
};

export type CampaignRuntimeContinuationDecision = {
  decision: "continue_existing_campaign" | "recover_then_continue" | "checkpoint_and_stabilize" | "cooldown_before_retry" | "blocked_waiting_for_dependency";
  runtimeStatus: CampaignRuntimeStatus;
  retryAfterMs?: number;
  nextSuggestedAction: string;
  truthfulnessLabel: string;
};

const hourMs = 60 * 60 * 1000;

function parseTime(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid campaign runtime timestamp: ${value}`);
  }
  return timestamp;
}

function elapsedMs(start: string, now: string): number {
  return Math.max(0, parseTime(now) - parseTime(start));
}

function runtimeTruthfulnessWarnings(scope: CampaignCheckpointPersistenceScope): string[] {
  return [
    "Long-running campaign runtime Phase 1 models continuity, checkpoints, and resume decisions; it does not create a background agent or unattended shell controller.",
    `Checkpoint persistence scope is ${scope}; do not describe it as stronger persistence than that label allows.`,
    "Runtime continuation prefers existing campaign state over restart, but execution and repo mutation still require separate approved paths.",
  ];
}

function persistenceLabel(scope: CampaignCheckpointPersistenceScope): string {
  if (scope === "durable") {
    return "durable checkpoint metadata";
  }
  if (scope === "partial_persistence") {
    return "partial persistence checkpoint metadata";
  }
  return "in-memory-only checkpoint metadata";
}

export function formatElapsedCampaignRuntime(elapsedRuntimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedRuntimeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}h ${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatCampaignRuntimeTimestamp(timestamp: string, timezoneLabel = "UTC"): string {
  const date = new Date(parseTime(timestamp));
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hours = `${date.getUTCHours()}`.padStart(2, "0");
  const minutes = `${date.getUTCMinutes()}`.padStart(2, "0");
  const seconds = `${date.getUTCSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${timezoneLabel}`;
}

export function createCampaignRuntimeState(input: CampaignRuntimeInput): CampaignRuntimeState {
  const elapsedRuntimeMs = elapsedMs(input.campaignStartTime, input.now);
  const failures = input.failures ?? [];
  const checkpointPersistenceScope = input.checkpointPersistenceScope ?? "in_memory_only";
  const runtimeIteration = input.runtimeIteration ?? 1;
  const completedLayerCount = input.completedLayers.length;
  const layerCompletionVelocityPerHour = elapsedRuntimeMs > 0 ? completedLayerCount / (elapsedRuntimeMs / hourMs) : 0;
  const runtimeStatus = input.runtimeStatus ?? "running";

  return {
    layerId: "LONG_RUNNING_CAMPAIGN_RUNTIME_PHASE1",
    campaignStartTime: input.campaignStartTime,
    lastCheckpointTime: input.now,
    elapsedRuntimeMs,
    completedLayerCount,
    completedLayers: [...input.completedLayers],
    activeLayer: input.activeLayer,
    queuedLayers: [...input.queuedLayers],
    blockedLayers: [...input.blockedLayers],
    runtimeStatus,
    runtimeIteration,
    lastFailure: failures.at(-1),
    nextSuggestedAction: input.blockedLayers.includes(input.activeLayer)
      ? "Checkpoint current state, summarize blocker, and wait for dependency recovery."
      : "Continue the existing campaign from the active layer without restarting from scratch.",
    iterationHistory: [{
      iteration: runtimeIteration,
      timestamp: input.now,
      activeLayer: input.activeLayer,
      runtimeStatus,
      summary: "Runtime state initialized or refreshed from current campaign context.",
    }],
    previousLayerHistory: [...input.completedLayers],
    metrics: {
      totalRuntimeMs: elapsedRuntimeMs,
      layerCompletionVelocityPerHour,
      testPassHistory: [...(input.testPassHistory ?? [])],
      buildHistory: [...(input.buildHistory ?? [])],
      rollbackHistory: [...(input.rollbackHistory ?? [])],
      failureFrequency: elapsedRuntimeMs > 0 ? failures.length / (elapsedRuntimeMs / hourMs) : failures.length,
      interruptionCount: input.interruptionCount ?? 0,
    },
    checkpointPersistenceScope,
    truthfulnessWarnings: runtimeTruthfulnessWarnings(checkpointPersistenceScope),
  };
}

export function checkpointCampaignRuntime(state: CampaignRuntimeState, checkpointTime: string, persistenceScope: CampaignCheckpointPersistenceScope): CampaignRuntimeCheckpoint {
  const elapsedRuntimeMs = elapsedMs(state.campaignStartTime, checkpointTime);
  const checkpointedState: CampaignRuntimeState = {
    ...state,
    lastCheckpointTime: checkpointTime,
    elapsedRuntimeMs,
    runtimeStatus: "checkpointed",
    checkpointPersistenceScope: persistenceScope,
    metrics: {
      ...state.metrics,
      totalRuntimeMs: elapsedRuntimeMs,
    },
    iterationHistory: [
      ...state.iterationHistory,
      {
        iteration: state.runtimeIteration,
        timestamp: checkpointTime,
        activeLayer: state.activeLayer,
        runtimeStatus: "checkpointed",
        summary: "Campaign runtime checkpoint captured for resumable continuation.",
      },
    ],
    truthfulnessWarnings: runtimeTruthfulnessWarnings(persistenceScope),
  };

  return {
    checkpointId: `campaign-runtime-${state.runtimeIteration}-${parseTime(checkpointTime)}`,
    checkpointTime,
    persistenceScope,
    persistenceLabel: persistenceLabel(persistenceScope),
    state: checkpointedState,
    continuationMetadata: {
      resumeActiveLayer: checkpointedState.activeLayer,
      resumeIteration: checkpointedState.runtimeIteration + 1,
      continueExistingCampaign: true,
      restartFromScratch: false,
      elapsedRuntimeMs,
    },
  };
}

export function resumeCampaignRuntime(checkpoint: CampaignRuntimeCheckpoint, now: string): CampaignRuntimeState {
  const resumedIteration = checkpoint.continuationMetadata.resumeIteration;
  const elapsedRuntimeMs = elapsedMs(checkpoint.state.campaignStartTime, now);

  return {
    ...checkpoint.state,
    lastCheckpointTime: checkpoint.checkpointTime,
    elapsedRuntimeMs,
    runtimeStatus: "resuming",
    runtimeIteration: resumedIteration,
    nextSuggestedAction: `Resume ${checkpoint.continuationMetadata.resumeActiveLayer} from checkpoint ${checkpoint.checkpointId}; do not restart campaign planning from scratch.`,
    iterationHistory: [
      ...checkpoint.state.iterationHistory,
      {
        iteration: resumedIteration,
        timestamp: now,
        activeLayer: checkpoint.continuationMetadata.resumeActiveLayer,
        runtimeStatus: "resuming",
        summary: "Runtime resumed from checkpoint and preserved previous-layer history.",
      },
    ],
    metrics: {
      ...checkpoint.state.metrics,
      totalRuntimeMs: elapsedRuntimeMs,
    },
  };
}

export function decideCampaignRuntimeContinuation(state: CampaignRuntimeState): CampaignRuntimeContinuationDecision {
  const recentFailures = state.lastFailure ? 1 : 0;
  const latestBuildFailed = state.metrics.buildHistory.at(-1)?.passed === false;
  const latestTestsFailed = state.metrics.testPassHistory.at(-1)?.passed === false;

  if (state.blockedLayers.includes(state.activeLayer)) {
    return {
      decision: "blocked_waiting_for_dependency",
      runtimeStatus: "blocked",
      nextSuggestedAction: "Checkpoint, summarize the active blocker, and continue only after the dependency is unblocked.",
      truthfulnessLabel: "blocked-state routing only; no execution performed",
    };
  }
  if (latestBuildFailed || latestTestsFailed || recentFailures > 0) {
    return {
      decision: "checkpoint_and_stabilize",
      runtimeStatus: "stabilizing",
      retryAfterMs: 0,
      nextSuggestedAction: "Checkpoint, summarize the failure, stabilize the runtime state, then continue safely.",
      truthfulnessLabel: "recoverable failure handling only; no autonomous shell control claimed",
    };
  }
  if (state.runtimeStatus === "cooldown") {
    return {
      decision: "cooldown_before_retry",
      runtimeStatus: "cooldown",
      retryAfterMs: 60_000,
      nextSuggestedAction: "Wait for cooldown before retrying the active layer continuation.",
      truthfulnessLabel: "scheduled retry metadata only; no background worker is running",
    };
  }

  return {
    decision: "continue_existing_campaign",
    runtimeStatus: "running",
    nextSuggestedAction: "Continue the existing campaign from the active layer and preserve progression history.",
    truthfulnessLabel: "planning/runtime continuation only; no unattended execution claimed",
  };
}

export function recordCampaignRuntimeRecovery(state: CampaignRuntimeState, recovery: CampaignRuntimeRecovery): CampaignRuntimeState {
  return {
    ...state,
    runtimeStatus: "recovering",
    lastRecovery: recovery,
    nextSuggestedAction: "Recovery recorded; checkpoint and continue the active campaign layer when validation is stable.",
    iterationHistory: [
      ...state.iterationHistory,
      {
        iteration: state.runtimeIteration,
        timestamp: recovery.timestamp,
        activeLayer: recovery.layerId,
        runtimeStatus: "recovering",
        summary: recovery.summary,
      },
    ],
  };
}

export function buildCampaignRuntimeSummary(state: CampaignRuntimeState, now: string, timezoneLabel = "UTC"): string {
  return [
    formatCampaignRuntimeTimestamp(now, timezoneLabel),
    `Elapsed campaign runtime: ${formatElapsedCampaignRuntime(elapsedMs(state.campaignStartTime, now))}`,
    `Runtime status: ${state.runtimeStatus}`,
    `Iteration: ${state.runtimeIteration}`,
    `Active layer: ${state.activeLayer}`,
    `Completed layers: ${state.completedLayerCount}`,
    `Next suggested action: ${state.nextSuggestedAction}`,
    "Truthfulness: runtime continuation is modeled and checkpointed only; it is not unattended execution or autonomous shell control.",
  ].join("\n");
}
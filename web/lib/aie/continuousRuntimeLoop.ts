import {
  DEFAULT_RUNTIME_PROFILE_NAME,
  resolveRuntimeProfile,
  summarizeRuntimeProfile,
  type RuntimeProfile,
} from "./runtimeProfiles";
import {
  cloneRuntimeStateRecord,
  loadRuntimeState,
  persistRuntimeStateRecord,
  type ContinuousLoopStateRecord,
  type ContinuousLoopStatus,
  type ContinuousLoopTickHistoryEntry,
  type RuntimeStateRecord,
  type RuntimeStateStore,
} from "./runtimeStateStore";
import {
  runExecutionLoopController,
  type ExecutionLoopControllerResult,
} from "./executionLoopController";
import type { BackgroundSessionQueue } from "./backgroundSessionQueue";
import type { SafeRuntimeIntent } from "./safeRuntimeActionBridge";

export type ContinuousRuntimeLoopClock = {
  nextTickTime(): string;
};

export type ContinuousRuntimeLoopConfig = {
  runtime_id: string;
  profile_name?: string;
  tick_interval_ms?: number;
  max_ticks_per_run?: number;
  max_runs_per_invocation?: number;
  dry_run_mode?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
  stop_on_blocker?: boolean;
  stop_on_error?: boolean;
  started_at?: string;
  runtime_intent?: SafeRuntimeIntent;
  goal_id?: string | null;
  existing_queue?: BackgroundSessionQueue | null;
};

export type LoadedContinuousRuntimeLoopConfig = RuntimeProfile & {
  runtime_id: string;
  started_at: string;
  runtime_intent: SafeRuntimeIntent;
  goal_id: string | null;
};

export type ContinuousRuntimeLoopResult = {
  status: ContinuousLoopStatus;
  config: LoadedContinuousRuntimeLoopConfig;
  runtime_state: RuntimeStateRecord | null;
  last_queue: BackgroundSessionQueue | null;
  reason: string;
  ticks: ContinuousLoopTickHistoryEntry[];
  summary: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseTimestamp(value: string | null | undefined): number | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildTickId(runtimeId: string, attemptedAt: string): string {
  return `continuous-runtime-loop-tick-${sanitizeTimestamp(attemptedAt)}-${runtimeId}`;
}

function cloneContinuousLoopState(state: ContinuousLoopStateRecord | null | undefined): ContinuousLoopStateRecord {
  if (!state) {
    return {
      status: "loop_stopped",
      started_at: null,
      stopped_at: null,
      last_tick_at: null,
      ticks_attempted: 0,
      ticks_completed: 0,
      last_trigger_result: null,
      reason: "Continuous runtime loop has not started yet.",
      tick_history: [],
    };
  }

  return JSON.parse(JSON.stringify(state)) as ContinuousLoopStateRecord;
}

function mapLoopStatusToServiceStatus(status: ContinuousLoopStatus): RuntimeStateRecord["last_status"] {
  switch (status) {
    case "loop_running":
      return "service_running";
    case "loop_completed":
      return "service_completed";
    case "loop_blocked":
    case "loop_error":
      return "service_blocked";
    case "loop_paused":
      return "service_paused";
    case "loop_stopped":
    default:
      return "service_stopped";
  }
}

function mapLoopStatusToStopReason(status: ContinuousLoopStatus): RuntimeStateRecord["stop_reason"] {
  switch (status) {
    case "loop_completed":
      return "completed_without_work";
    case "loop_blocked":
      return "blocker_detected";
    case "loop_error":
      return "error_detected";
    case "loop_paused":
      return "operator_stopped";
    case "loop_stopped":
      return "max_ticks_reached";
    case "loop_running":
    default:
      return "not_started";
  }
}

function buildErrorSummary(config: LoadedContinuousRuntimeLoopConfig, reason: string): string {
  return [
    `Continuous runtime loop status: loop_error`,
    `Runtime id: ${config.runtime_id}`,
    `Reason: ${reason}`,
    summarizeRuntimeProfile(config),
  ].join("\n");
}

function buildResult(
  config: LoadedContinuousRuntimeLoopConfig,
  status: ContinuousLoopStatus,
  runtimeState: RuntimeStateRecord | null,
  reason: string,
  lastQueue: BackgroundSessionQueue | null,
): ContinuousRuntimeLoopResult {
  const ticks = runtimeState?.continuous_loop?.tick_history ?? [];
  return {
    status,
    config,
    runtime_state: runtimeState,
    last_queue: lastQueue,
    reason,
    ticks,
    summary: runtimeState
      ? summarizeContinuousRuntimeLoop({
        status,
        config,
        runtime_state: runtimeState,
        last_queue: lastQueue,
        reason,
        ticks,
        summary: "",
      })
      : buildErrorSummary(config, reason),
  };
}

export function loadContinuousRuntimeLoopConfig(input: ContinuousRuntimeLoopConfig): LoadedContinuousRuntimeLoopConfig {
  const profile = resolveRuntimeProfile(
    input.profile_name ?? DEFAULT_RUNTIME_PROFILE_NAME,
    {
      tick_interval_ms: input.tick_interval_ms,
      max_ticks_per_run: input.max_ticks_per_run,
      max_runs_per_invocation: input.max_runs_per_invocation,
      dry_run_mode: input.dry_run_mode,
      require_fresh_approvals: input.require_fresh_approvals,
      require_fresh_context: input.require_fresh_context,
      stop_on_blocker: input.stop_on_blocker,
      stop_on_error: input.stop_on_error,
    },
  );

  return {
    ...profile,
    runtime_id: normalizeText(input.runtime_id),
    started_at: input.started_at ?? new Date().toISOString(),
    runtime_intent: input.runtime_intent ?? "no_op",
    goal_id: input.goal_id ?? null,
  };
}

export function createContinuousRuntimeLoopClock(
  startedAt: string,
  tickIntervalMs: number,
): ContinuousRuntimeLoopClock {
  const baseTime = parseTimestamp(startedAt) ?? Date.UTC(2026, 0, 1);
  let tickIndex = 0;

  return {
    nextTickTime() {
      const tickTime = new Date(baseTime + (tickIndex * tickIntervalMs)).toISOString();
      tickIndex += 1;
      return tickTime;
    },
  };
}

function evaluateStopCondition(record: RuntimeStateRecord): { status: ContinuousLoopStatus; reason: string } | null {
  const state = record.operator_dashboard_state;
  if (!state) {
    return {
      status: "loop_error",
      reason: "No persisted operator dashboard state is available for the continuous runtime loop.",
    };
  }

  if (record.last_status === "service_paused") {
    return {
      status: "loop_paused",
      reason: "Continuous runtime loop paused because the runtime record is already paused.",
    };
  }

  if (state.validation_issues.length > 0) {
    return {
      status: "loop_blocked",
      reason: "Continuous runtime loop stopped because validation failed and requires operator review.",
    };
  }

  if (state.approvals_required.length > 0) {
    return {
      status: "loop_paused",
      reason: "Continuous runtime loop paused because fresh approval is required before the next execution cycle.",
    };
  }

  if (!state.active_goal && state.queued_goals.length === 0) {
    if (state.blocked_goals.length > 0) {
      return {
        status: "loop_blocked",
        reason: "Continuous runtime loop stopped because only blocked goals remain.",
      };
    }

    if (state.paused_goals.length > 0) {
      return {
        status: "loop_paused",
        reason: "Continuous runtime loop paused because only paused goals remain.",
      };
    }

    return {
      status: "loop_completed",
      reason: "Continuous runtime loop completed because no runnable goals remain.",
    };
  }

  return null;
}

function appendBlocker(record: RuntimeStateRecord, code: string, message: string) {
  if (record.blockers.some((blocker) => blocker.code === code && blocker.message === message)) {
    return;
  }
  record.blockers = [...record.blockers, { code, message }];
}

function applyExecutionResult(
  record: RuntimeStateRecord,
  loopState: ContinuousLoopStateRecord,
  config: LoadedContinuousRuntimeLoopConfig,
  attemptedAt: string,
  tickIndex: number,
  execution: ExecutionLoopControllerResult,
): RuntimeStateRecord {
  const nextRecord = cloneRuntimeStateRecord(record);
  const tickHistoryEntry: ContinuousLoopTickHistoryEntry = {
    tick_id: buildTickId(config.runtime_id, attemptedAt),
    attempted_at: attemptedAt,
    tick_index: tickIndex,
    status: execution.status === "loop_blocked" ? "loop_blocked" : "loop_running",
    triggered: execution.triggered,
    run_results_recorded: execution.queue_result ? 1 : 0,
    reason: execution.reason,
  };

  nextRecord.operator_dashboard_state = execution.updated_dashboard_state;
  nextRecord.last_tick_at = attemptedAt;
  nextRecord.persisted_at = attemptedAt;
  nextRecord.ticks_attempted += 1;
  nextRecord.ticks_completed += execution.triggered ? 1 : 0;
  nextRecord.last_trigger_result = {
    status: execution.status,
    reason: execution.reason,
    triggered: execution.triggered,
    run_results_recorded: execution.queue_result ? 1 : 0,
  };
  nextRecord.continuous_loop = {
    ...loopState,
    status: tickHistoryEntry.status,
    started_at: loopState.started_at ?? attemptedAt,
    stopped_at: null,
    last_tick_at: attemptedAt,
    ticks_attempted: loopState.ticks_attempted + 1,
    ticks_completed: loopState.ticks_completed + (execution.triggered ? 1 : 0),
    last_trigger_result: {
      status: tickHistoryEntry.status,
      reason: execution.reason,
      triggered: execution.triggered,
      run_results_recorded: execution.queue_result ? 1 : 0,
    },
    reason: execution.reason,
    tick_history: [...loopState.tick_history, tickHistoryEntry],
  };

  if (execution.status === "loop_blocked") {
    appendBlocker(nextRecord, "continuous_loop_blocked", execution.reason);
  }

  return nextRecord;
}

function finalizeRecord(
  record: RuntimeStateRecord,
  status: ContinuousLoopStatus,
  reason: string,
  stoppedAt: string,
): RuntimeStateRecord {
  const nextRecord = cloneRuntimeStateRecord(record);
  nextRecord.last_status = mapLoopStatusToServiceStatus(status);
  nextRecord.stop_reason = mapLoopStatusToStopReason(status);
  nextRecord.last_started_at = nextRecord.last_started_at ?? stoppedAt;
  nextRecord.last_stopped_at = stoppedAt;
  nextRecord.persisted_at = stoppedAt;
  nextRecord.continuous_loop = {
    ...cloneContinuousLoopState(nextRecord.continuous_loop),
    status,
    started_at: nextRecord.continuous_loop?.started_at ?? nextRecord.last_started_at ?? stoppedAt,
    stopped_at: stoppedAt,
    last_tick_at: nextRecord.continuous_loop?.last_tick_at ?? nextRecord.last_tick_at,
    ticks_attempted: nextRecord.continuous_loop?.ticks_attempted ?? 0,
    ticks_completed: nextRecord.continuous_loop?.ticks_completed ?? 0,
    last_trigger_result: nextRecord.continuous_loop?.last_trigger_result ?? null,
    reason,
    tick_history: nextRecord.continuous_loop?.tick_history ?? [],
  };

  if (status === "loop_error") {
    appendBlocker(nextRecord, "continuous_loop_error", reason);
  }

  if (status === "loop_completed" || status === "loop_paused" || status === "loop_stopped") {
    nextRecord.blockers = nextRecord.blockers.filter((blocker) =>
      blocker.code !== "continuous_loop_blocked" && blocker.code !== "continuous_loop_error");
  }

  return nextRecord;
}

export function runContinuousRuntimeLoop(
  store: RuntimeStateStore,
  input: ContinuousRuntimeLoopConfig,
  clock?: ContinuousRuntimeLoopClock,
): ContinuousRuntimeLoopResult {
  const config = loadContinuousRuntimeLoopConfig(input);
  const runtimeId = normalizeText(config.runtime_id);

  if (!runtimeId) {
    return buildResult(config, "loop_error", null, "A runtime id is required before the continuous runtime loop can start.", input.existing_queue ?? null);
  }

  const persistedRecord = loadRuntimeState(store, runtimeId);
  if (!persistedRecord) {
    return buildResult(config, "loop_error", null, "No persisted runtime state record was found for the continuous runtime loop.", input.existing_queue ?? null);
  }

  if (config.dry_run_mode) {
    const pausedRecord = finalizeRecord(persistedRecord, "loop_paused", "Dry-run mode validated the continuous runtime loop configuration without starting loop ticks.", config.started_at);
    persistRuntimeStateRecord(store, pausedRecord);
    return buildResult(config, "loop_paused", pausedRecord, pausedRecord.continuous_loop?.reason ?? "Dry-run mode enabled.", input.existing_queue ?? null);
  }

  const loopClock = clock ?? createContinuousRuntimeLoopClock(config.started_at, config.tick_interval_ms);

  try {
    let currentRecord = cloneRuntimeStateRecord(persistedRecord);
    let loopState = cloneContinuousLoopState(currentRecord.continuous_loop);
    let finalStatus: ContinuousLoopStatus = "loop_running";
    let finalReason = "Continuous runtime loop is running bounded execution cycles.";
    let stoppedAt = config.started_at;
    let existingQueue: BackgroundSessionQueue | null = input.existing_queue ?? null;

    for (let tickIndex = 1; tickIndex <= config.max_ticks_per_run; tickIndex += 1) {
      const stopBeforeTick = evaluateStopCondition(currentRecord);
      if (stopBeforeTick) {
        finalStatus = stopBeforeTick.status;
        finalReason = stopBeforeTick.reason;
        stoppedAt = currentRecord.last_tick_at ?? config.started_at;
        break;
      }

      const attemptedAt = loopClock.nextTickTime();
      const previousTickMs = parseTimestamp(loopState.last_tick_at);
      const attemptedAtMs = parseTimestamp(attemptedAt);
      if (previousTickMs !== null && attemptedAtMs !== null && (attemptedAtMs - previousTickMs) < config.tick_interval_ms) {
        finalStatus = "loop_stopped";
        finalReason = "Continuous runtime loop stopped because the configured tick interval has not elapsed for the next bounded cycle.";
        stoppedAt = loopState.last_tick_at ?? attemptedAt;
        break;
      }

      const execution = runExecutionLoopController({
        runtime_intent: tickIndex === 1 ? config.runtime_intent : "no_op",
        dashboard_state: currentRecord.operator_dashboard_state!,
        timestamp: attemptedAt,
        goal_id: tickIndex === 1 ? config.goal_id : null,
        max_sessions_per_run: config.max_runs_per_invocation,
        force_continuation: true,
        require_fresh_approvals: config.require_fresh_approvals,
        require_fresh_context: config.require_fresh_context,
        existing_queue: existingQueue,
      });

      currentRecord = applyExecutionResult(currentRecord, loopState, config, attemptedAt, tickIndex, execution);
      currentRecord.last_started_at = currentRecord.last_started_at ?? attemptedAt;
      currentRecord.last_status = "service_running";
      loopState = cloneContinuousLoopState(currentRecord.continuous_loop);
      existingQueue = execution.queue_result?.queue ?? existingQueue;
      stoppedAt = attemptedAt;
      persistRuntimeStateRecord(store, currentRecord);

      if (execution.status === "loop_blocked" && config.stop_on_blocker) {
        finalStatus = "loop_blocked";
        finalReason = execution.reason;
        break;
      }

      const stopAfterTick = evaluateStopCondition(currentRecord);
      if (stopAfterTick) {
        finalStatus = stopAfterTick.status;
        finalReason = stopAfterTick.reason;
        break;
      }

      if (tickIndex === config.max_ticks_per_run) {
        finalStatus = "loop_stopped";
        finalReason = "Continuous runtime loop stopped because the configured max tick bound was reached.";
      }
    }

    const finalizedRecord = finalizeRecord(currentRecord, finalStatus, finalReason, stoppedAt);
    persistRuntimeStateRecord(store, finalizedRecord);
    return buildResult(config, finalStatus, finalizedRecord, finalReason, existingQueue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedRecord = finalizeRecord(persistedRecord, "loop_error", message, config.started_at);
    persistRuntimeStateRecord(store, failedRecord);
    return buildResult(config, "loop_error", failedRecord, message, input.existing_queue ?? null);
  }
}

export function summarizeContinuousRuntimeLoop(result: ContinuousRuntimeLoopResult): string {
  const loopState = result.runtime_state?.continuous_loop;
  return [
    `Continuous runtime loop status: ${result.status}`,
    `Runtime id: ${result.config.runtime_id}`,
    `Ticks attempted: ${loopState?.ticks_attempted ?? 0}`,
    `Ticks completed: ${loopState?.ticks_completed ?? 0}`,
    `Last tick at: ${loopState?.last_tick_at ?? "none"}`,
    `Reason: ${result.reason}`,
    summarizeRuntimeProfile(result.config),
  ].join("\n");
}
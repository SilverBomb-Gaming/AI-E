import {
  createTimeTrigger,
  runTimeTriggeredCycle,
  type TimeTriggerResult,
  type TimeTriggerState,
} from "./timeBasedRuntimeTrigger";
import type { BackgroundRunHistory } from "./backgroundRunHistory";
import type { BackgroundSessionQueue } from "./backgroundSessionQueue";

export type BackgroundRuntimeServiceStatus =
  | "service_idle"
  | "service_running"
  | "service_paused"
  | "service_stopped"
  | "service_blocked"
  | "service_completed";

export type BackgroundRuntimeServiceStopReason =
  | "not_started"
  | "max_ticks_reached"
  | "operator_stopped"
  | "blocker_detected"
  | "error_detected"
  | "completed_without_work";

export type BackgroundRuntimeServiceConfig = {
  tick_interval_ms: number;
  max_ticks_per_run: number;
  max_runs_per_invocation?: number;
  stop_on_blocker?: boolean;
  stop_on_error?: boolean;
  operator_away_mode?: boolean;
  require_supervised_scope?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
};

export type BackgroundRuntimeClock = {
  nextTickTime(): string;
};

export type BackgroundRuntimeTickResult = {
  tick_id: string;
  attempted_at: string;
  tick_index: number;
  status: TimeTriggerResult["status"];
  triggered: boolean;
  queue_runs_recorded: number;
  reason: string;
  trigger_result: TimeTriggerResult;
};

export type BackgroundRuntimeServiceState = {
  service_id: string;
  created_at: string;
  started_at: string | null;
  stopped_at: string | null;
  status: BackgroundRuntimeServiceStatus;
  ticks_attempted: number;
  ticks_completed: number;
  last_tick_at: string | null;
  last_trigger_result: TimeTriggerResult | null;
  tick_history: BackgroundRuntimeTickResult[];
  stop_reason: BackgroundRuntimeServiceStopReason;
  blockers: Array<{ code: string; message: string }>;
  config: {
    tick_interval_ms: number;
    max_ticks_per_run: number;
    max_runs_per_invocation: number;
    stop_on_blocker: boolean;
    stop_on_error: boolean;
    operator_away_mode: boolean;
    require_supervised_scope: boolean;
    require_fresh_approvals: boolean;
    require_fresh_context: boolean;
  };
  trigger_state: TimeTriggerState;
};

export type BackgroundRuntimeServiceResult = {
  status: BackgroundRuntimeServiceStatus;
  service: BackgroundRuntimeServiceState;
  queue: BackgroundSessionQueue;
  history: BackgroundRunHistory;
  tick_result: BackgroundRuntimeTickResult | null;
  reason: string;
};

function normalizeConfig(config: BackgroundRuntimeServiceConfig): BackgroundRuntimeServiceState["config"] {
  return {
    tick_interval_ms: Math.max(1, Math.floor(config.tick_interval_ms)),
    max_ticks_per_run: Math.max(1, Math.floor(config.max_ticks_per_run)),
    max_runs_per_invocation: Math.max(1, Math.floor(config.max_runs_per_invocation ?? 1)),
    stop_on_blocker: config.stop_on_blocker !== false,
    stop_on_error: config.stop_on_error !== false,
    operator_away_mode: config.operator_away_mode !== false,
    require_supervised_scope: config.require_supervised_scope !== false,
    require_fresh_approvals: config.require_fresh_approvals !== false,
    require_fresh_context: config.require_fresh_context !== false,
  };
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function buildServiceId(config: BackgroundRuntimeServiceState["config"]): string {
  return [
    "background-runtime-service",
    String(config.tick_interval_ms),
    String(config.max_ticks_per_run),
    String(config.max_runs_per_invocation),
    config.stop_on_blocker ? "stop-blocker" : "continue-blocker",
    config.operator_away_mode ? "away" : "local",
  ].join("-");
}

function cloneService(service: BackgroundRuntimeServiceState): BackgroundRuntimeServiceState {
  return {
    ...service,
    blockers: service.blockers.map((blocker) => ({ ...blocker })),
    tick_history: [...service.tick_history],
    config: { ...service.config },
    trigger_state: { ...service.trigger_state, config: { ...service.trigger_state.config } },
  };
}

function hasBlockingQueueResult(triggerResult: TimeTriggerResult): boolean {
  return triggerResult.run_results.some((result) => result.status === "queue_blocked");
}

function collectBlockers(triggerResult: TimeTriggerResult): Array<{ code: string; message: string }> {
  return triggerResult.run_results.flatMap((result) =>
    result.blockers.map((blocker) => ({
      code: blocker.code,
      message: blocker.message,
    })),
  );
}

function createTickResult(service: BackgroundRuntimeServiceState, triggerResult: TimeTriggerResult): BackgroundRuntimeTickResult {
  return {
    tick_id: `background-runtime-tick-${sanitizeTimestamp(triggerResult.now)}-${service.service_id}`,
    attempted_at: triggerResult.now,
    tick_index: service.ticks_attempted + 1,
    status: triggerResult.status,
    triggered: triggerResult.triggered,
    queue_runs_recorded: triggerResult.run_results.length,
    reason: triggerResult.reason,
    trigger_result: triggerResult,
  };
}

export function createBackgroundRuntimeService(config: BackgroundRuntimeServiceConfig): BackgroundRuntimeServiceState {
  const normalized = normalizeConfig(config);
  return {
    service_id: buildServiceId(normalized),
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    started_at: null,
    stopped_at: null,
    status: "service_idle",
    ticks_attempted: 0,
    ticks_completed: 0,
    last_tick_at: null,
    last_trigger_result: null,
    tick_history: [],
    stop_reason: "not_started",
    blockers: [],
    config: normalized,
    trigger_state: createTimeTrigger({
      interval_ms: normalized.tick_interval_ms,
      max_runs_per_invocation: normalized.max_runs_per_invocation,
      allow_empty_runs: false,
      require_fresh_approvals: normalized.require_fresh_approvals,
      require_fresh_context: normalized.require_fresh_context,
    }),
  };
}

export function runBackgroundRuntimeTick(
  service: BackgroundRuntimeServiceState,
  queue: BackgroundSessionQueue,
  history: BackgroundRunHistory,
  now: string,
): BackgroundRuntimeServiceResult {
  const nextService = cloneService(service);
  nextService.status = "service_running";
  nextService.started_at = nextService.started_at ?? now;

  const triggerResult = runTimeTriggeredCycle(nextService.trigger_state, queue, history, now);
  const tickResult = createTickResult(nextService, triggerResult);
  const blockers = collectBlockers(triggerResult);

  const updatedService: BackgroundRuntimeServiceState = {
    ...nextService,
    ticks_attempted: nextService.ticks_attempted + 1,
    ticks_completed: nextService.ticks_completed + 1,
    last_tick_at: now,
    last_trigger_result: triggerResult,
    tick_history: [...nextService.tick_history, tickResult],
    blockers: [...nextService.blockers, ...blockers],
    trigger_state: triggerResult.state,
  };

  if (hasBlockingQueueResult(triggerResult) && updatedService.config.stop_on_blocker) {
    const blockedService: BackgroundRuntimeServiceState = {
      ...updatedService,
      status: "service_blocked",
      stopped_at: now,
      stop_reason: "blocker_detected",
    };
    return {
      status: blockedService.status,
      service: blockedService,
      queue: triggerResult.queue,
      history: triggerResult.history,
      tick_result: tickResult,
      reason: "Background runtime service stopped because a blocking queue result was detected.",
    };
  }

  return {
    status: updatedService.status,
    service: updatedService,
    queue: triggerResult.queue,
    history: triggerResult.history,
    tick_result: tickResult,
    reason: tickResult.reason,
  };
}

export function startBackgroundRuntimeService(
  service: BackgroundRuntimeServiceState,
  queue: BackgroundSessionQueue,
  history: BackgroundRunHistory,
  clock: BackgroundRuntimeClock,
): BackgroundRuntimeServiceResult {
  let serviceState = cloneService(service);
  let nextQueue = queue;
  let nextHistory = history;
  let lastTick: BackgroundRuntimeTickResult | null = null;

  serviceState.status = "service_running";

  while (serviceState.ticks_attempted < serviceState.config.max_ticks_per_run) {
    const now = clock.nextTickTime();
    const tick = runBackgroundRuntimeTick(serviceState, nextQueue, nextHistory, now);
    serviceState = tick.service;
    nextQueue = tick.queue;
    nextHistory = tick.history;
    lastTick = tick.tick_result;

    if (serviceState.status === "service_blocked") {
      return {
        status: serviceState.status,
        service: serviceState,
        queue: nextQueue,
        history: nextHistory,
        tick_result: lastTick,
        reason: tick.reason,
      };
    }
  }

  const hasTriggeredWork = serviceState.tick_history.some((tick) => tick.triggered);
  const completedService: BackgroundRuntimeServiceState = {
    ...serviceState,
    status: "service_completed",
    stopped_at: serviceState.last_tick_at,
    stop_reason: hasTriggeredWork ? "max_ticks_reached" : "completed_without_work",
  };
  return {
    status: completedService.status,
    service: completedService,
    queue: nextQueue,
    history: nextHistory,
    tick_result: lastTick,
    reason: hasTriggeredWork
      ? "Background runtime service completed its bounded tick run."
      : "Background runtime service completed without recording queue work during this bounded tick run.",
  };
}

export function stopBackgroundRuntimeService(
  service: BackgroundRuntimeServiceState,
  reason: BackgroundRuntimeServiceStopReason,
): BackgroundRuntimeServiceState {
  return {
    ...cloneService(service),
    status: "service_stopped",
    stopped_at: service.last_tick_at ?? service.started_at ?? service.created_at,
    stop_reason: reason,
  };
}

export function summarizeBackgroundRuntimeService(service: BackgroundRuntimeServiceState): string {
  return [
    `Service status: ${service.status}`,
    `Ticks attempted: ${service.ticks_attempted}/${service.config.max_ticks_per_run}`,
    `Ticks completed: ${service.ticks_completed}`,
    `Max runs per invocation: ${service.config.max_runs_per_invocation}`,
    `Require fresh approvals: ${service.config.require_fresh_approvals}`,
    `Require fresh context: ${service.config.require_fresh_context}`,
    `Last tick at: ${service.last_tick_at ?? "none"}`,
    `Stop reason: ${service.stop_reason}`,
    `Tick history entries: ${service.tick_history.length}`,
  ].join("\n");
}
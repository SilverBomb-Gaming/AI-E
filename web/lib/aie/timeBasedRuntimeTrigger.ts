import {
  appendBackgroundRunRecord,
  type BackgroundRunHistory,
} from "./backgroundRunHistory";
import {
  runBackgroundSessionQueue,
  type BackgroundQueueResult,
  type BackgroundSessionQueue,
} from "./backgroundSessionQueue";

export type TimeTriggerStatus =
  | "trigger_idle"
  | "trigger_waiting"
  | "trigger_running"
  | "trigger_skipped"
  | "trigger_completed";

export type TimeTriggerConfig = {
  interval_ms: number;
  max_runs_per_invocation: number;
  allow_empty_runs?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
};

export type TimeTriggerState = {
  config: {
    interval_ms: number;
    max_runs_per_invocation: number;
    allow_empty_runs: boolean;
    require_fresh_approvals: boolean;
    require_fresh_context: boolean;
  };
  last_run_at: string | null;
  runs_executed: number;
  last_result: TimeTriggerResult | null;
  trigger_status: TimeTriggerStatus;
};

export type TimeTriggerResult = {
  status: TimeTriggerStatus;
  triggered: boolean;
  now: string;
  state: TimeTriggerState;
  queue: BackgroundSessionQueue;
  history: BackgroundRunHistory;
  run_results: BackgroundQueueResult[];
  reason: string;
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

function normalizeConfig(config: TimeTriggerConfig): TimeTriggerState["config"] {
  return {
    interval_ms: Math.max(1, Math.floor(config.interval_ms)),
    max_runs_per_invocation: Math.max(1, Math.floor(config.max_runs_per_invocation)),
    allow_empty_runs: config.allow_empty_runs === true,
    require_fresh_approvals: config.require_fresh_approvals !== false,
    require_fresh_context: config.require_fresh_context !== false,
  };
}

function cloneState(state: TimeTriggerState): TimeTriggerState {
  return {
    ...state,
    config: { ...state.config },
    last_result: state.last_result,
  };
}

export function createTimeTrigger(config: TimeTriggerConfig): TimeTriggerState {
  return {
    config: normalizeConfig(config),
    last_run_at: null,
    runs_executed: 0,
    last_result: null,
    trigger_status: "trigger_idle",
  };
}

export function shouldTriggerRun(state: TimeTriggerState, now: string): boolean {
  const currentMs = parseTimestamp(now);
  const lastRunMs = parseTimestamp(state.last_run_at);
  if (currentMs === null) {
    return false;
  }
  if (lastRunMs === null) {
    return true;
  }
  return currentMs - lastRunMs >= state.config.interval_ms;
}

export function updateTriggerState(state: TimeTriggerState, result: TimeTriggerResult): TimeTriggerState {
  return {
    ...cloneState(result.state),
    last_result: result,
  };
}

export function runTimeTriggeredCycle(
  state: TimeTriggerState,
  queue: BackgroundSessionQueue,
  history: BackgroundRunHistory,
  now: string,
): TimeTriggerResult {
  const nextState = cloneState(state);
  const currentNow = normalizeText(now);
  if (!shouldTriggerRun(nextState, currentNow)) {
    const skippedState: TimeTriggerState = {
      ...nextState,
      trigger_status: nextState.last_run_at === null ? "trigger_waiting" : "trigger_skipped",
    };
    const skippedResult: TimeTriggerResult = {
      status: skippedState.trigger_status,
      triggered: false,
      now: currentNow,
      state: skippedState,
      queue,
      history,
      run_results: [],
      reason: nextState.last_run_at === null
        ? "Trigger is waiting for a valid scheduled invocation time."
        : "The configured interval has not elapsed since the last background run.",
    };
    return updateResultReference(skippedResult);
  }

  let nextQueue = queue;
  let nextHistory = history;
  const runResults: BackgroundQueueResult[] = [];
  let runsExecutedThisInvocation = 0;

  while (runsExecutedThisInvocation < nextState.config.max_runs_per_invocation) {
    const queueResult = runBackgroundSessionQueue(nextQueue);
    const queueHasWork = queueResult.sessions_considered > 0 || queueResult.sessions_run > 0;
    if (!nextState.config.allow_empty_runs && !queueHasWork) {
      break;
    }

    runResults.push(queueResult);
    nextHistory = appendBackgroundRunRecord(nextHistory, queueResult);
    nextQueue = queueResult.queue;
    runsExecutedThisInvocation += 1;

    if (queueResult.status !== "queue_running") {
      break;
    }
  }

  const completedState: TimeTriggerState = {
    ...nextState,
    last_run_at: currentNow,
    runs_executed: nextState.runs_executed + runResults.length,
    trigger_status: runResults.length > 0 ? "trigger_completed" : "trigger_skipped",
  };

  const result: TimeTriggerResult = {
    status: runResults.length > 0 ? "trigger_completed" : "trigger_skipped",
    triggered: runResults.length > 0,
    now: currentNow,
    state: completedState,
    queue: nextQueue,
    history: nextHistory,
    run_results: runResults,
    reason: runResults.length > 0
      ? `Time trigger executed ${runResults.length} bounded background queue run${runResults.length === 1 ? "" : "s"}.`
      : "The interval elapsed, but no bounded background queue run was recorded under the current trigger policy.",
  };
  return updateResultReference(result);
}

function updateResultReference(result: TimeTriggerResult): TimeTriggerResult {
  const stateWithResult: TimeTriggerState = {
    ...result.state,
    last_result: result,
  };
  return {
    ...result,
    state: stateWithResult,
  };
}

export function summarizeTrigger(result: TimeTriggerResult): string {
  return [
    `Trigger status: ${result.status}`,
    `Triggered: ${result.triggered}`,
    `Runs this cycle: ${result.run_results.length}`,
    `Total runs executed: ${result.state.runs_executed}`,
    `Last run at: ${result.state.last_run_at ?? "none"}`,
    `Reason: ${result.reason}`,
  ].join("\n");
}
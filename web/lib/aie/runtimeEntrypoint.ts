import {
  buildOperatorAwayDigest,
  createBackgroundRunHistory,
  summarizeOperatorAwayDigest,
  type BackgroundRunHistory,
  type OperatorAwayDigest,
} from "./backgroundRunHistory";
import {
  createBackgroundRuntimeService,
  startBackgroundRuntimeService,
  summarizeBackgroundRuntimeService,
  type BackgroundRuntimeClock,
  type BackgroundRuntimeServiceResult,
  type BackgroundRuntimeServiceState,
} from "./backgroundRuntimeService";
import {
  createBackgroundSessionQueue,
  summarizeBackgroundQueue,
  type BackgroundQueueResult,
  type BackgroundSessionQueue,
} from "./backgroundSessionQueue";

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_TICKS_PER_RUN = 3;
const DEFAULT_MAX_RUNS_PER_INVOCATION = 1;
const DEFAULT_MAX_SESSIONS_PER_RUN = 1;
const DEFAULT_MAX_CYCLES_PER_SESSION = 1;
const DEFAULT_STARTED_AT = "2026-04-25T00:00:00.000Z";

export type RuntimeEntrypointConfig = {
  tick_interval_ms?: number;
  max_ticks_per_run?: number;
  max_runs_per_invocation?: number;
  operator_away_mode?: boolean;
  require_supervised_scope?: boolean;
  dry_run_mode?: boolean;
  started_at?: string;
};

export type LoadedRuntimeEntrypointConfig = {
  tick_interval_ms: number;
  max_ticks_per_run: number;
  max_runs_per_invocation: number;
  operator_away_mode: boolean;
  require_supervised_scope: boolean;
  dry_run_mode: boolean;
  started_at: string;
};

export type RuntimeEntrypointStatus =
  | "entrypoint_completed"
  | "entrypoint_blocked"
  | "entrypoint_paused";

export type RuntimeEntrypointDependencies = {
  queue?: BackgroundSessionQueue;
  history?: BackgroundRunHistory;
  clock?: BackgroundRuntimeClock;
  summaryWriter?: (summary: string) => void;
};

export type RuntimeEntrypointResult = {
  status: RuntimeEntrypointStatus;
  config: LoadedRuntimeEntrypointConfig;
  service: BackgroundRuntimeServiceState;
  service_result: BackgroundRuntimeServiceResult | null;
  queue: BackgroundSessionQueue;
  history: BackgroundRunHistory;
  digest: OperatorAwayDigest;
  reason: string;
  summary: string;
};

function readOptionalNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  return Number(trimmed);
}

function readOptionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid runtime entrypoint boolean value: ${raw}`);
}

function resolveNumber(override: number | undefined, envValue: string | undefined, fallback: number): number {
  return override ?? readOptionalNumber(envValue) ?? fallback;
}

function resolveBoolean(override: boolean | undefined, envValue: string | undefined, fallback: boolean): boolean {
  return override ?? readOptionalBoolean(envValue) ?? fallback;
}

function validatePositiveInteger(value: number, field: keyof LoadedRuntimeEntrypointConfig): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid runtime entrypoint config: ${field} must be a finite positive integer.`);
  }
  return value;
}

function createEntrypointClock(config: LoadedRuntimeEntrypointConfig): BackgroundRuntimeClock {
  const baseTime = Date.parse(config.started_at);
  const startMs = Number.isNaN(baseTime) ? Date.parse(DEFAULT_STARTED_AT) : baseTime;
  let tickIndex = 0;

  return {
    nextTickTime() {
      const tickTime = new Date(startMs + (tickIndex * config.tick_interval_ms)).toISOString();
      tickIndex += 1;
      return tickTime;
    },
  };
}

function createDefaultQueue(config: LoadedRuntimeEntrypointConfig): BackgroundSessionQueue {
  return createBackgroundSessionQueue({
    max_sessions_per_run: DEFAULT_MAX_SESSIONS_PER_RUN,
    max_cycles_per_session: DEFAULT_MAX_CYCLES_PER_SESSION,
    skip_blocked_sessions: false,
    stop_on_first_failure: true,
    operator_away_mode: config.operator_away_mode,
    require_fresh_approvals: config.require_supervised_scope,
    require_fresh_context: config.require_supervised_scope,
  });
}

function buildLatestQueueSummary(result: RuntimeEntrypointResult): string | null {
  const latestQueueResult: BackgroundQueueResult | undefined = result.service_result?.service.last_trigger_result?.run_results.at(-1);
  return latestQueueResult ? summarizeBackgroundQueue(latestQueueResult) : null;
}

export function loadRuntimeEntrypointConfig(input: RuntimeEntrypointConfig = {}): LoadedRuntimeEntrypointConfig {
  const config: LoadedRuntimeEntrypointConfig = {
    tick_interval_ms: validatePositiveInteger(
      resolveNumber(input.tick_interval_ms, process.env.AIE_RUNTIME_TICK_INTERVAL_MS, DEFAULT_TICK_INTERVAL_MS),
      "tick_interval_ms",
    ),
    max_ticks_per_run: validatePositiveInteger(
      resolveNumber(input.max_ticks_per_run, process.env.AIE_RUNTIME_MAX_TICKS_PER_RUN, DEFAULT_MAX_TICKS_PER_RUN),
      "max_ticks_per_run",
    ),
    max_runs_per_invocation: validatePositiveInteger(
      resolveNumber(
        input.max_runs_per_invocation,
        process.env.AIE_RUNTIME_MAX_RUNS_PER_INVOCATION,
        DEFAULT_MAX_RUNS_PER_INVOCATION,
      ),
      "max_runs_per_invocation",
    ),
    operator_away_mode: resolveBoolean(input.operator_away_mode, process.env.AIE_RUNTIME_OPERATOR_AWAY_MODE, true),
    require_supervised_scope: resolveBoolean(
      input.require_supervised_scope,
      process.env.AIE_RUNTIME_REQUIRE_SUPERVISED_SCOPE,
      true,
    ),
    dry_run_mode: resolveBoolean(input.dry_run_mode, process.env.AIE_RUNTIME_DRY_RUN_MODE, false),
    started_at: input.started_at ?? process.env.AIE_RUNTIME_STARTED_AT ?? new Date().toISOString(),
  };

  if (!config.require_supervised_scope) {
    throw new Error(
      "Invalid runtime entrypoint config: require_supervised_scope must remain true for supervised runtime entrypoint runs.",
    );
  }

  return config;
}

export function summarizeRuntimeEntrypoint(result: RuntimeEntrypointResult): string {
  const lines = [
    `Runtime entrypoint status: ${result.status}`,
    `Reason: ${result.reason}`,
    `Dry run mode: ${result.config.dry_run_mode}`,
    `Operator away mode: ${result.config.operator_away_mode}`,
    `Require supervised scope: ${result.config.require_supervised_scope}`,
    summarizeBackgroundRuntimeService(result.service),
    summarizeOperatorAwayDigest(result.digest),
  ];

  const latestQueueSummary = buildLatestQueueSummary(result);
  if (latestQueueSummary) {
    lines.push(latestQueueSummary);
  }

  return lines.join("\n");
}

export function runBackgroundRuntimeEntrypoint(
  configInput: RuntimeEntrypointConfig = {},
  dependencies: RuntimeEntrypointDependencies = {},
): RuntimeEntrypointResult {
  const config = loadRuntimeEntrypointConfig(configInput);
  const queue = dependencies.queue ?? createDefaultQueue(config);
  const history = dependencies.history ?? createBackgroundRunHistory();
  const service = createBackgroundRuntimeService({
    tick_interval_ms: config.tick_interval_ms,
    max_ticks_per_run: config.max_ticks_per_run,
    max_runs_per_invocation: config.max_runs_per_invocation,
    stop_on_blocker: true,
    stop_on_error: true,
    operator_away_mode: config.operator_away_mode,
    require_supervised_scope: config.require_supervised_scope,
  });

  if (config.dry_run_mode) {
    const pausedService: BackgroundRuntimeServiceState = {
      ...service,
      status: "service_paused",
      started_at: config.started_at,
      stopped_at: config.started_at,
    };
    const dryRunResult: RuntimeEntrypointResult = {
      status: "entrypoint_paused",
      config,
      service: pausedService,
      service_result: null,
      queue,
      history,
      digest: buildOperatorAwayDigest(history),
      reason: "Dry-run mode validated the runtime entrypoint configuration without starting the background runtime service.",
      summary: "",
    };
    const summary = summarizeRuntimeEntrypoint(dryRunResult);
    const finalized = {
      ...dryRunResult,
      summary,
    };
    dependencies.summaryWriter?.(summary);
    return finalized;
  }

  const serviceResult = startBackgroundRuntimeService(
    service,
    queue,
    history,
    dependencies.clock ?? createEntrypointClock(config),
  );

  const result: RuntimeEntrypointResult = {
    status: serviceResult.status === "service_blocked" ? "entrypoint_blocked" : "entrypoint_completed",
    config,
    service: serviceResult.service,
    service_result: serviceResult,
    queue: serviceResult.queue,
    history: serviceResult.history,
    digest: buildOperatorAwayDigest(serviceResult.history),
    reason: serviceResult.reason,
    summary: "",
  };
  const summary = summarizeRuntimeEntrypoint(result);
  const finalized = {
    ...result,
    summary,
  };
  dependencies.summaryWriter?.(summary);
  return finalized;
}
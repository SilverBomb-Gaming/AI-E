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
import {
  DEFAULT_RUNTIME_PROFILE_NAME,
  resolveRuntimeProfile,
  summarizeRuntimeProfile,
  type RuntimeProfile,
} from "./runtimeProfiles";
import {
  createContinuousRuntimeLoopClock,
  runContinuousRuntimeLoop,
  summarizeContinuousRuntimeLoop,
  type ContinuousRuntimeLoopClock,
  type ContinuousRuntimeLoopResult,
} from "./continuousRuntimeLoop";
import {
  createRuntimeStateStore,
  evaluateBootResume,
  loadRuntimeState,
  saveRuntimeState,
  summarizeBootResume,
  type RuntimeBootResumeResult,
  type RuntimeStateStore,
} from "./runtimeStateStore";

const DEFAULT_TICK_INTERVAL_MS = 60_000;
const DEFAULT_MAX_TICKS_PER_RUN = 3;
const DEFAULT_MAX_RUNS_PER_INVOCATION = 1;
const DEFAULT_MAX_SESSIONS_PER_RUN = 1;
const DEFAULT_MAX_CYCLES_PER_SESSION = 1;
const DEFAULT_STARTED_AT = "2026-04-25T00:00:00.000Z";

export type RuntimeEntrypointConfig = {
  profile_name?: string;
  tick_interval_ms?: number;
  max_ticks_per_run?: number;
  max_runs_per_invocation?: number;
  operator_away_mode?: boolean;
  require_supervised_scope?: boolean;
  dry_run_mode?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
  stop_on_blocker?: boolean;
  stop_on_error?: boolean;
  started_at?: string;
};

export type LoadedRuntimeEntrypointConfig = {
  profile_name: string;
  profile_description: string;
  tick_interval_ms: number;
  max_ticks_per_run: number;
  max_runs_per_invocation: number;
  operator_away_mode: boolean;
  require_supervised_scope: boolean;
  dry_run_mode: boolean;
  require_fresh_approvals: boolean;
  require_fresh_context: boolean;
  stop_on_blocker: boolean;
  stop_on_error: boolean;
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
  continuous_loop_clock?: ContinuousRuntimeLoopClock;
  summaryWriter?: (summary: string) => void;
  runtime_state_store?: RuntimeStateStore;
};

export type RuntimeEntrypointResult = {
  status: RuntimeEntrypointStatus;
  config: LoadedRuntimeEntrypointConfig;
  boot_resume: RuntimeBootResumeResult;
  service: BackgroundRuntimeServiceState;
  service_result: BackgroundRuntimeServiceResult | null;
  queue: BackgroundSessionQueue;
  history: BackgroundRunHistory;
  continuous_loop_result: ContinuousRuntimeLoopResult | null;
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

function validateBoolean(value: boolean, field: keyof LoadedRuntimeEntrypointConfig): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid runtime entrypoint config: ${field} must be a boolean.`);
  }
  return value;
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
    require_fresh_approvals: config.require_fresh_approvals,
    require_fresh_context: config.require_fresh_context,
  });
}

function buildLatestQueueSummary(result: RuntimeEntrypointResult): string | null {
  const latestQueueResult: BackgroundQueueResult | undefined = result.service_result?.service.last_trigger_result?.run_results.at(-1);
  return latestQueueResult ? summarizeBackgroundQueue(latestQueueResult) : null;
}

export function loadRuntimeEntrypointConfig(input: RuntimeEntrypointConfig = {}): LoadedRuntimeEntrypointConfig {
  const profile = resolveRuntimeProfile(
    input.profile_name ?? process.env.AIE_RUNTIME_PROFILE ?? DEFAULT_RUNTIME_PROFILE_NAME,
    {
      tick_interval_ms: input.tick_interval_ms ?? readOptionalNumber(process.env.AIE_RUNTIME_TICK_INTERVAL_MS),
      max_ticks_per_run: input.max_ticks_per_run ?? readOptionalNumber(process.env.AIE_RUNTIME_MAX_TICKS_PER_RUN),
      max_runs_per_invocation: input.max_runs_per_invocation ?? readOptionalNumber(process.env.AIE_RUNTIME_MAX_RUNS_PER_INVOCATION),
      operator_away_mode: input.operator_away_mode ?? readOptionalBoolean(process.env.AIE_RUNTIME_OPERATOR_AWAY_MODE),
      dry_run_mode: input.dry_run_mode ?? readOptionalBoolean(process.env.AIE_RUNTIME_DRY_RUN_MODE),
      require_fresh_approvals: input.require_fresh_approvals ?? readOptionalBoolean(process.env.AIE_RUNTIME_REQUIRE_FRESH_APPROVALS),
      require_fresh_context: input.require_fresh_context ?? readOptionalBoolean(process.env.AIE_RUNTIME_REQUIRE_FRESH_CONTEXT),
      stop_on_blocker: input.stop_on_blocker ?? readOptionalBoolean(process.env.AIE_RUNTIME_STOP_ON_BLOCKER),
      stop_on_error: input.stop_on_error ?? readOptionalBoolean(process.env.AIE_RUNTIME_STOP_ON_ERROR),
    },
  );
  const config: LoadedRuntimeEntrypointConfig = {
    profile_name: profile.profile_name,
    profile_description: profile.description,
    tick_interval_ms: validatePositiveInteger(profile.tick_interval_ms, "tick_interval_ms"),
    max_ticks_per_run: validatePositiveInteger(profile.max_ticks_per_run, "max_ticks_per_run"),
    max_runs_per_invocation: validatePositiveInteger(profile.max_runs_per_invocation, "max_runs_per_invocation"),
    operator_away_mode: validateBoolean(profile.operator_away_mode, "operator_away_mode"),
    require_supervised_scope: resolveBoolean(
      input.require_supervised_scope,
      process.env.AIE_RUNTIME_REQUIRE_SUPERVISED_SCOPE,
      true,
    ),
    dry_run_mode: validateBoolean(profile.dry_run_mode, "dry_run_mode"),
    require_fresh_approvals: validateBoolean(profile.require_fresh_approvals, "require_fresh_approvals"),
    require_fresh_context: validateBoolean(profile.require_fresh_context, "require_fresh_context"),
    stop_on_blocker: validateBoolean(profile.stop_on_blocker, "stop_on_blocker"),
    stop_on_error: validateBoolean(profile.stop_on_error, "stop_on_error"),
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
    summarizeBootResume(result.boot_resume),
    `Require supervised scope: ${result.config.require_supervised_scope}`,
    summarizeRuntimeProfile({
      profile_name: result.config.profile_name,
      description: result.config.profile_description,
      tick_interval_ms: result.config.tick_interval_ms,
      max_ticks_per_run: result.config.max_ticks_per_run,
      max_runs_per_invocation: result.config.max_runs_per_invocation,
      operator_away_mode: result.config.operator_away_mode,
      dry_run_mode: result.config.dry_run_mode,
      require_fresh_approvals: result.config.require_fresh_approvals,
      require_fresh_context: result.config.require_fresh_context,
      stop_on_blocker: result.config.stop_on_blocker,
      stop_on_error: result.config.stop_on_error,
    }),
    summarizeBackgroundRuntimeService(result.service),
    summarizeOperatorAwayDigest(result.digest),
  ];

  const latestQueueSummary = buildLatestQueueSummary(result);
  if (latestQueueSummary) {
    lines.push(latestQueueSummary);
  }

  if (result.continuous_loop_result) {
    lines.push(summarizeContinuousRuntimeLoop(result.continuous_loop_result));
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
  const runtimeStateStore = dependencies.runtime_state_store ?? createRuntimeStateStore();
  const service = createBackgroundRuntimeService({
    tick_interval_ms: config.tick_interval_ms,
    max_ticks_per_run: config.max_ticks_per_run,
    max_runs_per_invocation: config.max_runs_per_invocation,
    stop_on_blocker: config.stop_on_blocker,
    stop_on_error: config.stop_on_error,
    operator_away_mode: config.operator_away_mode,
    require_supervised_scope: config.require_supervised_scope,
    require_fresh_approvals: config.require_fresh_approvals,
    require_fresh_context: config.require_fresh_context,
  });
  const bootResume = evaluateBootResume(runtimeStateStore, service.service_id, config.started_at);

  if (bootResume.status === "resume_blocked" || bootResume.status === "state_corrupt" || bootResume.status === "resume_requires_review") {
    const blockedService: BackgroundRuntimeServiceState = {
      ...service,
      status: bootResume.status === "resume_requires_review" ? "service_paused" : "service_blocked",
      started_at: config.started_at,
      stopped_at: config.started_at,
    };
    saveRuntimeState(runtimeStateStore, blockedService, config.profile_name);
    const bootBlockedResult: RuntimeEntrypointResult = {
      status: bootResume.status === "resume_requires_review" ? "entrypoint_paused" : "entrypoint_blocked",
      config,
      boot_resume: bootResume,
      service: blockedService,
      service_result: null,
      queue,
      history,
      continuous_loop_result: null,
      digest: buildOperatorAwayDigest(history),
      reason: bootResume.reason,
      summary: "",
    };
    const summary = summarizeRuntimeEntrypoint(bootBlockedResult);
    const finalized = {
      ...bootBlockedResult,
      summary,
    };
    dependencies.summaryWriter?.(summary);
    return finalized;
  }

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
      boot_resume: bootResume,
      service: pausedService,
      service_result: null,
      queue,
      history,
      continuous_loop_result: null,
      digest: buildOperatorAwayDigest(history),
      reason: "Dry-run mode validated the runtime entrypoint configuration without starting the background runtime service.",
      summary: "",
    };
    saveRuntimeState(runtimeStateStore, pausedService, config.profile_name);
    const summary = summarizeRuntimeEntrypoint(dryRunResult);
    const finalized = {
      ...dryRunResult,
      summary,
    };
    dependencies.summaryWriter?.(summary);
    return finalized;
  }

  const persistedRuntimeRecord = loadRuntimeState(runtimeStateStore, service.service_id);
  if (persistedRuntimeRecord?.operator_dashboard_state) {
    const continuousLoopResult = runContinuousRuntimeLoop(
      runtimeStateStore,
      {
        runtime_id: service.service_id,
        profile_name: config.profile_name,
        tick_interval_ms: config.tick_interval_ms,
        max_ticks_per_run: config.max_ticks_per_run,
        max_runs_per_invocation: config.max_runs_per_invocation,
        require_fresh_approvals: config.require_fresh_approvals,
        require_fresh_context: config.require_fresh_context,
        stop_on_blocker: config.stop_on_blocker,
        stop_on_error: config.stop_on_error,
        started_at: config.started_at,
      },
      dependencies.continuous_loop_clock ?? createContinuousRuntimeLoopClock(config.started_at, config.tick_interval_ms),
    );

    const loopRecord = continuousLoopResult.runtime_state;
    const serviceFromLoop: BackgroundRuntimeServiceState = {
      ...service,
      started_at: loopRecord?.last_started_at ?? config.started_at,
      stopped_at: loopRecord?.last_stopped_at ?? config.started_at,
      status: loopRecord?.last_status ?? service.status,
      ticks_attempted: loopRecord?.ticks_attempted ?? service.ticks_attempted,
      ticks_completed: loopRecord?.ticks_completed ?? service.ticks_completed,
      last_tick_at: loopRecord?.last_tick_at ?? service.last_tick_at,
      last_trigger_result: null,
      tick_history: [],
      stop_reason: loopRecord?.stop_reason ?? service.stop_reason,
      blockers: loopRecord?.blockers ?? service.blockers,
    };

    const loopStatus = continuousLoopResult.status;
    const result: RuntimeEntrypointResult = {
      status: loopStatus === "loop_blocked" || loopStatus === "loop_error"
        ? "entrypoint_blocked"
        : loopStatus === "loop_paused"
          ? "entrypoint_paused"
          : "entrypoint_completed",
      config,
      boot_resume: bootResume,
      service: serviceFromLoop,
      service_result: null,
      queue,
      history,
      continuous_loop_result: continuousLoopResult,
      digest: buildOperatorAwayDigest(history),
      reason: continuousLoopResult.reason,
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

  const serviceResult = startBackgroundRuntimeService(
    service,
    queue,
    history,
    dependencies.clock ?? createEntrypointClock(config),
  );

  const result: RuntimeEntrypointResult = {
    status: serviceResult.status === "service_blocked" ? "entrypoint_blocked" : "entrypoint_completed",
    config,
    boot_resume: bootResume,
    service: serviceResult.service,
    service_result: serviceResult,
    queue: serviceResult.queue,
    history: serviceResult.history,
    continuous_loop_result: null,
    digest: buildOperatorAwayDigest(serviceResult.history),
    reason: serviceResult.reason,
    summary: "",
  };
  saveRuntimeState(runtimeStateStore, serviceResult.service, config.profile_name);
  const summary = summarizeRuntimeEntrypoint(result);
  const finalized = {
    ...result,
    summary,
  };
  dependencies.summaryWriter?.(summary);
  return finalized;
}
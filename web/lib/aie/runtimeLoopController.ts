import {
  evaluateRuntimeState,
  runSessionCycle,
  summarizeRuntime,
  type RuntimeStatus,
  type SessionRuntimeResult,
} from "./sessionRuntime";
import type { AutonomousWorkSession, WorkSessionStatus } from "./autonomousWorkSession";

export type LoopStatus =
  | "loop_idle"
  | "loop_running"
  | "loop_paused"
  | "loop_blocked"
  | "loop_completed";

export type LoopControlConfig = {
  max_cycles: number;
  continuous_operation?: boolean;
};

export type RuntimeLoopResult = {
  status: LoopStatus;
  executed_cycles: number;
  latest_runtime_status: RuntimeStatus | null;
  latest_cycle_summary: string | null;
  session_status: WorkSessionStatus;
  reason: string;
};

export type RuntimeLoopState = {
  status: LoopStatus;
  session: AutonomousWorkSession;
  config: {
    max_cycles: number;
    continuous_operation: boolean;
  };
  started_at: string;
  stopped_at: string | null;
  executed_cycles: number;
  can_run_next_cycle: boolean;
  next_cycle_index: number;
  reason: string;
  latest_runtime_result: SessionRuntimeResult | null;
  cycle_results: SessionRuntimeResult[];
  result: RuntimeLoopResult;
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

function deriveLoopTimestamp(session: AutonomousWorkSession, offsetSeconds: number): string {
  const base = parseTimestamp(session.updated_at) ?? parseTimestamp(session.created_at) ?? Date.UTC(2026, 0, 1);
  return new Date(base + (offsetSeconds * 1000)).toISOString();
}

function normalizeConfig(config: LoopControlConfig): RuntimeLoopState["config"] {
  return {
    max_cycles: Math.max(1, Math.floor(config.max_cycles)),
    continuous_operation: config.continuous_operation !== false,
  };
}

function buildLoopResult(state: RuntimeLoopState): RuntimeLoopResult {
  return {
    status: state.status,
    executed_cycles: state.executed_cycles,
    latest_runtime_status: state.latest_runtime_result?.status ?? null,
    latest_cycle_summary: state.latest_runtime_result?.cycle?.summary ?? null,
    session_status: state.session.status,
    reason: state.reason,
  };
}

function mapRuntimeStatusToLoopStatus(status: RuntimeStatus): LoopStatus {
  switch (status) {
    case "runtime_idle":
      return "loop_idle";
    case "runtime_running":
    case "runtime_ready":
      return "loop_running";
    case "runtime_paused":
      return "loop_paused";
    case "runtime_blocked":
      return "loop_blocked";
    case "runtime_completed":
      return "loop_completed";
  }
}

function withEvaluation(state: RuntimeLoopState): RuntimeLoopState {
  const runtimeState = evaluateRuntimeState(state.session);
  const latestRuntimeStatus = state.latest_runtime_result?.status ?? null;
  const nextCycleIndex = state.executed_cycles + 1;

  if (latestRuntimeStatus === "runtime_completed" || state.session.status === "session_completed") {
    const evaluated = {
      ...state,
      status: "loop_completed" as const,
      stopped_at: state.stopped_at ?? deriveLoopTimestamp(state.session, nextCycleIndex),
      can_run_next_cycle: false,
      next_cycle_index: nextCycleIndex,
      reason: state.latest_runtime_result?.explanation ?? state.session.session_report.completion_reason ?? "The supervised runtime loop completed the session goal.",
    };
    return {
      ...evaluated,
      result: buildLoopResult(evaluated),
    };
  }

  if (latestRuntimeStatus === "runtime_blocked" || runtimeState.status === "runtime_blocked") {
    const evaluated = {
      ...state,
      status: "loop_blocked" as const,
      stopped_at: state.stopped_at ?? deriveLoopTimestamp(state.session, nextCycleIndex),
      can_run_next_cycle: false,
      next_cycle_index: nextCycleIndex,
      reason: state.latest_runtime_result?.explanation ?? runtimeState.reason,
    };
    return {
      ...evaluated,
      result: buildLoopResult(evaluated),
    };
  }

  if (latestRuntimeStatus === "runtime_paused" || runtimeState.status === "runtime_paused") {
    const evaluated = {
      ...state,
      status: "loop_paused" as const,
      stopped_at: state.stopped_at ?? deriveLoopTimestamp(state.session, nextCycleIndex),
      can_run_next_cycle: false,
      next_cycle_index: nextCycleIndex,
      reason: state.latest_runtime_result?.explanation ?? runtimeState.reason,
    };
    return {
      ...evaluated,
      result: buildLoopResult(evaluated),
    };
  }

  if (runtimeState.can_run_cycle) {
    const evaluated = {
      ...state,
      status: "loop_running" as const,
      stopped_at: null,
      can_run_next_cycle: true,
      next_cycle_index: nextCycleIndex,
      reason: state.executed_cycles === 0
        ? "Runtime loop is ready to execute supervised session cycles."
        : "Runtime loop can continue into another bounded supervised cycle.",
    };
    return {
      ...evaluated,
      result: buildLoopResult(evaluated),
    };
  }

  const evaluated = {
    ...state,
    status: mapRuntimeStatusToLoopStatus(runtimeState.status),
    stopped_at: state.stopped_at ?? deriveLoopTimestamp(state.session, nextCycleIndex),
    can_run_next_cycle: false,
    next_cycle_index: nextCycleIndex,
    reason: runtimeState.reason,
  };
  return {
    ...evaluated,
    result: buildLoopResult(evaluated),
  };
}

function createInitialLoopState(session: AutonomousWorkSession, config: LoopControlConfig): RuntimeLoopState {
  const normalizedConfig = normalizeConfig(config);
  const initialState: RuntimeLoopState = {
    status: "loop_idle",
    session,
    config: normalizedConfig,
    started_at: deriveLoopTimestamp(session, 0),
    stopped_at: null,
    executed_cycles: 0,
    can_run_next_cycle: false,
    next_cycle_index: 1,
    reason: "Runtime loop initialized.",
    latest_runtime_result: null,
    cycle_results: [],
    result: {
      status: "loop_idle",
      executed_cycles: 0,
      latest_runtime_status: null,
      latest_cycle_summary: null,
      session_status: session.status,
      reason: "Runtime loop initialized.",
    },
  };

  return withEvaluation(initialState);
}

export function evaluateLoopState(loopState: RuntimeLoopState): RuntimeLoopState {
  return withEvaluation({
    ...loopState,
    cycle_results: [...loopState.cycle_results],
  });
}

export function runNextCycle(loopState: RuntimeLoopState): RuntimeLoopState {
  const evaluated = evaluateLoopState(loopState);
  if (!evaluated.can_run_next_cycle) {
    return evaluated;
  }

  const cycleResult = runSessionCycle(evaluated.session);
  const updatedState: RuntimeLoopState = {
    ...evaluated,
    session: cycleResult.session,
    executed_cycles: evaluated.executed_cycles + 1,
    latest_runtime_result: cycleResult,
    cycle_results: [...evaluated.cycle_results, cycleResult],
    reason: cycleResult.explanation,
  };

  return withEvaluation(updatedState);
}

export function startRuntimeLoop(session: AutonomousWorkSession, config: LoopControlConfig): RuntimeLoopState {
  let loopState = createInitialLoopState(session, config);
  const maxAutomaticCycles = loopState.config.continuous_operation
    ? loopState.config.max_cycles
    : Math.min(loopState.config.max_cycles, 1);
  let automaticCycles = 0;

  while (loopState.can_run_next_cycle && automaticCycles < maxAutomaticCycles) {
    loopState = runNextCycle(loopState);
    automaticCycles += 1;
  }

  if (loopState.can_run_next_cycle && automaticCycles >= maxAutomaticCycles) {
    const limitedState: RuntimeLoopState = {
      ...loopState,
      status: "loop_running",
      stopped_at: deriveLoopTimestamp(loopState.session, loopState.executed_cycles + 1),
      reason: loopState.config.continuous_operation
        ? `Runtime loop reached the configured max cycle limit of ${loopState.config.max_cycles}.`
        : "Runtime loop stopped after one externally triggered cycle because continuous operation is disabled.",
    };
    return {
      ...limitedState,
      result: buildLoopResult(limitedState),
    };
  }

  return loopState;
}

export function stopRuntimeLoop(loopState: RuntimeLoopState): RuntimeLoopState {
  const stoppedState: RuntimeLoopState = {
    ...loopState,
    status: "loop_paused",
    stopped_at: loopState.stopped_at ?? deriveLoopTimestamp(loopState.session, loopState.executed_cycles + 1),
    can_run_next_cycle: false,
    next_cycle_index: loopState.executed_cycles + 1,
    reason: "Runtime loop was stopped by the operator.",
    cycle_results: [...loopState.cycle_results],
  };
  return {
    ...stoppedState,
    result: buildLoopResult(stoppedState),
  };
}

export function summarizeLoop(loopState: RuntimeLoopState): string {
  return [
    `Loop status: ${loopState.status}`,
    `Executed cycles: ${loopState.executed_cycles}/${loopState.config.max_cycles}`,
    `Can run next cycle: ${loopState.can_run_next_cycle}`,
    `Reason: ${loopState.reason}`,
    `Latest runtime status: ${loopState.latest_runtime_result?.status ?? "none"}`,
    `Latest runtime summary: ${loopState.latest_runtime_result ? summarizeRuntime(loopState.latest_runtime_result).replace(/\n/g, " | ") : "none"}`,
  ].join("\n");
}
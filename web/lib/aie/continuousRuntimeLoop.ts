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
  assignGoalToAgentRuntime,
  createAgentRuntimeRegistry,
  EXECUTOR_AGENT_ID,
  markAgentBlocked,
  markAgentIdle,
  PLANNER_AGENT_ID,
  REPORTER_AGENT_ID,
  VALIDATOR_AGENT_ID,
  type AgentRuntimeRegistry,
} from "./agentRuntimeRegistry";
import {
  runExecutionLoopController,
  type ExecutionLoopControllerResult,
} from "./executionLoopController";
import type { BackgroundSessionQueue } from "./backgroundSessionQueue";
import type { SafeRuntimeIntent } from "./safeRuntimeActionBridge";
import { createExecutionChainId, type ExecutionChainRecord } from "./executionChainState";

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

function buildRuntimeEventType(params: {
  triggered: boolean;
  blocked: boolean;
  goalTransitionChanged: boolean;
}): ContinuousLoopTickHistoryEntry["event_type"] {
  if (params.blocked) {
    return "tick_blocked";
  }

  if (params.goalTransitionChanged) {
    return "goal_transition";
  }

  if (params.triggered) {
    return "tick_executed";
  }

  return "tick_observed";
}

function summarizeActiveGoal(goal: RuntimeStateRecord["operator_dashboard_state"]["active_goal"] | null | undefined) {
  if (!goal) {
    return null;
  }

  return {
    goal_id: goal.goal_id,
    goal_label: goal.description,
  };
}

function hasSemanticProgress(goalTransition: ContinuousLoopTickHistoryEntry["goal_transition"], semanticProgression: ContinuousLoopTickHistoryEntry["semantic_progression"]) {
  return goalTransition.changed
    || semanticProgression.queue_count_before !== semanticProgression.queue_count_after
    || semanticProgression.blocked_count_before !== semanticProgression.blocked_count_after
    || semanticProgression.runtime_status_before !== semanticProgression.runtime_status_after
    || semanticProgression.scheduler_status_before !== semanticProgression.scheduler_status_after;
}

function appendStopConditionEvent(
  record: RuntimeStateRecord,
  loopState: ContinuousLoopStateRecord,
  attemptedAt: string,
  status: ContinuousLoopStatus,
  reason: string,
): RuntimeStateRecord {
  const nextRecord = cloneRuntimeStateRecord(record);
  const currentTickIndex = (loopState.ticks_attempted ?? 0) + 1;
  const tickId = buildTickId(record.runtime_id, attemptedAt);
  const activeGoal = summarizeActiveGoal(record.operator_dashboard_state?.active_goal);
  const blocked = status === "loop_blocked" || status === "loop_paused";

  nextRecord.last_tick_at = attemptedAt;
  nextRecord.persisted_at = attemptedAt;
  nextRecord.continuous_loop = {
    ...loopState,
    status,
    started_at: loopState.started_at ?? attemptedAt,
    stopped_at: null,
    last_tick_at: attemptedAt,
    ticks_attempted: loopState.ticks_attempted + 1,
    ticks_completed: loopState.ticks_completed,
    last_trigger_result: {
      status,
      reason,
      triggered: false,
      run_results_recorded: 0,
    },
    reason,
    tick_history: [...loopState.tick_history, {
      tick_id: tickId,
      event_id: tickId,
      runtime_id: record.runtime_id,
      attempted_at: attemptedAt,
      timestamp: attemptedAt,
      tick_index: currentTickIndex,
      status,
      event_type: blocked ? "tick_blocked" : "tick_observed",
      triggered: false,
      run_results_recorded: 0,
      reason,
      active_goal_before: activeGoal,
      active_goal_after: activeGoal,
      mutation_applied: null,
      safety_gate_result: blocked ? "blocked" : "not_triggered",
      scheduler_decision: record.operator_dashboard_state?.scheduler_status.explanation || null,
      persistence_result: "persisted_to_runtime_state",
      goal_transition: {
        changed: false,
        from_goal_id: activeGoal?.goal_id ?? null,
        to_goal_id: activeGoal?.goal_id ?? null,
        from_goal_label: activeGoal?.goal_label ?? null,
        to_goal_label: activeGoal?.goal_label ?? null,
        summary: activeGoal
          ? `Goal focus remained on ${activeGoal.goal_label}.`
          : "No active goal owned the slot before or after the runtime gate decision.",
      },
      semantic_progression: {
        queue_count_before: record.operator_dashboard_state?.queued_goals.length ?? 0,
        queue_count_after: record.operator_dashboard_state?.queued_goals.length ?? 0,
        blocked_count_before: record.operator_dashboard_state?.blocked_goals.length ?? 0,
        blocked_count_after: record.operator_dashboard_state?.blocked_goals.length ?? 0,
        runtime_status_before: record.operator_dashboard_state?.runtime_status.status ?? record.last_status,
        runtime_status_after: record.operator_dashboard_state?.runtime_status.status ?? record.last_status,
        scheduler_status_before: record.operator_dashboard_state?.scheduler_status.status ?? "scheduler_idle",
        scheduler_status_after: record.operator_dashboard_state?.scheduler_status.status ?? "scheduler_idle",
      },
      mutation_summary: reason,
      next_scheduled_action: record.operator_dashboard_state?.scheduler_status.explanation || null,
    }],
  };

  return nextRecord;
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

function describeGoalTransition(record: RuntimeStateRecord, execution: ExecutionLoopControllerResult) {
  const previousGoal = record.operator_dashboard_state?.active_goal ?? null;
  const nextGoal = execution.updated_dashboard_state.active_goal ?? null;

  if (previousGoal?.goal_id !== nextGoal?.goal_id) {
    if (previousGoal && nextGoal) {
      return {
        changed: true,
        from_goal_id: previousGoal.goal_id,
        to_goal_id: nextGoal.goal_id,
        from_goal_label: previousGoal.description,
        to_goal_label: nextGoal.description,
        summary: `Goal focus changed from ${previousGoal.description} to ${nextGoal.description}.`,
      };
    }

    if (previousGoal && !nextGoal) {
      return {
        changed: true,
        from_goal_id: previousGoal.goal_id,
        to_goal_id: null,
        from_goal_label: previousGoal.description,
        to_goal_label: null,
        summary: `Goal focus cleared after ${previousGoal.description} completed or yielded control.`,
      };
    }

    return {
      changed: true,
      from_goal_id: null,
      to_goal_id: nextGoal?.goal_id ?? null,
      from_goal_label: null,
      to_goal_label: nextGoal?.description ?? null,
      summary: `Goal focus advanced to ${nextGoal?.description ?? "the next runnable goal"}.`,
    };
  }

  return {
    changed: false,
    from_goal_id: previousGoal?.goal_id ?? null,
    to_goal_id: nextGoal?.goal_id ?? null,
    from_goal_label: previousGoal?.description ?? null,
    to_goal_label: nextGoal?.description ?? null,
    summary: previousGoal
      ? `Goal focus stayed on ${previousGoal.description}.`
      : "No active goal owned the slot before or after this tick.",
  };
}

function summarizeSemanticProgression(record: RuntimeStateRecord, execution: ExecutionLoopControllerResult) {
  const previousState = record.operator_dashboard_state;
  const nextState = execution.updated_dashboard_state;

  return {
    queue_count_before: previousState?.queued_goals.length ?? 0,
    queue_count_after: nextState.queued_goals.length,
    blocked_count_before: previousState?.blocked_goals.length ?? 0,
    blocked_count_after: nextState.blocked_goals.length,
    runtime_status_before: previousState?.runtime_status.status ?? record.last_status,
    runtime_status_after: nextState.runtime_status.status,
    scheduler_status_before: previousState?.scheduler_status.status ?? "scheduler_idle",
    scheduler_status_after: nextState.scheduler_status.status,
  };
}

function summarizeMutation(record: RuntimeStateRecord, execution: ExecutionLoopControllerResult): string {
  const progression = summarizeSemanticProgression(record, execution);
  const parts = [execution.reason];

  if (progression.queue_count_before !== progression.queue_count_after) {
    parts.push(`Queue ${progression.queue_count_before} -> ${progression.queue_count_after}`);
  }

  if (progression.blocked_count_before !== progression.blocked_count_after) {
    parts.push(`Blocked ${progression.blocked_count_before} -> ${progression.blocked_count_after}`);
  }

  if (progression.runtime_status_before !== progression.runtime_status_after) {
    parts.push(`Runtime ${progression.runtime_status_before} -> ${progression.runtime_status_after}`);
  }

  if (progression.scheduler_status_before !== progression.scheduler_status_after) {
    parts.push(`Scheduler ${progression.scheduler_status_before} -> ${progression.scheduler_status_after}`);
  }

  return parts.join(" | ");
}

const CHAIN_AGENT_IDS = [PLANNER_AGENT_ID, EXECUTOR_AGENT_ID, VALIDATOR_AGENT_ID, REPORTER_AGENT_ID] as const;

function resolveFocusedGoal(record: RuntimeStateRecord, execution: ExecutionLoopControllerResult): {
  goal_id: string | null;
  goal_label: string | null;
} {
  const previousGoal = record.operator_dashboard_state?.active_goal ?? record.operator_dashboard_state?.queued_goals[0] ?? null;
  const nextGoal = execution.updated_dashboard_state.active_goal ?? execution.updated_dashboard_state.queued_goals[0] ?? null;
  const focusedGoal = previousGoal ?? nextGoal;

  return {
    goal_id: focusedGoal?.goal_id ?? null,
    goal_label: focusedGoal?.description ?? null,
  };
}

function buildAgentRuntimeProjection(
  record: RuntimeStateRecord,
  execution: ExecutionLoopControllerResult,
  attemptedAt: string,
  tickId: string,
  mutationSummary: string,
): { registry: AgentRuntimeRegistry; event_summary: string } {
  const focusedGoal = resolveFocusedGoal(record, execution);
  let registry = record.agent_runtime_registry ?? createAgentRuntimeRegistry({
    runtime_id: record.runtime_id,
    now: attemptedAt,
  });

  const plannerSummary = focusedGoal.goal_id
    ? `planner-agent selected ${focusedGoal.goal_label ?? focusedGoal.goal_id} for bounded execution.`
    : "planner-agent found no runnable goal to assign.";
  registry = markAgentIdle(registry, {
    agent_id: PLANNER_AGENT_ID,
    timestamp: attemptedAt,
    event_id: `${tickId}-planner`,
    event_summary: plannerSummary,
  });

  if (execution.updated_dashboard_state.active_goal?.goal_id) {
    const executorAgent = registry.agents.find((agent) => agent.agent_id === EXECUTOR_AGENT_ID) ?? null;
    if (executorAgent?.current_goal_id && executorAgent.current_goal_id !== execution.updated_dashboard_state.active_goal.goal_id) {
      registry = markAgentIdle(registry, {
        agent_id: EXECUTOR_AGENT_ID,
        timestamp: attemptedAt,
        event_id: `${tickId}-executor-reset`,
        event_summary: `executor-agent cleared stale ownership of ${executorAgent.current_goal_id} before the next bounded assignment.`,
      });
    }

    registry = assignGoalToAgentRuntime(registry, {
      agent_id: EXECUTOR_AGENT_ID,
      goal_id: execution.updated_dashboard_state.active_goal.goal_id,
      timestamp: attemptedAt,
      event_id: `${tickId}-executor`,
      event_summary: `executor-agent is advancing ${execution.updated_dashboard_state.active_goal.description}.`,
    });
  } else {
    registry = markAgentIdle(registry, {
      agent_id: EXECUTOR_AGENT_ID,
      timestamp: attemptedAt,
      event_id: `${tickId}-executor`,
      event_summary: focusedGoal.goal_id
        ? `executor-agent completed or yielded ${focusedGoal.goal_label ?? focusedGoal.goal_id}.`
        : "executor-agent has no active bounded goal.",
    });
  }

  if (execution.status === "loop_blocked") {
    registry = markAgentBlocked(registry, {
      agent_id: VALIDATOR_AGENT_ID,
      timestamp: attemptedAt,
      event_id: `${tickId}-validator`,
      event_summary: `validator-agent blocked the bounded chain: ${execution.reason}`,
    });
  } else {
    registry = markAgentIdle(registry, {
      agent_id: VALIDATOR_AGENT_ID,
      timestamp: attemptedAt,
      event_id: `${tickId}-validator`,
      event_summary: "validator-agent cleared the bounded runtime transition.",
    });
  }

  registry = markAgentIdle(registry, {
    agent_id: REPORTER_AGENT_ID,
    timestamp: attemptedAt,
    event_id: `${tickId}-reporter`,
    event_summary: `reporter-agent persisted chain telemetry: ${mutationSummary}`,
  });

  const summaries = registry.agents
    .map((agent) => agent.last_event_summary)
    .filter((summary): summary is string => Boolean(summary));

  return {
    registry,
    event_summary: summaries.join(" | "),
  };
}

function buildExecutionChainProjection(
  record: RuntimeStateRecord,
  execution: ExecutionLoopControllerResult,
  attemptedAt: string,
  mutationSummary: string,
): { chains: ExecutionChainRecord[]; chain_summary: string } {
  const focusedGoal = resolveFocusedGoal(record, execution);
  const existingChains = [...(record.execution_chains ?? [])];
  const activeChain = [...existingChains].reverse().find((chain) => chain.status === "active" || chain.status === "pending") ?? null;
  const canReuseActiveChain = activeChain && activeChain.parent_goal_id === focusedGoal.goal_id;
  const nextStatus = execution.status === "loop_blocked"
    ? "blocked"
    : (execution.updated_dashboard_state.active_goal || execution.updated_dashboard_state.queued_goals.length > 0)
      ? "active"
      : "completed";
  const safetyStatus = execution.status === "loop_blocked"
    ? "blocked"
    : execution.updated_dashboard_state.approvals_required.length > 0
      ? "approval_required"
      : "safe";
  const nextChain: ExecutionChainRecord = {
    chain_id: canReuseActiveChain ? activeChain.chain_id : createExecutionChainId(focusedGoal.goal_id, attemptedAt),
    parent_goal_id: focusedGoal.goal_id,
    current_step: (canReuseActiveChain ? activeChain.current_step : 0) + 1,
    total_steps: CHAIN_AGENT_IDS.length,
    status: nextStatus,
    agent_ids: [...CHAIN_AGENT_IDS],
    started_at: canReuseActiveChain ? activeChain.started_at : attemptedAt,
    completed_at: nextStatus === "completed" || nextStatus === "blocked" ? attemptedAt : null,
    failure_reason: nextStatus === "blocked" ? execution.reason : null,
    last_transition: mutationSummary,
    safety_status: safetyStatus,
  };
  const nextChains = [...existingChains.filter((chain) => chain.chain_id !== nextChain.chain_id), nextChain].slice(-10);

  return {
    chains: nextChains,
    chain_summary: `Execution chain ${nextChain.chain_id} is ${nextChain.status} at step ${nextChain.current_step}/${nextChain.total_steps}.`,
  };
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
  const goalTransition = describeGoalTransition(record, execution);
  const semanticProgression = summarizeSemanticProgression(record, execution);
  const baseMutationSummary = summarizeMutation(record, execution);
  const tickId = buildTickId(config.runtime_id, attemptedAt);
  const agentRuntimeProjection = buildAgentRuntimeProjection(record, execution, attemptedAt, tickId, baseMutationSummary);
  const executionChainProjection = buildExecutionChainProjection(record, execution, attemptedAt, baseMutationSummary);
  const mutationSummary = [
    baseMutationSummary,
    agentRuntimeProjection.event_summary,
    executionChainProjection.chain_summary,
  ].filter(Boolean).join(" | ");
  const semanticProgressDetected = hasSemanticProgress(goalTransition, semanticProgression);
  const tickHistoryEntry: ContinuousLoopTickHistoryEntry = {
    tick_id: tickId,
    event_id: tickId,
    runtime_id: config.runtime_id,
    attempted_at: attemptedAt,
    timestamp: attemptedAt,
    tick_index: tickIndex,
    status: execution.status === "loop_blocked" ? "loop_blocked" : "loop_running",
    event_type: buildRuntimeEventType({
      triggered: execution.triggered,
      blocked: execution.status === "loop_blocked",
      goalTransitionChanged: goalTransition.changed,
    }),
    triggered: execution.triggered,
    run_results_recorded: execution.queue_result ? 1 : 0,
    reason: execution.reason,
    active_goal_before: summarizeActiveGoal(record.operator_dashboard_state?.active_goal),
    active_goal_after: summarizeActiveGoal(execution.updated_dashboard_state.active_goal),
    mutation_applied: semanticProgressDetected ? mutationSummary : null,
    safety_gate_result: execution.status === "loop_blocked"
      ? "blocked"
      : execution.triggered
        ? "passed"
        : "not_triggered",
    scheduler_decision: execution.updated_dashboard_state.scheduler_status.explanation || null,
    persistence_result: "persisted_to_runtime_state",
    goal_transition: goalTransition,
    semantic_progression: semanticProgression,
    mutation_summary: mutationSummary,
    next_scheduled_action: execution.updated_dashboard_state.scheduler_status.explanation || null,
  };

  nextRecord.operator_dashboard_state = execution.updated_dashboard_state;
  nextRecord.agent_runtime_registry = agentRuntimeProjection.registry;
  nextRecord.execution_chains = executionChainProjection.chains;
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
        const stopAttemptedAt = loopState.last_tick_at ?? config.started_at;
        currentRecord = appendStopConditionEvent(currentRecord, loopState, stopAttemptedAt, stopBeforeTick.status, stopBeforeTick.reason);
        loopState = cloneContinuousLoopState(currentRecord.continuous_loop);
        finalStatus = stopBeforeTick.status;
        finalReason = stopBeforeTick.reason;
        stoppedAt = currentRecord.last_tick_at ?? stopAttemptedAt;
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
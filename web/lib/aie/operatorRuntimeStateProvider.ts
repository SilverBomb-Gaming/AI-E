import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import {
  applyOperatorActionToProviderState,
  type OperatorRuntimeActionResult,
} from "./operatorRuntimeActionHandler";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardAgentRuntime,
  OperatorDashboardFailure,
  OperatorDashboardRecoveryRecommendation,
  OperatorRuntimeObservability,
  OperatorRuntimeObservabilityEvent,
  OperatorDashboardState,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";
import { createAgentRuntimeRegistry, type AgentRuntimeNode } from "./agentRuntimeRegistry";
import type { OperatorRuntimeStateProviderResult, OperatorStateSource } from "./operatorRuntimeStateContract";
import {
  evaluateBootResume,
  type RuntimeBootResumeResult,
  type RuntimeStateRecord,
  type RuntimeStateStore,
} from "./runtimeStateStore";
import { aggregateStudioHealthFromDashboardState } from "./studioHealthAggregator";
import type { ExecutionChainRecord } from "./executionChainState";
import type {
  SupervisedAutonomyCheckpointRecord,
  SupervisedAutonomySessionRecord,
} from "./supervisedAutonomySession";

export type OperatorRuntimeStateProviderDependencies = {
  runtime_state_store?: RuntimeStateStore | null;
  runtime_id?: string | null;
  now?: string;
};

type LiveRuntimeInspection = {
  mode: "live" | "missing" | "corrupt";
  boot_resume: RuntimeBootResumeResult | null;
  warnings: string[];
};

function createLoadedAt(now?: string): string {
  return now ?? new Date().toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function buildDemoWarnings(): string[] {
  return [
    "This dashboard is using seeded demo state. It demonstrates AI-E reasoning and controls but is not connected to live runtime state yet.",
  ];
}

function buildUnavailableWarnings(reason: string): string[] {
  return [
    "No runtime state is available.",
    reason,
  ];
}

function buildLiveWarnings(record: RuntimeStateRecord, bootResume: RuntimeBootResumeResult): string[] {
  const warnings = [
    "This dashboard is connected to live AI-E runtime state.",
    "Live runtime mode currently exposes persisted runtime service state first; detailed queued goal and session slices are only shown when they can be reconstructed safely.",
  ];

  if (!record.last_trigger_result) {
    warnings.push("No persisted queue trigger result was available in the latest runtime snapshot.");
  }

  if (bootResume.status === "resume_requires_review") {
    warnings.push("The persisted runtime state requires operator review before a safe resume.");
  }

  if (bootResume.status === "resume_blocked") {
    warnings.push("The persisted runtime state is blocked and should not be resumed automatically.");
  }

  return unique(warnings);
}

function inspectLiveRuntimeState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): LiveRuntimeInspection {
  const runtimeStateStore = dependencies.runtime_state_store;
  const runtimeId = normalizeText(dependencies.runtime_id);
  const now = createLoadedAt(dependencies.now);

  if (!runtimeStateStore || !runtimeId) {
    return {
      mode: "missing",
      boot_resume: null,
      warnings: ["No live runtime state store and runtime id were provided to the operator runtime state provider."],
    };
  }

  const bootResume = evaluateBootResume(runtimeStateStore, runtimeId, now);
  if (bootResume.status === "state_corrupt") {
    return {
      mode: "corrupt",
      boot_resume: bootResume,
      warnings: [bootResume.reason],
    };
  }

  if (bootResume.status === "no_prior_state") {
    return {
      mode: "missing",
      boot_resume: bootResume,
      warnings: [bootResume.reason],
    };
  }

  return {
    mode: "live",
    boot_resume: bootResume,
    warnings: [],
  };
}

function buildLiveApprovals(bootResume: RuntimeBootResumeResult): OperatorDashboardApprovalRequirement[] {
  const approvalsNeeded = unique(
    (bootResume.validation.blockers ?? []).flatMap((blocker) =>
      /approval/i.test(blocker.code) || /approval/i.test(blocker.message) ? ["session"] : []),
  );

  if (approvalsNeeded.length === 0) {
    return [];
  }

  return [{
    goal_id: null,
    approvals_needed: approvalsNeeded,
    reason: bootResume.reason,
    recommended_action: "Refresh the required approvals before another live runtime run is attempted.",
  }];
}

function buildLiveValidationIssues(bootResume: RuntimeBootResumeResult): OperatorDashboardValidationIssue[] {
  if (bootResume.status !== "resume_requires_review") {
    return [];
  }

  return [{
    goal_id: null,
    source: "runtime_state_store",
    status: "resume_requires_review",
    recommendation: "review_required",
    summary: bootResume.reason,
  }];
}

function buildLiveRecoveryRecommendation(
  bootResume: RuntimeBootResumeResult,
  loadedAt: string,
): {
  recent_failures: OperatorDashboardFailure[];
  recovery_recommendations: OperatorDashboardRecoveryRecommendation[];
} {
  if (bootResume.status === "resume_ready") {
    return {
      recent_failures: [],
      recovery_recommendations: [],
    };
  }

  const category = bootResume.status === "resume_blocked"
    ? buildLiveApprovals(bootResume).length > 0
      ? "stale_approval"
      : "dependency_blocked"
    : "stale_context";
  const severity = bootResume.status === "resume_blocked" ? "high" : "medium";
  const recommendation = bootResume.status === "resume_blocked"
    ? buildLiveApprovals(bootResume).length > 0
      ? "retry_after_refresh"
      : "block_until_fixed"
    : "request_operator_review";
  const reportId = `operator-runtime-provider-${loadedAt.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000"}-${bootResume.runtime_id}`;

  return {
    recent_failures: [{
      report_id: reportId,
      created_at: loadedAt,
      source: "runtime_state_store",
      category,
      severity,
      recommendation,
      reason: bootResume.reason,
    }],
    recovery_recommendations: [{
      report_id: reportId,
      source: "runtime_state_store",
      category,
      severity,
      recommendation,
      retry_safe: false,
      operator_review_required: true,
      reason: bootResume.reason,
    }],
  };
}

function toRuntimeObservabilityEvent(
  tick: NonNullable<RuntimeStateRecord["continuous_loop"]>["tick_history"][number],
): OperatorRuntimeObservabilityEvent {
  return {
    tick_id: tick.tick_id,
    event_id: tick.event_id,
    runtime_id: tick.runtime_id,
    timestamp: tick.timestamp,
    tick_index: tick.tick_index,
    event_type: tick.event_type,
    attempted_at: tick.attempted_at,
    status: tick.status,
    reason: tick.reason,
    active_goal_before: tick.active_goal_before ? { ...tick.active_goal_before } : null,
    active_goal_after: tick.active_goal_after ? { ...tick.active_goal_after } : null,
    mutation_applied: tick.mutation_applied,
    safety_gate_result: tick.safety_gate_result,
    scheduler_decision: tick.scheduler_decision,
    persistence_result: tick.persistence_result,
    goal_transition: tick.goal_transition ? { ...tick.goal_transition } : null,
    semantic_progression: tick.semantic_progression ? { ...tick.semantic_progression } : null,
    mutation_summary: tick.mutation_summary,
    next_scheduled_action: tick.next_scheduled_action,
  };
}

function describeSemanticTransition(event: OperatorRuntimeObservabilityEvent | null): string | null {
  if (!event) {
    return null;
  }

  if (event.goal_transition?.changed) {
    return event.goal_transition.summary;
  }

  if (event.mutation_applied) {
    return event.mutation_applied;
  }

  return null;
}

function inferNextScheduledTickAt(record: RuntimeStateRecord): string | null {
  const lastTickAt = record.continuous_loop?.last_tick_at ?? record.last_tick_at;
  const tickIntervalMs = record.continuous_loop_config?.tick_interval_ms ?? null;
  const loopStatus = record.continuous_loop?.status ?? null;

  if (!lastTickAt || !tickIntervalMs) {
    return null;
  }

  if (loopStatus === "loop_completed" || loopStatus === "loop_blocked" || loopStatus === "loop_paused" || loopStatus === "loop_error") {
    return null;
  }

  const lastTickMs = Date.parse(lastTickAt);
  if (Number.isNaN(lastTickMs)) {
    return null;
  }

  return new Date(lastTickMs + tickIntervalMs).toISOString();
}

function inferNextScheduledAction(record: RuntimeStateRecord): string | null {
  const state = record.operator_dashboard_state;
  if (!state) {
    return null;
  }

  if (state.approvals_required.length > 0) {
    return "Await operator approval before the next bounded runtime tick.";
  }

  if (state.active_goal) {
    return `Continue ${state.active_goal.description} on the next bounded tick.`;
  }

  if (state.queued_goals[0]) {
    return `Select ${state.queued_goals[0].description} on the next bounded tick.`;
  }

  return state.scheduler_status.explanation || null;
}

function buildRuntimeObservability(record: RuntimeStateRecord): OperatorRuntimeObservability {
  const eventLog = (record.continuous_loop?.tick_history ?? []).slice(-10).map(toRuntimeObservabilityEvent);
  const lastEvent = eventLog.length > 0 ? eventLog[eventLog.length - 1] : null;
  const lastMutationEvent = [...eventLog].reverse().find((event) => event.mutation_applied) ?? null;
  const lastSemanticEvent = [...eventLog].reverse().find((event) => describeSemanticTransition(event)) ?? null;

  return {
    current_tick: record.continuous_loop?.ticks_attempted ?? 0,
    last_tick_at: record.continuous_loop?.last_tick_at ?? record.last_tick_at,
    last_mutation: lastMutationEvent?.mutation_applied ?? null,
    last_semantic_transition: describeSemanticTransition(lastSemanticEvent),
    latest_safety_gate_decision: lastEvent?.safety_gate_result ?? null,
    next_scheduled_action: inferNextScheduledAction(record),
    next_scheduled_tick_at: inferNextScheduledTickAt(record),
    event_log: eventLog,
  };
}

function cloneAgentRuntimeNode(agent: AgentRuntimeNode): AgentRuntimeNode {
  return {
    ...agent,
    assigned_goal_ids: [...agent.assigned_goal_ids],
  };
}

function buildAgentRuntime(record: RuntimeStateRecord, loadedAt: string): OperatorDashboardAgentRuntime {
  const registry = record.agent_runtime_registry ?? createAgentRuntimeRegistry({
    runtime_id: record.runtime_id,
    now: loadedAt,
  });
  const agents = registry.agents.map(cloneAgentRuntimeNode);

  return {
    agents,
    active_agents: agents.filter((agent) => agent.status === "assigned"),
    idle_agents: agents.filter((agent) => agent.status === "idle"),
    blocked_agents: agents.filter((agent) => agent.status === "blocked"),
    paused_agents: agents.filter((agent) => agent.status === "paused"),
  };
}

function buildExecutionChains(record: RuntimeStateRecord): ExecutionChainRecord[] {
  return (record.execution_chains ?? []).map((chain) => ({
    ...chain,
    agent_ids: [...chain.agent_ids],
  }));
}

function buildSupervisedSession(record: RuntimeStateRecord): SupervisedAutonomySessionRecord | null {
  if (!record.supervised_session) {
    return null;
  }

  return {
    ...record.supervised_session,
    agent_ids: [...record.supervised_session.agent_ids],
    active_chain_ids: [...record.supervised_session.active_chain_ids],
    completed_chain_ids: [...record.supervised_session.completed_chain_ids],
    failed_chain_ids: [...record.supervised_session.failed_chain_ids],
  };
}

function buildSupervisedCheckpoints(record: RuntimeStateRecord): SupervisedAutonomyCheckpointRecord[] {
  return (record.supervised_checkpoints ?? []).map((checkpoint) => ({
    ...checkpoint,
    agent_states: checkpoint.agent_states.map((agentState) => ({ ...agentState })),
    active_chains: [...checkpoint.active_chains],
    queued_goals: [...checkpoint.queued_goals],
    completed_goals: [...checkpoint.completed_goals],
  }));
}

function buildLiveOperatorDashboardState(
  record: RuntimeStateRecord,
  bootResume: RuntimeBootResumeResult,
  loadedAt: string,
): OperatorDashboardState {
  const runtimeObservability = buildRuntimeObservability(record);
  const agentRuntime = buildAgentRuntime(record, loadedAt);
  const executionChains = buildExecutionChains(record);
  const supervisedSession = buildSupervisedSession(record);
  const supervisedCheckpoints = buildSupervisedCheckpoints(record);

  if (record.operator_dashboard_state) {
    const dashboardState = {
      ...record.operator_dashboard_state,
      runtime_observability: runtimeObservability,
      agent_runtime: agentRuntime,
      execution_chains: executionChains,
      supervised_session: supervisedSession,
      supervised_checkpoints: supervisedCheckpoints,
      last_updated_at: record.operator_dashboard_state.last_updated_at || record.persisted_at,
    };

    return {
      ...dashboardState,
      studio_operations: aggregateStudioHealthFromDashboardState(dashboardState),
    };
  }

  const approvalsRequired = buildLiveApprovals(bootResume);
  const validationIssues = buildLiveValidationIssues(bootResume);
  const recoverySignals = buildLiveRecoveryRecommendation(bootResume, loadedAt);

  const dashboardState = {
    active_goal: null,
    queued_goals: [],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: record.blockers.map((blocker, index) => ({
      goal_id: `runtime-blocker-${index + 1}`,
      blocker_ids: [blocker.code],
      explanation: blocker.message,
    })),
    conflict_blockers: [],
    recent_failures: recoverySignals.recent_failures,
    recovery_recommendations: recoverySignals.recovery_recommendations,
    approvals_required: approvalsRequired,
    validation_issues: validationIssues,
    runtime_status: {
      status: record.last_status,
      explanation: `Last persisted runtime status ${record.last_status} with stop reason ${record.stop_reason}.`,
    },
    session_status: {
      status: bootResume.status,
      explanation: bootResume.reason,
    },
    queue_status: {
      status: record.last_trigger_result?.status ?? "queue_idle",
      explanation: record.last_trigger_result?.reason ?? "No persisted queue trigger result is available for the current runtime snapshot.",
    },
    scheduler_status: {
      status: record.last_trigger_result?.status ?? bootResume.status,
      explanation: record.last_trigger_result?.reason ?? bootResume.reason,
    },
    autonomous_sessions: {
      sessions: [],
      selected_session_id: null,
      runnable_session_ids: [],
      blocked_session_ids: [],
      ready_session_ids: [],
      scheduler_status: {
        status: "no_runnable_sessions",
        explanation: "No autonomous session registry is available in the persisted runtime snapshot.",
      },
      resource_status: {
        status: "resource_idle",
        explanation: "No autonomous sessions are registered for bounded parallel execution yet.",
      },
      max_logical_cpu_units: 0,
      max_concurrent_chains: 0,
      total_logical_cpu_units: 0,
      total_active_chains: 0,
      assigned_agent_ids: [],
      conflicts: [],
      coordination_groups: [],
      coordination_dependencies: [],
    },
    runtime_observability: runtimeObservability,
    agent_runtime: agentRuntime,
    execution_chains: executionChains,
    supervised_session: supervisedSession,
    supervised_checkpoints: supervisedCheckpoints,
    last_updated_at: record.persisted_at,
  };

  return {
    ...dashboardState,
    studio_operations: aggregateStudioHealthFromDashboardState(dashboardState),
  };
}

export function resolveOperatorStateSource(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): OperatorStateSource {
  const inspection = inspectLiveRuntimeState(dependencies);
  switch (inspection.mode) {
    case "live":
      return "live_runtime";
    case "corrupt":
      return "unavailable";
    case "missing":
    default:
      return "demo_seed";
  }
}

export function loadDemoOperatorDashboardState(
  loadedAt = createLoadedAt(),
): OperatorRuntimeStateProviderResult {
  const dashboardState = createOperatorDashboardDemoState();
  return {
    source: "demo_seed",
    dashboard_state: {
      ...dashboardState,
      studio_operations: aggregateStudioHealthFromDashboardState(dashboardState),
    },
    warnings: buildDemoWarnings(),
    loaded_at: loadedAt,
  };
}

export function loadLiveOperatorDashboardState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): OperatorRuntimeStateProviderResult {
  const loadedAt = createLoadedAt(dependencies.now);
  const inspection = inspectLiveRuntimeState(dependencies);
  if (inspection.mode !== "live" || !inspection.boot_resume?.record) {
    const unavailableReason = inspection.boot_resume?.reason ?? inspection.warnings.join(" ") ?? "No live runtime state is available.";
    return {
      source: "unavailable",
      dashboard_state: null,
      warnings: buildUnavailableWarnings(unavailableReason || "No live runtime state is available."),
      loaded_at: loadedAt,
    };
  }

  return {
    source: "live_runtime",
    dashboard_state: buildLiveOperatorDashboardState(inspection.boot_resume.record, inspection.boot_resume, loadedAt),
    warnings: buildLiveWarnings(inspection.boot_resume.record, inspection.boot_resume),
    loaded_at: loadedAt,
  };
}

export async function loadOperatorDashboardState(
  dependencies: OperatorRuntimeStateProviderDependencies = {},
): Promise<OperatorRuntimeStateProviderResult> {
  const loadedAt = createLoadedAt(dependencies.now);
  const inspection = inspectLiveRuntimeState(dependencies);

  if (inspection.mode === "live") {
    return loadLiveOperatorDashboardState({
      ...dependencies,
      now: loadedAt,
    });
  }

  if (inspection.mode === "corrupt") {
    const unavailableReason = inspection.boot_resume?.reason ?? inspection.warnings.join(" ") ?? "No runtime state is available.";
    return {
      source: "unavailable",
      dashboard_state: null,
      warnings: buildUnavailableWarnings(unavailableReason || "No runtime state is available."),
      loaded_at: loadedAt,
    };
  }

  const demoResult = loadDemoOperatorDashboardState(loadedAt);
  return {
    ...demoResult,
    warnings: unique([...inspection.warnings, ...demoResult.warnings]),
  };
}

export function summarizeOperatorStateProviderResult(result: OperatorRuntimeStateProviderResult): string {
  return [
    `Operator state source: ${result.source}`,
    `Loaded at: ${result.loaded_at}`,
    `Dashboard available: ${result.dashboard_state ? "yes" : "no"}`,
    `Runtime status: ${result.dashboard_state?.runtime_status.status ?? "none"}`,
    `Queue status: ${result.dashboard_state?.queue_status.status ?? "none"}`,
    `Warnings: ${result.warnings.length > 0 ? result.warnings.join(" | ") : "none"}`,
  ].join("\n");
}

export { applyOperatorActionToProviderState };
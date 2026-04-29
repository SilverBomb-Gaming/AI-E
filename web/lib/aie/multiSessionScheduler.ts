import {
  createAutonomousSessionRegistry,
  priorityRank,
  type AutonomousSessionRecord,
  type AutonomousSessionRegistry,
} from "./autonomousSessionRegistry";

export type MultiSessionSchedulerState = {
  global_tick_budget: number;
  global_ticks_consumed: number;
  per_session_ticks: Record<string, number>;
};

export type MultiSessionSchedulerSkipReason =
  | "session_not_runnable"
  | "session_tick_budget_exhausted"
  | "global_tick_budget_exhausted";

export type MultiSessionSchedulerSkippedSession = {
  session_id: string;
  reason: MultiSessionSchedulerSkipReason;
  explanation: string;
};

export type MultiSessionSchedulerResult = {
  status: "session_selected" | "no_runnable_sessions";
  selected_session: AutonomousSessionRecord | null;
  runnable_sessions: AutonomousSessionRecord[];
  skipped_sessions: MultiSessionSchedulerSkippedSession[];
  global_budget_remaining: number;
  scheduling_reason: string;
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function clampInteger(value: number | null | undefined, fallback: number, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(value));
}

function cloneSession(session: AutonomousSessionRecord): AutonomousSessionRecord {
  return {
    ...session,
    allocated_resources: { ...session.allocated_resources },
    active_chain_ids: [...session.active_chain_ids],
    queued_work_item_ids: [...session.queued_work_item_ids],
    assigned_agent_ids: [...session.assigned_agent_ids],
  };
}

function parseTimestamp(value: string | null | undefined): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isRunnable(session: AutonomousSessionRecord): boolean {
  return session.status === "pending" || session.status === "running";
}

function priorityWeight(session: AutonomousSessionRecord): number {
  switch (session.priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function consumedTicksForSession(state: MultiSessionSchedulerState, sessionId: string): number {
  return clampInteger(state.per_session_ticks[sessionId], 0, 0);
}

function remainingGlobalBudget(state: MultiSessionSchedulerState): number {
  return Math.max(0, state.global_tick_budget - state.global_ticks_consumed);
}

function weightedShare(state: MultiSessionSchedulerState, session: AutonomousSessionRecord): number {
  return consumedTicksForSession(state, session.session_id) / priorityWeight(session);
}

function compareRunnableSessions(
  state: MultiSessionSchedulerState,
  left: AutonomousSessionRecord,
  right: AutonomousSessionRecord,
): number {
  const shareDelta = weightedShare(state, left) - weightedShare(state, right);
  if (shareDelta !== 0) {
    return shareDelta;
  }

  const leftTick = parseTimestamp(left.last_tick ?? left.start_time);
  const rightTick = parseTimestamp(right.last_tick ?? right.start_time);
  if (leftTick !== rightTick) {
    return leftTick - rightTick;
  }

  const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return left.session_id.localeCompare(right.session_id);
}

export function createMultiSessionSchedulerState(input?: {
  global_tick_budget?: number;
  global_ticks_consumed?: number;
  per_session_ticks?: Record<string, number>;
}): MultiSessionSchedulerState {
  return {
    global_tick_budget: clampInteger(input?.global_tick_budget, 12, 1),
    global_ticks_consumed: clampInteger(input?.global_ticks_consumed, 0, 0),
    per_session_ticks: Object.fromEntries(
      Object.entries(input?.per_session_ticks ?? {}).map(([sessionId, ticks]) => [sessionId, clampInteger(ticks, 0, 0)]),
    ),
  };
}

export function scheduleNextAutonomousSession(
  registry: AutonomousSessionRegistry,
  schedulerState: MultiSessionSchedulerState,
): MultiSessionSchedulerResult {
  const normalizedRegistry = createAutonomousSessionRegistry(registry);
  const normalizedState = createMultiSessionSchedulerState(schedulerState);
  const globalBudgetRemaining = remainingGlobalBudget(normalizedState);

  if (globalBudgetRemaining <= 0) {
    return {
      status: "no_runnable_sessions",
      selected_session: null,
      runnable_sessions: [],
      skipped_sessions: normalizedRegistry.sessions.map((session) => ({
        session_id: session.session_id,
        reason: "global_tick_budget_exhausted",
        explanation: "The scheduler exhausted the global tick budget for this run.",
      })),
      global_budget_remaining: 0,
      scheduling_reason: "The global multi-session tick budget is exhausted.",
      reason: "The global multi-session tick budget is exhausted.",
    };
  }

  const skippedSessions: MultiSessionSchedulerSkippedSession[] = [];
  const runnableSessions: AutonomousSessionRecord[] = [];

  for (const session of normalizedRegistry.sessions) {
    if (!isRunnable(session)) {
      skippedSessions.push({
        session_id: session.session_id,
        reason: "session_not_runnable",
        explanation: `Session ${session.session_id} is ${session.status} and cannot consume another tick.`,
      });
      continue;
    }

    if (consumedTicksForSession(normalizedState, session.session_id) >= session.max_tick_budget) {
      skippedSessions.push({
        session_id: session.session_id,
        reason: "session_tick_budget_exhausted",
        explanation: `Session ${session.session_id} reached its bounded max tick budget of ${session.max_tick_budget}.`,
      });
      continue;
    }

    runnableSessions.push(cloneSession(session));
  }

  if (runnableSessions.length === 0) {
    return {
      status: "no_runnable_sessions",
      selected_session: null,
      runnable_sessions: [],
      skipped_sessions: skippedSessions,
      global_budget_remaining: globalBudgetRemaining,
      scheduling_reason: "No runnable autonomous sessions remain after applying bounded status and tick-budget rules.",
      reason: "No runnable autonomous sessions remain after applying bounded status and tick-budget rules.",
    };
  }

  const ordered = [...runnableSessions].sort((left, right) => compareRunnableSessions(normalizedState, left, right));
  const selected = ordered[0] ?? null;

  return {
    status: selected ? "session_selected" : "no_runnable_sessions",
    selected_session: selected,
    runnable_sessions: ordered,
    skipped_sessions: skippedSessions,
    global_budget_remaining: globalBudgetRemaining,
    scheduling_reason: selected
      ? `Selected ${selected.session_id} using weighted fair scheduling across ${ordered.length} runnable sessions.`
      : "No runnable autonomous sessions remain after applying bounded status and tick-budget rules.",
    reason: selected
      ? `Selected ${selected.session_id} using weighted fair scheduling across ${ordered.length} runnable sessions.`
      : "No runnable autonomous sessions remain after applying bounded status and tick-budget rules.",
  };
}

export function recordAutonomousSessionTick(
  schedulerState: MultiSessionSchedulerState,
  sessionId: string,
): MultiSessionSchedulerState {
  const normalizedState = createMultiSessionSchedulerState(schedulerState);
  const normalizedSessionId = normalizeText(sessionId);

  return {
    ...normalizedState,
    global_ticks_consumed: normalizedState.global_ticks_consumed + 1,
    per_session_ticks: {
      ...normalizedState.per_session_ticks,
      [normalizedSessionId]: consumedTicksForSession(normalizedState, normalizedSessionId) + 1,
    },
  };
}

export function summarizeMultiSessionScheduler(result: MultiSessionSchedulerResult): string {
  const lines = [
    `Multi-session scheduler status: ${result.status}`,
    `Global budget remaining: ${result.global_budget_remaining}`,
    `Scheduling reason: ${result.scheduling_reason}`,
  ];

  if (result.selected_session) {
    lines.push(`Selected session: ${result.selected_session.session_id} (${result.selected_session.session_type}, ${result.selected_session.priority})`);
  }

  if (result.runnable_sessions.length > 0) {
    lines.push(`Runnable sessions: ${result.runnable_sessions.map((session) => session.session_id).join(", ")}`);
  }

  if (result.skipped_sessions.length > 0) {
    lines.push(`Skipped sessions: ${result.skipped_sessions.map((session) => `${session.session_id}:${session.reason}`).join(" | ")}`);
  }

  return lines.join("\n");
}
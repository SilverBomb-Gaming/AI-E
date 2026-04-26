import {
  createBackgroundRuntimeScheduler,
  evaluateBackgroundRunEligibility,
  runBackgroundRuntimeCycle,
  summarizeBackgroundRun,
  type BackgroundRunBlocker,
  type BackgroundRunResult,
} from "./backgroundRuntimeScheduler";
import type { AutonomousWorkSession } from "./autonomousWorkSession";
import {
  createGoalQueue,
  createGoalRecordFromSession,
  scheduleNextGoal,
  summarizeGoalScheduler,
  type GoalPriority,
  type GoalSchedulerResult,
} from "./multiGoalOrchestrator";

export type BackgroundQueueStatus =
  | "queue_idle"
  | "queue_running"
  | "queue_paused"
  | "queue_completed"
  | "queue_blocked";

export type BackgroundQueuedSessionStatus =
  | "queued"
  | "eligible"
  | "running"
  | "skipped"
  | "paused"
  | "blocked"
  | "completed";

export type QueueRunPolicy = {
  max_sessions_per_run: number;
  max_cycles_per_session: number;
  skip_blocked_sessions: boolean;
  stop_on_first_failure: boolean;
  operator_away_mode: boolean;
  require_fresh_approvals: boolean;
  require_fresh_context: boolean;
};

export type BackgroundQueuedSession = {
  queue_entry_id: string;
  session_id: string;
  operator_goal: string;
  goal_priority: GoalPriority;
  enqueued_at: string;
  order: number;
  status: BackgroundQueuedSessionStatus;
  session: AutonomousWorkSession;
  last_run_result: BackgroundRunResult | null;
};

export type BackgroundSessionQueue = {
  queue_id: string;
  created_at: string;
  policy: QueueRunPolicy;
  sessions: BackgroundQueuedSession[];
};

export type BackgroundQueueReport = {
  report_id: string;
  created_at: string;
  queue_status: BackgroundQueueStatus;
  sessions_considered: number;
  sessions_run: number;
  sessions_skipped: number;
  sessions_paused: number;
  sessions_blocked: number;
  sessions_completed: number;
  blockers: BackgroundRunBlocker[];
  next_operator_action: string;
  safe_to_continue_later: boolean;
};

export type BackgroundQueueResult = {
  status: BackgroundQueueStatus;
  queue: BackgroundSessionQueue;
  goal_schedule: GoalSchedulerResult;
  run_results: BackgroundRunResult[];
  blockers: BackgroundRunBlocker[];
  sessions_considered: number;
  sessions_run: number;
  sessions_skipped: number;
  sessions_paused: number;
  sessions_blocked: number;
  sessions_completed: number;
  next_operator_action: string;
  safe_to_continue_later: boolean;
  report: BackgroundQueueReport;
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "background-session-queue";
}

function uniqueBlockers(blockers: BackgroundRunBlocker[]): BackgroundRunBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}:${blocker.message}:${(blocker.approvals_needed ?? []).join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function deriveQueueTimestamp(queue: BackgroundSessionQueue, offsetSeconds: number): string {
  const base = parseTimestamp(queue.created_at) ?? Date.UTC(2026, 0, 1);
  return new Date(base + (offsetSeconds * 1000)).toISOString();
}

function normalizePolicy(config: {
  max_sessions_per_run: number;
  max_cycles_per_session: number;
  skip_blocked_sessions?: boolean;
  stop_on_first_failure?: boolean;
  operator_away_mode?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
}): QueueRunPolicy {
  return {
    max_sessions_per_run: Math.max(1, Math.floor(config.max_sessions_per_run)),
    max_cycles_per_session: Math.max(1, Math.floor(config.max_cycles_per_session)),
    skip_blocked_sessions: config.skip_blocked_sessions === true,
    stop_on_first_failure: config.stop_on_first_failure === true,
    operator_away_mode: config.operator_away_mode !== false,
    require_fresh_approvals: config.require_fresh_approvals !== false,
    require_fresh_context: config.require_fresh_context !== false,
  };
}

function buildQueueId(policy: QueueRunPolicy): string {
  const flags = [
    policy.max_sessions_per_run,
    policy.max_cycles_per_session,
    policy.skip_blocked_sessions ? "skip-blocked" : "stop-blocked",
    policy.stop_on_first_failure ? "stop-first-failure" : "continue-on-failure",
    policy.operator_away_mode ? "away" : "local",
  ].join("-");
  return `background-session-queue-${flags}`;
}

function createEntryId(queue: BackgroundSessionQueue, session: AutonomousWorkSession, order: number): string {
  return `${queue.queue_id}-entry-${String(order).padStart(4, "0")}-${slugify(session.operator_goal)}`;
}

function mapRunStatusToQueuedStatus(status: BackgroundRunResult["status"]): BackgroundQueuedSessionStatus {
  switch (status) {
    case "run_eligible":
      return "eligible";
    case "run_started":
      return "running";
    case "run_paused":
      return "paused";
    case "run_blocked":
      return "blocked";
    case "run_completed":
      return "completed";
    case "run_skipped":
      return "skipped";
    case "scheduler_idle":
      return "queued";
  }
}

function createScheduler(queue: BackgroundSessionQueue) {
  return createBackgroundRuntimeScheduler({
    max_cycles_per_run: queue.policy.max_cycles_per_session,
    allow_when_approvals_pending: false,
    require_fresh_approvals: queue.policy.require_fresh_approvals,
    require_fresh_context: queue.policy.require_fresh_context,
    stop_on_validation_failure: true,
    stop_on_rollback_recommendation: true,
    operator_away_mode: queue.policy.operator_away_mode,
  });
}

function cloneQueue(queue: BackgroundSessionQueue): BackgroundSessionQueue {
  return {
    ...queue,
    policy: { ...queue.policy },
    sessions: queue.sessions.map((session) => ({ ...session })),
  };
}

function buildQueueResult(input: Omit<BackgroundQueueResult, "report">): BackgroundQueueResult {
  const partial: BackgroundQueueResult = {
    ...input,
    report: {
      report_id: "",
      created_at: input.queue.created_at,
      queue_status: input.status,
      sessions_considered: input.sessions_considered,
      sessions_run: input.sessions_run,
      sessions_skipped: input.sessions_skipped,
      sessions_paused: input.sessions_paused,
      sessions_blocked: input.sessions_blocked,
      sessions_completed: input.sessions_completed,
      blockers: [],
      next_operator_action: input.next_operator_action,
      safe_to_continue_later: input.safe_to_continue_later,
    },
  };

  return {
    ...partial,
    report: buildQueueRunReport(partial),
  };
}

export function createBackgroundSessionQueue(config: {
  max_sessions_per_run: number;
  max_cycles_per_session: number;
  skip_blocked_sessions?: boolean;
  stop_on_first_failure?: boolean;
  operator_away_mode?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
}): BackgroundSessionQueue {
  const policy = normalizePolicy(config);
  return {
    queue_id: buildQueueId(policy),
    created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    policy,
    sessions: [],
  };
}

export function enqueueBackgroundSession(
  queue: BackgroundSessionQueue,
  session: AutonomousWorkSession,
  options: {
    priority?: GoalPriority;
  } = {},
): BackgroundSessionQueue {
  const nextQueue = cloneQueue(queue);
  const order = nextQueue.sessions.length + 1;
  const queuedSession: BackgroundQueuedSession = {
    queue_entry_id: createEntryId(nextQueue, session, order),
    session_id: session.session_id,
    operator_goal: session.operator_goal,
    goal_priority: options.priority ?? "medium",
    enqueued_at: deriveQueueTimestamp(nextQueue, order),
    order,
    status: "queued",
    session,
    last_run_result: null,
  };
  return {
    ...nextQueue,
    sessions: [...nextQueue.sessions, queuedSession],
  };
}

export function evaluateQueuedSession(
  queue: BackgroundSessionQueue,
  queuedSession: BackgroundQueuedSession,
): BackgroundQueuedSession {
  const scheduler = createScheduler(queue);
  const runResult = evaluateBackgroundRunEligibility(queuedSession.session, scheduler);
  return {
    ...queuedSession,
    status: mapRunStatusToQueuedStatus(runResult.status),
    last_run_result: runResult,
  };
}

function buildGoalSchedule(queue: BackgroundSessionQueue): GoalSchedulerResult {
  return scheduleNextGoal(createGoalQueue(queue.sessions.map((queuedSession) =>
    createGoalRecordFromSession(queuedSession.session, {
      priority: queuedSession.goal_priority,
      created_at: queuedSession.enqueued_at,
      last_updated_at: queuedSession.enqueued_at,
    })
  )));
}

function buildOrderedSessionIndices(queue: BackgroundSessionQueue, goalSchedule: GoalSchedulerResult): number[] {
  const indexBySessionId = new Map<string, number>();
  queue.sessions.forEach((queuedSession, index) => {
    indexBySessionId.set(queuedSession.session_id, index);
  });

  const scheduledIndices = goalSchedule.ordered_goals
    .map((goal) => indexBySessionId.get(goal.id))
    .filter((index): index is number => index !== undefined);

  const seen = new Set<number>(scheduledIndices);
  const trailingIndices = queue.sessions
    .map((_, index) => index)
    .filter((index) => !seen.has(index));

  return [...scheduledIndices, ...trailingIndices];
}

export function runBackgroundSessionQueue(queue: BackgroundSessionQueue): BackgroundQueueResult {
  const nextQueue = cloneQueue(queue);
  const scheduler = createScheduler(nextQueue);
  const goalSchedule = buildGoalSchedule(nextQueue);
  const orderedIndices = buildOrderedSessionIndices(nextQueue, goalSchedule);
  const runResults: BackgroundRunResult[] = [];
  const blockers: BackgroundRunBlocker[] = [];

  let sessionsConsidered = 0;
  let sessionsRun = 0;
  let sessionsSkipped = 0;
  let sessionsPaused = 0;
  let sessionsBlocked = 0;
  let sessionsCompleted = 0;
  let status: BackgroundQueueStatus = nextQueue.sessions.length === 0 ? "queue_idle" : "queue_completed";
  let nextOperatorAction = nextQueue.sessions.length === 0
    ? "Enqueue background-capable sessions before running the queue."
    : "Review the queue report after this operator-away pass.";
  let safeToContinueLater = nextQueue.sessions.length > 0;

  for (const index of orderedIndices) {
    if (sessionsRun >= nextQueue.policy.max_sessions_per_run) {
      status = "queue_running";
      nextOperatorAction = "Trigger another bounded queue pass to continue processing the remaining sessions.";
      safeToContinueLater = true;
      break;
    }

    const originalEntry = nextQueue.sessions[index];
    const evaluatedEntry = evaluateQueuedSession(nextQueue, originalEntry);
    nextQueue.sessions[index] = evaluatedEntry;
    sessionsConsidered += 1;

    const eligibilityResult = evaluatedEntry.last_run_result;
    if (!eligibilityResult) {
      continue;
    }

    if (evaluatedEntry.status === "completed") {
      runResults.push(eligibilityResult);
      sessionsCompleted += 1;
      blockers.push(...eligibilityResult.blockers);
      continue;
    }

    if (evaluatedEntry.status === "blocked") {
      if (nextQueue.policy.skip_blocked_sessions) {
        const skippedEntry: BackgroundQueuedSession = {
          ...evaluatedEntry,
          status: "skipped",
        };
        nextQueue.sessions[index] = skippedEntry;
        runResults.push(eligibilityResult);
        sessionsSkipped += 1;
        blockers.push(...eligibilityResult.blockers);
        continue;
      }

      runResults.push(eligibilityResult);
      sessionsBlocked += 1;
      blockers.push(...eligibilityResult.blockers);
      status = "queue_blocked";
      nextOperatorAction = "Resolve the blocked session before the next operator-away queue pass.";
      safeToContinueLater = false;
      break;
    }

    if (evaluatedEntry.status === "paused" || evaluatedEntry.status === "skipped") {
      runResults.push(eligibilityResult);
      blockers.push(...eligibilityResult.blockers);
      if (evaluatedEntry.status === "paused") {
        sessionsPaused += 1;
        status = "queue_paused";
        nextOperatorAction = "Review the paused session before the next operator-away queue pass.";
      } else {
        sessionsSkipped += 1;
      }
      if (nextQueue.policy.stop_on_first_failure && evaluatedEntry.status === "paused") {
        safeToContinueLater = true;
        break;
      }
      continue;
    }

    if (evaluatedEntry.status === "eligible") {
      const runResult = runBackgroundRuntimeCycle(evaluatedEntry.session, scheduler);
      const updatedEntry: BackgroundQueuedSession = {
        ...evaluatedEntry,
        session: runResult.session,
        status: mapRunStatusToQueuedStatus(runResult.status),
        last_run_result: runResult,
      };
      nextQueue.sessions[index] = updatedEntry;
      runResults.push(runResult);
      blockers.push(...runResult.blockers);
      sessionsRun += 1;

      if (updatedEntry.status === "completed") {
        sessionsCompleted += 1;
      }

      if (updatedEntry.status === "paused") {
        sessionsPaused += 1;
        status = "queue_paused";
        nextOperatorAction = "Review the paused session before the next operator-away queue pass.";
        safeToContinueLater = true;
        if (nextQueue.policy.stop_on_first_failure) {
          break;
        }
      }

      if (updatedEntry.status === "blocked") {
        if (nextQueue.policy.skip_blocked_sessions) {
          nextQueue.sessions[index] = {
            ...updatedEntry,
            status: "skipped",
          };
          sessionsSkipped += 1;
        } else {
          sessionsBlocked += 1;
          status = "queue_blocked";
          nextOperatorAction = "Resolve the blocked session before the next operator-away queue pass.";
          safeToContinueLater = false;
          break;
        }
      }
    }
  }

  if (status === "queue_completed") {
    if (sessionsPaused > 0) {
      status = "queue_paused";
      nextOperatorAction = "Review the paused sessions before the next operator-away queue pass.";
      safeToContinueLater = true;
    } else if (sessionsBlocked > 0) {
      status = nextQueue.policy.skip_blocked_sessions ? "queue_completed" : "queue_blocked";
      nextOperatorAction = nextQueue.policy.skip_blocked_sessions
        ? "Review the skipped blocked sessions and rerun the queue when they are safe again."
        : "Resolve the blocked sessions before another queue pass.";
      safeToContinueLater = nextQueue.policy.skip_blocked_sessions;
    } else if (sessionsConsidered === 0) {
      status = "queue_idle";
      nextOperatorAction = "Enqueue background-capable sessions before running the queue.";
      safeToContinueLater = false;
    }
  }

  return buildQueueResult({
    status,
    queue: nextQueue,
    goal_schedule: goalSchedule,
    run_results: runResults,
    blockers: uniqueBlockers(blockers),
    sessions_considered: sessionsConsidered,
    sessions_run: sessionsRun,
    sessions_skipped: sessionsSkipped,
    sessions_paused: sessionsPaused,
    sessions_blocked: sessionsBlocked,
    sessions_completed: sessionsCompleted,
    next_operator_action: nextOperatorAction,
    safe_to_continue_later: safeToContinueLater,
  });
}

export function buildQueueRunReport(result: BackgroundQueueResult): BackgroundQueueReport {
  return {
    report_id: `background-queue-report-${sanitizeTimestamp(result.queue.created_at)}-${result.queue.queue_id}`,
    created_at: result.queue.created_at,
    queue_status: result.status,
    sessions_considered: result.sessions_considered,
    sessions_run: result.sessions_run,
    sessions_skipped: result.sessions_skipped,
    sessions_paused: result.sessions_paused,
    sessions_blocked: result.sessions_blocked,
    sessions_completed: result.sessions_completed,
    blockers: result.blockers,
    next_operator_action: result.next_operator_action,
    safe_to_continue_later: result.safe_to_continue_later,
  };
}

export function summarizeBackgroundQueue(result: BackgroundQueueResult): string {
  return [
    `Background queue status: ${result.status}`,
    summarizeGoalScheduler(result.goal_schedule).replace(/\n/g, " | "),
    `Sessions considered: ${result.sessions_considered}`,
    `Sessions run: ${result.sessions_run}`,
    `Sessions skipped: ${result.sessions_skipped}`,
    `Sessions paused: ${result.sessions_paused}`,
    `Sessions blocked: ${result.sessions_blocked}`,
    `Sessions completed: ${result.sessions_completed}`,
    `Next operator action: ${result.next_operator_action}`,
    `Latest session run: ${result.run_results.at(-1) ? summarizeBackgroundRun(result.run_results.at(-1)!).replace(/\n/g, " | ") : "none"}`,
  ].join("\n");
}
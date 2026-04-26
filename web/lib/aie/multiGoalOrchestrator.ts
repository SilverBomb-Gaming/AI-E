import type { AutonomousWorkSession } from "./autonomousWorkSession";

export type GoalPriority = "high" | "medium" | "low";

export type GoalStatus = "pending" | "active" | "paused" | "completed" | "blocked";

export type GoalRecord = {
  id: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  created_at: string;
  last_updated_at: string;
  conflicts_with_goal_ids: string[];
};

export type GoalQueue = {
  goals: GoalRecord[];
};

export type GoalSchedulerResult = {
  status: "goal_selected" | "no_runnable_goals";
  next_goal: GoalRecord | null;
  ordered_goals: GoalRecord[];
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseTimestamp(value: string | null | undefined): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function cloneGoal(goal: GoalRecord): GoalRecord {
  return {
    ...goal,
    conflicts_with_goal_ids: [...goal.conflicts_with_goal_ids],
  };
}

function cloneGoalQueue(queue: GoalQueue): GoalQueue {
  return {
    goals: queue.goals.map((goal) => cloneGoal(goal)),
  };
}

function priorityRank(priority: GoalPriority): number {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

function statusRank(status: GoalStatus): number {
  switch (status) {
    case "active":
      return 0;
    case "pending":
      return 1;
    case "paused":
      return 2;
    case "blocked":
      return 3;
    case "completed":
      return 4;
  }
}

function isRunnable(goal: GoalRecord): boolean {
  return goal.status === "active" || goal.status === "pending";
}

function goalsConflict(left: GoalRecord, right: GoalRecord): boolean {
  if (left.id === right.id) {
    return false;
  }

  return left.conflicts_with_goal_ids.includes(right.id) || right.conflicts_with_goal_ids.includes(left.id);
}

function compareGoals(left: GoalRecord, right: GoalRecord): number {
  const runnableLeft = isRunnable(left) ? 0 : 1;
  const runnableRight = isRunnable(right) ? 0 : 1;
  if (runnableLeft !== runnableRight) {
    return runnableLeft - runnableRight;
  }

  const leftStatusRank = statusRank(left.status);
  const rightStatusRank = statusRank(right.status);
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  const leftPriorityRank = priorityRank(left.priority);
  const rightPriorityRank = priorityRank(right.priority);
  if (leftPriorityRank !== rightPriorityRank) {
    return leftPriorityRank - rightPriorityRank;
  }

  const leftCreatedAt = parseTimestamp(left.created_at);
  const rightCreatedAt = parseTimestamp(right.created_at);
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  const leftUpdatedAt = parseTimestamp(left.last_updated_at);
  const rightUpdatedAt = parseTimestamp(right.last_updated_at);
  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt - rightUpdatedAt;
  }

  return left.id.localeCompare(right.id);
}

function mapSessionStatusToGoalStatus(session: AutonomousWorkSession): GoalStatus {
  switch (session.status) {
    case "session_running":
      return "active";
    case "session_paused":
    case "awaiting_session_approval":
      return "paused";
    case "session_blocked":
      return "blocked";
    case "session_completed":
      return "completed";
    case "session_planned":
    default:
      return "pending";
  }
}

export function createGoalRecord(input: {
  id: string;
  description: string;
  priority?: GoalPriority;
  status?: GoalStatus;
  created_at: string;
  last_updated_at?: string;
  conflicts_with_goal_ids?: string[];
}): GoalRecord {
  return {
    id: normalizeText(input.id),
    description: normalizeText(input.description),
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    created_at: input.created_at,
    last_updated_at: input.last_updated_at ?? input.created_at,
    conflicts_with_goal_ids: [...(input.conflicts_with_goal_ids ?? [])].sort((left, right) => left.localeCompare(right)),
  };
}

export function createGoalQueue(goals: GoalRecord[] = []): GoalQueue {
  return {
    goals: goals.map((goal) => cloneGoal(goal)),
  };
}

export function insertGoal(queue: GoalQueue, goal: GoalRecord): GoalQueue {
  const nextQueue = cloneGoalQueue(queue);
  return {
    goals: [...nextQueue.goals, cloneGoal(goal)],
  };
}

export function removeGoal(queue: GoalQueue, goalId: string): GoalQueue {
  return {
    goals: queue.goals.filter((goal) => goal.id !== goalId).map((goal) => cloneGoal(goal)),
  };
}

export function reprioritizeGoal(queue: GoalQueue, goalId: string, priority: GoalPriority, updatedAt?: string): GoalQueue {
  return {
    goals: queue.goals.map((goal) => goal.id === goalId
      ? {
          ...cloneGoal(goal),
          priority,
          last_updated_at: updatedAt ?? goal.last_updated_at,
        }
      : cloneGoal(goal)),
  };
}

export function createGoalRecordFromSession(
  session: AutonomousWorkSession,
  input: {
    priority?: GoalPriority;
    conflicts_with_goal_ids?: string[];
    created_at?: string;
    last_updated_at?: string;
  } = {},
): GoalRecord {
  return createGoalRecord({
    id: session.session_id,
    description: session.operator_goal,
    priority: input.priority ?? "medium",
    status: mapSessionStatusToGoalStatus(session),
    created_at: input.created_at ?? session.created_at,
    last_updated_at: input.last_updated_at ?? session.updated_at,
    conflicts_with_goal_ids: input.conflicts_with_goal_ids,
  });
}

export function scheduleNextGoal(queue: GoalQueue): GoalSchedulerResult {
  const orderedGoals = [...queue.goals].map((goal) => cloneGoal(goal)).sort(compareGoals);
  if (orderedGoals.length === 0) {
    return {
      status: "no_runnable_goals",
      next_goal: null,
      ordered_goals: orderedGoals,
      reason: "No goals were queued for orchestration.",
    };
  }

  const activeGoals = orderedGoals.filter((goal) => goal.status === "active");
  if (activeGoals.length > 1) {
    return {
      status: "no_runnable_goals",
      next_goal: null,
      ordered_goals: orderedGoals,
      reason: "Multiple active goals were detected, so the scheduler refused to pick another goal.",
    };
  }

  for (const goal of orderedGoals) {
    if (!isRunnable(goal)) {
      continue;
    }

    const conflictingActiveGoal = activeGoals.find((activeGoal) => goalsConflict(goal, activeGoal));
    if (conflictingActiveGoal) {
      continue;
    }

    return {
      status: "goal_selected",
      next_goal: goal,
      ordered_goals: orderedGoals,
      reason: goal.status === "active"
        ? `Continuing active goal '${goal.description}'.`
        : `Selected next runnable goal '${goal.description}'.`,
    };
  }

  return {
    status: "no_runnable_goals",
    next_goal: null,
    ordered_goals: orderedGoals,
    reason: "All queued goals are paused, blocked, completed, or conflict with an active goal.",
  };
}

export function summarizeGoalScheduler(result: GoalSchedulerResult): string {
  return [
    `Goal orchestration status: ${result.status}`,
    `Next runnable goal: ${result.next_goal ? result.next_goal.description : "none"}`,
    `Ordered goals: ${result.ordered_goals.length > 0 ? result.ordered_goals.map((goal) => `${goal.priority}:${goal.status}:${goal.description}`).join(" | ") : "none"}`,
    `Reason: ${result.reason}`,
  ].join("\n");
}
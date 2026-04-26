import type { AutonomousWorkSession } from "./autonomousWorkSession";
import {
  createTaskDependencyGraph,
  detectCircularDependencies,
  evaluateTaskRunnable,
  type TaskGraphEdge,
  type TaskGraphNode,
  type TaskRunnableEvaluation,
} from "./taskDependencyGraph";

export type GoalPriority = "high" | "medium" | "low";

export type GoalStatus = "pending" | "active" | "paused" | "completed" | "blocked";

export type GoalRecord = {
  id: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  created_at: string;
  last_updated_at: string;
  depends_on_goal_ids: string[];
  blocks_goal_ids: string[];
  conflicts_with_goal_ids: string[];
  related_goal_ids: string[];
};

export type GoalQueue = {
  goals: GoalRecord[];
};

export type GoalSchedulerResult = {
  status: "goal_selected" | "no_runnable_goals";
  selected_goal: GoalRecord | null;
  next_goal: GoalRecord | null;
  ordered_goals: GoalRecord[];
  runnable_goals: GoalRecord[];
  skipped_goals: GoalRecord[];
  dependency_blockers: Array<{ goal_id: string; blocker_ids: string[]; explanation: string }>;
  conflict_blockers: Array<{ goal_id: string; conflicting_goal_ids: string[]; explanation: string }>;
  scheduling_reason: string;
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
    depends_on_goal_ids: [...goal.depends_on_goal_ids],
    blocks_goal_ids: [...goal.blocks_goal_ids],
    conflicts_with_goal_ids: [...goal.conflicts_with_goal_ids],
    related_goal_ids: [...goal.related_goal_ids],
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
  depends_on_goal_ids?: string[];
  blocks_goal_ids?: string[];
  conflicts_with_goal_ids?: string[];
  related_goal_ids?: string[];
}): GoalRecord {
  return {
    id: normalizeText(input.id),
    description: normalizeText(input.description),
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    created_at: input.created_at,
    last_updated_at: input.last_updated_at ?? input.created_at,
    depends_on_goal_ids: [...(input.depends_on_goal_ids ?? [])].sort((left, right) => left.localeCompare(right)),
    blocks_goal_ids: [...(input.blocks_goal_ids ?? [])].sort((left, right) => left.localeCompare(right)),
    conflicts_with_goal_ids: [...(input.conflicts_with_goal_ids ?? [])].sort((left, right) => left.localeCompare(right)),
    related_goal_ids: [...(input.related_goal_ids ?? [])].sort((left, right) => left.localeCompare(right)),
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
    depends_on_goal_ids?: string[];
    blocks_goal_ids?: string[];
    conflicts_with_goal_ids?: string[];
    related_goal_ids?: string[];
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
    depends_on_goal_ids: input.depends_on_goal_ids,
    blocks_goal_ids: input.blocks_goal_ids,
    conflicts_with_goal_ids: input.conflicts_with_goal_ids,
    related_goal_ids: input.related_goal_ids,
  });
}

function toTaskGraphNode(goal: GoalRecord): TaskGraphNode {
  return {
    id: goal.id,
    description: goal.description,
    priority: goal.priority,
    status: goal.status,
    created_at: goal.created_at,
    last_updated_at: goal.last_updated_at,
  };
}

function toTaskGraphEdges(goal: GoalRecord): TaskGraphEdge[] {
  return [
    ...goal.depends_on_goal_ids.map((dependencyGoalId) => ({
      from_task_id: goal.id,
      to_task_id: dependencyGoalId,
      type: "depends_on" as const,
      reason: `${goal.description} depends on ${dependencyGoalId}.`,
    })),
    ...goal.blocks_goal_ids.map((blockedGoalId) => ({
      from_task_id: goal.id,
      to_task_id: blockedGoalId,
      type: "blocks" as const,
      reason: `${goal.description} blocks ${blockedGoalId} until it completes.`,
    })),
    ...goal.conflicts_with_goal_ids.map((conflictingGoalId) => ({
      from_task_id: goal.id,
      to_task_id: conflictingGoalId,
      type: "conflicts_with" as const,
      reason: `${goal.description} conflicts with ${conflictingGoalId}.`,
    })),
    ...goal.related_goal_ids.map((relatedGoalId) => ({
      from_task_id: goal.id,
      to_task_id: relatedGoalId,
      type: "related_to" as const,
      reason: `${goal.description} is related to ${relatedGoalId}.`,
    })),
  ];
}

function isRunnableStatus(goal: GoalRecord): boolean {
  return goal.status === "active" || goal.status === "pending";
}

function buildBlockedResult(
  orderedGoals: GoalRecord[],
  reason: string,
  skippedGoals: GoalRecord[],
  runnableGoals: GoalRecord[] = [],
  dependencyBlockers: GoalSchedulerResult["dependency_blockers"] = [],
  conflictBlockers: GoalSchedulerResult["conflict_blockers"] = [],
): GoalSchedulerResult {
  return {
    status: "no_runnable_goals",
    selected_goal: null,
    next_goal: null,
    ordered_goals: orderedGoals,
    runnable_goals: runnableGoals,
    skipped_goals: skippedGoals,
    dependency_blockers: dependencyBlockers,
    conflict_blockers: conflictBlockers,
    scheduling_reason: reason,
    reason,
  };
}

export function scheduleNextGoal(queue: GoalQueue): GoalSchedulerResult {
  const orderedGoals = [...queue.goals].map((goal) => cloneGoal(goal)).sort(compareGoals);
  if (orderedGoals.length === 0) {
    return buildBlockedResult(orderedGoals, "No goals were queued for orchestration.", []);
  }

  const graph = createTaskDependencyGraph(
    orderedGoals.map((goal) => toTaskGraphNode(goal)),
    orderedGoals.flatMap((goal) => toTaskGraphEdges(goal)),
  );
  const circularDependencies = detectCircularDependencies(graph);

  if (circularDependencies.length > 0) {
    return buildBlockedResult(
      orderedGoals,
      `Circular dependencies detected: ${circularDependencies.map((cycle) => cycle.join(" -> ")).join(" | ")}.`,
      orderedGoals.filter((goal) => isRunnableStatus(goal)),
    );
  }

  const activeGoals = orderedGoals.filter((goal) => goal.status === "active");
  if (activeGoals.length > 1) {
    return buildBlockedResult(orderedGoals, "Multiple active goals were detected, so the scheduler refused to pick another goal.", activeGoals);
  }

  const skippedGoals: GoalRecord[] = [];
  const runnableGoals: GoalRecord[] = [];
  const dependencyBlockers: GoalSchedulerResult["dependency_blockers"] = [];
  const conflictBlockers: GoalSchedulerResult["conflict_blockers"] = [];
  let selectedGoal: GoalRecord | null = null;

  for (const goal of orderedGoals) {
    if (!isRunnable(goal)) {
      skippedGoals.push(goal);
      continue;
    }

    const runnableEvaluation: TaskRunnableEvaluation = evaluateTaskRunnable(graph, goal.id);
    if (!runnableEvaluation.runnable) {
      skippedGoals.push(goal);
      if (runnableEvaluation.status === "dependency_blocked" || runnableEvaluation.status === "circular_dependency_blocked") {
        dependencyBlockers.push({
          goal_id: goal.id,
          blocker_ids: runnableEvaluation.incomplete_dependencies.length > 0
            ? runnableEvaluation.incomplete_dependencies
            : runnableEvaluation.circular_dependency_paths.flatMap((path) => path),
          explanation: runnableEvaluation.explanation,
        });
      }
      if (runnableEvaluation.status === "conflict_blocked") {
        conflictBlockers.push({
          goal_id: goal.id,
          conflicting_goal_ids: runnableEvaluation.active_conflicts.map((conflict) => conflict.conflicting_task_id),
          explanation: runnableEvaluation.explanation,
        });
      }
      continue;
    }

    const conflictingActiveGoal = activeGoals.find((activeGoal) => goalsConflict(goal, activeGoal));
    if (conflictingActiveGoal) {
      skippedGoals.push(goal);
      conflictBlockers.push({
        goal_id: goal.id,
        conflicting_goal_ids: [conflictingActiveGoal.id],
        explanation: `${goal.description} conflicts with active goal ${conflictingActiveGoal.description}.`,
      });
      continue;
    }

    if (!selectedGoal) {
      selectedGoal = goal;
    }
    runnableGoals.push(goal);
  }

  if (selectedGoal) {
    const reason = selectedGoal.status === "active"
      ? `Continuing active goal '${selectedGoal.description}'.`
      : `Selected next runnable goal '${selectedGoal.description}'.`;

    return {
      status: "goal_selected",
      selected_goal: selectedGoal,
      next_goal: selectedGoal,
      ordered_goals: orderedGoals,
      runnable_goals: runnableGoals,
      skipped_goals: skippedGoals,
      dependency_blockers: dependencyBlockers,
      conflict_blockers: conflictBlockers,
      scheduling_reason: reason,
      reason,
    };
  }

  return buildBlockedResult(
    orderedGoals,
    "All queued goals are paused, blocked, completed, dependency-blocked, or conflict with an active goal.",
    skippedGoals,
    runnableGoals,
    dependencyBlockers,
    conflictBlockers,
  );
}

export function summarizeGoalScheduler(result: GoalSchedulerResult): string {
  return [
    `Goal orchestration status: ${result.status}`,
    `Next runnable goal: ${result.selected_goal ? result.selected_goal.description : "none"}`,
    `Ordered goals: ${result.ordered_goals.length > 0 ? result.ordered_goals.map((goal) => `${goal.priority}:${goal.status}:${goal.description}`).join(" | ") : "none"}`,
    `Runnable goals: ${result.runnable_goals.length > 0 ? result.runnable_goals.map((goal) => goal.id).join(", ") : "none"}`,
    `Dependency blockers: ${result.dependency_blockers.length > 0 ? result.dependency_blockers.map((blocker) => `${blocker.goal_id}->${blocker.blocker_ids.join(",")}`).join(" | ") : "none"}`,
    `Conflict blockers: ${result.conflict_blockers.length > 0 ? result.conflict_blockers.map((blocker) => `${blocker.goal_id}->${blocker.conflicting_goal_ids.join(",")}`).join(" | ") : "none"}`,
    `Reason: ${result.scheduling_reason}`,
  ].join("\n");
}
import {
  createGoalQueue,
  createGoalRecordFromSession,
  scheduleNextGoal,
  type GoalPriority,
  type GoalQueue,
  type GoalRecord,
  type GoalSchedulerResult,
  type GoalStatus,
} from "./multiGoalOrchestrator";
import {
  createTaskDependencyGraph,
  evaluateTaskRunnable,
  type TaskDependencyGraph,
  type TaskGraphEdge,
  type TaskGraphNode,
  type TaskRunnableEvaluation,
} from "./taskDependencyGraph";
import type {
  BackgroundQueuedSession,
  BackgroundQueueResult,
  BackgroundQueueStatus,
  BackgroundSessionQueue,
} from "./backgroundSessionQueue";
import type { BackgroundRunResult } from "./backgroundRuntimeScheduler";
import type { SessionRuntimeResult } from "./sessionRuntime";
import type {
  FailureCategory,
  FailureSeverity,
  RecoveryRecommendation,
  RecoveryReport,
} from "./failureRecoveryIntelligence";
import type { AgentRuntimeNode } from "./agentRuntimeRegistry";
import type { ExecutionChainRecord } from "./executionChainState";

export type OperatorDashboardGoal = {
  goal_id: string;
  description: string;
  priority: GoalPriority;
  status: GoalStatus;
  explanation: string;
  recommended_action: string | null;
  depends_on_goal_ids: string[];
  blocking_goal_ids: string[];
  conflict_goal_ids: string[];
  last_updated_at: string;
};

export type OperatorDashboardBlockedGoal = OperatorDashboardGoal & {
  blocker_type: "dependency" | "conflict" | "status";
  blocker_ids: string[];
};

export type OperatorDashboardBlocker = {
  goal_id: string;
  blocker_ids: string[];
  explanation: string;
};

export type OperatorDashboardFailure = {
  report_id: string;
  created_at: string;
  source: string;
  category: FailureCategory;
  severity: FailureSeverity;
  recommendation: RecoveryRecommendation;
  reason: string;
};

export type OperatorDashboardRecoveryRecommendation = {
  report_id: string;
  source: string;
  category: FailureCategory;
  severity: FailureSeverity;
  recommendation: RecoveryRecommendation;
  retry_safe: boolean;
  operator_review_required: boolean;
  reason: string;
};

export type OperatorDashboardApprovalRequirement = {
  goal_id: string | null;
  approvals_needed: string[];
  reason: string;
  recommended_action: string;
};

export type OperatorDashboardValidationIssue = {
  goal_id: string | null;
  source: string;
  status: string;
  recommendation: string | null;
  summary: string;
};

export type OperatorDashboardStatusLine = {
  status: string;
  explanation: string;
};

export type OperatorRuntimeObservabilityEvent = {
  tick_id: string;
  event_id: string;
  runtime_id: string;
  timestamp: string;
  tick_index: number;
  event_type: "tick_executed" | "goal_transition" | "tick_blocked" | "tick_observed";
  attempted_at: string;
  status: string;
  reason: string;
  active_goal_before: {
    goal_id: string | null;
    goal_label: string | null;
  } | null;
  active_goal_after: {
    goal_id: string | null;
    goal_label: string | null;
  } | null;
  mutation_applied: string | null;
  safety_gate_result: "passed" | "blocked" | "not_triggered";
  scheduler_decision: string | null;
  persistence_result: "persisted_to_runtime_state";
  goal_transition: {
    changed: boolean;
    from_goal_id: string | null;
    to_goal_id: string | null;
    from_goal_label: string | null;
    to_goal_label: string | null;
    summary: string;
  } | null;
  semantic_progression: {
    queue_count_before: number;
    queue_count_after: number;
    blocked_count_before: number;
    blocked_count_after: number;
    runtime_status_before: string;
    runtime_status_after: string;
    scheduler_status_before: string;
    scheduler_status_after: string;
  } | null;
  mutation_summary: string | null;
  next_scheduled_action: string | null;
};

export type OperatorRuntimeObservability = {
  current_tick: number;
  last_tick_at: string | null;
  last_mutation: string | null;
  last_semantic_transition: string | null;
  latest_safety_gate_decision: string | null;
  next_scheduled_action: string | null;
  next_scheduled_tick_at: string | null;
  event_log: OperatorRuntimeObservabilityEvent[];
};

export type OperatorDashboardAgentRuntime = {
  agents: AgentRuntimeNode[];
  active_agents: AgentRuntimeNode[];
  idle_agents: AgentRuntimeNode[];
  blocked_agents: AgentRuntimeNode[];
  paused_agents: AgentRuntimeNode[];
};

export type OperatorDashboardActionItem = {
  kind: "approval" | "dependency" | "conflict" | "recovery" | "validation";
  goal_id: string | null;
  title: string;
  reason: string;
  recommended_action: string;
  priority: "high" | "medium" | "low";
};

export type OperatorDashboardState = {
  active_goal: OperatorDashboardGoal | null;
  queued_goals: OperatorDashboardGoal[];
  blocked_goals: OperatorDashboardBlockedGoal[];
  completed_goals: OperatorDashboardGoal[];
  paused_goals: OperatorDashboardGoal[];
  dependency_blockers: OperatorDashboardBlocker[];
  conflict_blockers: OperatorDashboardBlocker[];
  recent_failures: OperatorDashboardFailure[];
  recovery_recommendations: OperatorDashboardRecoveryRecommendation[];
  approvals_required: OperatorDashboardApprovalRequirement[];
  validation_issues: OperatorDashboardValidationIssue[];
  runtime_status: OperatorDashboardStatusLine;
  session_status: OperatorDashboardStatusLine;
  queue_status: OperatorDashboardStatusLine;
  scheduler_status: OperatorDashboardStatusLine;
  runtime_observability?: OperatorRuntimeObservability;
  agent_runtime?: OperatorDashboardAgentRuntime;
  execution_chains?: ExecutionChainRecord[];
  last_updated_at: string;
};

export type OperatorDashboardContext = {
  goal_queue?: GoalQueue;
  goal_schedule?: GoalSchedulerResult | null;
  task_graph?: TaskDependencyGraph | null;
  background_queue?: BackgroundSessionQueue | null;
  background_queue_result?: BackgroundQueueResult | null;
  background_run_result?: BackgroundRunResult | null;
  runtime_result?: SessionRuntimeResult | null;
  recovery_reports?: RecoveryReport[];
  generated_at?: string;
};

const EMPTY_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseTimestamp(value: string | null | undefined): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }

  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => normalizeText(value).length > 0))].sort((left, right) => left.localeCompare(right));
}

function sortByTimestampDesc<T extends { created_at: string }>(left: T, right: T): number {
  const timestampDelta = parseTimestamp(right.created_at) - parseTimestamp(left.created_at);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
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

function sortGoals(left: GoalRecord, right: GoalRecord): number {
  const leftStatus = statusRank(left.status);
  const rightStatus = statusRank(right.status);
  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }

  const leftPriority = priorityRank(left.priority);
  const rightPriority = priorityRank(right.priority);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  const updatedDelta = parseTimestamp(left.last_updated_at) - parseTimestamp(right.last_updated_at);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return left.id.localeCompare(right.id);
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

function mergeGoalRecord(existing: GoalRecord | undefined, next: GoalRecord): GoalRecord {
  if (!existing) {
    return cloneGoal(next);
  }

  const existingUpdated = parseTimestamp(existing.last_updated_at);
  const nextUpdated = parseTimestamp(next.last_updated_at);
  const preferred = nextUpdated >= existingUpdated ? next : existing;
  const fallback = preferred === next ? existing : next;

  return {
    ...cloneGoal(preferred),
    description: normalizeText(preferred.description) || fallback.description,
    priority: priorityRank(preferred.priority) <= priorityRank(fallback.priority) ? preferred.priority : fallback.priority,
    status: statusRank(preferred.status) <= statusRank(fallback.status) ? preferred.status : fallback.status,
    depends_on_goal_ids: unique([...preferred.depends_on_goal_ids, ...fallback.depends_on_goal_ids]),
    blocks_goal_ids: unique([...preferred.blocks_goal_ids, ...fallback.blocks_goal_ids]),
    conflicts_with_goal_ids: unique([...preferred.conflicts_with_goal_ids, ...fallback.conflicts_with_goal_ids]),
    related_goal_ids: unique([...preferred.related_goal_ids, ...fallback.related_goal_ids]),
    last_updated_at: nextUpdated >= existingUpdated ? next.last_updated_at : existing.last_updated_at,
  };
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

function goalRecordFromQueuedSession(queuedSession: BackgroundQueuedSession): GoalRecord {
  return createGoalRecordFromSession(queuedSession.session, {
    priority: queuedSession.goal_priority,
    depends_on_goal_ids: queuedSession.dependency_goal_ids,
    blocks_goal_ids: queuedSession.blocking_goal_ids,
    conflicts_with_goal_ids: queuedSession.conflict_goal_ids,
    related_goal_ids: queuedSession.related_goal_ids,
    created_at: queuedSession.enqueued_at,
    last_updated_at: queuedSession.last_run_result?.session.updated_at ?? queuedSession.session.updated_at,
  });
}

function collectGoalRecords(context: OperatorDashboardContext): GoalRecord[] {
  const goalMap = new Map<string, GoalRecord>();

  for (const goal of context.goal_queue?.goals ?? []) {
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  for (const goal of context.goal_schedule?.ordered_goals ?? []) {
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  for (const queuedSession of context.background_queue?.sessions ?? []) {
    const goal = goalRecordFromQueuedSession(queuedSession);
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  for (const queuedSession of context.background_queue_result?.queue.sessions ?? []) {
    const goal = goalRecordFromQueuedSession(queuedSession);
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  if (context.background_run_result) {
    const goal = createGoalRecordFromSession(context.background_run_result.session, {
      created_at: context.background_run_result.session.created_at,
      last_updated_at: context.background_run_result.session.updated_at,
    });
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  if (context.runtime_result) {
    const goal = createGoalRecordFromSession(context.runtime_result.session, {
      created_at: context.runtime_result.session.created_at,
      last_updated_at: context.runtime_result.session.updated_at,
    });
    goalMap.set(goal.id, mergeGoalRecord(goalMap.get(goal.id), goal));
  }

  return [...goalMap.values()].sort(sortGoals);
}

function deriveGoalSchedule(context: OperatorDashboardContext, goals: GoalRecord[]): GoalSchedulerResult {
  if (context.goal_schedule) {
    return context.goal_schedule;
  }
  return scheduleNextGoal(createGoalQueue(goals));
}

function deriveTaskGraph(context: OperatorDashboardContext, goals: GoalRecord[]): TaskDependencyGraph {
  if (context.task_graph) {
    return context.task_graph;
  }

  return createTaskDependencyGraph(
    goals.map((goal) => toTaskGraphNode(goal)),
    goals.flatMap((goal) => toTaskGraphEdges(goal)),
  );
}

function goalExplanation(goal: GoalRecord, selectedGoalId: string | null, blockedReasons: Map<string, { explanation: string; recommended_action: string | null }>): string {
  if (selectedGoalId && goal.id === selectedGoalId) {
    return goal.status === "active"
      ? `This goal is currently running because it already owns the active execution slot.`
      : `This goal is selected next because it is the highest-priority runnable goal.`;
  }

  const blocked = blockedReasons.get(goal.id);
  if (blocked) {
    return blocked.explanation;
  }

  switch (goal.status) {
    case "completed":
      return "This goal is complete and no longer needs runtime attention.";
    case "paused":
      return "This goal is paused and requires explicit operator review or resume.";
    case "blocked":
      return "This goal is blocked by its current session or validation state.";
    case "active":
      return "This goal is active and has current runtime ownership.";
    case "pending":
    default:
      return "This goal is queued and waiting for selection.";
  }
}

function toGoalSnapshot(
  goal: GoalRecord,
  selectedGoalId: string | null,
  blockedReasons: Map<string, { explanation: string; recommended_action: string | null }>,
): OperatorDashboardGoal {
  const blocked = blockedReasons.get(goal.id);
  return {
    goal_id: goal.id,
    description: goal.description,
    priority: goal.priority,
    status: goal.status,
    explanation: goalExplanation(goal, selectedGoalId, blockedReasons),
    recommended_action: blocked?.recommended_action ?? null,
    depends_on_goal_ids: [...goal.depends_on_goal_ids],
    blocking_goal_ids: [...goal.blocks_goal_ids],
    conflict_goal_ids: [...goal.conflicts_with_goal_ids],
    last_updated_at: goal.last_updated_at,
  };
}

function buildBlockerMaps(
  goals: GoalRecord[],
  graph: TaskDependencyGraph,
  goalSchedule: GoalSchedulerResult,
): {
  dependency_blockers: OperatorDashboardBlocker[];
  conflict_blockers: OperatorDashboardBlocker[];
  blocked_goals: OperatorDashboardBlockedGoal[];
  blocked_reason_map: Map<string, { explanation: string; recommended_action: string | null }>;
} {
  const goalMap = new Map(goals.map((goal) => [goal.id, goal]));
  const dependencyMap = new Map<string, OperatorDashboardBlocker>();
  const conflictMap = new Map<string, OperatorDashboardBlocker>();

  const dependencyExplanation = (goal: GoalRecord, blockerIds: string[]): string => {
    return `${goal.description} depends_on ${blockerIds.join(", ")}.`;
  };

  const conflictExplanation = (goal: GoalRecord, blockerIds: string[]): string => {
    return `${goal.description} conflicts_with ${blockerIds.join(", ")}.`;
  };

  for (const blocker of goalSchedule.dependency_blockers) {
    dependencyMap.set(blocker.goal_id, {
      goal_id: blocker.goal_id,
      blocker_ids: [...blocker.blocker_ids].sort((left, right) => left.localeCompare(right)),
      explanation: blocker.explanation,
    });
  }

  for (const blocker of goalSchedule.conflict_blockers) {
    conflictMap.set(blocker.goal_id, {
      goal_id: blocker.goal_id,
      blocker_ids: [...blocker.conflicting_goal_ids].sort((left, right) => left.localeCompare(right)),
      explanation: blocker.explanation,
    });
  }

  for (const goal of goals) {
    const evaluation: TaskRunnableEvaluation = evaluateTaskRunnable(graph, goal.id);
    if (evaluation.status === "dependency_blocked" || evaluation.status === "circular_dependency_blocked") {
      if (!dependencyMap.has(goal.id)) {
        dependencyMap.set(goal.id, {
          goal_id: goal.id,
          blocker_ids: evaluation.incomplete_dependencies.length > 0
            ? [...evaluation.incomplete_dependencies].sort((left, right) => left.localeCompare(right))
            : unique(evaluation.circular_dependency_paths.flatMap((path) => path)),
          explanation: evaluation.explanation,
        });
      }
    }

    if (evaluation.status === "conflict_blocked") {
      if (!conflictMap.has(goal.id)) {
        conflictMap.set(goal.id, {
          goal_id: goal.id,
          blocker_ids: evaluation.active_conflicts.map((conflict) => conflict.conflicting_task_id).sort((left, right) => left.localeCompare(right)),
          explanation: evaluation.explanation,
        });
      }
    }
  }

  const blockedReasonMap = new Map<string, { explanation: string; recommended_action: string | null }>();
  const blockedGoals: OperatorDashboardBlockedGoal[] = [];

  for (const blocker of [...dependencyMap.values()].sort((left, right) => left.goal_id.localeCompare(right.goal_id))) {
    const goal = goalMap.get(blocker.goal_id);
    if (!goal) {
      continue;
    }
    blockedReasonMap.set(goal.id, {
      explanation: dependencyExplanation(goal, blocker.blocker_ids),
      recommended_action: "Complete the prerequisite goal before scheduling this goal again.",
    });
    blockedGoals.push({
      ...toGoalSnapshot(goal, null, blockedReasonMap),
      blocker_type: "dependency",
      blocker_ids: [...blocker.blocker_ids],
      explanation: dependencyExplanation(goal, blocker.blocker_ids),
      recommended_action: "Complete the prerequisite goal before scheduling this goal again.",
    });
  }

  for (const blocker of [...conflictMap.values()].sort((left, right) => left.goal_id.localeCompare(right.goal_id))) {
    const goal = goalMap.get(blocker.goal_id);
    if (!goal) {
      continue;
    }
    blockedReasonMap.set(goal.id, {
      explanation: conflictExplanation(goal, blocker.blocker_ids),
      recommended_action: "Resolve the conflicting active goal before scheduling this goal again.",
    });
    blockedGoals.push({
      ...toGoalSnapshot(goal, null, blockedReasonMap),
      blocker_type: "conflict",
      blocker_ids: [...blocker.blocker_ids],
      explanation: conflictExplanation(goal, blocker.blocker_ids),
      recommended_action: "Resolve the conflicting active goal before scheduling this goal again.",
    });
  }

  for (const goal of goals.filter((candidate) => candidate.status === "blocked").sort(sortGoals)) {
    if (blockedReasonMap.has(goal.id)) {
      continue;
    }
    blockedReasonMap.set(goal.id, {
      explanation: "This goal is blocked by its current session or validation boundary.",
      recommended_action: "Review the associated runtime or recovery state before resuming this goal.",
    });
    blockedGoals.push({
      ...toGoalSnapshot(goal, null, blockedReasonMap),
      blocker_type: "status",
      blocker_ids: [],
      explanation: "This goal is blocked by its current session or validation boundary.",
      recommended_action: "Review the associated runtime or recovery state before resuming this goal.",
    });
  }

  return {
    dependency_blockers: [...dependencyMap.values()].sort((left, right) => left.goal_id.localeCompare(right.goal_id)),
    conflict_blockers: [...conflictMap.values()].sort((left, right) => left.goal_id.localeCompare(right.goal_id)),
    blocked_goals: blockedGoals.sort((left, right) => left.goal_id.localeCompare(right.goal_id)),
    blocked_reason_map: blockedReasonMap,
  };
}

function collectRecoveryReports(context: OperatorDashboardContext): RecoveryReport[] {
  const reports = new Map<string, RecoveryReport>();
  const addReport = (report: RecoveryReport | null | undefined) => {
    if (!report) {
      return;
    }
    reports.set(report.report_id, report);
  };

  for (const report of context.recovery_reports ?? []) {
    addReport(report);
  }

  addReport(context.runtime_result?.recovery_report);
  addReport(context.background_run_result?.recovery_report);

  for (const result of context.background_queue_result?.run_results ?? []) {
    addReport(result.recovery_report);
  }

  for (const queuedSession of context.background_queue_result?.queue.sessions ?? []) {
    addReport(queuedSession.last_run_result?.recovery_report);
  }

  for (const queuedSession of context.background_queue?.sessions ?? []) {
    addReport(queuedSession.last_run_result?.recovery_report);
  }

  return [...reports.values()].sort(sortByTimestampDesc);
}

function buildRecentFailures(reports: RecoveryReport[]): OperatorDashboardFailure[] {
  return reports.map((report) => ({
    report_id: report.report_id,
    created_at: report.created_at,
    source: report.source,
    category: report.decision.category,
    severity: report.decision.severity,
    recommendation: report.decision.recommendation,
    reason: report.decision.reason,
  }));
}

function buildRecoveryRecommendations(reports: RecoveryReport[]): OperatorDashboardRecoveryRecommendation[] {
  return reports.map((report) => ({
    report_id: report.report_id,
    source: report.source,
    category: report.decision.category,
    severity: report.decision.severity,
    recommendation: report.decision.recommendation,
    retry_safe: report.decision.retry_safe,
    operator_review_required: report.decision.operator_review_required,
    reason: report.decision.reason,
  }));
}

function collectApprovalsRequired(context: OperatorDashboardContext, reports: RecoveryReport[]): OperatorDashboardApprovalRequirement[] {
  const approvalMap = new Map<string, OperatorDashboardApprovalRequirement>();
  const addApproval = (approval: OperatorDashboardApprovalRequirement) => {
    const key = `${approval.goal_id ?? "none"}:${approval.approvals_needed.join(",")}:${approval.reason}`;
    approvalMap.set(key, approval);
  };

  const addFromRunResult = (runResult: BackgroundRunResult | null | undefined) => {
    if (!runResult) {
      return;
    }
    for (const blocker of runResult.blockers) {
      if ((blocker.approvals_needed ?? []).length === 0) {
        continue;
      }
      addApproval({
        goal_id: runResult.session.session_id,
        approvals_needed: [...(blocker.approvals_needed ?? [])].sort((left, right) => left.localeCompare(right)),
        reason: blocker.message,
        recommended_action: "Renew the required approvals before the next bounded run.",
      });
    }
  };

  addFromRunResult(context.background_run_result);
  for (const runResult of context.background_queue_result?.run_results ?? []) {
    addFromRunResult(runResult);
  }
  for (const queuedSession of context.background_queue_result?.queue.sessions ?? []) {
    addFromRunResult(queuedSession.last_run_result);
  }
  for (const queuedSession of context.background_queue?.sessions ?? []) {
    addFromRunResult(queuedSession.last_run_result);
  }

  if (context.runtime_result?.session.status === "awaiting_session_approval") {
    addApproval({
      goal_id: context.runtime_result.session.session_id,
      approvals_needed: ["session"],
      reason: context.runtime_result.explanation,
      recommended_action: "Grant or renew the required session approval before resuming this goal.",
    });
  }

  if (
    context.runtime_result
    && context.runtime_result.status === "runtime_paused"
    && /approval/i.test(context.runtime_result.explanation)
  ) {
    addApproval({
      goal_id: context.runtime_result.session.session_id,
      approvals_needed: ["session"],
      reason: context.runtime_result.explanation,
      recommended_action: "Grant or renew the required session approval before resuming this goal.",
    });
  }

  for (const report of reports) {
    if (report.decision.category !== "stale_approval") {
      continue;
    }
    const approvalsNeeded = unique(report.decision.blockers.flatMap((blocker) => blocker.approvals_needed ?? []));
    if (approvalsNeeded.length === 0) {
      continue;
    }
    addApproval({
      goal_id: null,
      approvals_needed: approvalsNeeded,
      reason: report.decision.reason,
      recommended_action: "Refresh the required approvals before another operator-away run.",
    });
  }

  return [...approvalMap.values()].sort((left, right) => {
    const goalDelta = (left.goal_id ?? "").localeCompare(right.goal_id ?? "");
    if (goalDelta !== 0) {
      return goalDelta;
    }
    return left.reason.localeCompare(right.reason);
  });
}

function collectValidationIssues(context: OperatorDashboardContext): OperatorDashboardValidationIssue[] {
  const issueMap = new Map<string, OperatorDashboardValidationIssue>();
  const addIssue = (issue: OperatorDashboardValidationIssue) => {
    const key = `${issue.goal_id ?? "none"}:${issue.source}:${issue.status}:${issue.summary}`;
    issueMap.set(key, issue);
  };

  const addSessionValidation = (goalId: string | null, source: string, session: { latest_persistence_record: { validation_snapshot: { status: string; recommendation: string } } }) => {
    const snapshot = session.latest_persistence_record.validation_snapshot;
    if (snapshot.status === "validation_passed") {
      return;
    }
    addIssue({
      goal_id: goalId,
      source,
      status: snapshot.status,
      recommendation: snapshot.recommendation,
      summary: `Validation ${snapshot.status} with recommendation ${snapshot.recommendation}.`,
    });
  };

  if (context.runtime_result) {
    addSessionValidation(context.runtime_result.session.session_id, "session_runtime", context.runtime_result.session);
  }

  if (context.background_run_result) {
    addSessionValidation(context.background_run_result.session.session_id, "background_runtime", context.background_run_result.session);
  }

  for (const queuedSession of context.background_queue_result?.queue.sessions ?? []) {
    addSessionValidation(queuedSession.session_id, "background_queue", queuedSession.session);
  }

  for (const queuedSession of context.background_queue?.sessions ?? []) {
    addSessionValidation(queuedSession.session_id, "background_queue", queuedSession.session);
  }

  return [...issueMap.values()].sort((left, right) => {
    const goalDelta = (left.goal_id ?? "").localeCompare(right.goal_id ?? "");
    if (goalDelta !== 0) {
      return goalDelta;
    }
    return left.summary.localeCompare(right.summary);
  });
}

function deriveRuntimeStatus(context: OperatorDashboardContext): OperatorDashboardStatusLine {
  if (context.runtime_result) {
    return {
      status: context.runtime_result.status,
      explanation: context.runtime_result.explanation,
    };
  }
  return {
    status: "runtime_idle",
    explanation: "No runtime state is currently active.",
  };
}

function deriveSessionStatus(context: OperatorDashboardContext): OperatorDashboardStatusLine {
  if (context.runtime_result) {
    return {
      status: context.runtime_result.session.status,
      explanation: context.runtime_result.session.session_report.pause_reason
        ?? context.runtime_result.session.session_report.completion_reason
        ?? context.runtime_result.session.session_report.summary,
    };
  }
  if (context.background_run_result) {
    return {
      status: context.background_run_result.session.status,
      explanation: context.background_run_result.stop_reason,
    };
  }
  return {
    status: "session_idle",
    explanation: "No autonomous work session is currently selected.",
  };
}

function deriveQueueStatus(context: OperatorDashboardContext): OperatorDashboardStatusLine {
  if (context.background_queue_result) {
    return {
      status: context.background_queue_result.status,
      explanation: context.background_queue_result.next_operator_action,
    };
  }
  if (context.background_queue) {
    const queueStatus: BackgroundQueueStatus = context.background_queue.sessions.length === 0 ? "queue_idle" : "queue_running";
    return {
      status: queueStatus,
      explanation: context.background_queue.sessions.length === 0
        ? "No background sessions are currently queued."
        : `${context.background_queue.sessions.length} background session(s) are currently queued.`,
    };
  }
  return {
    status: "queue_idle",
    explanation: "No background queue is currently active.",
  };
}

function deriveSchedulerStatus(context: OperatorDashboardContext, goalSchedule: GoalSchedulerResult): OperatorDashboardStatusLine {
  if (context.background_run_result) {
    return {
      status: context.background_run_result.status,
      explanation: context.background_run_result.stop_reason,
    };
  }

  return {
    status: goalSchedule.status === "goal_selected" ? "goal_selected" : "scheduler_idle",
    explanation: goalSchedule.reason,
  };
}

function deriveLastUpdatedAt(context: OperatorDashboardContext, goals: GoalRecord[], reports: RecoveryReport[]): string {
  const timestamps = [
    context.generated_at,
    ...goals.map((goal) => goal.last_updated_at),
    ...reports.map((report) => report.created_at),
    context.background_queue_result?.queue.created_at,
    context.background_queue?.created_at,
    context.background_run_result?.request.requested_at,
    context.runtime_result?.session.updated_at,
  ].map((value) => normalizeText(value)).filter(Boolean);

  if (timestamps.length === 0) {
    return EMPTY_TIMESTAMP;
  }

  return timestamps.sort((left, right) => parseTimestamp(right) - parseTimestamp(left) || left.localeCompare(right))[0] ?? EMPTY_TIMESTAMP;
}

function sortGoalSnapshots<T extends OperatorDashboardGoal>(goals: T[]): T[] {
  return [...goals].sort((left, right) => {
    const leftStatus = statusRank(left.status);
    const rightStatus = statusRank(right.status);
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }

    const leftPriority = priorityRank(left.priority);
    const rightPriority = priorityRank(right.priority);
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const updatedDelta = parseTimestamp(left.last_updated_at) - parseTimestamp(right.last_updated_at);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.goal_id.localeCompare(right.goal_id);
  });
}

export function buildOperatorDashboardState(context: OperatorDashboardContext): OperatorDashboardState {
  const goals = collectGoalRecords(context);
  const goalSchedule = deriveGoalSchedule(context, goals);
  const graph = deriveTaskGraph(context, goals);
  const blockerState = buildBlockerMaps(goals, graph, goalSchedule);
  const reports = collectRecoveryReports(context);
  const selectedGoalId = goalSchedule.selected_goal?.id ?? goals.find((goal) => goal.status === "active")?.id ?? null;

  const goalSnapshots = goals.map((goal) => toGoalSnapshot(goal, selectedGoalId, blockerState.blocked_reason_map));
  const goalSnapshotMap = new Map(goalSnapshots.map((goal) => [goal.goal_id, goal]));
  const blockedGoalIds = new Set(blockerState.blocked_goals.map((goal) => goal.goal_id));
  const queuedGoals = sortGoalSnapshots(goalSnapshots.filter((goal) => goal.status === "pending" && goal.goal_id !== selectedGoalId && !blockedGoalIds.has(goal.goal_id)));
  const completedGoals = sortGoalSnapshots(goalSnapshots.filter((goal) => goal.status === "completed"));
  const pausedGoals = sortGoalSnapshots(goalSnapshots.filter((goal) => goal.status === "paused"));
  const activeGoal = selectedGoalId ? goalSnapshotMap.get(selectedGoalId) ?? null : null;

  return {
    active_goal: activeGoal,
    queued_goals: queuedGoals,
    blocked_goals: blockerState.blocked_goals,
    completed_goals: completedGoals,
    paused_goals: pausedGoals,
    dependency_blockers: blockerState.dependency_blockers,
    conflict_blockers: blockerState.conflict_blockers,
    recent_failures: buildRecentFailures(reports),
    recovery_recommendations: buildRecoveryRecommendations(reports),
    approvals_required: collectApprovalsRequired(context, reports),
    validation_issues: collectValidationIssues(context),
    runtime_status: deriveRuntimeStatus(context),
    session_status: deriveSessionStatus(context),
    queue_status: deriveQueueStatus(context),
    scheduler_status: deriveSchedulerStatus(context, goalSchedule),
    runtime_observability: {
      current_tick: 0,
      last_tick_at: null,
      last_mutation: null,
      last_semantic_transition: null,
      latest_safety_gate_decision: null,
      next_scheduled_action: null,
      next_scheduled_tick_at: null,
      event_log: [],
    },
    agent_runtime: {
      agents: [],
      active_agents: [],
      idle_agents: [],
      blocked_agents: [],
      paused_agents: [],
    },
    execution_chains: [],
    last_updated_at: deriveLastUpdatedAt(context, goals, reports),
  };
}

export function groupGoalsByStatus(state: OperatorDashboardState): {
  active: OperatorDashboardGoal[];
  queued: OperatorDashboardGoal[];
  blocked: OperatorDashboardBlockedGoal[];
  completed: OperatorDashboardGoal[];
  paused: OperatorDashboardGoal[];
} {
  return {
    active: state.active_goal ? [state.active_goal] : [],
    queued: [...state.queued_goals],
    blocked: [...state.blocked_goals],
    completed: [...state.completed_goals],
    paused: [...state.paused_goals],
  };
}

export function extractActionableItems(state: OperatorDashboardState): OperatorDashboardActionItem[] {
  const items: OperatorDashboardActionItem[] = [];

  for (const approval of state.approvals_required) {
    items.push({
      kind: "approval",
      goal_id: approval.goal_id,
      title: approval.goal_id
        ? `Approval required for ${approval.goal_id}`
        : "Approval refresh required",
      reason: approval.reason,
      recommended_action: approval.recommended_action,
      priority: "high",
    });
  }

  for (const blockedGoal of state.blocked_goals) {
    items.push({
      kind: blockedGoal.blocker_type === "dependency" ? "dependency" : blockedGoal.blocker_type === "conflict" ? "conflict" : "validation",
      goal_id: blockedGoal.goal_id,
      title: `${blockedGoal.description} is blocked`,
      reason: blockedGoal.explanation,
      recommended_action: blockedGoal.recommended_action ?? "Review the blocked goal before resuming it.",
      priority: blockedGoal.blocker_type === "conflict" ? "medium" : "high",
    });
  }

  for (const recommendation of state.recovery_recommendations) {
    items.push({
      kind: "recovery",
      goal_id: null,
      title: `Recovery recommendation: ${recommendation.recommendation}`,
      reason: recommendation.reason,
      recommended_action: recommendation.recommendation.replace(/_/g, " "),
      priority: recommendation.severity === "critical" || recommendation.severity === "high" ? "high" : "medium",
    });
  }

  for (const issue of state.validation_issues) {
    items.push({
      kind: "validation",
      goal_id: issue.goal_id,
      title: issue.goal_id ? `Validation issue for ${issue.goal_id}` : "Validation issue",
      reason: issue.summary,
      recommended_action: issue.recommendation ? issue.recommendation.replace(/_/g, " ") : "Review the validation issue before continuing.",
      priority: issue.status === "validation_failed" ? "high" : "medium",
    });
  }

  return items.sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const priorityDelta = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const goalDelta = (left.goal_id ?? "").localeCompare(right.goal_id ?? "");
    if (goalDelta !== 0) {
      return goalDelta;
    }
    return left.title.localeCompare(right.title);
  });
}

export function summarizeOperatorDashboardState(state: OperatorDashboardState): string {
  const actionableItems = extractActionableItems(state);
  return [
    `Active goal: ${state.active_goal ? state.active_goal.description : "none"}`,
    `Queued goals: ${state.queued_goals.length > 0 ? state.queued_goals.map((goal) => goal.description).join(" | ") : "none"}`,
    `Blocked goals: ${state.blocked_goals.length > 0 ? state.blocked_goals.map((goal) => `${goal.description} (${goal.blocker_type})`).join(" | ") : "none"}`,
    `Approvals required: ${state.approvals_required.length}`,
    `Validation issues: ${state.validation_issues.length}`,
    `Recovery recommendations: ${state.recovery_recommendations.length}`,
    `Runtime status: ${state.runtime_status.status}`,
    `Queue status: ${state.queue_status.status}`,
    `Operator action items: ${actionableItems.length > 0 ? actionableItems.map((item) => `${item.title} -> ${item.recommended_action}`).join(" | ") : "none"}`,
  ].join("\n");
}
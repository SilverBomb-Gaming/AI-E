import {
  createAutonomousWorkSession,
  type AutonomousWorkSession,
  type WorkSessionStatus,
} from "./autonomousWorkSession";
import {
  buildOperatorDashboardState,
  type OperatorDashboardGoal,
  type OperatorDashboardState,
} from "./operatorDashboardState";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
  runBackgroundSessionQueue,
  type BackgroundSessionQueue,
  type BackgroundQueueResult,
} from "./backgroundSessionQueue";
import type { GoalPriority } from "./multiGoalOrchestrator";
import type { SafeRuntimeIntent } from "./safeRuntimeActionBridge";

export type ExecutionLoopControllerStatus = "loop_not_triggered" | "loop_executed" | "loop_blocked";

export type ExecutionLoopControllerInput = {
  runtime_intent: SafeRuntimeIntent;
  dashboard_state: OperatorDashboardState;
  timestamp: string;
  goal_id?: string | null;
  max_sessions_per_run?: number;
  max_cycles_per_session?: number;
  force_continuation?: boolean;
  require_fresh_approvals?: boolean;
  require_fresh_context?: boolean;
  existing_queue?: BackgroundSessionQueue | null;
};

export type ExecutionLoopControllerResult = {
  status: ExecutionLoopControllerStatus;
  triggered: boolean;
  reason: string;
  updated_dashboard_state: OperatorDashboardState;
  queue_result: BackgroundQueueResult | null;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function shouldTriggerExecution(runtimeIntent: SafeRuntimeIntent, forceContinuation = false): boolean {
  if (forceContinuation) {
    return true;
  }

  return runtimeIntent === "grant_session_approval"
    || runtimeIntent === "resume_paused_goal"
    || runtimeIntent === "mark_goal_retry_requested";
}

function hasBlockingReviewSignals(state: OperatorDashboardState): boolean {
  return state.validation_issues.length > 0;
}

function buildSessionReportSummary(
  session: AutonomousWorkSession,
  status: WorkSessionStatus,
  pauseReason: string | null,
  completionReason: string | null,
): string {
  const completedCycles = session.cycle_history.filter((cycle) => cycle.status === "cycle_completed").length;
  const reason = pauseReason ?? completionReason;
  return reason
    ? `${status}: ${completedCycles}/${session.cycle_history.length} cycles completed for ${session.operator_goal}. ${reason}`
    : `${status}: ${completedCycles}/${session.cycle_history.length} cycles completed for ${session.operator_goal}`;
}

function withSessionStatus(
  session: AutonomousWorkSession,
  status: WorkSessionStatus,
  updatedAt: string,
  reason: string | null,
): AutonomousWorkSession {
  const pauseReason = status === "session_paused" || status === "session_blocked" || status === "awaiting_session_approval"
    ? reason
    : null;
  const completionReason = status === "session_completed"
    ? (reason ?? session.goal_state.completion_reason ?? "The supervised work session reached a completed goal state.")
    : null;

  return {
    ...session,
    updated_at: updatedAt,
    status,
    session_report: {
      ...session.session_report,
      updated_at: updatedAt,
      status,
      pause_reason: pauseReason,
      completion_reason: completionReason,
      summary: buildSessionReportSummary(session, status, pauseReason, completionReason),
    },
  };
}

function hasApprovalForGoal(state: OperatorDashboardState, goalId: string): boolean {
  return state.approvals_required.some((approval) => approval.goal_id === null || approval.goal_id === goalId);
}

function buildGoalStepTitle(goal: OperatorDashboardGoal): string {
  return `Advance ${goal.description}`;
}

function buildSessionForGoal(
  goal: OperatorDashboardGoal,
  state: OperatorDashboardState,
  input: ExecutionLoopControllerInput,
  effectiveStatus: OperatorDashboardGoal["status"],
): AutonomousWorkSession {
  const createdAt = normalizeText(goal.last_updated_at) || normalizeText(state.last_updated_at) || input.timestamp;
  const approvalPending = hasApprovalForGoal(state, goal.goal_id);
  const baseSession = createAutonomousWorkSession({
    sessionId: goal.goal_id,
    operatorGoal: goal.description,
    createdAt,
    sessionApproval: !approvalPending,
    sessionApprovalGrantedAt: !approvalPending ? createdAt : undefined,
    sessionApprovalExpiresAt: !approvalPending ? null : undefined,
    maxCycles: Math.max(1, input.max_cycles_per_session ?? 2),
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: buildGoalStepTitle(goal),
        plannerReadyRequest: goal.description,
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });

  if (approvalPending && (effectiveStatus === "active" || effectiveStatus === "pending")) {
    return withSessionStatus(baseSession, "awaiting_session_approval", createdAt, goal.explanation);
  }

  switch (effectiveStatus) {
    case "active":
      return withSessionStatus(baseSession, "session_running", createdAt, null);
    case "paused":
      return withSessionStatus(baseSession, "session_paused", createdAt, goal.explanation);
    case "blocked":
      return withSessionStatus(baseSession, "session_blocked", createdAt, goal.explanation);
    case "completed":
      return withSessionStatus(baseSession, "session_completed", createdAt, goal.explanation);
    case "pending":
    default:
      return baseSession;
  }
}

function collectDistinctGoals(state: OperatorDashboardState): OperatorDashboardGoal[] {
  const goals = new Map<string, OperatorDashboardGoal>();
  const addGoal = (goal: OperatorDashboardGoal | null | undefined) => {
    if (!goal) {
      return;
    }
    goals.set(goal.goal_id, goal);
  };

  addGoal(state.active_goal);
  state.queued_goals.forEach(addGoal);
  state.paused_goals.forEach(addGoal);
  state.blocked_goals.forEach(addGoal);
  state.completed_goals.forEach(addGoal);
  return [...goals.values()];
}

function resolveEffectiveStatus(
  goal: OperatorDashboardGoal,
  input: ExecutionLoopControllerInput,
): OperatorDashboardGoal["status"] {
  if (input.runtime_intent === "mark_goal_retry_requested" && goal.goal_id === input.goal_id) {
    return "active";
  }

  if (input.runtime_intent === "mark_goal_retry_requested" && goal.goal_id !== input.goal_id && goal.status === "active") {
    return "pending";
  }

  return goal.status;
}

export function runExecutionLoopController(input: ExecutionLoopControllerInput): ExecutionLoopControllerResult {
  if (!shouldTriggerExecution(input.runtime_intent, input.force_continuation)) {
    return {
      status: "loop_not_triggered",
      triggered: false,
      reason: "The requested runtime mutation does not start a bounded execution loop.",
      updated_dashboard_state: input.dashboard_state,
      queue_result: null,
    };
  }

  if (hasBlockingReviewSignals(input.dashboard_state)) {
    return {
      status: "loop_blocked",
      triggered: false,
      reason: "Execution loop blocked because validation or recovery review is still required.",
      updated_dashboard_state: input.dashboard_state,
      queue_result: null,
    };
  }

  const goals = collectDistinctGoals(input.dashboard_state);
  const runnableGoals = goals.filter((goal) => {
    const status = resolveEffectiveStatus(goal, input);
    return status === "active" || status === "pending";
  });

  if (runnableGoals.length === 0) {
    return {
      status: "loop_not_triggered",
      triggered: false,
      reason: "No runnable goals are available for the bounded execution loop.",
      updated_dashboard_state: input.dashboard_state,
      queue_result: null,
    };
  }

  let queue = input.existing_queue ?? createBackgroundSessionQueue({
    max_sessions_per_run: Math.max(1, input.max_sessions_per_run ?? 1),
    max_cycles_per_session: Math.max(1, input.max_cycles_per_session ?? 2),
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: input.require_fresh_approvals !== false,
    require_fresh_context: input.require_fresh_context !== false,
  });

  if (!input.existing_queue) {
    for (const goal of goals) {
      const effectiveStatus = resolveEffectiveStatus(goal, input);
      const session = buildSessionForGoal(goal, input.dashboard_state, input, effectiveStatus);
      queue = enqueueBackgroundSession(queue, session, {
        priority: goal.priority as GoalPriority,
        dependency_goal_ids: goal.depends_on_goal_ids,
        blocking_goal_ids: goal.blocking_goal_ids,
        conflict_goal_ids: goal.conflict_goal_ids,
      });
    }
  }

  const queueResult = runBackgroundSessionQueue(queue);
  const updatedDashboardState = buildOperatorDashboardState({
    background_queue_result: queueResult,
    generated_at: input.timestamp,
  });

  return {
    status: "loop_executed",
    triggered: true,
    reason: queueResult.next_operator_action,
    updated_dashboard_state: updatedDashboardState,
    queue_result: queueResult,
  };
}
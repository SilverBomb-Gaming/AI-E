import type {
  OperatorDashboardActionItem,
  OperatorDashboardApprovalRequirement,
  OperatorDashboardBlockedGoal,
  OperatorDashboardFailure,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";
import {
  createOvernightAutonomyPolicyId,
  createSupervisedAutonomySessionId,
  type OvernightAutonomyAllowedAgentRole,
  type SupervisedAutonomyApprovalPolicy,
  type SupervisedAutonomyRecoveryPolicy,
} from "./supervisedAutonomySession";

export type OperatorControlActionType = "approve_goal" | "pause_goal" | "resume_goal" | "retry_goal" | "start_supervised_session" | "pause_session" | "resume_session" | "stop_session" | "request_operator_review" | "approve_review_item" | "reject_review_item" | "defer_review_item";

export type SupervisedSessionControlInput = {
  max_duration_ms?: number;
  tick_budget?: number;
  max_chain_count?: number;
  approval_policy?: SupervisedAutonomyApprovalPolicy;
  recovery_policy?: SupervisedAutonomyRecoveryPolicy;
  overnight_mode_enabled?: boolean;
  max_runtime_hours?: number;
  allowed_time_window_start?: string;
  allowed_time_window_end?: string;
  max_tick_count?: number;
  max_retries_per_chain?: number;
  max_recovery_attempts?: number;
  requires_operator_review_before_commit?: boolean;
  allowed_agent_roles?: OvernightAutonomyAllowedAgentRole[];
  disallowed_actions?: string[];
  shutdown_on_failure_count?: number;
  checkpoint_interval_ticks?: number;
  review_queue_enabled?: boolean;
};

export type OperatorControlAction = {
  type: OperatorControlActionType;
  goal_id?: string | null;
  review_id?: string | null;
  supervised_session_input?: SupervisedSessionControlInput;
};

export type OperatorControlResult = {
  action: OperatorControlAction;
  changed: boolean;
  message: string;
  state: OperatorDashboardState;
};

function cloneGoal(goal: OperatorDashboardGoal): OperatorDashboardGoal {
  return {
    ...goal,
    depends_on_goal_ids: [...goal.depends_on_goal_ids],
    blocking_goal_ids: [...goal.blocking_goal_ids],
    conflict_goal_ids: [...goal.conflict_goal_ids],
  };
}

function cloneBlockedGoal(goal: OperatorDashboardBlockedGoal): OperatorDashboardBlockedGoal {
  return {
    ...cloneGoal(goal),
    blocker_type: goal.blocker_type,
    blocker_ids: [...goal.blocker_ids],
  };
}

function cloneApproval(approval: OperatorDashboardApprovalRequirement): OperatorDashboardApprovalRequirement {
  return {
    ...approval,
    approvals_needed: [...approval.approvals_needed],
  };
}

function cloneFailure(failure: OperatorDashboardFailure): OperatorDashboardFailure {
  return { ...failure };
}

function cloneRecommendation(
  recommendation: OperatorDashboardRecoveryRecommendation,
): OperatorDashboardRecoveryRecommendation {
  return { ...recommendation };
}

function cloneValidationIssue(issue: OperatorDashboardValidationIssue): OperatorDashboardValidationIssue {
  return { ...issue };
}

function cloneActionItem(item: OperatorDashboardActionItem): OperatorDashboardActionItem {
  return { ...item };
}

function cloneSupervisedSessionInput(input: SupervisedSessionControlInput | undefined): SupervisedSessionControlInput | undefined {
  return input
    ? {
      ...input,
      allowed_agent_roles: input.allowed_agent_roles ? [...input.allowed_agent_roles] : undefined,
      disallowed_actions: input.disallowed_actions ? [...input.disallowed_actions] : undefined,
    }
    : undefined;
}

function cloneState(state: OperatorDashboardState): OperatorDashboardState {
  return {
    active_goal: state.active_goal ? cloneGoal(state.active_goal) : null,
    queued_goals: state.queued_goals.map((goal) => cloneGoal(goal)),
    blocked_goals: state.blocked_goals.map((goal) => cloneBlockedGoal(goal)),
    completed_goals: state.completed_goals.map((goal) => cloneGoal(goal)),
    paused_goals: state.paused_goals.map((goal) => cloneGoal(goal)),
    dependency_blockers: state.dependency_blockers.map((blocker) => ({
      ...blocker,
      blocker_ids: [...blocker.blocker_ids],
    })),
    conflict_blockers: state.conflict_blockers.map((blocker) => ({
      ...blocker,
      blocker_ids: [...blocker.blocker_ids],
    })),
    recent_failures: state.recent_failures.map((failure) => cloneFailure(failure)),
    recovery_recommendations: state.recovery_recommendations.map((recommendation) => cloneRecommendation(recommendation)),
    approvals_required: state.approvals_required.map((approval) => cloneApproval(approval)),
    validation_issues: state.validation_issues.map((issue) => cloneValidationIssue(issue)),
    runtime_status: { ...state.runtime_status },
    session_status: { ...state.session_status },
    queue_status: { ...state.queue_status },
    scheduler_status: { ...state.scheduler_status },
    runtime_observability: state.runtime_observability ? {
      current_tick: state.runtime_observability.current_tick,
      last_tick_at: state.runtime_observability.last_tick_at,
      last_mutation: state.runtime_observability.last_mutation,
      last_semantic_transition: state.runtime_observability.last_semantic_transition,
      latest_safety_gate_decision: state.runtime_observability.latest_safety_gate_decision,
      next_scheduled_action: state.runtime_observability.next_scheduled_action,
      next_scheduled_tick_at: state.runtime_observability.next_scheduled_tick_at,
      event_log: state.runtime_observability.event_log.map((event) => ({
        ...event,
        active_goal_before: event.active_goal_before ? { ...event.active_goal_before } : null,
        active_goal_after: event.active_goal_after ? { ...event.active_goal_after } : null,
        goal_transition: event.goal_transition ? { ...event.goal_transition } : null,
        semantic_progression: event.semantic_progression ? { ...event.semantic_progression } : null,
      })),
    } : undefined,
    supervised_session: state.supervised_session ? {
      ...state.supervised_session,
      agent_ids: [...state.supervised_session.agent_ids],
      active_chain_ids: [...state.supervised_session.active_chain_ids],
      completed_chain_ids: [...state.supervised_session.completed_chain_ids],
      failed_chain_ids: [...state.supervised_session.failed_chain_ids],
      overnight_policy: state.supervised_session.overnight_policy
        ? {
          ...state.supervised_session.overnight_policy,
          allowed_time_window: { ...state.supervised_session.overnight_policy.allowed_time_window },
          allowed_agent_roles: [...state.supervised_session.overnight_policy.allowed_agent_roles],
          disallowed_actions: [...state.supervised_session.overnight_policy.disallowed_actions],
        }
        : state.supervised_session.overnight_policy,
      review_queue: state.supervised_session.review_queue?.map((item) => ({ ...item })),
      active_recovery: state.supervised_session.active_recovery ? { ...state.supervised_session.active_recovery } : state.supervised_session.active_recovery,
      resume_state: state.supervised_session.resume_state ? { ...state.supervised_session.resume_state } : state.supervised_session.resume_state,
    } : undefined,
    supervised_checkpoints: state.supervised_checkpoints?.map((checkpoint) => ({
      ...checkpoint,
      agent_states: checkpoint.agent_states.map((agentState) => ({ ...agentState })),
      active_chains: [...checkpoint.active_chains],
      queued_goals: [...checkpoint.queued_goals],
      completed_goals: [...checkpoint.completed_goals],
    })),
    last_updated_at: state.last_updated_at,
  };
}

function nextTimestamp(state: OperatorDashboardState): string {
  const parsed = Date.parse(state.last_updated_at);
  if (Number.isNaN(parsed)) {
    return "2026-04-26T12:00:01.000Z";
  }
  return new Date(parsed + 1000).toISOString();
}

function updateLastUpdated(state: OperatorDashboardState): void {
  state.last_updated_at = nextTimestamp(state);
}

function markGoal(goal: OperatorDashboardGoal, updates: Partial<OperatorDashboardGoal>): OperatorDashboardGoal {
  return {
    ...cloneGoal(goal),
    ...updates,
  };
}

function takeGoal(goals: OperatorDashboardGoal[], goalId: string | null | undefined): OperatorDashboardGoal | null {
  if (goals.length === 0) {
    return null;
  }

  if (!goalId) {
    return goals.shift() ?? null;
  }

  const goalIndex = goals.findIndex((goal) => goal.goal_id === goalId);
  if (goalIndex < 0) {
    return null;
  }

  const [goal] = goals.splice(goalIndex, 1);
  return goal ?? null;
}

function clearGoalApproval(state: OperatorDashboardState, goalId: string | null | undefined): boolean {
  if (state.approvals_required.length === 0) {
    return false;
  }

  if (!goalId) {
    state.approvals_required.shift();
    return true;
  }

  const before = state.approvals_required.length;
  state.approvals_required = state.approvals_required.filter((approval) => approval.goal_id !== goalId);
  return state.approvals_required.length !== before;
}

function removeMatchingValidationIssues(state: OperatorDashboardState, goalId: string | null | undefined): void {
  if (!goalId) {
    return;
  }

  state.validation_issues = state.validation_issues.filter((issue) => issue.goal_id !== goalId);
}

function removeMatchingRecoverySignals(state: OperatorDashboardState): void {
  if (state.recovery_recommendations.length > 0) {
    state.recovery_recommendations = state.recovery_recommendations.slice(1);
  }
  if (state.recent_failures.length > 0) {
    state.recent_failures = state.recent_failures.slice(1);
  }
}

function nextStateTimestamp(state: OperatorDashboardState): string {
  return nextTimestamp(state);
}

function buildSupervisedSession(state: OperatorDashboardState, input: SupervisedSessionControlInput | undefined) {
  const createdAt = nextStateTimestamp(state);
  const approvalPolicy = input?.approval_policy ?? state.supervised_session?.approval_policy ?? "operator_must_approve_start";
  const recoveryPolicy = input?.recovery_policy ?? state.supervised_session?.recovery_policy ?? "request_operator_review";
  const needsApproval = approvalPolicy !== "preapproved_with_limits";
  const sessionId = createSupervisedAutonomySessionId("local-runtime", createdAt);
  const overnightPolicy = input?.overnight_mode_enabled
    ? {
      policy_id: createOvernightAutonomyPolicyId(sessionId, createdAt),
      session_id: sessionId,
      max_runtime_hours: input.max_runtime_hours ?? Math.max(1, Math.ceil((input?.max_duration_ms ?? 28_800_000) / 3_600_000)),
      allowed_time_window: {
        start_time: input.allowed_time_window_start ?? "22:00",
        end_time: input.allowed_time_window_end ?? "06:00",
      },
      max_tick_count: input.max_tick_count ?? input?.tick_budget ?? 12,
      max_chain_count: input?.max_chain_count ?? state.supervised_session?.max_chain_count ?? 8,
      max_retries_per_chain: input.max_retries_per_chain ?? 1,
      max_recovery_attempts: input.max_recovery_attempts ?? 2,
      requires_operator_review_before_commit: input.requires_operator_review_before_commit ?? true,
      allowed_agent_roles: input.allowed_agent_roles ?? ["planner", "executor", "validator"],
      disallowed_actions: input.disallowed_actions ?? ["commit_changes", "push_branch", "delete_artifacts"],
      shutdown_on_failure_count: input.shutdown_on_failure_count ?? 2,
      checkpoint_interval_ticks: input.checkpoint_interval_ticks ?? 1,
      review_queue_enabled: input.review_queue_enabled ?? true,
    }
    : null;

  return {
    session_id: sessionId,
    runtime_id: "local-runtime",
    status: needsApproval ? "pending_approval" : "running",
    started_at: createdAt,
    stopped_at: null,
    duration_ms: 0,
    max_duration_ms: input?.max_duration_ms ?? state.supervised_session?.max_duration_ms ?? 28_800_000,
    tick_budget: input?.tick_budget ?? state.supervised_session?.tick_budget ?? 12,
    ticks_completed: 0,
    max_chain_count: input?.max_chain_count ?? state.supervised_session?.max_chain_count ?? 8,
    agent_ids: state.agent_runtime?.agents.map((agent) => agent.agent_id) ?? [],
    active_chain_ids: [],
    completed_chain_ids: [],
    failed_chain_ids: [],
    safety_scope: "bounded_multi_agent_runtime" as const,
    approval_policy: approvalPolicy,
    recovery_policy: recoveryPolicy,
    last_checkpoint_at: null,
    stop_reason: null,
    last_recovery_action: "none" as const,
    next_scheduled_tick_at: needsApproval ? null : createdAt,
    latest_timeline_event_id: null,
    pending_operator_review: false,
    overnight_policy: overnightPolicy,
    review_queue: [],
    active_recovery: null,
    resume_state: overnightPolicy
      ? {
        resume_status: "resume_ready" as const,
        restart_count: 0,
        resumed_from_checkpoint_id: null,
        resumed_at: null,
        preserved_review_queue_count: 0,
        shutdown_reason: null,
      }
      : null,
    failure_count: 0,
  };
}

function applyReviewDecision(
  state: OperatorDashboardState,
  action: OperatorControlAction,
  decision: "approved" | "rejected" | "deferred",
): OperatorControlResult {
  const session = state.supervised_session;
  if (!session || !session.review_queue || session.review_queue.length === 0) {
    return {
      action,
      changed: false,
      message: "No overnight review queue items are available.",
      state,
    };
  }

  const reviewId = action.review_id ?? session.review_queue[0]?.review_id ?? null;
  const reviewQueue = session.review_queue.map((item) => item.review_id === reviewId ? { ...item, status: decision } : item);
  const pendingReviewCount = reviewQueue.filter((item) => item.status === "pending").length;
  if (!reviewQueue.some((item) => item.review_id === reviewId)) {
    return {
      action,
      changed: false,
      message: "The requested overnight review item was not found.",
      state,
    };
  }

  state.supervised_session = {
    ...session,
    review_queue: reviewQueue,
    pending_operator_review: pendingReviewCount > 0,
    status: pendingReviewCount > 0 ? "waiting_for_operator" : session.status === "waiting_for_operator" ? "paused" : session.status,
    active_recovery: pendingReviewCount > 0 ? session.active_recovery : null,
    resume_state: session.resume_state
      ? {
        ...session.resume_state,
        preserved_review_queue_count: pendingReviewCount,
      }
      : session.resume_state,
  };
  state.runtime_status = pendingReviewCount > 0
    ? {
      status: "runtime_blocked",
      explanation: "Overnight autonomy is waiting for remaining operator review items.",
    }
    : {
      status: "runtime_paused",
      explanation: "The overnight review item was handled and the session is awaiting the next operator action.",
    };
  state.session_status = pendingReviewCount > 0
    ? {
      status: "session_waiting_for_approval",
      explanation: "Overnight review queue items are still waiting for operator decisions.",
    }
    : {
      status: "session_paused",
      explanation: "The overnight review item was handled.",
    };
  updateLastUpdated(state);
  return {
    action,
    changed: true,
    message: `The overnight review item was ${decision}.`,
    state,
  };
}

export function applyOperatorControlAction(state: OperatorDashboardState, action: OperatorControlAction): OperatorControlResult {
  const nextState = cloneState(state);

  switch (action.type) {
    case "approve_goal": {
      const changed = clearGoalApproval(nextState, action.goal_id);
      if (!changed) {
        return {
          action,
          changed: false,
          message: "No approval requirement matched the requested goal.",
          state: nextState,
        };
      }

      if (nextState.approvals_required.length === 0) {
        nextState.runtime_status = {
          status: "runtime_ready",
          explanation: "All local approval requirements are cleared.",
        };
        nextState.session_status = {
          status: "session_running",
          explanation: "The active operator workflow can continue on the next cycle.",
        };
        if (nextState.supervised_session?.status === "pending_approval") {
          nextState.supervised_session = {
            ...nextState.supervised_session,
            status: "running",
            next_scheduled_tick_at: nextTimestamp(nextState),
            pending_operator_review: false,
          };
        }
      }

      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "Approval recorded and the local dashboard state was refreshed.",
        state: nextState,
      };
    }

    case "pause_goal": {
      const activeGoal = nextState.active_goal;
      if (!activeGoal || (action.goal_id && action.goal_id !== activeGoal.goal_id)) {
        return {
          action,
          changed: false,
          message: "There is no matching active goal to pause.",
          state: nextState,
        };
      }

      nextState.active_goal = null;
      nextState.paused_goals = [
        markGoal(activeGoal, {
          status: "paused",
          explanation: "Paused by the operator from the dashboard UI.",
          recommended_action: "Resume this goal when you are ready to continue.",
          last_updated_at: nextTimestamp(nextState),
        }),
        ...nextState.paused_goals,
      ];
      nextState.runtime_status = {
        status: "runtime_paused",
        explanation: "The operator paused the active goal.",
      };
      nextState.session_status = {
        status: "session_paused",
        explanation: "The active goal is paused until the operator resumes it.",
      };
      nextState.scheduler_status = {
        status: "scheduler_idle",
        explanation: "No new goal is selected while the active goal remains paused.",
      };

      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The active goal was paused.",
        state: nextState,
      };
    }

    case "resume_goal": {
      const resumedGoal = takeGoal(nextState.paused_goals, action.goal_id);
      if (!resumedGoal) {
        return {
          action,
          changed: false,
          message: "There is no paused goal available to resume.",
          state: nextState,
        };
      }

      if (nextState.active_goal) {
        nextState.queued_goals = [
          markGoal(nextState.active_goal, {
            status: "pending",
            explanation: "Returned to the queue when another goal was resumed.",
            recommended_action: null,
            last_updated_at: nextTimestamp(nextState),
          }),
          ...nextState.queued_goals,
        ];
      }

      nextState.active_goal = markGoal(resumedGoal, {
        status: "active",
        explanation: "Resumed by the operator from the dashboard UI.",
        recommended_action: "Pause this goal if operator review is needed again.",
        last_updated_at: nextTimestamp(nextState),
      });
      nextState.runtime_status = {
        status: "runtime_ready",
        explanation: "The resumed goal is ready for its next runtime cycle.",
      };
      nextState.session_status = {
        status: "session_running",
        explanation: "The resumed goal now owns the active operator slot.",
      };
      nextState.scheduler_status = {
        status: "goal_selected",
        explanation: `${nextState.active_goal.description} is selected as the current goal.`,
      };

      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The paused goal was resumed.",
        state: nextState,
      };
    }

    case "retry_goal": {
      const retriedGoal = takeGoal(nextState.blocked_goals, action.goal_id);
      if (!retriedGoal) {
        return {
          action,
          changed: false,
          message: "There is no blocked goal available to retry.",
          state: nextState,
        };
      }

      nextState.dependency_blockers = nextState.dependency_blockers.filter((blocker) => blocker.goal_id !== retriedGoal.goal_id);
      nextState.conflict_blockers = nextState.conflict_blockers.filter((blocker) => blocker.goal_id !== retriedGoal.goal_id);
      removeMatchingValidationIssues(nextState, retriedGoal.goal_id);
      removeMatchingRecoverySignals(nextState);
      nextState.queued_goals = [
        markGoal(retriedGoal, {
          status: "pending",
          explanation: "Retry requested from the operator dashboard.",
          recommended_action: null,
          last_updated_at: nextTimestamp(nextState),
        }),
        ...nextState.queued_goals,
      ];
      nextState.queue_status = {
        status: "queue_running",
        explanation: "The retried goal has been returned to the queue.",
      };
      nextState.scheduler_status = {
        status: "goal_selected",
        explanation: "The scheduler can reconsider the retried goal on the next pass.",
      };

      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The blocked goal was returned to the queue for retry.",
        state: nextState,
      };
    }

    case "start_supervised_session": {
      if (nextState.supervised_session && ["pending_approval", "running", "paused", "waiting_for_operator", "recovering"].includes(nextState.supervised_session.status)) {
        return {
          action,
          changed: false,
          message: "A supervised session is already active or awaiting operator action.",
          state: nextState,
        };
      }

      nextState.supervised_session = buildSupervisedSession(nextState, cloneSupervisedSessionInput(action.supervised_session_input));
      nextState.supervised_checkpoints = [];
      if (nextState.supervised_session.approval_policy !== "preapproved_with_limits") {
        nextState.approvals_required = [{
          goal_id: nextState.active_goal?.goal_id ?? null,
          approvals_needed: ["session"],
          reason: "Operator approval is required before supervised autonomy can start.",
          recommended_action: "Approve the supervised session to begin bounded ticks.",
        }];
        nextState.runtime_status = {
          status: "runtime_blocked",
          explanation: "Supervised autonomy is waiting for operator approval.",
        };
        nextState.session_status = {
          status: "session_waiting_for_approval",
          explanation: "The supervised session is configured and waiting for approval to start.",
        };
      } else {
        nextState.runtime_status = {
          status: "runtime_ready",
          explanation: "Supervised autonomy is configured and ready to run within its hard limits.",
        };
        nextState.session_status = {
          status: "session_running",
          explanation: "The supervised session is active within its configured limits.",
        };
      }
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The supervised autonomy session was configured.",
        state: nextState,
      };
    }

    case "pause_session": {
      if (!nextState.supervised_session || !["running", "recovering", "pending_approval"].includes(nextState.supervised_session.status)) {
        return {
          action,
          changed: false,
          message: "No running supervised session is available to pause.",
          state: nextState,
        };
      }

      nextState.supervised_session = {
        ...nextState.supervised_session,
        status: "paused",
        next_scheduled_tick_at: null,
        pending_operator_review: false,
      };
      nextState.runtime_status = {
        status: "runtime_paused",
        explanation: "The supervised autonomy session was paused by the operator.",
      };
      nextState.session_status = {
        status: "session_paused",
        explanation: "The supervised autonomy session is paused until resumed.",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The supervised autonomy session was paused.",
        state: nextState,
      };
    }

    case "resume_session": {
      if (!nextState.supervised_session || !["paused", "waiting_for_operator", "stopped_by_operator"].includes(nextState.supervised_session.status)) {
        return {
          action,
          changed: false,
          message: "No supervised session is available to resume.",
          state: nextState,
        };
      }

      const requiresApproval = nextState.approvals_required.length > 0 && nextState.supervised_session.approval_policy !== "preapproved_with_limits";
      nextState.supervised_session = {
        ...nextState.supervised_session,
        status: requiresApproval ? "pending_approval" : "running",
        stopped_at: null,
        stop_reason: null,
        next_scheduled_tick_at: requiresApproval ? null : nextTimestamp(nextState),
        pending_operator_review: false,
      };
      nextState.runtime_status = {
        status: requiresApproval ? "runtime_blocked" : "runtime_ready",
        explanation: requiresApproval
          ? "The supervised session requires approval before it can resume."
          : "The supervised session is ready to resume bounded execution.",
      };
      nextState.session_status = {
        status: requiresApproval ? "session_waiting_for_approval" : "session_running",
        explanation: requiresApproval
          ? "The supervised session is waiting for approval before resuming."
          : "The supervised session is running again within its limits.",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: requiresApproval ? "The supervised session is waiting for approval before resuming." : "The supervised autonomy session was resumed.",
        state: nextState,
      };
    }

    case "stop_session": {
      if (!nextState.supervised_session || ["completed", "failed", "stopped_by_operator"].includes(nextState.supervised_session.status)) {
        return {
          action,
          changed: false,
          message: "No supervised session is currently running.",
          state: nextState,
        };
      }

      nextState.supervised_session = {
        ...nextState.supervised_session,
        status: "stopped_by_operator",
        stopped_at: nextTimestamp(nextState),
        stop_reason: "Stopped by operator.",
        next_scheduled_tick_at: null,
        pending_operator_review: false,
      };
      nextState.runtime_status = {
        status: "runtime_paused",
        explanation: "The supervised autonomy session was stopped by the operator.",
      };
      nextState.session_status = {
        status: "session_paused",
        explanation: "The supervised autonomy session was stopped by the operator.",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The supervised autonomy session was stopped.",
        state: nextState,
      };
    }

    case "request_operator_review": {
      if (!nextState.supervised_session) {
        return {
          action,
          changed: false,
          message: "No supervised session is active to send for operator review.",
          state: nextState,
        };
      }

      nextState.supervised_session = {
        ...nextState.supervised_session,
        status: "waiting_for_operator",
        last_recovery_action: "request_operator_review",
        next_scheduled_tick_at: null,
        pending_operator_review: true,
      };
      nextState.runtime_status = {
        status: "runtime_blocked",
        explanation: "The supervised autonomy session is waiting for operator review.",
      };
      nextState.session_status = {
        status: "session_waiting_for_approval",
        explanation: "Operator review was requested before bounded autonomy can continue.",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "Operator review was requested for the supervised session.",
        state: nextState,
      };
    }

    case "approve_review_item": {
      return applyReviewDecision(nextState, action, "approved");
    }

    case "reject_review_item": {
      return applyReviewDecision(nextState, action, "rejected");
    }

    case "defer_review_item": {
      return applyReviewDecision(nextState, action, "deferred");
    }
  }
}

export async function runOperatorControlAction(
  state: OperatorDashboardState,
  action: OperatorControlAction,
): Promise<OperatorControlResult> {
  return applyOperatorControlAction(state, action);
}
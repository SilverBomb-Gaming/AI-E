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

export type OperatorControlActionType = "approve_goal" | "pause_goal" | "resume_goal" | "retry_goal";

export type OperatorControlAction = {
  type: OperatorControlActionType;
  goal_id?: string | null;
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
  }
}

export async function runOperatorControlAction(
  state: OperatorDashboardState,
  action: OperatorControlAction,
): Promise<OperatorControlResult> {
  return applyOperatorControlAction(state, action);
}
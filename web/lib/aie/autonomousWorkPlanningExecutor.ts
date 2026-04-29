import type { AutonomousWorkItem } from "./autonomousWorkPlanning";
import type { OperatorDashboardGoal, OperatorDashboardState } from "./operatorDashboardState";

export type AutonomousWorkPlanningProjectionInput = {
  state: OperatorDashboardState;
  timestamp: string;
  max_new_work_items?: number;
  max_chain_count?: number | null;
  existing_chain_count?: number;
};

export type AutonomousWorkPlanningProjectionResult = {
  state: OperatorDashboardState;
  scheduled_work_item_ids: string[];
  reason: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function cloneWorkItem(item: AutonomousWorkItem): AutonomousWorkItem {
  return {
    ...item,
    required_agent_roles: [...item.required_agent_roles],
    dependency_ids: [...item.dependency_ids],
    expected_outputs: [...item.expected_outputs],
  };
}

function cloneGoal(goal: OperatorDashboardGoal): OperatorDashboardGoal {
  return {
    ...goal,
    depends_on_goal_ids: [...goal.depends_on_goal_ids],
    blocking_goal_ids: [...goal.blocking_goal_ids],
    conflict_goal_ids: [...goal.conflict_goal_ids],
  };
}

function cloneState(state: OperatorDashboardState): OperatorDashboardState {
  return {
    ...state,
    active_goal: state.active_goal ? cloneGoal(state.active_goal) : null,
    queued_goals: state.queued_goals.map((goal) => cloneGoal(goal)),
    blocked_goals: state.blocked_goals.map((goal) => ({ ...cloneGoal(goal), blocker_ids: [...goal.blocker_ids] })),
    completed_goals: state.completed_goals.map((goal) => cloneGoal(goal)),
    paused_goals: state.paused_goals.map((goal) => cloneGoal(goal)),
    dependency_blockers: state.dependency_blockers.map((item) => ({ ...item, blocker_ids: [...item.blocker_ids] })),
    conflict_blockers: state.conflict_blockers.map((item) => ({ ...item, blocker_ids: [...item.blocker_ids] })),
    recent_failures: state.recent_failures.map((item) => ({ ...item })),
    recovery_recommendations: state.recovery_recommendations.map((item) => ({ ...item })),
    approvals_required: state.approvals_required.map((item) => ({ ...item, approvals_needed: [...item.approvals_needed] })),
    validation_issues: state.validation_issues.map((item) => ({ ...item })),
    runtime_status: { ...state.runtime_status },
    session_status: { ...state.session_status },
    queue_status: { ...state.queue_status },
    scheduler_status: { ...state.scheduler_status },
    proposed_work_items: state.proposed_work_items?.map((item) => cloneWorkItem(item)),
    scheduled_work_items: state.scheduled_work_items?.map((item) => cloneWorkItem(item)),
    running_work_items: state.running_work_items?.map((item) => cloneWorkItem(item)),
    review_packages: state.review_packages?.map((item) => ({
      ...item,
      files_changed: [...item.files_changed],
      tests_run: [...item.tests_run],
      proof_results: [...item.proof_results],
      risks: [...item.risks],
      operator_actions: [...item.operator_actions],
    })),
    planning_recommendations: state.planning_recommendations?.map((item) => ({ ...item })),
    planning_policy_feedback: state.planning_policy_feedback ? { ...state.planning_policy_feedback } : undefined,
    runtime_observability: state.runtime_observability ? {
      ...state.runtime_observability,
      event_log: state.runtime_observability.event_log.map((event) => ({
        ...event,
        active_goal_before: event.active_goal_before ? { ...event.active_goal_before } : null,
        active_goal_after: event.active_goal_after ? { ...event.active_goal_after } : null,
        goal_transition: event.goal_transition ? { ...event.goal_transition } : null,
        semantic_progression: event.semantic_progression ? { ...event.semantic_progression } : null,
      })),
    } : undefined,
    agent_runtime: state.agent_runtime ? {
      ...state.agent_runtime,
      agents: state.agent_runtime.agents.map((agent) => ({ ...agent, assigned_goal_ids: [...agent.assigned_goal_ids] })),
      active_agents: [...state.agent_runtime.active_agents],
      idle_agents: [...state.agent_runtime.idle_agents],
      blocked_agents: [...state.agent_runtime.blocked_agents],
      paused_agents: [...state.agent_runtime.paused_agents],
    } : undefined,
    execution_chains: state.execution_chains?.map((chain) => ({ ...chain, agent_ids: [...chain.agent_ids] })),
    supervised_session: state.supervised_session ? {
      ...state.supervised_session,
      agent_ids: [...state.supervised_session.agent_ids],
      active_chain_ids: [...state.supervised_session.active_chain_ids],
      completed_chain_ids: [...state.supervised_session.completed_chain_ids],
      failed_chain_ids: [...state.supervised_session.failed_chain_ids],
      overnight_policy: state.supervised_session.overnight_policy ? {
        ...state.supervised_session.overnight_policy,
        allowed_time_window: { ...state.supervised_session.overnight_policy.allowed_time_window },
        allowed_agent_roles: [...state.supervised_session.overnight_policy.allowed_agent_roles],
        disallowed_actions: [...state.supervised_session.overnight_policy.disallowed_actions],
      } : state.supervised_session.overnight_policy,
      review_queue: state.supervised_session.review_queue?.map((item) => ({ ...item })),
      active_recovery: state.supervised_session.active_recovery ? { ...state.supervised_session.active_recovery } : null,
      resume_state: state.supervised_session.resume_state ? { ...state.supervised_session.resume_state } : null,
    } : undefined,
    supervised_checkpoints: state.supervised_checkpoints?.map((checkpoint) => ({
      ...checkpoint,
      agent_states: checkpoint.agent_states.map((item) => ({ ...item })),
      active_chains: [...checkpoint.active_chains],
      queued_goals: [...checkpoint.queued_goals],
      completed_goals: [...checkpoint.completed_goals],
    })),
  };
}

function isApprovalBlocked(state: OperatorDashboardState, item: AutonomousWorkItem): boolean {
  if (item.required_approval_level === "none" && item.risk_level !== "high") {
    return false;
  }

  return state.approvals_required.some((approval) => approval.goal_id === null || approval.goal_id === item.work_item_id);
}

function hasScheduledGoal(state: OperatorDashboardState, goalId: string): boolean {
  return Boolean(
    state.active_goal?.goal_id === goalId
    || state.queued_goals.some((goal) => goal.goal_id === goalId)
    || state.paused_goals.some((goal) => goal.goal_id === goalId)
    || state.blocked_goals.some((goal) => goal.goal_id === goalId)
    || state.completed_goals.some((goal) => goal.goal_id === goalId)
    || (state.execution_chains ?? []).some((chain) => chain.parent_goal_id === goalId),
  );
}

function toQueuedGoal(item: AutonomousWorkItem, timestamp: string): OperatorDashboardGoal {
  return {
    goal_id: item.work_item_id,
    description: item.title,
    explanation: item.summary,
    priority: item.priority,
    status: "pending",
    recommended_action: item.required_approval_level === "none"
      ? "Allow the bounded runtime loop to schedule this work item."
      : "Operator approval is required before the bounded runtime loop can schedule this work item.",
    depends_on_goal_ids: [...item.dependency_ids],
    blocking_goal_ids: [],
    conflict_goal_ids: [],
    last_updated_at: timestamp,
  };
}

function isRunnablePlanningStatus(status: AutonomousWorkItem["status"]): boolean {
  return status === "approved_for_planning" || status === "scheduled";
}

export function projectApprovedWorkItemsToExecution(input: AutonomousWorkPlanningProjectionInput): AutonomousWorkPlanningProjectionResult {
  const nextState = cloneState(input.state);
  const proposedWorkItems = nextState.proposed_work_items ?? [];
  const scheduledWorkItems = nextState.scheduled_work_items ?? [];
  const availableChainCapacity = input.max_chain_count === null || input.max_chain_count === undefined
    ? Math.max(0, input.max_new_work_items ?? 1)
    : Math.max(0, input.max_chain_count - (input.existing_chain_count ?? 0));
  const maxNewWorkItems = Math.max(0, Math.min(input.max_new_work_items ?? 1, availableChainCapacity));

  if (maxNewWorkItems === 0) {
    return {
      state: nextState,
      scheduled_work_item_ids: [],
      reason: "No planning-to-execution capacity is available for this bounded tick.",
    };
  }

  const eligibleItems = [...proposedWorkItems, ...scheduledWorkItems]
    .filter((item) => isRunnablePlanningStatus(item.status))
    .filter((item) => !hasScheduledGoal(nextState, item.work_item_id))
    .filter((item) => item.status !== "blocked" && item.status !== "rejected" && item.status !== "failed" && item.status !== "needs_review")
    .filter((item) => !isApprovalBlocked(nextState, item));

  if (eligibleItems.length === 0) {
    return {
      state: nextState,
      scheduled_work_item_ids: [],
      reason: "No approved autonomous work items are eligible for bounded execution scheduling.",
    };
  }

  const selectedItems = eligibleItems.slice(0, maxNewWorkItems);
  const scheduledWorkItemIds = selectedItems.map((item) => item.work_item_id);

  nextState.proposed_work_items = proposedWorkItems.filter((item) => !scheduledWorkItemIds.includes(item.work_item_id));
  nextState.scheduled_work_items = [
    ...selectedItems.map((item) => ({ ...item, status: "scheduled", updated_at: input.timestamp })),
    ...scheduledWorkItems.filter((item) => !scheduledWorkItemIds.includes(item.work_item_id)),
  ];
  nextState.queued_goals = [
    ...selectedItems.map((item) => toQueuedGoal(item, input.timestamp)),
    ...nextState.queued_goals.filter((goal) => !scheduledWorkItemIds.includes(goal.goal_id)),
  ];
  nextState.queue_status = {
    status: "queue_running",
    explanation: `${scheduledWorkItemIds.length} approved autonomous work item(s) were projected into the bounded execution queue.`,
  };
  nextState.scheduler_status = {
    status: "goal_selected",
    explanation: `${scheduledWorkItemIds.join(", ")} projected into the existing goal queue for bounded execution.`,
  };

  return {
    state: nextState,
    scheduled_work_item_ids: scheduledWorkItemIds,
    reason: `${scheduledWorkItemIds.length} approved autonomous work item(s) were projected into the existing goal queue.`,
  };
}
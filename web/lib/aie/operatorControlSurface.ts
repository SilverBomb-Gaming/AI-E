import type {
  OperatorDashboardPlanningRecommendation,
  OperatorDashboardActionItem,
  OperatorDashboardApprovalRequirement,
  OperatorDashboardAutonomousSession,
  OperatorDashboardBlockedGoal,
  OperatorDashboardFailure,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
  OperatorDashboardValidationIssue,
} from "./operatorDashboardState";
import type {
  AutonomousDeliveryPackage,
  AutonomousReviewPackage,
  AutonomousWorkItem,
  AutonomousWorkItemPolicyFeedback,
} from "./autonomousWorkPlanning";
import { aggregateStudioHealthFromDashboardState } from "./studioHealthAggregator";
import { createMetaIntelligenceSummaryPackage } from "./metaIntelligenceSummary";
import {
  buildMetaIntelligenceState,
  detectMetaPatterns,
} from "./metaPatternDetector";
import {
  deriveMetaPolicyState,
  recommendMetaPolicyAdjustments,
} from "./metaPolicyRecommender";
import type { AutonomousSessionPriority } from "./autonomousSessionRegistry";
import { createStudioOperationsSummary } from "./studioOperationsSummary";
import {
  createOvernightAutonomyPolicyId,
  createSupervisedAutonomySessionId,
  type OvernightAutonomyAllowedAgentRole,
  type SupervisedAutonomyApprovalPolicy,
  type SupervisedAutonomyRecoveryPolicy,
} from "./supervisedAutonomySession";

export type OperatorControlActionType = "approve_goal" | "pause_goal" | "resume_goal" | "retry_goal" | "pause_all_sessions" | "resume_safe_sessions" | "prioritize_review_queue" | "prioritize_delivery_queue" | "acknowledge_studio_risk" | "request_studio_summary" | "approve_policy_recommendation" | "reject_policy_recommendation" | "defer_policy_recommendation" | "request_meta_summary" | "acknowledge_pattern" | "pause_autonomous_session" | "resume_autonomous_session" | "reprioritize_autonomous_session" | "merge_autonomous_sessions" | "terminate_autonomous_session" | "start_supervised_session" | "pause_session" | "resume_session" | "stop_session" | "request_operator_review" | "approve_review_item" | "reject_review_item" | "defer_review_item" | "approve_work_item" | "reject_work_item" | "defer_work_item" | "approve_review_package" | "reject_review_package" | "approve_delivery_package" | "reject_delivery_package" | "request_delivery_changes" | "archive_delivery_package";

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
  session_id?: string | null;
  target_session_id?: string | null;
  session_priority?: AutonomousSessionPriority;
  review_id?: string | null;
  work_item_id?: string | null;
  package_id?: string | null;
  recommendation_id?: string | null;
  pattern_id?: string | null;
  rationale?: string | null;
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

function cloneWorkItem(item: AutonomousWorkItem): AutonomousWorkItem {
  return {
    ...item,
    required_agent_roles: [...item.required_agent_roles],
    dependency_ids: [...item.dependency_ids],
    expected_outputs: [...item.expected_outputs],
  };
}

function cloneReviewPackage(item: AutonomousReviewPackage): AutonomousReviewPackage {
  return {
    ...item,
    files_changed: [...item.files_changed],
    tests_run: [...item.tests_run],
    proof_results: [...item.proof_results],
    risks: [...item.risks],
    operator_actions: [...item.operator_actions],
  };
}

function cloneDeliveryPackage(item: AutonomousDeliveryPackage): AutonomousDeliveryPackage {
  return {
    ...item,
    commit_plan: [...item.commit_plan],
    files_changed: [...item.files_changed],
    validation_results: [...item.validation_results],
    proof_results: [...item.proof_results],
  };
}

function clonePlanningRecommendation(item: OperatorDashboardPlanningRecommendation): OperatorDashboardPlanningRecommendation {
  return { ...item };
}

function cloneAutonomousSession(item: OperatorDashboardAutonomousSession): OperatorDashboardAutonomousSession {
  return {
    ...item,
    assigned_agent_ids: [...item.assigned_agent_ids],
  };
}

function clonePlanningPolicyFeedback(value: AutonomousWorkItemPolicyFeedback | undefined): AutonomousWorkItemPolicyFeedback | undefined {
  return value ? { ...value } : undefined;
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
    proposed_work_items: state.proposed_work_items?.map((item) => cloneWorkItem(item)),
    scheduled_work_items: state.scheduled_work_items?.map((item) => cloneWorkItem(item)),
    running_work_items: state.running_work_items?.map((item) => cloneWorkItem(item)),
    review_packages: state.review_packages?.map((item) => cloneReviewPackage(item)),
    delivery_packages: state.delivery_packages?.map((item) => cloneDeliveryPackage(item)),
    planning_recommendations: state.planning_recommendations?.map((item) => clonePlanningRecommendation(item)),
    planning_policy_feedback: clonePlanningPolicyFeedback(state.planning_policy_feedback),
    autonomous_sessions: state.autonomous_sessions ? {
      sessions: state.autonomous_sessions.sessions.map((item) => cloneAutonomousSession(item)),
      selected_session_id: state.autonomous_sessions.selected_session_id,
      runnable_session_ids: [...state.autonomous_sessions.runnable_session_ids],
      blocked_session_ids: [...state.autonomous_sessions.blocked_session_ids],
      ready_session_ids: [...state.autonomous_sessions.ready_session_ids],
      scheduler_status: { ...state.autonomous_sessions.scheduler_status },
      resource_status: { ...state.autonomous_sessions.resource_status },
      max_logical_cpu_units: state.autonomous_sessions.max_logical_cpu_units,
      max_concurrent_chains: state.autonomous_sessions.max_concurrent_chains,
      total_logical_cpu_units: state.autonomous_sessions.total_logical_cpu_units,
      total_active_chains: state.autonomous_sessions.total_active_chains,
      assigned_agent_ids: [...state.autonomous_sessions.assigned_agent_ids],
      conflicts: state.autonomous_sessions.conflicts.map((conflict) => ({ ...conflict, shared_targets: [...conflict.shared_targets] })),
      coordination_groups: state.autonomous_sessions.coordination_groups.map((group) => ({ ...group, session_ids: [...group.session_ids] })),
      coordination_dependencies: state.autonomous_sessions.coordination_dependencies.map((dependency) => ({ ...dependency })),
    } : undefined,
    studio_operations: state.studio_operations ? {
      ...state.studio_operations,
      top_priority_work: state.studio_operations.top_priority_work.map((item) => ({ ...item })),
      recent_risks: state.studio_operations.recent_risks.map((item) => ({ ...item })),
      recommended_operator_actions: state.studio_operations.recommended_operator_actions.map((item) => ({ ...item })),
    } : undefined,
    studio_risk_acknowledgements: state.studio_risk_acknowledgements?.map((item) => ({ ...item })),
    studio_summary_package: state.studio_summary_package ? {
      ...state.studio_summary_package,
      what_is_running: [...state.studio_summary_package.what_is_running],
      what_is_blocked: [...state.studio_summary_package.what_is_blocked],
      what_needs_review: [...state.studio_summary_package.what_needs_review],
      what_is_delivery_ready: [...state.studio_summary_package.what_is_delivery_ready],
      risks: [...state.studio_summary_package.risks],
    } : state.studio_summary_package,
    meta_intelligence: state.meta_intelligence ? {
      ...state.meta_intelligence,
      top_failure_patterns: [...state.meta_intelligence.top_failure_patterns],
      top_success_patterns: [...state.meta_intelligence.top_success_patterns],
      recommended_policy_adjustments: [...state.meta_intelligence.recommended_policy_adjustments],
      safety_notes: [...state.meta_intelligence.safety_notes],
    } : state.meta_intelligence,
    meta_detected_patterns: state.meta_detected_patterns?.map((item) => ({
      ...item,
      evidence: [...item.evidence],
      affected_sessions: [...item.affected_sessions],
      affected_agents: [...item.affected_agents],
    })),
    meta_policy_recommendations: state.meta_policy_recommendations?.map((item) => ({
      ...item,
      evidence: [...item.evidence],
    })),
    meta_policy_state: state.meta_policy_state ? {
      ...state.meta_policy_state,
      paused_agent_roles: [...state.meta_policy_state.paused_agent_roles],
    } : state.meta_policy_state,
    meta_operator_decision_history: state.meta_operator_decision_history?.map((item) => ({ ...item })),
    meta_summary_package: state.meta_summary_package ? {
      ...state.meta_summary_package,
      what_improved: [...state.meta_summary_package.what_improved],
      what_degraded: [...state.meta_summary_package.what_degraded],
      what_patterns_emerged: [...state.meta_summary_package.what_patterns_emerged],
      recommended_changes: [...state.meta_summary_package.recommended_changes],
      safe_change_reasons: [...state.meta_summary_package.safe_change_reasons],
      requires_operator_approval: [...state.meta_summary_package.requires_operator_approval],
      should_not_change: [...state.meta_summary_package.should_not_change],
    } : state.meta_summary_package,
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
  state.studio_operations = aggregateStudioHealthFromDashboardState(state);
  state.meta_policy_state = deriveMetaPolicyState(state, state.meta_policy_state);
  state.meta_detected_patterns = detectMetaPatterns({
    studio_operations_state: state.studio_operations,
    runtime_timeline_events: state.runtime_observability?.event_log,
    execution_chains: state.execution_chains,
    review_packages: state.review_packages,
    delivery_packages: state.delivery_packages,
    recovery_events: state.recovery_recommendations,
    operator_decisions: state.meta_operator_decision_history,
    autonomous_sessions: state.autonomous_sessions,
    agent_runtime: state.agent_runtime,
  });
  state.meta_policy_recommendations = recommendMetaPolicyAdjustments({
    detected_patterns: state.meta_detected_patterns,
    current_policy_state: state.meta_policy_state,
    overnight_policy: state.supervised_session?.overnight_policy,
    recovery_policy: state.supervised_session?.recovery_policy ?? null,
    planning_priority_weights: (state.planning_recommendations ?? []).map((item) => `${item.work_item_id}:${item.score}`),
    delivery_gating_rules: (state.delivery_packages ?? []).map((item) => `${item.delivery_package_id}:${item.status}`),
    operator_decision_history: state.meta_operator_decision_history,
    timestamp: state.last_updated_at,
  });
  state.meta_intelligence = buildMetaIntelligenceState(state, state.meta_detected_patterns, state.meta_policy_recommendations);
  if (state.studio_summary_package) {
    state.studio_summary_package = createStudioOperationsSummary(state, state.studio_summary_package.requested_at);
  }
  if (state.meta_summary_package) {
    state.meta_summary_package = createMetaIntelligenceSummaryPackage(state, state.meta_summary_package.requested_at);
  }
}

function appendMetaDecision(
  state: OperatorDashboardState,
  decision: NonNullable<OperatorDashboardState["meta_operator_decision_history"]>[number],
): void {
  state.meta_operator_decision_history = [decision, ...(state.meta_operator_decision_history ?? [])];
}

function applyApprovedMetaRecommendation(state: OperatorDashboardState, recommendationId: string): boolean {
  const policyState = state.meta_policy_state;
  const recommendation = state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId) ?? null;
  if (!policyState || !recommendation) {
    return false;
  }

  switch (recommendation.target) {
    case "concurrency":
      state.meta_policy_state = { ...policyState, concurrency_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "tick_budget":
      state.meta_policy_state = { ...policyState, tick_budget_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "review_timing":
      state.meta_policy_state = { ...policyState, review_timing_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "work_type_priority":
      state.meta_policy_state = { ...policyState, work_type_priority_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "checkpoint_frequency":
      state.meta_policy_state = { ...policyState, checkpoint_frequency_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "proof_timeout":
      state.meta_policy_state = { ...policyState, proof_timeout_mode: recommendation.requested_policy_value, last_updated_at: state.last_updated_at };
      return true;
    case "resource_safe_mode":
      state.meta_policy_state = { ...policyState, resource_safe_mode_enabled: /true/i.test(recommendation.requested_policy_value), last_updated_at: state.last_updated_at };
      return true;
    case "agent_role_pause": {
      const requestedRole = recommendation.requested_policy_value.replace(/^paused_agent_role=/, "");
      state.meta_policy_state = {
        ...policyState,
        paused_agent_roles: requestedRole && !policyState.paused_agent_roles.includes(requestedRole)
          ? [...policyState.paused_agent_roles, requestedRole]
          : [...policyState.paused_agent_roles],
        last_updated_at: state.last_updated_at,
      };
      return true;
    }
    default:
      return false;
  }
}

function reviewPackagePriority(item: AutonomousReviewPackage): number {
  if (item.status === "pending") {
    return item.recommended_decision === "approve" ? 0 : 1;
  }
  if (item.status === "deferred" || item.status === "request_changes") {
    return 2;
  }
  return 3;
}

function deliveryPackagePriority(item: AutonomousDeliveryPackage): number {
  if (item.status === "approved_for_commit") {
    return 0;
  }
  if (item.status === "pr_ready" || item.status === "pr_opened") {
    return 1;
  }
  if (item.status === "awaiting_operator_approval") {
    return 2;
  }
  return 3;
}

function canResumeSafeSession(state: OperatorDashboardState, sessionId: string): boolean {
  const session = state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sessionId) ?? null;
  if (!session || session.status !== "paused") {
    return false;
  }
  if (session.blocked_by_conflict || session.tick_budget_remaining <= 0) {
    return false;
  }
  return true;
}

function recalculateAutonomousSessionSummary(state: OperatorDashboardState): void {
  if (!state.autonomous_sessions) {
    return;
  }

  const selectedSession = state.autonomous_sessions.sessions.find((session) => session.status === "running")
    ?? state.autonomous_sessions.sessions.find((session) => session.status === "pending")
    ?? null;
  state.autonomous_sessions.selected_session_id = selectedSession?.session_id ?? null;
  state.autonomous_sessions.runnable_session_ids = state.autonomous_sessions.sessions
    .filter((session) => session.status === "running" || session.status === "pending")
    .map((session) => session.session_id);
  state.autonomous_sessions.blocked_session_ids = state.autonomous_sessions.sessions
    .filter((session) => session.blocked_by_conflict || session.status === "blocked" || session.status === "failed")
    .map((session) => session.session_id);
  state.autonomous_sessions.ready_session_ids = state.autonomous_sessions.sessions
    .filter((session) => session.ready_on_dependency)
    .map((session) => session.session_id);
  state.autonomous_sessions.total_logical_cpu_units = state.autonomous_sessions.sessions
    .filter((session) => session.status === "running" || session.status === "pending")
    .reduce((total, session) => total + session.logical_cpu_units, 0);
  state.autonomous_sessions.total_active_chains = state.autonomous_sessions.sessions
    .filter((session) => session.status === "running" || session.status === "pending")
    .reduce((total, session) => total + session.active_chain_count, 0);
  state.autonomous_sessions.assigned_agent_ids = [...new Set(state.autonomous_sessions.sessions.flatMap((session) => session.assigned_agent_ids))].sort((left, right) => left.localeCompare(right));
  state.autonomous_sessions.resource_status = {
    status: state.autonomous_sessions.sessions.length === 0
      ? "resource_idle"
      : state.autonomous_sessions.total_logical_cpu_units > state.autonomous_sessions.max_logical_cpu_units
        || state.autonomous_sessions.total_active_chains > state.autonomous_sessions.max_concurrent_chains
        ? "resource_pressure"
        : "resource_balanced",
    explanation: state.autonomous_sessions.sessions.length === 0
      ? "No autonomous sessions are registered for bounded parallel execution yet."
      : `Using ${state.autonomous_sessions.total_logical_cpu_units}/${state.autonomous_sessions.max_logical_cpu_units} logical CPU units and ${state.autonomous_sessions.total_active_chains}/${state.autonomous_sessions.max_concurrent_chains} active chains across ${state.autonomous_sessions.sessions.length} sessions.`,
  };
  state.autonomous_sessions.scheduler_status = {
    status: selectedSession ? "session_selected" : "no_runnable_sessions",
    explanation: selectedSession
      ? `Selected ${selectedSession.session_id} for the next bounded multi-session tick.`
      : "No runnable autonomous sessions remain after applying bounded status rules.",
  };
}

function findAutonomousSession(state: OperatorDashboardState, sessionId: string | null | undefined): OperatorDashboardAutonomousSession | null {
  if (!state.autonomous_sessions) {
    return null;
  }

  if (sessionId) {
    return state.autonomous_sessions.sessions.find((session) => session.session_id === sessionId) ?? null;
  }

  return state.autonomous_sessions.sessions[0] ?? null;
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

function buildGoalFromWorkItem(workItem: AutonomousWorkItem, updatedAt: string): OperatorDashboardGoal {
  return {
    goal_id: workItem.work_item_id,
    description: workItem.title,
    explanation: workItem.summary,
    priority: workItem.priority,
    status: workItem.status === "running" ? "active" : workItem.status === "completed" ? "completed" : "pending",
    recommended_action: workItem.status === "scheduled"
      ? "Let the bounded scheduler pick up this approved work item."
      : workItem.status === "completed"
        ? "Review the package outcome and close the item when ready."
        : null,
    depends_on_goal_ids: [...workItem.dependency_ids],
    blocking_goal_ids: [],
    conflict_goal_ids: [],
    last_updated_at: updatedAt,
  };
}

function removeQueuedGoal(state: OperatorDashboardState, goalId: string): void {
  state.queued_goals = state.queued_goals.filter((goal) => goal.goal_id !== goalId);
  state.paused_goals = state.paused_goals.filter((goal) => goal.goal_id !== goalId);
  state.blocked_goals = state.blocked_goals.filter((goal) => goal.goal_id !== goalId);
}

function upsertQueuedGoal(state: OperatorDashboardState, goal: OperatorDashboardGoal): void {
  removeQueuedGoal(state, goal.goal_id);
  if (state.active_goal?.goal_id === goal.goal_id) {
    state.active_goal = goal.status === "active" ? goal : state.active_goal;
    return;
  }
  state.queued_goals = [goal, ...state.queued_goals];
}

function removePlanningRecommendation(state: OperatorDashboardState, workItemId: string): void {
  state.planning_recommendations = (state.planning_recommendations ?? []).filter((item) => item.work_item_id !== workItemId);
}

function ensurePlanningFeedback(state: OperatorDashboardState): AutonomousWorkItemPolicyFeedback {
  const existing = state.planning_policy_feedback;
  if (existing) {
    return existing;
  }
  const created = {
    approvals_recorded: 0,
    rejections_recorded: 0,
    deferrals_recorded: 0,
    request_changes_recorded: 0,
    last_feedback_at: null,
  };
  state.planning_policy_feedback = created;
  return created;
}

function locateWorkItem(state: OperatorDashboardState, workItemId: string | null | undefined): {
  bucket: "proposed_work_items" | "scheduled_work_items" | "running_work_items";
  index: number;
  item: AutonomousWorkItem;
} | null {
  const targetId = workItemId ?? state.proposed_work_items?.[0]?.work_item_id ?? state.scheduled_work_items?.[0]?.work_item_id ?? state.running_work_items?.[0]?.work_item_id ?? null;
  if (!targetId) {
    return null;
  }

  for (const bucket of ["proposed_work_items", "scheduled_work_items", "running_work_items"] as const) {
    const index = state[bucket]?.findIndex((item) => item.work_item_id === targetId) ?? -1;
    if (index >= 0) {
      const item = state[bucket]?.[index] ?? null;
      if (item) {
        return { bucket, index, item };
      }
    }
  }

  return null;
}

function moveWorkItem(
  state: OperatorDashboardState,
  targetBucket: "proposed_work_items" | "scheduled_work_items" | "running_work_items",
  nextItem: AutonomousWorkItem,
): void {
  for (const bucket of ["proposed_work_items", "scheduled_work_items", "running_work_items"] as const) {
    state[bucket] = (state[bucket] ?? []).filter((item) => item.work_item_id !== nextItem.work_item_id);
  }

  state[targetBucket] = [nextItem, ...(state[targetBucket] ?? [])];
}

function locateReviewPackage(state: OperatorDashboardState, packageId: string | null | undefined): {
  index: number;
  item: AutonomousReviewPackage;
} | null {
  const targetId = packageId ?? state.review_packages?.[0]?.package_id ?? null;
  if (!targetId) {
    return null;
  }
  const index = state.review_packages?.findIndex((item) => item.package_id === targetId) ?? -1;
  if (index < 0 || !state.review_packages) {
    return null;
  }
  const item = state.review_packages[index];
  return item ? { index, item } : null;
}

function locateDeliveryPackage(state: OperatorDashboardState, packageId: string | null | undefined): {
  index: number;
  item: AutonomousDeliveryPackage;
} | null {
  const targetId = packageId ?? state.delivery_packages?.[0]?.delivery_package_id ?? null;
  if (!targetId) {
    return null;
  }
  const index = state.delivery_packages?.findIndex((item) => item.delivery_package_id === targetId) ?? -1;
  if (index < 0 || !state.delivery_packages) {
    return null;
  }
  const item = state.delivery_packages[index];
  return item ? { index, item } : null;
}

function slugifyForBranch(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "delivery-package";
}

function buildDeliveryPackageFromReviewPackage(
  reviewPackage: AutonomousReviewPackage,
  updatedAt: string,
  existingPackage?: AutonomousDeliveryPackage,
): AutonomousDeliveryPackage {
  const prTitle = `AI-E: deliver ${reviewPackage.work_item_id}`;
  return {
    delivery_package_id: existingPackage?.delivery_package_id ?? `delivery-${reviewPackage.package_id}`,
    review_package_id: reviewPackage.package_id,
    work_item_id: reviewPackage.work_item_id,
    chain_id: reviewPackage.chain_id,
    branch_name: existingPackage?.branch_name ?? `autonomy/${slugifyForBranch(reviewPackage.work_item_id || reviewPackage.package_id)}`,
    commit_plan: [
      `Stage reviewed changes for ${reviewPackage.work_item_id}.`,
      "Run the bounded validation bundle and capture evidence.",
      "Prepare the PR summary, rollback notes, and operator approval record.",
    ],
    files_changed: [...reviewPackage.files_changed],
    validation_results: [...reviewPackage.tests_run],
    proof_results: [...reviewPackage.proof_results],
    risk_summary: reviewPackage.risks.length ? reviewPackage.risks.join("; ") : "No additional delivery risks recorded.",
    rollback_plan: reviewPackage.rollback_notes || "Revert the reviewed change set and restore the previous delivery branch state.",
    release_notes: reviewPackage.summary,
    recommended_pr_title: prTitle,
    recommended_pr_body: [
      `Summary: ${reviewPackage.summary}`,
      `Validation evidence: ${reviewPackage.tests_run.length ? reviewPackage.tests_run.join(", ") : "No validation evidence recorded yet."}`,
      `Proof evidence: ${reviewPackage.proof_results.length ? reviewPackage.proof_results.join(", ") : "No proof evidence recorded yet."}`,
      `Rollback notes: ${reviewPackage.rollback_notes || "No rollback notes recorded."}`,
    ].join("\n\n"),
    operator_decision: existingPackage?.operator_decision ?? null,
    status: existingPackage?.status && existingPackage.status !== "rejected" && existingPackage.status !== "archived"
      ? existingPackage.status
      : "awaiting_operator_approval",
    created_at: existingPackage?.created_at ?? updatedAt,
    updated_at: updatedAt,
  };
}

function upsertDeliveryPackage(state: OperatorDashboardState, nextItem: AutonomousDeliveryPackage): void {
  state.delivery_packages = [
    nextItem,
    ...(state.delivery_packages ?? []).filter((item) => item.delivery_package_id !== nextItem.delivery_package_id),
  ];
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

    case "pause_all_sessions": {
      let changed = false;
      for (const session of nextState.autonomous_sessions?.sessions ?? []) {
        if (session.status === "running" || session.status === "pending") {
          session.status = "paused";
          session.is_runnable = false;
          session.blocked_by_conflict = false;
          changed = true;
        }
      }
      if (nextState.supervised_session && ["running", "recovering", "pending_approval"].includes(nextState.supervised_session.status)) {
        nextState.supervised_session = {
          ...nextState.supervised_session,
          status: "paused",
          next_scheduled_tick_at: null,
          pending_operator_review: false,
        };
        changed = true;
      }
      if (nextState.active_goal) {
        nextState.paused_goals = [
          markGoal(nextState.active_goal, {
            status: "paused",
            explanation: "Paused by the studio command center.",
            recommended_action: "Resume this goal through the command center when it is safe to continue.",
            last_updated_at: nextTimestamp(nextState),
          }),
          ...nextState.paused_goals.filter((goal) => goal.goal_id !== nextState.active_goal?.goal_id),
        ];
        nextState.active_goal = null;
        changed = true;
      }
      if (!changed) {
        return {
          action,
          changed: false,
          message: "All autonomous sessions are already paused or idle.",
          state: nextState,
        };
      }
      recalculateAutonomousSessionSummary(nextState);
      nextState.runtime_status = {
        status: "runtime_paused",
        explanation: "The studio command center paused all runnable sessions.",
      };
      nextState.session_status = {
        status: "session_paused",
        explanation: "All safe session execution is paused until the operator resumes it.",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "All runnable sessions were paused through the studio command center.",
        state: nextState,
      };
    }

    case "resume_safe_sessions": {
      let resumedCount = 0;
      for (const session of nextState.autonomous_sessions?.sessions ?? []) {
        if (canResumeSafeSession(nextState, session.session_id)) {
          session.status = "pending";
          session.is_runnable = true;
          session.blocked_by_conflict = false;
          resumedCount += 1;
        }
      }
      if (nextState.supervised_session
        && nextState.supervised_session.status === "paused"
        && nextState.approvals_required.length === 0
        && !nextState.supervised_session.pending_operator_review) {
        nextState.supervised_session = {
          ...nextState.supervised_session,
          status: "running",
          next_scheduled_tick_at: nextTimestamp(nextState),
        };
        resumedCount += 1;
      }
      if (resumedCount === 0) {
        return {
          action,
          changed: false,
          message: "No paused safe sessions are available to resume.",
          state: nextState,
        };
      }
      recalculateAutonomousSessionSummary(nextState);
      nextState.runtime_status = {
        status: "runtime_ready",
        explanation: "The studio command center resumed safe paused sessions.",
      };
      nextState.session_status = {
        status: "session_running",
        explanation: `${resumedCount} paused session${resumedCount === 1 ? " was" : "s were"} resumed after safety checks.`,
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `${resumedCount} safe paused session${resumedCount === 1 ? " was" : "s were"} resumed.`,
        state: nextState,
      };
    }

    case "prioritize_review_queue": {
      const reviewPackages = nextState.review_packages ?? [];
      if (reviewPackages.length === 0) {
        return {
          action,
          changed: false,
          message: "No review packages are available to reprioritize.",
          state: nextState,
        };
      }
      nextState.review_packages = [...reviewPackages].sort((left, right) => {
        return reviewPackagePriority(left) - reviewPackagePriority(right) || left.work_item_id.localeCompare(right.work_item_id);
      });
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The review queue was reprioritized for operator attention.",
        state: nextState,
      };
    }

    case "prioritize_delivery_queue": {
      const deliveryPackages = nextState.delivery_packages ?? [];
      if (deliveryPackages.length === 0) {
        return {
          action,
          changed: false,
          message: "No delivery packages are available to reprioritize.",
          state: nextState,
        };
      }
      nextState.delivery_packages = [...deliveryPackages].sort((left, right) => {
        return deliveryPackagePriority(left) - deliveryPackagePriority(right) || left.work_item_id.localeCompare(right.work_item_id);
      });
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The delivery queue was reprioritized for operator action.",
        state: nextState,
      };
    }

    case "acknowledge_studio_risk": {
      const topRisk = nextState.studio_operations?.recent_risks[0] ?? aggregateStudioHealthFromDashboardState(nextState).recent_risks[0] ?? null;
      if (!topRisk) {
        return {
          action,
          changed: false,
          message: "No studio risk is currently available to acknowledge.",
          state: nextState,
        };
      }
      const acknowledgedAt = nextTimestamp(nextState);
      const acknowledgements = nextState.studio_risk_acknowledgements ?? [];
      const alreadyAcknowledged = acknowledgements.some((item) => item.risk_id === topRisk.id);
      nextState.studio_risk_acknowledgements = alreadyAcknowledged
        ? acknowledgements.map((item) => item.risk_id === topRisk.id ? { ...item, acknowledged_at: acknowledgedAt } : item)
        : [{ risk_id: topRisk.id, acknowledged_at: acknowledgedAt }, ...acknowledgements];
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Studio risk ${topRisk.id} was acknowledged.`,
        state: nextState,
      };
    }

    case "request_studio_summary": {
      nextState.studio_summary_package = createStudioOperationsSummary(nextState, nextTimestamp(nextState));
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "A fresh studio summary package was generated from live operator state.",
        state: nextState,
      };
    }

    case "approve_policy_recommendation": {
      const recommendation = nextState.meta_policy_recommendations?.find((item) => item.recommendation_id === (action.recommendation_id ?? nextState.meta_policy_recommendations?.[0]?.recommendation_id ?? null)) ?? null;
      if (!recommendation) {
        return {
          action,
          changed: false,
          message: "No meta-intelligence recommendation is available to approve.",
          state: nextState,
        };
      }
      nextState.meta_policy_recommendations = (nextState.meta_policy_recommendations ?? []).map((item) => item.recommendation_id === recommendation.recommendation_id ? { ...item, status: "approved", last_updated_at: nextTimestamp(nextState) } : item);
      appendMetaDecision(nextState, {
        decision_id: `meta-decision-${recommendation.recommendation_id}-approve-${nextTimestamp(nextState).replace(/[^0-9]/g, "").slice(0, 14)}`,
        decision_type: "approve_policy_recommendation",
        recommendation_id: recommendation.recommendation_id,
        pattern_id: null,
        rationale: action.rationale ?? `Approved ${recommendation.title}.`,
        created_at: nextTimestamp(nextState),
      });
      applyApprovedMetaRecommendation(nextState, recommendation.recommendation_id);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Meta-intelligence recommendation ${recommendation.recommendation_id} was approved and persisted to policy state.`,
        state: nextState,
      };
    }

    case "reject_policy_recommendation": {
      const recommendation = nextState.meta_policy_recommendations?.find((item) => item.recommendation_id === (action.recommendation_id ?? nextState.meta_policy_recommendations?.[0]?.recommendation_id ?? null)) ?? null;
      if (!recommendation) {
        return {
          action,
          changed: false,
          message: "No meta-intelligence recommendation is available to reject.",
          state: nextState,
        };
      }
      nextState.meta_policy_recommendations = (nextState.meta_policy_recommendations ?? []).map((item) => item.recommendation_id === recommendation.recommendation_id ? { ...item, status: "rejected", last_updated_at: nextTimestamp(nextState) } : item);
      appendMetaDecision(nextState, {
        decision_id: `meta-decision-${recommendation.recommendation_id}-reject-${nextTimestamp(nextState).replace(/[^0-9]/g, "").slice(0, 14)}`,
        decision_type: "reject_policy_recommendation",
        recommendation_id: recommendation.recommendation_id,
        pattern_id: null,
        rationale: action.rationale ?? `Rejected ${recommendation.title}.`,
        created_at: nextTimestamp(nextState),
      });
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Meta-intelligence recommendation ${recommendation.recommendation_id} was rejected and remains auditable.`,
        state: nextState,
      };
    }

    case "defer_policy_recommendation": {
      const recommendation = nextState.meta_policy_recommendations?.find((item) => item.recommendation_id === (action.recommendation_id ?? nextState.meta_policy_recommendations?.[0]?.recommendation_id ?? null)) ?? null;
      if (!recommendation) {
        return {
          action,
          changed: false,
          message: "No meta-intelligence recommendation is available to defer.",
          state: nextState,
        };
      }
      nextState.meta_policy_recommendations = (nextState.meta_policy_recommendations ?? []).map((item) => item.recommendation_id === recommendation.recommendation_id ? { ...item, status: "deferred", last_updated_at: nextTimestamp(nextState) } : item);
      appendMetaDecision(nextState, {
        decision_id: `meta-decision-${recommendation.recommendation_id}-defer-${nextTimestamp(nextState).replace(/[^0-9]/g, "").slice(0, 14)}`,
        decision_type: "defer_policy_recommendation",
        recommendation_id: recommendation.recommendation_id,
        pattern_id: null,
        rationale: action.rationale ?? `Deferred ${recommendation.title}.`,
        created_at: nextTimestamp(nextState),
      });
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Meta-intelligence recommendation ${recommendation.recommendation_id} was deferred for later review.`,
        state: nextState,
      };
    }

    case "request_meta_summary": {
      nextState.meta_summary_package = createMetaIntelligenceSummaryPackage(nextState, nextTimestamp(nextState));
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "A fresh meta-intelligence summary package was generated from live operator state.",
        state: nextState,
      };
    }

    case "acknowledge_pattern": {
      const pattern = nextState.meta_detected_patterns?.find((item) => item.pattern_id === (action.pattern_id ?? nextState.meta_detected_patterns?.[0]?.pattern_id ?? null)) ?? null;
      if (!pattern) {
        return {
          action,
          changed: false,
          message: "No meta-intelligence pattern is available to acknowledge.",
          state: nextState,
        };
      }
      appendMetaDecision(nextState, {
        decision_id: `meta-decision-${pattern.pattern_id}-ack-${nextTimestamp(nextState).replace(/[^0-9]/g, "").slice(0, 14)}`,
        decision_type: "acknowledge_pattern",
        recommendation_id: null,
        pattern_id: pattern.pattern_id,
        rationale: action.rationale ?? `Acknowledged ${pattern.summary}.`,
        created_at: nextTimestamp(nextState),
      });
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Meta-intelligence pattern ${pattern.pattern_id} was acknowledged.`,
        state: nextState,
      };
    }

    case "pause_autonomous_session": {
      const session = findAutonomousSession(nextState, action.session_id);
      if (!session || session.status !== "running") {
        return {
          action,
          changed: false,
          message: "No running autonomous session is available to pause.",
          state: nextState,
        };
      }

      session.status = "paused";
      session.is_runnable = false;
      session.blocked_by_conflict = false;
      recalculateAutonomousSessionSummary(nextState);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Autonomous session ${session.session_id} was paused.`,
        state: nextState,
      };
    }

    case "resume_autonomous_session": {
      const session = findAutonomousSession(nextState, action.session_id);
      if (!session || !["paused", "blocked"].includes(session.status)) {
        return {
          action,
          changed: false,
          message: "No paused autonomous session is available to resume.",
          state: nextState,
        };
      }

      session.status = "pending";
      session.is_runnable = true;
      session.blocked_by_conflict = false;
      recalculateAutonomousSessionSummary(nextState);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Autonomous session ${session.session_id} was resumed.`,
        state: nextState,
      };
    }

    case "reprioritize_autonomous_session": {
      const session = findAutonomousSession(nextState, action.session_id);
      const nextPriority = action.session_priority ?? null;
      if (!session || !nextPriority) {
        return {
          action,
          changed: false,
          message: "A target autonomous session and priority are required to reprioritize session work.",
          state: nextState,
        };
      }

      session.priority = nextPriority;
      recalculateAutonomousSessionSummary(nextState);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Autonomous session ${session.session_id} priority changed to ${nextPriority}.`,
        state: nextState,
      };
    }

    case "merge_autonomous_sessions": {
      if (!nextState.autonomous_sessions) {
        return {
          action,
          changed: false,
          message: "No autonomous session state is available to merge.",
          state: nextState,
        };
      }

      const sourceSession = findAutonomousSession(nextState, action.session_id);
      const targetSession = findAutonomousSession(nextState, action.target_session_id);
      if (!sourceSession || !targetSession || sourceSession.session_id === targetSession.session_id) {
        return {
          action,
          changed: false,
          message: "Two distinct autonomous sessions are required for a merge.",
          state: nextState,
        };
      }

      targetSession.assigned_agent_ids = [...new Set([...targetSession.assigned_agent_ids, ...sourceSession.assigned_agent_ids])].sort((left, right) => left.localeCompare(right));
      targetSession.active_chain_count += sourceSession.active_chain_count;
      targetSession.queued_work_item_count += sourceSession.queued_work_item_count;
      targetSession.logical_cpu_units += sourceSession.logical_cpu_units;
      targetSession.parent_session_id = targetSession.parent_session_id ?? sourceSession.parent_session_id ?? sourceSession.session_id;
      sourceSession.status = "completed";
      sourceSession.is_runnable = false;
      sourceSession.active_chain_count = 0;
      sourceSession.queued_work_item_count = 0;
      sourceSession.logical_cpu_units = 0;
      sourceSession.assigned_agent_ids = [];
      nextState.autonomous_sessions.conflicts = nextState.autonomous_sessions.conflicts.filter((conflict) => {
        return conflict.left_session_id !== sourceSession.session_id && conflict.right_session_id !== sourceSession.session_id;
      });
      recalculateAutonomousSessionSummary(nextState);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Merged autonomous session ${sourceSession.session_id} into ${targetSession.session_id}.`,
        state: nextState,
      };
    }

    case "terminate_autonomous_session": {
      const session = findAutonomousSession(nextState, action.session_id);
      if (!session || ["completed", "failed"].includes(session.status)) {
        return {
          action,
          changed: false,
          message: "No active autonomous session is available to terminate.",
          state: nextState,
        };
      }

      session.status = "failed";
      session.is_runnable = false;
      session.blocked_by_conflict = true;
      session.active_chain_count = 0;
      session.tick_budget_remaining = 0;
      recalculateAutonomousSessionSummary(nextState);
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: `Autonomous session ${session.session_id} was terminated.`,
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

    case "approve_work_item": {
      const resolved = locateWorkItem(nextState, action.work_item_id);
      if (!resolved) {
        return {
          action,
          changed: false,
          message: "No autonomous work item is available to approve.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      const approvedItem: AutonomousWorkItem = {
        ...cloneWorkItem(resolved.item),
        status: "scheduled",
        updated_at: updatedAt,
      };
      moveWorkItem(nextState, "scheduled_work_items", approvedItem);
      upsertQueuedGoal(nextState, buildGoalFromWorkItem(approvedItem, updatedAt));
      removePlanningRecommendation(nextState, approvedItem.work_item_id);
      nextState.queue_status = {
        status: "queue_running",
        explanation: `${approvedItem.title} was approved and added to the bounded work queue.`,
      };
      nextState.scheduler_status = {
        status: "goal_selected",
        explanation: `${approvedItem.title} is ready for bounded scheduling.`,
      };
      const feedback = ensurePlanningFeedback(nextState);
      feedback.approvals_recorded += 1;
      feedback.last_feedback_at = updatedAt;
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The autonomous work item was approved and queued.",
        state: nextState,
      };
    }

    case "reject_work_item": {
      const resolved = locateWorkItem(nextState, action.work_item_id);
      if (!resolved) {
        return {
          action,
          changed: false,
          message: "No autonomous work item is available to reject.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      const rejectedItem: AutonomousWorkItem = {
        ...cloneWorkItem(resolved.item),
        status: "rejected",
        updated_at: updatedAt,
      };
      moveWorkItem(nextState, "proposed_work_items", rejectedItem);
      removeQueuedGoal(nextState, rejectedItem.work_item_id);
      removePlanningRecommendation(nextState, rejectedItem.work_item_id);
      const feedback = ensurePlanningFeedback(nextState);
      feedback.rejections_recorded += 1;
      feedback.last_feedback_at = updatedAt;
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The autonomous work item was rejected.",
        state: nextState,
      };
    }

    case "defer_work_item": {
      const resolved = locateWorkItem(nextState, action.work_item_id);
      if (!resolved) {
        return {
          action,
          changed: false,
          message: "No autonomous work item is available to defer.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      const deferredItem: AutonomousWorkItem = {
        ...cloneWorkItem(resolved.item),
        status: "needs_review",
        updated_at: updatedAt,
      };
      moveWorkItem(nextState, "proposed_work_items", deferredItem);
      removeQueuedGoal(nextState, deferredItem.work_item_id);
      const feedback = ensurePlanningFeedback(nextState);
      feedback.deferrals_recorded += 1;
      feedback.last_feedback_at = updatedAt;
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The autonomous work item was deferred for later review.",
        state: nextState,
      };
    }

    case "approve_review_package": {
      const resolved = locateReviewPackage(nextState, action.package_id);
      if (!resolved || !nextState.review_packages) {
        return {
          action,
          changed: false,
          message: "No review package is available to approve.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.review_packages[resolved.index] = {
        ...cloneReviewPackage(resolved.item),
        status: "approved",
      };
      const existingDeliveryPackage = nextState.delivery_packages?.find((item) => item.review_package_id === resolved.item.package_id);
      upsertDeliveryPackage(nextState, buildDeliveryPackageFromReviewPackage(resolved.item, updatedAt, existingDeliveryPackage));
      const workItem = locateWorkItem(nextState, resolved.item.work_item_id);
      if (workItem) {
        const completedItem: AutonomousWorkItem = {
          ...cloneWorkItem(workItem.item),
          status: "completed",
          updated_at: updatedAt,
        };
        nextState[workItem.bucket] = (nextState[workItem.bucket] ?? []).filter((item) => item.work_item_id !== completedItem.work_item_id);
        nextState.completed_goals = [buildGoalFromWorkItem(completedItem, updatedAt), ...nextState.completed_goals.filter((goal) => goal.goal_id !== completedItem.work_item_id)];
      }
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The review package was approved and a delivery package is ready for operator approval.",
        state: nextState,
      };
    }

    case "reject_review_package": {
      const resolved = locateReviewPackage(nextState, action.package_id);
      if (!resolved || !nextState.review_packages) {
        return {
          action,
          changed: false,
          message: "No review package is available to reject.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.review_packages[resolved.index] = {
        ...cloneReviewPackage(resolved.item),
        status: "rejected",
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The review package was rejected.",
        state: nextState,
      };
    }

    case "approve_delivery_package": {
      const resolved = locateDeliveryPackage(nextState, action.package_id);
      if (!resolved || !nextState.delivery_packages) {
        return {
          action,
          changed: false,
          message: "No delivery package is available to approve for commit.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.delivery_packages[resolved.index] = {
        ...cloneDeliveryPackage(resolved.item),
        operator_decision: "approve_for_commit",
        status: "approved_for_commit",
        updated_at: updatedAt,
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The delivery package was approved for commit.",
        state: nextState,
      };
    }

    case "reject_delivery_package": {
      const resolved = locateDeliveryPackage(nextState, action.package_id);
      if (!resolved || !nextState.delivery_packages) {
        return {
          action,
          changed: false,
          message: "No delivery package is available to reject.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.delivery_packages[resolved.index] = {
        ...cloneDeliveryPackage(resolved.item),
        operator_decision: "reject_delivery",
        status: "rejected",
        updated_at: updatedAt,
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The delivery package was rejected.",
        state: nextState,
      };
    }

    case "request_delivery_changes": {
      const resolved = locateDeliveryPackage(nextState, action.package_id);
      if (!resolved || !nextState.delivery_packages) {
        return {
          action,
          changed: false,
          message: "No delivery package is available for a change request.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.delivery_packages[resolved.index] = {
        ...cloneDeliveryPackage(resolved.item),
        operator_decision: "request_changes",
        status: "draft",
        updated_at: updatedAt,
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The delivery package was sent back for changes.",
        state: nextState,
      };
    }

    case "archive_delivery_package": {
      const resolved = locateDeliveryPackage(nextState, action.package_id);
      if (!resolved || !nextState.delivery_packages) {
        return {
          action,
          changed: false,
          message: "No delivery package is available to archive.",
          state: nextState,
        };
      }

      const updatedAt = nextTimestamp(nextState);
      nextState.delivery_packages[resolved.index] = {
        ...cloneDeliveryPackage(resolved.item),
        operator_decision: "archive",
        status: "archived",
        updated_at: updatedAt,
      };
      updateLastUpdated(nextState);
      return {
        action,
        changed: true,
        message: "The delivery package was archived.",
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
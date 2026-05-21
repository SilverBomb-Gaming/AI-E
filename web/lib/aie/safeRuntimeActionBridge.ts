import type { OperatorControlAction } from "./operatorControlSurface";
import type {
  OperatorDashboardApprovalRequirement,
  OperatorDashboardBlockedGoal,
  OperatorDashboardGoal,
  OperatorDashboardRecoveryRecommendation,
  OperatorDashboardState,
} from "./operatorDashboardState";
import type {
  OperatorStateSource,
  OperatorRuntimeStateProviderResult,
} from "./operatorRuntimeStateContract";

export type SafeRuntimeIntent =
  | "grant_session_approval"
  | "pause_active_goal"
  | "resume_paused_goal"
  | "mark_goal_retry_requested"
  | "pause_all_sessions"
  | "resume_safe_sessions"
  | "prioritize_review_queue"
  | "prioritize_delivery_queue"
  | "acknowledge_studio_risk"
  | "request_studio_summary"
  | "approve_policy_recommendation"
  | "reject_policy_recommendation"
  | "defer_policy_recommendation"
  | "request_meta_summary"
  | "acknowledge_pattern"
  | "approve_strategy_goal"
  | "reject_strategy_goal"
  | "defer_strategy_goal"
  | "activate_strategy_goal"
  | "pause_strategy_goal"
  | "archive_strategy_goal"
  | "decompose_strategy_goal"
  | "request_strategy_summary"
  | "submit_chat_message"
  | "select_chat_option"
  | "archive_chat_session"
  | "request_chat_summary"
  | "pause_governed_lane"
  | "resume_governed_lane"
  | "reprioritize_governed_lane"
  | "merge_governed_lanes"
  | "terminate_governed_lane"
  | "start_supervised_session"
  | "pause_supervised_session"
  | "resume_supervised_session"
  | "stop_supervised_session"
  | "request_supervised_operator_review"
  | "approve_review_queue_item"
  | "reject_review_queue_item"
  | "defer_review_queue_item"
  | "approve_autonomous_work_item"
  | "reject_autonomous_work_item"
  | "defer_autonomous_work_item"
  | "approve_autonomous_review_package"
  | "reject_autonomous_review_package"
  | "approve_autonomous_delivery_package"
  | "reject_autonomous_delivery_package"
  | "request_changes_autonomous_delivery_package"
  | "archive_autonomous_delivery_package"
  | "no_op";

export type SafeRuntimeActionBridgeStatus =
  | "action_ready"
  | "action_rejected"
  | "action_requires_review"
  | "action_unsupported";

export type SafeRuntimeActionAuditEvent = {
  audit_event_id: string;
  created_at: string;
  source: OperatorStateSource;
  action_type: OperatorControlAction["type"];
  goal_id: string | null;
  status: SafeRuntimeActionBridgeStatus;
  runtime_intent: SafeRuntimeIntent;
  reason: string;
};

export type SafeRuntimeActionBridgeResult = {
  status: SafeRuntimeActionBridgeStatus;
  action: OperatorControlAction;
  source: OperatorStateSource;
  goal_id: string | null;
  runtime_intent: SafeRuntimeIntent;
  reason: string;
  warnings: string[];
  audit_event: SafeRuntimeActionAuditEvent;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function createAuditEvent(
  source: OperatorStateSource,
  action: OperatorControlAction,
  status: SafeRuntimeActionBridgeStatus,
  runtimeIntent: SafeRuntimeIntent,
  reason: string,
  createdAt: string,
): SafeRuntimeActionAuditEvent {
  const actionTargetId = action.goal_id
    ?? action.recommendation_id
    ?? action.pattern_id
    ?? action.option_id
    ?? action.session_id
    ?? action.target_session_id
    ?? action.work_item_id
    ?? action.package_id
    ?? "global";

  return {
    audit_event_id: [
      "safe-runtime-action-bridge",
      sanitizeTimestamp(createdAt),
      source,
      action.type,
      actionTargetId,
    ].join("-"),
    created_at: createdAt,
    source,
    action_type: action.type,
    goal_id: actionTargetId === "global" ? null : actionTargetId,
    status,
    runtime_intent: runtimeIntent,
    reason,
  };
}

function buildResult(
  source: OperatorStateSource,
  action: OperatorControlAction,
  status: SafeRuntimeActionBridgeStatus,
  runtimeIntent: SafeRuntimeIntent,
  reason: string,
  warnings: string[],
  createdAt: string,
): SafeRuntimeActionBridgeResult {
  const actionTargetId = action.goal_id
    ?? action.recommendation_id
    ?? action.pattern_id
    ?? action.option_id
    ?? action.session_id
    ?? action.target_session_id
    ?? action.work_item_id
    ?? action.package_id
    ?? null;

  return {
    status,
    action,
    source,
    goal_id: actionTargetId,
    runtime_intent: runtimeIntent,
    reason,
    warnings: unique(warnings),
    audit_event: createAuditEvent(source, action, status, runtimeIntent, reason, createdAt),
  };
}

function resolveActiveGoal(state: OperatorDashboardState, goalId: string | null | undefined): OperatorDashboardGoal | null {
  if (!state.active_goal) {
    return null;
  }
  if (!goalId || state.active_goal.goal_id === goalId) {
    return state.active_goal;
  }
  return null;
}

function resolvePausedGoal(state: OperatorDashboardState, goalId: string | null | undefined): OperatorDashboardGoal | null {
  if (!goalId) {
    return state.paused_goals[0] ?? null;
  }
  return state.paused_goals.find((goal) => goal.goal_id === goalId) ?? null;
}

function resolveApproval(state: OperatorDashboardState, goalId: string | null | undefined): OperatorDashboardApprovalRequirement | null {
  if (!goalId) {
    return state.approvals_required[0] ?? null;
  }
  return state.approvals_required.find((approval) => approval.goal_id === goalId) ?? null;
}

function resolveRetryCandidate(
  state: OperatorDashboardState,
  goalId: string | null | undefined,
): {
  blockedGoal: OperatorDashboardBlockedGoal | null;
  recommendation: OperatorDashboardRecoveryRecommendation | null;
} {
  const blockedGoal = goalId
    ? state.blocked_goals.find((goal) => goal.goal_id === goalId) ?? null
    : state.blocked_goals[0] ?? null;
  const recommendation = state.recovery_recommendations[0] ?? null;
  return { blockedGoal, recommendation };
}

function resolveAutonomousSession(state: OperatorDashboardState, sessionId: string | null | undefined) {
  if (!sessionId) {
    return null;
  }

  return state.governed_runtime_lanes?.sessions.find((session) => session.session_id === sessionId) ?? null;
}

function resolveStrategyGoal(state: OperatorDashboardState, goalId: string | null | undefined) {
  if (!goalId) {
    return state.strategy_goals?.[0] ?? null;
  }

  return state.strategy_goals?.find((goal) => goal.strategy_goal_id === goalId) ?? null;
}

function resolveConversationalSession(state: OperatorDashboardState) {
  return state.conversational_session ?? null;
}

export function createSafeRuntimeActionBridgeResult(
  providerResult: OperatorRuntimeStateProviderResult,
  action: OperatorControlAction,
  createdAt = providerResult.loaded_at,
): SafeRuntimeActionBridgeResult {
  const source = providerResult.source;

  if (source === "demo_seed") {
    return buildResult(
      source,
      action,
      "action_rejected",
      "no_op",
      "demo seed actions must stay in the local demo control path",
      providerResult.warnings,
      createdAt,
    );
  }

  if (source === "unavailable") {
    return buildResult(
      source,
      action,
      "action_rejected",
      "no_op",
      "no live runtime state is available for this operator action",
      providerResult.warnings,
      createdAt,
    );
  }

  const state = providerResult.dashboard_state;
  if (!state) {
    return buildResult(
      source,
      action,
      "action_rejected",
      "no_op",
      "live runtime state is missing a dashboard snapshot",
      providerResult.warnings,
      createdAt,
    );
  }

  switch (action.type) {
    case "approve_goal": {
      const approval = resolveApproval(state, action.goal_id);
      if (!approval) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "session approval is not currently required for this live runtime state",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "grant_session_approval",
        "session approval is required and may be granted through the runtime approval path",
        [...providerResult.warnings, `Approval target: ${approval.goal_id ?? "global"}`],
        createdAt,
      );
    }

    case "pause_goal": {
      const activeGoal = resolveActiveGoal(state, action.goal_id);
      if (!activeGoal) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no active goal exists for a live runtime pause request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "pause_active_goal",
        "an active goal exists and may be paused through the runtime session boundary",
        [...providerResult.warnings, `Pause target: ${activeGoal.goal_id}`],
        createdAt,
      );
    }

    case "resume_goal": {
      const pausedGoal = resolvePausedGoal(state, action.goal_id);
      if (!pausedGoal) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no paused goal exists for a live runtime resume request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "resume_paused_goal",
        "a paused goal exists and may be resumed through the runtime session boundary",
        [...providerResult.warnings, `Resume target: ${pausedGoal.goal_id}`],
        createdAt,
      );
    }

    case "retry_goal": {
      const retryCandidate = resolveRetryCandidate(state, action.goal_id);
      if (!retryCandidate.blockedGoal && !retryCandidate.recommendation) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no blocked goal or recovery recommendation exists for a live runtime retry request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "mark_goal_retry_requested",
        "a blocked goal or recovery recommendation exists and may be marked for retry through the runtime queue boundary",
        [...providerResult.warnings, `Retry target: ${retryCandidate.blockedGoal?.goal_id ?? action.goal_id ?? "recovery"}`],
        createdAt,
      );
    }

    case "pause_all_sessions": {
      const hasRunnableSession = state.governed_runtime_lanes?.sessions.some((session) => session.status === "running" || session.status === "pending")
        || (state.supervised_session ? ["running", "recovering", "pending_approval"].includes(state.supervised_session.status) : false)
        || Boolean(state.active_goal);
      if (!hasRunnableSession) {
        return buildResult(source, action, "action_rejected", "no_op", "no runnable session exists for a studio-wide pause request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "pause_all_sessions", "all runnable autonomous work may be paused through the studio command center", providerResult.warnings, createdAt);
    }

    case "resume_safe_sessions": {
      const hasSafePausedSession = state.governed_runtime_lanes?.sessions.some((session) => session.status === "paused" && !session.blocked_by_conflict && session.tick_budget_remaining > 0)
        || Boolean(state.supervised_session && state.supervised_session.status === "paused" && !state.supervised_session.pending_operator_review && state.approvals_required.length === 0);
      if (!hasSafePausedSession) {
        return buildResult(source, action, "action_rejected", "no_op", "no paused safe session exists for a studio-wide resume request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "resume_safe_sessions", "paused safe sessions may resume through the studio command center", providerResult.warnings, createdAt);
    }

    case "prioritize_review_queue": {
      if ((state.review_packages?.length ?? 0) === 0) {
        return buildResult(source, action, "action_rejected", "no_op", "no review packages exist for a studio review-queue reprioritization request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "prioritize_review_queue", "review package ordering may be safely reprioritized through the studio command center", providerResult.warnings, createdAt);
    }

    case "prioritize_delivery_queue": {
      if ((state.delivery_packages?.length ?? 0) === 0) {
        return buildResult(source, action, "action_rejected", "no_op", "no delivery packages exist for a studio delivery-queue reprioritization request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "prioritize_delivery_queue", "delivery package ordering may be safely reprioritized through the studio command center", providerResult.warnings, createdAt);
    }

    case "acknowledge_studio_risk": {
      if ((state.studio_operations?.recent_risks.length ?? 0) === 0 && state.recovery_recommendations.length === 0 && state.validation_issues.length === 0) {
        return buildResult(source, action, "action_rejected", "no_op", "no studio risk exists for acknowledgement in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "acknowledge_studio_risk", "the current top studio risk may be acknowledged without triggering hidden execution", providerResult.warnings, createdAt);
    }

    case "request_studio_summary": {
      return buildResult(source, action, "action_ready", "request_studio_summary", "a studio summary package may be generated from the current live runtime state", providerResult.warnings, createdAt);
    }

    case "approve_policy_recommendation": {
      const recommendationId = action.recommendation_id ?? state.meta_policy_recommendations?.[0]?.recommendation_id ?? null;
      const recommendation = recommendationId
        ? state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId) ?? null
        : null;
      if (!recommendation) {
        return buildResult(source, action, "action_rejected", "no_op", "no meta-intelligence recommendation exists for approval in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "approve_policy_recommendation", "a bounded policy recommendation may be approved and persisted without modifying code", [...providerResult.warnings, `Recommendation target: ${recommendation.recommendation_id}`], createdAt);
    }

    case "reject_policy_recommendation": {
      const recommendationId = action.recommendation_id ?? state.meta_policy_recommendations?.[0]?.recommendation_id ?? null;
      const recommendation = recommendationId
        ? state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId) ?? null
        : null;
      if (!recommendation) {
        return buildResult(source, action, "action_rejected", "no_op", "no meta-intelligence recommendation exists for rejection in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "reject_policy_recommendation", "a bounded policy recommendation may be rejected while remaining auditable", [...providerResult.warnings, `Recommendation target: ${recommendation.recommendation_id}`], createdAt);
    }

    case "defer_policy_recommendation": {
      const recommendationId = action.recommendation_id ?? state.meta_policy_recommendations?.[0]?.recommendation_id ?? null;
      const recommendation = recommendationId
        ? state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId) ?? null
        : null;
      if (!recommendation) {
        return buildResult(source, action, "action_rejected", "no_op", "no meta-intelligence recommendation exists for deferral in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "defer_policy_recommendation", "a bounded policy recommendation may be deferred for later operator review", [...providerResult.warnings, `Recommendation target: ${recommendation.recommendation_id}`], createdAt);
    }

    case "request_meta_summary": {
      return buildResult(source, action, "action_ready", "request_meta_summary", "a meta-intelligence summary package may be generated from the current live runtime state", providerResult.warnings, createdAt);
    }

    case "acknowledge_pattern": {
      const patternId = action.pattern_id ?? state.meta_detected_patterns?.[0]?.pattern_id ?? null;
      const pattern = patternId
        ? state.meta_detected_patterns?.find((item) => item.pattern_id === patternId) ?? null
        : null;
      if (!pattern) {
        return buildResult(source, action, "action_rejected", "no_op", "no meta-intelligence pattern exists for acknowledgement in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "acknowledge_pattern", "a detected meta-intelligence pattern may be acknowledged without widening autonomy scope", [...providerResult.warnings, `Pattern target: ${pattern.pattern_id}`], createdAt);
    }

    case "approve_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || !["proposed", "under_review"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "no strategic goal exists for approval in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "approve_strategy_goal", "a proposed strategic goal may be approved without starting autonomous execution", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "reject_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || ["rejected", "archived"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "no strategic goal exists for rejection in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "reject_strategy_goal", "a strategic goal may be rejected while remaining auditable", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "defer_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || ["completed", "archived"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "no strategic goal exists for deferral in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "defer_strategy_goal", "a strategic goal may be deferred for later operator review", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "activate_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || !["approved", "paused"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "no approved strategic goal exists for activation in the current live runtime state", providerResult.warnings, createdAt);
      }
      if (goal.blocked_by.length > 0) {
        return buildResult(source, action, "action_rejected", "no_op", "the selected strategic goal is still blocked and cannot be activated", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "activate_strategy_goal", "an approved strategic goal may be activated without starting hidden execution", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "pause_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || !["active", "approved"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "no active strategic goal exists for pause in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "pause_strategy_goal", "an active strategic goal may be paused without widening autonomy scope", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "archive_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || goal.status === "active" || goal.status === "archived") {
        return buildResult(source, action, "action_rejected", "no_op", "no strategic goal exists for archival in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "archive_strategy_goal", "a non-active strategic goal may be archived through the bounded portfolio control path", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "decompose_strategy_goal": {
      const goal = resolveStrategyGoal(state, action.goal_id);
      if (!goal || !["approved", "active"].includes(goal.status)) {
        return buildResult(source, action, "action_rejected", "no_op", "only approved or active strategic goals may be decomposed in the current live runtime state", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "decompose_strategy_goal", "a strategic goal may be decomposed into bounded proposed work items without automatic execution", [...providerResult.warnings, `Strategy goal target: ${goal.strategy_goal_id}`], createdAt);
    }

    case "request_strategy_summary": {
      return buildResult(source, action, "action_ready", "request_strategy_summary", "a strategy portfolio summary package may be generated from the current live runtime state", providerResult.warnings, createdAt);
    }

    case "submit_chat_message": {
      if (!normalizeText(action.message_text)) {
        return buildResult(source, action, "action_rejected", "no_op", "a non-empty chat message is required before the conversational layer can classify it", providerResult.warnings, createdAt);
      }

      return buildResult(source, action, "action_ready", "submit_chat_message", "a chat request may be classified into a bounded advisory proposal without triggering execution", providerResult.warnings, createdAt);
    }

    case "select_chat_option": {
      const session = resolveConversationalSession(state);
      const optionId = normalizeText(action.option_id);
      if (!session || !optionId || !session.pending_options.some((option) => option.option_id === optionId)) {
        return buildResult(source, action, "action_rejected", "no_op", "the selected chat option is not available in the current conversational session", providerResult.warnings, createdAt);
      }

      return buildResult(source, action, "action_ready", "select_chat_option", "a chat option may be recorded as an operator choice without triggering execution", providerResult.warnings, createdAt);
    }

    case "archive_chat_session": {
      const session = resolveConversationalSession(state);
      if (!session || session.status === "archived") {
        return buildResult(source, action, "action_rejected", "no_op", "no active conversational session is available to archive", providerResult.warnings, createdAt);
      }

      return buildResult(source, action, "action_ready", "archive_chat_session", "the operator may archive the current conversational session without triggering execution", providerResult.warnings, createdAt);
    }

    case "request_chat_summary": {
      const session = resolveConversationalSession(state);
      if (!session || session.messages.length === 0) {
        return buildResult(source, action, "action_rejected", "no_op", "no conversational session is available to summarize", providerResult.warnings, createdAt);
      }

      return buildResult(source, action, "action_ready", "request_chat_summary", "a bounded chat summary may be generated from the current conversational session", providerResult.warnings, createdAt);
    }

    case "pause_governed_lane":
    {
      const session = resolveAutonomousSession(state, action.session_id);
      if (!session || session.status !== "running") {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no running governed runtime lane exists for a live pause request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "pause_governed_lane",
        "the selected governed runtime lane may be paused through the persisted multi-lane control path",
        [...providerResult.warnings, `Lane target: ${session.session_id}`],
        createdAt,
      );
    }

    case "resume_governed_lane":
    {
      const session = resolveAutonomousSession(state, action.session_id);
      if (!session || !["paused", "blocked"].includes(session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no paused governed runtime lane exists for a live resume request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "resume_governed_lane",
        "the selected governed runtime lane may resume through the persisted multi-lane control path",
        [...providerResult.warnings, `Lane target: ${session.session_id}`],
        createdAt,
      );
    }

    case "reprioritize_governed_lane":
    {
      const session = resolveAutonomousSession(state, action.session_id);
      if (!session || !action.session_priority) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "a target governed runtime lane and priority are required for a live reprioritize request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "reprioritize_governed_lane",
        "the selected governed runtime lane priority may be updated through the persisted multi-lane control path",
        [...providerResult.warnings, `Lane target: ${session.session_id}`, `Priority: ${action.session_priority}`],
        createdAt,
      );
    }

    case "merge_governed_lanes":
    {
      const sourceSession = resolveAutonomousSession(state, action.session_id);
      const targetSession = resolveAutonomousSession(state, action.target_session_id);
      if (!sourceSession || !targetSession || sourceSession.session_id === targetSession.session_id) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "two distinct governed runtime lanes are required for a live merge request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "merge_governed_lanes",
        "the selected governed runtime lanes may be merged through the persisted multi-lane control path",
        [...providerResult.warnings, `Merge source: ${sourceSession.session_id}`, `Merge target: ${targetSession.session_id}`],
        createdAt,
      );
    }

    case "terminate_governed_lane": {
      const session = resolveAutonomousSession(state, action.session_id);
      if (!session || ["completed", "failed"].includes(session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no active governed runtime lane exists for a live terminate request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "terminate_governed_lane",
        "the selected governed runtime lane may be terminated through the persisted multi-lane control path",
        [...providerResult.warnings, `Lane target: ${session.session_id}`],
        createdAt,
      );
    }

    case "start_supervised_session": {
      if (state.supervised_session && ["pending_approval", "running", "paused", "waiting_for_operator", "recovering"].includes(state.supervised_session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "a supervised session is already active for this live runtime state",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "start_supervised_session",
        "the live runtime may create a bounded supervised autonomy session with explicit limits",
        providerResult.warnings,
        createdAt,
      );
    }

    case "pause_session": {
      if (!state.supervised_session || !["running", "recovering", "pending_approval"].includes(state.supervised_session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no running supervised session exists for a live pause request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "pause_supervised_session",
        "the active supervised session may be paused through the runtime session boundary",
        providerResult.warnings,
        createdAt,
      );
    }

    case "resume_session": {
      if (!state.supervised_session || !["paused", "waiting_for_operator", "stopped_by_operator"].includes(state.supervised_session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no paused supervised session exists for a live resume request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "resume_supervised_session",
        "the bounded supervised session may resume within its stored limits",
        providerResult.warnings,
        createdAt,
      );
    }

    case "stop_session": {
      if (!state.supervised_session || ["completed", "failed", "stopped_by_operator"].includes(state.supervised_session.status)) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no running supervised session exists for a live stop request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "stop_supervised_session",
        "the bounded supervised session may be stopped by the operator",
        providerResult.warnings,
        createdAt,
      );
    }

    case "request_operator_review": {
      if (!state.supervised_session) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no supervised session exists for a live operator-review request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "request_supervised_operator_review",
        "the supervised session may be paused for operator review",
        providerResult.warnings,
        createdAt,
      );
    }

    case "approve_review_item": {
      const reviewItem = action.review_id
        ? state.supervised_session?.review_queue?.find((item) => item.review_id === action.review_id) ?? null
        : state.supervised_session?.review_queue?.[0] ?? null;
      if (!reviewItem) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no overnight review item exists for a live approval request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "approve_review_queue_item",
        "the overnight review item may be approved through the runtime review queue boundary",
        [...providerResult.warnings, `Review target: ${reviewItem.review_id}`],
        createdAt,
      );
    }

    case "reject_review_item": {
      const reviewItem = action.review_id
        ? state.supervised_session?.review_queue?.find((item) => item.review_id === action.review_id) ?? null
        : state.supervised_session?.review_queue?.[0] ?? null;
      if (!reviewItem) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no overnight review item exists for a live rejection request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "reject_review_queue_item",
        "the overnight review item may be rejected through the runtime review queue boundary",
        [...providerResult.warnings, `Review target: ${reviewItem.review_id}`],
        createdAt,
      );
    }

    case "defer_review_item": {
      const reviewItem = action.review_id
        ? state.supervised_session?.review_queue?.find((item) => item.review_id === action.review_id) ?? null
        : state.supervised_session?.review_queue?.[0] ?? null;
      if (!reviewItem) {
        return buildResult(
          source,
          action,
          "action_rejected",
          "no_op",
          "no overnight review item exists for a live defer request",
          providerResult.warnings,
          createdAt,
        );
      }

      return buildResult(
        source,
        action,
        "action_ready",
        "defer_review_queue_item",
        "the overnight review item may be deferred through the runtime review queue boundary",
        [...providerResult.warnings, `Review target: ${reviewItem.review_id}`],
        createdAt,
      );
    }

    case "approve_work_item": {
      const workItem = action.work_item_id
        ? state.proposed_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? state.scheduled_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? null
        : state.proposed_work_items?.[0] ?? null;
      if (!workItem) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous work item exists for a live approval request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "approve_autonomous_work_item", "the autonomous work item may be approved and queued through the bounded runtime planning path", [...providerResult.warnings, `Work item target: ${workItem.work_item_id}`], createdAt);
    }

    case "reject_work_item": {
      const workItem = action.work_item_id
        ? state.proposed_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? state.scheduled_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? null
        : state.proposed_work_items?.[0] ?? null;
      if (!workItem) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous work item exists for a live rejection request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "reject_autonomous_work_item", "the autonomous work item may be rejected through the bounded runtime planning path", [...providerResult.warnings, `Work item target: ${workItem.work_item_id}`], createdAt);
    }

    case "defer_work_item": {
      const workItem = action.work_item_id
        ? state.proposed_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? state.scheduled_work_items?.find((item) => item.work_item_id === action.work_item_id)
          ?? null
        : state.proposed_work_items?.[0] ?? null;
      if (!workItem) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous work item exists for a live defer request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "defer_autonomous_work_item", "the autonomous work item may be deferred for later operator review", [...providerResult.warnings, `Work item target: ${workItem.work_item_id}`], createdAt);
    }

    case "approve_review_package": {
      const reviewPackage = action.package_id
        ? state.review_packages?.find((item) => item.package_id === action.package_id) ?? null
        : state.review_packages?.find((item) => item.status === "pending") ?? null;
      if (!reviewPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous review package exists for a live approval request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "approve_autonomous_review_package", "the autonomous review package may be approved through the bounded review handoff path", [...providerResult.warnings, `Package target: ${reviewPackage.package_id}`], createdAt);
    }

    case "reject_review_package": {
      const reviewPackage = action.package_id
        ? state.review_packages?.find((item) => item.package_id === action.package_id) ?? null
        : state.review_packages?.find((item) => item.status === "pending") ?? null;
      if (!reviewPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous review package exists for a live rejection request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "reject_autonomous_review_package", "the autonomous review package may be rejected through the bounded review handoff path", [...providerResult.warnings, `Package target: ${reviewPackage.package_id}`], createdAt);
    }

    case "approve_delivery_package": {
      const deliveryPackage = action.package_id
        ? state.delivery_packages?.find((item) => item.delivery_package_id === action.package_id) ?? null
        : state.delivery_packages?.find((item) => item.status === "awaiting_operator_approval") ?? null;
      if (!deliveryPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous delivery package exists for a live approval request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "approve_autonomous_delivery_package", "the autonomous delivery package may be approved for commit through the bounded delivery handoff path", [...providerResult.warnings, `Delivery package target: ${deliveryPackage.delivery_package_id}`], createdAt);
    }

    case "reject_delivery_package": {
      const deliveryPackage = action.package_id
        ? state.delivery_packages?.find((item) => item.delivery_package_id === action.package_id) ?? null
        : state.delivery_packages?.find((item) => item.status === "awaiting_operator_approval") ?? null;
      if (!deliveryPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous delivery package exists for a live rejection request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "reject_autonomous_delivery_package", "the autonomous delivery package may be rejected through the bounded delivery handoff path", [...providerResult.warnings, `Delivery package target: ${deliveryPackage.delivery_package_id}`], createdAt);
    }

    case "request_delivery_changes": {
      const deliveryPackage = action.package_id
        ? state.delivery_packages?.find((item) => item.delivery_package_id === action.package_id) ?? null
        : state.delivery_packages?.find((item) => item.status === "awaiting_operator_approval") ?? null;
      if (!deliveryPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous delivery package exists for a live change request", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "request_changes_autonomous_delivery_package", "the autonomous delivery package may be returned for bounded changes", [...providerResult.warnings, `Delivery package target: ${deliveryPackage.delivery_package_id}`], createdAt);
    }

    case "archive_delivery_package": {
      const deliveryPackage = action.package_id
        ? state.delivery_packages?.find((item) => item.delivery_package_id === action.package_id) ?? null
        : state.delivery_packages?.[0] ?? null;
      if (!deliveryPackage) {
        return buildResult(source, action, "action_rejected", "no_op", "no autonomous delivery package exists for archival", providerResult.warnings, createdAt);
      }
      return buildResult(source, action, "action_ready", "archive_autonomous_delivery_package", "the autonomous delivery package may be archived through the bounded delivery handoff path", [...providerResult.warnings, `Delivery package target: ${deliveryPackage.delivery_package_id}`], createdAt);
    }

    default: {
      return buildResult(
        source,
        action,
        "action_unsupported",
        "no_op",
        "the requested operator action is not supported by the safe runtime action bridge",
        providerResult.warnings,
        createdAt,
      );
    }
  }
}

export function summarizeSafeRuntimeActionBridgeResult(result: SafeRuntimeActionBridgeResult): string {
  return [
    `Safe runtime bridge status: ${result.status}`,
    `Action type: ${result.action.type}`,
    `Goal id: ${result.goal_id ?? "global"}`,
    `Source: ${result.source}`,
    `Runtime intent: ${result.runtime_intent}`,
    `Reason: ${result.reason}`,
    `Warnings: ${result.warnings.length > 0 ? result.warnings.join(" | ") : "none"}`,
    `Audit event: ${result.audit_event.audit_event_id}`,
  ].join("\n");
}
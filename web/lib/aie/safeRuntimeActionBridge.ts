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
  | "start_supervised_session"
  | "pause_supervised_session"
  | "resume_supervised_session"
  | "stop_supervised_session"
  | "request_supervised_operator_review"
  | "approve_review_queue_item"
  | "reject_review_queue_item"
  | "defer_review_queue_item"
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
  return {
    audit_event_id: [
      "safe-runtime-action-bridge",
      sanitizeTimestamp(createdAt),
      source,
      action.type,
      action.goal_id ?? "global",
    ].join("-"),
    created_at: createdAt,
    source,
    action_type: action.type,
    goal_id: action.goal_id ?? null,
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
  return {
    status,
    action,
    source,
    goal_id: action.goal_id ?? null,
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

    default: {
      const unsupportedAction = action satisfies never;
      return buildResult(
        source,
        unsupportedAction,
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
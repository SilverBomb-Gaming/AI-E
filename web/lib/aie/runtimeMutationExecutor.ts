import { applyOperatorControlAction, type OperatorControlAction } from "./operatorControlSurface";
import {
  createContinuousRuntimeLoopClock,
  runContinuousRuntimeLoop,
  type ContinuousRuntimeLoopClock,
  type ContinuousRuntimeLoopConfig,
  type ContinuousRuntimeLoopResult,
} from "./continuousRuntimeLoop";
import {
  runExecutionLoopController,
  type ExecutionLoopControllerResult,
} from "./executionLoopController";
import type { OperatorDashboardBlockedGoal, OperatorDashboardState } from "./operatorDashboardState";
import {
  cloneRuntimeStateRecord,
  type ContinuousLoopStateRecord,
  evaluateBootResume,
  loadRuntimeState,
  persistRuntimeStateRecord,
  type StoredContinuousLoopConfig,
  type RuntimeStateRecord,
  type RuntimeStateStore,
} from "./runtimeStateStore";
import type { SafeRuntimeActionAuditEvent, SafeRuntimeIntent } from "./safeRuntimeActionBridge";

export type RuntimeMutationStatus = "mutation_applied" | "mutation_rejected" | "mutation_no_op";

export type RuntimeMutationAuditEvent = {
  audit_event_id: string;
  created_at: string;
  runtime_id: string;
  goal_id: string | null;
  runtime_intent: SafeRuntimeIntent;
  status: RuntimeMutationStatus;
  reason: string;
  source_bridge_audit_event_id: string | null;
};

export type RuntimeMutationResult = {
  status: RuntimeMutationStatus;
  updated_runtime_state: RuntimeStateRecord;
  reason: string;
  audit_event: RuntimeMutationAuditEvent;
  execution_loop: ExecutionLoopControllerResult | null;
  continuous_runtime_loop: ContinuousRuntimeLoopResult | null;
};

export type RuntimeMutationExecutorInput = {
  action?: OperatorControlAction;
  runtime_intent: SafeRuntimeIntent;
  current_runtime_state: RuntimeStateRecord;
  current_dashboard_state: OperatorDashboardState;
  runtime_state_store: RuntimeStateStore;
  runtime_id: string;
  timestamp: string;
  goal_id?: string | null;
  source_audit_event?: SafeRuntimeActionAuditEvent;
  start_continuous_loop?: boolean;
  continuous_loop_clock?: ContinuousRuntimeLoopClock;
  continuous_loop_config?: Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">>;
};

function resolveContinuousLoopConfig(
  record: RuntimeStateRecord,
  overrides: Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">> | undefined,
): Partial<Omit<ContinuousRuntimeLoopConfig, "runtime_id">> {
  const storedConfig = record.continuous_loop_config ?? null;
  return {
    ...((storedConfig ?? {}) as StoredContinuousLoopConfig),
    ...(overrides ?? {}),
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

function isApprovalBlocker(codeOrMessage: string): boolean {
  return /approval|fresh/i.test(codeOrMessage);
}

function isRuntimeSnapshotStale(record: RuntimeStateRecord, now: string, staleAfterMs: number): boolean {
  const nowMs = Date.parse(now);
  const persistedMs = Date.parse(record.persisted_at);
  if (Number.isNaN(nowMs) || Number.isNaN(persistedMs)) {
    return true;
  }
  return (nowMs - persistedMs) > staleAfterMs;
}

function buildAuditEvent(input: RuntimeMutationExecutorInput, status: RuntimeMutationStatus, reason: string): RuntimeMutationAuditEvent {
  return {
    audit_event_id: [
      "runtime-mutation-executor",
      sanitizeTimestamp(input.timestamp),
      normalizeText(input.runtime_id) || "unknown-runtime",
      input.runtime_intent,
      input.goal_id ?? "global",
    ].join("-"),
    created_at: input.timestamp,
    runtime_id: input.runtime_id,
    goal_id: input.goal_id ?? null,
    runtime_intent: input.runtime_intent,
    status,
    reason,
    source_bridge_audit_event_id: input.source_audit_event?.audit_event_id ?? null,
  };
}

function buildResult(
  input: RuntimeMutationExecutorInput,
  status: RuntimeMutationStatus,
  record: RuntimeStateRecord,
  reason: string,
  executionLoop: ExecutionLoopControllerResult | null = null,
  continuousRuntimeLoop: ContinuousRuntimeLoopResult | null = null,
): RuntimeMutationResult {
  return {
    status,
    updated_runtime_state: record,
    reason,
    audit_event: buildAuditEvent(input, status, reason),
    execution_loop: executionLoop,
    continuous_runtime_loop: continuousRuntimeLoop,
  };
}

function createActionFromIntent(intent: SafeRuntimeIntent, goalId: string | null | undefined): OperatorControlAction | null {
  switch (intent) {
    case "grant_session_approval":
      return { type: "approve_goal", goal_id: goalId ?? null };
    case "pause_active_goal":
      return { type: "pause_goal", goal_id: goalId ?? null };
    case "resume_paused_goal":
      return { type: "resume_goal", goal_id: goalId ?? null };
    case "mark_goal_retry_requested":
      return { type: "retry_goal", goal_id: goalId ?? null };
    case "pause_all_sessions":
      return { type: "pause_all_sessions" };
    case "resume_safe_sessions":
      return { type: "resume_safe_sessions" };
    case "prioritize_review_queue":
      return { type: "prioritize_review_queue" };
    case "prioritize_delivery_queue":
      return { type: "prioritize_delivery_queue" };
    case "acknowledge_studio_risk":
      return { type: "acknowledge_studio_risk" };
    case "request_studio_summary":
      return { type: "request_studio_summary" };
    case "approve_policy_recommendation":
      return { type: "approve_policy_recommendation", recommendation_id: goalId ?? null };
    case "reject_policy_recommendation":
      return { type: "reject_policy_recommendation", recommendation_id: goalId ?? null };
    case "defer_policy_recommendation":
      return { type: "defer_policy_recommendation", recommendation_id: goalId ?? null };
    case "request_meta_summary":
      return { type: "request_meta_summary" };
    case "acknowledge_pattern":
      return { type: "acknowledge_pattern", pattern_id: goalId ?? null };
    case "start_supervised_session":
      return { type: "start_supervised_session" };
    case "pause_supervised_session":
      return { type: "pause_session" };
    case "resume_supervised_session":
      return { type: "resume_session" };
    case "stop_supervised_session":
      return { type: "stop_session" };
    case "request_supervised_operator_review":
      return { type: "request_operator_review" };
    case "approve_review_queue_item":
      return { type: "approve_review_item", review_id: goalId ?? null };
    case "reject_review_queue_item":
      return { type: "reject_review_item", review_id: goalId ?? null };
    case "defer_review_queue_item":
      return { type: "defer_review_item", review_id: goalId ?? null };
    case "approve_autonomous_work_item":
      return { type: "approve_work_item", work_item_id: goalId ?? null };
    case "reject_autonomous_work_item":
      return { type: "reject_work_item", work_item_id: goalId ?? null };
    case "defer_autonomous_work_item":
      return { type: "defer_work_item", work_item_id: goalId ?? null };
    case "approve_autonomous_review_package":
      return { type: "approve_review_package", package_id: goalId ?? null };
    case "reject_autonomous_review_package":
      return { type: "reject_review_package", package_id: goalId ?? null };
    case "approve_autonomous_delivery_package":
      return { type: "approve_delivery_package", package_id: goalId ?? null };
    case "reject_autonomous_delivery_package":
      return { type: "reject_delivery_package", package_id: goalId ?? null };
    case "request_changes_autonomous_delivery_package":
      return { type: "request_delivery_changes", package_id: goalId ?? null };
    case "archive_autonomous_delivery_package":
      return { type: "archive_delivery_package", package_id: goalId ?? null };
    case "no_op":
    default:
      return null;
  }
}

function resolveBlockedGoal(state: OperatorDashboardState, goalId: string | null | undefined): OperatorDashboardBlockedGoal | null {
  if (!goalId) {
    return state.blocked_goals[0] ?? null;
  }
  return state.blocked_goals.find((goal) => goal.goal_id === goalId) ?? null;
}

function reject(input: RuntimeMutationExecutorInput, currentRecord: RuntimeStateRecord, reason: string): RuntimeMutationResult {
  return buildResult(input, "mutation_rejected", cloneRuntimeStateRecord(currentRecord), reason);
}

function validateMutationRequest(
  input: RuntimeMutationExecutorInput,
  persistedRecord: RuntimeStateRecord,
  state: OperatorDashboardState,
): string | null {
  if (isRuntimeSnapshotStale(persistedRecord, input.timestamp, input.runtime_state_store.stale_after_ms)) {
    return "live runtime state requires operator review before a runtime mutation can be applied";
  }

  const bootResume = evaluateBootResume(input.runtime_state_store, input.runtime_id, input.timestamp);

  if (bootResume.status === "state_corrupt" || !bootResume.record) {
    return "live runtime state could not be validated before applying the requested mutation";
  }

  if (input.runtime_intent === "no_op") {
    return null;
  }

  if (bootResume.status === "resume_requires_review") {
    return "live runtime state requires operator review before a runtime mutation can be applied";
  }

  switch (input.runtime_intent) {
    case "grant_session_approval": {
      if (state.approvals_required.length === 0) {
        return "no approval requirement is currently active for this runtime mutation";
      }

      const hasApprovalBlocker = persistedRecord.blockers.some((blocker) =>
        isApprovalBlocker(blocker.code) || isApprovalBlocker(blocker.message));
      if (bootResume.status === "resume_blocked" && !hasApprovalBlocker) {
        return "the current runtime blocker cannot be cleared through a session approval mutation";
      }
      return null;
    }

    case "pause_active_goal": {
      if (!state.active_goal || (input.goal_id && state.active_goal.goal_id !== input.goal_id)) {
        return "no active goal is available for a live pause mutation";
      }
      if (/paused/i.test(state.session_status.status) || /paused/i.test(state.runtime_status.status)) {
        return "the live runtime is already paused for the selected goal";
      }
      return null;
    }

    case "resume_paused_goal": {
      const pausedGoal = input.goal_id
        ? state.paused_goals.find((goal) => goal.goal_id === input.goal_id) ?? null
        : state.paused_goals[0] ?? null;
      if (!pausedGoal) {
        return "no paused goal is available for a live resume mutation";
      }
      if (state.active_goal) {
        return "a different goal is already active, so the requested paused goal cannot resume yet";
      }
      const hasBlockingApproval = state.approvals_required.some((approval) => approval.goal_id === null || approval.goal_id === pausedGoal.goal_id);
      if (hasBlockingApproval) {
        return "the paused goal still requires fresh approval before it can resume";
      }
      return null;
    }

    case "mark_goal_retry_requested": {
      const blockedGoal = resolveBlockedGoal(state, input.goal_id);
      if (!blockedGoal && state.recovery_recommendations.length === 0) {
        return "no blocked goal or recovery recommendation is available for a live retry mutation";
      }
      if (blockedGoal && blockedGoal.blocker_type !== "status" && blockedGoal.blocker_ids.length > 0) {
        return "dependency constraints still block the requested retry mutation";
      }
      return null;
    }

    case "pause_all_sessions": {
      const hasRunnableSession = state.autonomous_sessions?.sessions.some((candidate) => candidate.status === "running" || candidate.status === "pending")
        || Boolean(state.supervised_session && ["running", "recovering", "pending_approval"].includes(state.supervised_session.status))
        || Boolean(state.active_goal);
      if (!hasRunnableSession) {
        return "no runnable session is available for a studio-wide pause mutation";
      }
      return null;
    }

    case "resume_safe_sessions": {
      const hasSafePausedSession = state.autonomous_sessions?.sessions.some((candidate) => candidate.status === "paused" && !candidate.blocked_by_conflict && candidate.tick_budget_remaining > 0)
        || Boolean(state.supervised_session && state.supervised_session.status === "paused" && !state.supervised_session.pending_operator_review && state.approvals_required.length === 0);
      if (!hasSafePausedSession) {
        return "no paused safe session is available for a studio-wide resume mutation";
      }
      return null;
    }

    case "prioritize_review_queue": {
      if ((state.review_packages?.length ?? 0) === 0) {
        return "no review package is available for the requested studio reprioritization mutation";
      }
      return null;
    }

    case "prioritize_delivery_queue": {
      if ((state.delivery_packages?.length ?? 0) === 0) {
        return "no delivery package is available for the requested studio reprioritization mutation";
      }
      return null;
    }

    case "acknowledge_studio_risk": {
      if ((state.studio_operations?.recent_risks.length ?? 0) === 0 && state.recovery_recommendations.length === 0 && state.validation_issues.length === 0) {
        return "no studio risk is available for acknowledgement";
      }
      return null;
    }

    case "request_studio_summary": {
      return null;
    }

    case "approve_policy_recommendation":
    case "reject_policy_recommendation":
    case "defer_policy_recommendation": {
      const recommendationId = input.action?.recommendation_id ?? input.goal_id ?? null;
      const recommendation = recommendationId
        ? state.meta_policy_recommendations?.find((item) => item.recommendation_id === recommendationId) ?? null
        : state.meta_policy_recommendations?.[0] ?? null;
      if (!recommendation) {
        return "no meta-intelligence recommendation is available for the requested runtime mutation";
      }
      return null;
    }

    case "request_meta_summary": {
      return null;
    }

    case "acknowledge_pattern": {
      const patternId = input.action?.pattern_id ?? input.goal_id ?? null;
      const pattern = patternId
        ? state.meta_detected_patterns?.find((item) => item.pattern_id === patternId) ?? null
        : state.meta_detected_patterns?.[0] ?? null;
      if (!pattern) {
        return "no meta-intelligence pattern is available for the requested runtime mutation";
      }
      return null;
    }

    case "pause_autonomous_session": {
      const sessionId = input.action?.session_id ?? null;
      const session = sessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sessionId) ?? null
        : null;
      if (!session || session.status !== "running") {
        return "no running autonomous session is available for a live pause mutation";
      }
      return null;
    }

    case "resume_autonomous_session": {
      const sessionId = input.action?.session_id ?? null;
      const session = sessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sessionId) ?? null
        : null;
      if (!session || !["paused", "blocked"].includes(session.status)) {
        return "no paused autonomous session is available for a live resume mutation";
      }
      return null;
    }

    case "reprioritize_autonomous_session": {
      const sessionId = input.action?.session_id ?? null;
      const session = sessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sessionId) ?? null
        : null;
      if (!session || !input.action?.session_priority) {
        return "a target autonomous session and priority are required for a live reprioritize mutation";
      }
      return null;
    }

    case "merge_autonomous_sessions": {
      const sourceSessionId = input.action?.session_id ?? null;
      const targetSessionId = input.action?.target_session_id ?? null;
      const sourceSession = sourceSessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sourceSessionId) ?? null
        : null;
      const targetSession = targetSessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === targetSessionId) ?? null
        : null;
      if (!sourceSession || !targetSession || sourceSession.session_id === targetSession.session_id) {
        return "two distinct autonomous sessions are required for a live merge mutation";
      }
      return null;
    }

    case "terminate_autonomous_session": {
      const sessionId = input.action?.session_id ?? null;
      const session = sessionId
        ? state.autonomous_sessions?.sessions.find((candidate) => candidate.session_id === sessionId) ?? null
        : null;
      if (!session || ["completed", "failed"].includes(session.status)) {
        return "no active autonomous session is available for a live terminate mutation";
      }
      return null;
    }

    case "start_supervised_session": {
      if (persistedRecord.supervised_session && ["pending_approval", "running", "paused", "waiting_for_operator", "recovering"].includes(persistedRecord.supervised_session.status)) {
        return "a supervised autonomy session is already active for this runtime";
      }
      return null;
    }

    case "pause_supervised_session": {
      if (!persistedRecord.supervised_session || !["running", "recovering", "pending_approval"].includes(persistedRecord.supervised_session.status)) {
        return "no running supervised session is available for a live pause mutation";
      }
      return null;
    }

    case "resume_supervised_session": {
      if (!persistedRecord.supervised_session || !["paused", "waiting_for_operator", "stopped_by_operator"].includes(persistedRecord.supervised_session.status)) {
        return "no paused supervised session is available for a live resume mutation";
      }
      return null;
    }

    case "stop_supervised_session": {
      if (!persistedRecord.supervised_session || ["completed", "failed", "stopped_by_operator"].includes(persistedRecord.supervised_session.status)) {
        return "no running supervised session is available for a live stop mutation";
      }
      return null;
    }

    case "request_supervised_operator_review": {
      if (!persistedRecord.supervised_session) {
        return "no supervised session is available for a live operator review mutation";
      }
      return null;
    }

    case "approve_review_queue_item":
    case "reject_review_queue_item":
    case "defer_review_queue_item": {
      const reviewId = input.action?.review_id ?? input.goal_id ?? null;
      const reviewItem = reviewId
        ? persistedRecord.supervised_session?.review_queue?.find((item) => item.review_id === reviewId) ?? null
        : persistedRecord.supervised_session?.review_queue?.[0] ?? null;
      if (!reviewItem) {
        return "no overnight review queue item is available for the requested runtime mutation";
      }
      return null;
    }

    case "approve_autonomous_work_item":
    case "reject_autonomous_work_item":
    case "defer_autonomous_work_item": {
      const workItemId = input.action?.work_item_id ?? input.goal_id ?? null;
      const workItem = workItemId
        ? state.proposed_work_items?.find((item) => item.work_item_id === workItemId)
          ?? state.scheduled_work_items?.find((item) => item.work_item_id === workItemId)
          ?? state.running_work_items?.find((item) => item.work_item_id === workItemId)
          ?? null
        : state.proposed_work_items?.[0] ?? null;
      if (!workItem) {
        return "no autonomous work item is available for the requested runtime mutation";
      }
      return null;
    }

    case "approve_autonomous_review_package":
    case "reject_autonomous_review_package": {
      const packageId = input.action?.package_id ?? input.goal_id ?? null;
      const reviewPackage = packageId
        ? state.review_packages?.find((item) => item.package_id === packageId) ?? null
        : state.review_packages?.find((item) => item.status === "pending") ?? null;
      if (!reviewPackage) {
        return "no autonomous review package is available for the requested runtime mutation";
      }
      return null;
    }

    case "approve_autonomous_delivery_package":
    case "reject_autonomous_delivery_package":
    case "request_changes_autonomous_delivery_package":
    case "archive_autonomous_delivery_package": {
      const packageId = input.action?.package_id ?? input.goal_id ?? null;
      const deliveryPackage = packageId
        ? state.delivery_packages?.find((item) => item.delivery_package_id === packageId) ?? null
        : state.delivery_packages?.[0] ?? null;
      if (!deliveryPackage) {
        return "no autonomous delivery package is available for the requested runtime mutation";
      }
      return null;
    }

    default:
      return "the requested runtime mutation intent is not supported";
  }
}

function applyRecordMetadata(
  runtimeIntent: SafeRuntimeIntent,
  record: RuntimeStateRecord,
): void {
  switch (runtimeIntent) {
    case "grant_session_approval": {
      record.blockers = record.blockers.filter((blocker) =>
        !(isApprovalBlocker(blocker.code) || isApprovalBlocker(blocker.message)));
      if (record.last_status === "service_blocked") {
        record.last_status = "service_idle";
      }
      break;
    }

    case "pause_active_goal": {
      record.last_status = "service_paused";
      break;
    }

    case "resume_paused_goal": {
      record.last_status = "service_idle";
      break;
    }

    case "mark_goal_retry_requested": {
      if (record.last_status === "service_blocked") {
        record.last_status = "service_idle";
      }
      break;
    }

    case "pause_all_sessions": {
      record.last_status = "service_paused";
      break;
    }

    case "resume_safe_sessions":
    case "prioritize_review_queue":
    case "prioritize_delivery_queue":
    case "acknowledge_studio_risk":
    case "request_studio_summary": {
      record.last_status = "service_idle";
      break;
    }

    case "approve_policy_recommendation":
    case "reject_policy_recommendation":
    case "defer_policy_recommendation":
    case "request_meta_summary":
    case "acknowledge_pattern": {
      record.last_status = "service_idle";
      break;
    }

    case "start_supervised_session":
    case "resume_supervised_session": {
      record.last_status = "service_idle";
      break;
    }

    case "pause_supervised_session":
    case "stop_supervised_session":
    case "request_supervised_operator_review": {
      record.last_status = "service_paused";
      break;
    }

    case "approve_review_queue_item":
    case "reject_review_queue_item":
    case "defer_review_queue_item": {
      record.last_status = record.supervised_session?.pending_operator_review ? "service_blocked" : "service_paused";
      break;
    }

    case "approve_autonomous_work_item":
    case "reject_autonomous_work_item":
    case "defer_autonomous_work_item":
    case "approve_autonomous_review_package":
    case "reject_autonomous_review_package":
    case "approve_autonomous_delivery_package":
    case "reject_autonomous_delivery_package":
    case "request_changes_autonomous_delivery_package":
    case "archive_autonomous_delivery_package": {
      record.last_status = "service_idle";
      break;
    }

    case "no_op":
    default:
      break;
  }
}

function buildControlLoopState(record: RuntimeStateRecord): ContinuousLoopStateRecord {
  return record.continuous_loop ?? {
    status: "loop_stopped",
    started_at: null,
    stopped_at: null,
    last_tick_at: null,
    ticks_attempted: 0,
    ticks_completed: 0,
    last_trigger_result: null,
    reason: "Continuous runtime loop has not started yet.",
    tick_history: [],
  };
}

function appendSupervisedSessionControlEvent(
  record: RuntimeStateRecord,
  input: RuntimeMutationExecutorInput,
  reason: string,
): void {
  const isAutonomousSessionIntent = input.runtime_intent === "pause_autonomous_session"
    || input.runtime_intent === "resume_autonomous_session"
    || input.runtime_intent === "reprioritize_autonomous_session"
    || input.runtime_intent === "merge_autonomous_sessions"
    || input.runtime_intent === "terminate_autonomous_session";
  const isStudioIntent = input.runtime_intent === "pause_all_sessions"
    || input.runtime_intent === "resume_safe_sessions"
    || input.runtime_intent === "prioritize_review_queue"
    || input.runtime_intent === "prioritize_delivery_queue"
    || input.runtime_intent === "acknowledge_studio_risk"
    || input.runtime_intent === "request_studio_summary";
  const isMetaIntent = input.runtime_intent === "approve_policy_recommendation"
    || input.runtime_intent === "reject_policy_recommendation"
    || input.runtime_intent === "defer_policy_recommendation"
    || input.runtime_intent === "request_meta_summary"
    || input.runtime_intent === "acknowledge_pattern";
  const loopState = buildControlLoopState(record);
  const eventScope = isMetaIntent ? "meta-intelligence-control" : isStudioIntent ? "studio-command-center-control" : isAutonomousSessionIntent ? "autonomous-session-control" : "supervised-session-control";
  const eventId = `${eventScope}-${sanitizeTimestamp(input.timestamp)}-${input.runtime_intent}`;
  const runtimeStatus = record.operator_dashboard_state?.runtime_status.status ?? record.last_status;
  const schedulerStatus = record.operator_dashboard_state?.scheduler_status.status ?? "scheduler_idle";

  record.continuous_loop = {
    ...loopState,
    reason,
    tick_history: [...loopState.tick_history, {
      tick_id: eventId,
      event_id: eventId,
      runtime_id: input.runtime_id,
      attempted_at: input.timestamp,
      timestamp: input.timestamp,
      tick_index: loopState.ticks_attempted,
      status: record.last_status === "service_paused" ? "loop_paused" : loopState.status,
      event_type: "tick_observed",
      triggered: false,
      run_results_recorded: 0,
      reason,
      active_goal_before: record.operator_dashboard_state?.active_goal ? {
        goal_id: record.operator_dashboard_state.active_goal.goal_id,
        goal_label: record.operator_dashboard_state.active_goal.description,
      } : null,
      active_goal_after: record.operator_dashboard_state?.active_goal ? {
        goal_id: record.operator_dashboard_state.active_goal.goal_id,
        goal_label: record.operator_dashboard_state.active_goal.description,
      } : null,
      mutation_applied: isAutonomousSessionIntent
        ? `${input.runtime_intent} persisted for autonomous session state.`
        : isMetaIntent
          ? `${input.runtime_intent} persisted for meta intelligence state.`
        : isStudioIntent
          ? `${input.runtime_intent} persisted for studio command center state.`
        : `${input.runtime_intent} persisted for supervised session state.`,
      safety_gate_result: record.supervised_session?.pending_operator_review ? "blocked" : "not_triggered",
      scheduler_decision: record.operator_dashboard_state?.scheduler_status.explanation ?? null,
      persistence_result: "persisted_to_runtime_state",
      goal_transition: {
        changed: false,
        from_goal_id: record.operator_dashboard_state?.active_goal?.goal_id ?? null,
        to_goal_id: record.operator_dashboard_state?.active_goal?.goal_id ?? null,
        from_goal_label: record.operator_dashboard_state?.active_goal?.description ?? null,
        to_goal_label: record.operator_dashboard_state?.active_goal?.description ?? null,
        summary: isAutonomousSessionIntent
          ? `Autonomous session control event recorded for ${input.runtime_intent}.`
          : isMetaIntent
            ? `Meta-intelligence control event recorded for ${input.runtime_intent}.`
          : isStudioIntent
            ? `Studio command center control event recorded for ${input.runtime_intent}.`
          : `Supervised session control event recorded for ${input.runtime_intent}.`,
      },
      semantic_progression: {
        queue_count_before: record.operator_dashboard_state?.queued_goals.length ?? 0,
        queue_count_after: record.operator_dashboard_state?.queued_goals.length ?? 0,
        blocked_count_before: record.operator_dashboard_state?.blocked_goals.length ?? 0,
        blocked_count_after: record.operator_dashboard_state?.blocked_goals.length ?? 0,
        runtime_status_before: runtimeStatus,
        runtime_status_after: runtimeStatus,
        scheduler_status_before: schedulerStatus,
        scheduler_status_after: schedulerStatus,
      },
      mutation_summary: isAutonomousSessionIntent
        ? `${input.runtime_intent} recorded for autonomous session state.`
        : isMetaIntent
          ? `${input.runtime_intent} recorded for meta intelligence state.`
        : isStudioIntent
          ? `${input.runtime_intent} recorded for studio command center state.`
        : `${input.runtime_intent} recorded for supervised session.`,
      next_scheduled_action: record.supervised_session?.next_scheduled_tick_at
        ? `Next scheduled tick at ${record.supervised_session.next_scheduled_tick_at}.`
        : null,
    }],
  };

  if (record.supervised_session && !isAutonomousSessionIntent && !isStudioIntent) {
    record.supervised_session.latest_timeline_event_id = eventId;
  }
}

function syncSupervisedStateToDashboard(record: RuntimeStateRecord): void {
  if (!record.operator_dashboard_state) {
    return;
  }

  record.operator_dashboard_state = {
    ...record.operator_dashboard_state,
    supervised_session: record.supervised_session ?? null,
    supervised_checkpoints: [...(record.supervised_checkpoints ?? [])],
  };
}

export function executeRuntimeMutation(input: RuntimeMutationExecutorInput): RuntimeMutationResult {
  const runtimeId = normalizeText(input.runtime_id);
  if (!runtimeId) {
    return reject(input, input.current_runtime_state, "a runtime id is required before a runtime mutation can be applied");
  }

  if (normalizeText(input.current_runtime_state.runtime_id) !== runtimeId) {
    return reject(input, input.current_runtime_state, "the provided runtime state does not match the requested runtime id");
  }

  if (input.runtime_intent === "no_op") {
    return buildResult(input, "mutation_no_op", cloneRuntimeStateRecord(input.current_runtime_state), "no live runtime mutation was required for the requested intent");
  }

  const persistedRecord = loadRuntimeState(input.runtime_state_store, runtimeId);
  if (!persistedRecord) {
    return reject(input, input.current_runtime_state, "no persisted runtime state record was found for the requested live mutation");
  }

  const stateForMutation = persistedRecord.operator_dashboard_state ?? input.current_dashboard_state;
  const validationFailure = validateMutationRequest(input, persistedRecord, stateForMutation);
  if (validationFailure) {
    return reject(input, persistedRecord, validationFailure);
  }

  const action = input.action ?? createActionFromIntent(input.runtime_intent, input.goal_id);
  if (!action) {
    return buildResult(input, "mutation_no_op", cloneRuntimeStateRecord(persistedRecord), "the requested runtime intent does not mutate persisted runtime state");
  }

  const controlResult = applyOperatorControlAction(stateForMutation, action);
  if (!controlResult.changed) {
    return reject(input, persistedRecord, controlResult.message);
  }

  const nextRecord = cloneRuntimeStateRecord(persistedRecord);
  nextRecord.operator_dashboard_state = controlResult.state;
  nextRecord.supervised_session = controlResult.state.supervised_session ?? nextRecord.supervised_session ?? null;
  nextRecord.supervised_checkpoints = controlResult.state.supervised_checkpoints ?? nextRecord.supervised_checkpoints ?? [];
  if (nextRecord.supervised_session) {
    nextRecord.supervised_session.runtime_id = runtimeId;
  }
  syncSupervisedStateToDashboard(nextRecord);
  nextRecord.persisted_at = input.timestamp;
  applyRecordMetadata(input.runtime_intent, nextRecord);
  appendSupervisedSessionControlEvent(nextRecord, input, controlResult.message);
  syncSupervisedStateToDashboard(nextRecord);

  const persistedNextRecord = persistRuntimeStateRecord(input.runtime_state_store, nextRecord);
  const effectiveContinuousLoopConfig = resolveContinuousLoopConfig(persistedNextRecord, input.continuous_loop_config);
  const executionLoop = persistedNextRecord.operator_dashboard_state
    ? runExecutionLoopController({
      runtime_intent: input.runtime_intent,
      dashboard_state: persistedNextRecord.operator_dashboard_state,
      timestamp: input.timestamp,
      goal_id: input.goal_id,
    })
    : null;

  if (!executionLoop || executionLoop.status === "loop_not_triggered" || executionLoop.status === "loop_blocked") {
    const baseResult = buildResult(
      input,
      "mutation_applied",
      persistedNextRecord,
      executionLoop ? `${controlResult.message} ${executionLoop.reason}`.trim() : controlResult.message,
      executionLoop,
    );

    if (!input.start_continuous_loop
      || input.runtime_intent === "pause_active_goal"
      || input.runtime_intent === "pause_all_sessions"
      || input.runtime_intent === "resume_safe_sessions"
      || input.runtime_intent === "prioritize_review_queue"
      || input.runtime_intent === "prioritize_delivery_queue"
      || input.runtime_intent === "acknowledge_studio_risk"
      || input.runtime_intent === "request_studio_summary"
      || input.runtime_intent === "approve_policy_recommendation"
      || input.runtime_intent === "reject_policy_recommendation"
      || input.runtime_intent === "defer_policy_recommendation"
      || input.runtime_intent === "request_meta_summary"
      || input.runtime_intent === "acknowledge_pattern"
      || input.runtime_intent === "pause_autonomous_session"
      || input.runtime_intent === "resume_autonomous_session"
      || input.runtime_intent === "reprioritize_autonomous_session"
      || input.runtime_intent === "merge_autonomous_sessions"
      || input.runtime_intent === "terminate_autonomous_session"
      || input.runtime_intent === "pause_supervised_session"
      || input.runtime_intent === "stop_supervised_session"
      || input.runtime_intent === "request_supervised_operator_review"
      || input.runtime_intent === "approve_review_queue_item"
      || input.runtime_intent === "reject_review_queue_item"
      || input.runtime_intent === "defer_review_queue_item"
      || input.runtime_intent === "reject_autonomous_work_item"
      || input.runtime_intent === "defer_autonomous_work_item"
      || input.runtime_intent === "approve_autonomous_review_package"
      || input.runtime_intent === "reject_autonomous_review_package"
      || persistedNextRecord.supervised_session?.status === "pending_approval"
      || !persistedNextRecord.operator_dashboard_state) {
      return baseResult;
    }

    const continuousRuntimeLoop = runContinuousRuntimeLoop(
      input.runtime_state_store,
      {
        runtime_id: runtimeId,
        profile_name: persistedNextRecord.profile_name,
        started_at: input.timestamp,
        runtime_intent: "no_op",
        ...effectiveContinuousLoopConfig,
      },
      input.continuous_loop_clock ?? createContinuousRuntimeLoopClock(
        input.timestamp,
        effectiveContinuousLoopConfig.tick_interval_ms ?? 60_000,
      ),
    );

    return buildResult(
      input,
      "mutation_applied",
      continuousRuntimeLoop.runtime_state ?? persistedNextRecord,
      `${baseResult.reason} ${continuousRuntimeLoop.reason}`.trim(),
      executionLoop,
      continuousRuntimeLoop,
    );
  }

  const executedRecord = cloneRuntimeStateRecord(persistedNextRecord);
  executedRecord.operator_dashboard_state = executionLoop.updated_dashboard_state;
  executedRecord.persisted_at = input.timestamp;
  syncSupervisedStateToDashboard(executedRecord);
  const persistedExecutedRecord = persistRuntimeStateRecord(input.runtime_state_store, executedRecord);
  const executedContinuousLoopConfig = resolveContinuousLoopConfig(persistedExecutedRecord, input.continuous_loop_config);

  if (!input.start_continuous_loop
    || input.runtime_intent === "pause_active_goal"
    || input.runtime_intent === "pause_autonomous_session"
    || input.runtime_intent === "resume_autonomous_session"
    || input.runtime_intent === "reprioritize_autonomous_session"
    || input.runtime_intent === "merge_autonomous_sessions"
    || input.runtime_intent === "terminate_autonomous_session"
    || input.runtime_intent === "pause_supervised_session"
    || input.runtime_intent === "stop_supervised_session"
    || input.runtime_intent === "request_supervised_operator_review"
    || input.runtime_intent === "approve_review_queue_item"
    || input.runtime_intent === "reject_review_queue_item"
    || input.runtime_intent === "defer_review_queue_item"
    || persistedExecutedRecord.supervised_session?.status === "pending_approval"
    || !persistedExecutedRecord.operator_dashboard_state) {
    return buildResult(
      input,
      "mutation_applied",
      persistedExecutedRecord,
      `${controlResult.message} ${executionLoop.reason}`.trim(),
      executionLoop,
    );
  }

  const continuousRuntimeLoop = runContinuousRuntimeLoop(
    input.runtime_state_store,
    {
      runtime_id: runtimeId,
      profile_name: persistedExecutedRecord.profile_name,
      started_at: input.timestamp,
      runtime_intent: "no_op",
      ...executedContinuousLoopConfig,
    },
    input.continuous_loop_clock ?? createContinuousRuntimeLoopClock(
      input.timestamp,
      executedContinuousLoopConfig.tick_interval_ms ?? 60_000,
    ),
  );

  return buildResult(
    input,
    "mutation_applied",
    continuousRuntimeLoop.runtime_state ?? persistedExecutedRecord,
    `${controlResult.message} ${executionLoop.reason} ${continuousRuntimeLoop.reason}`.trim(),
    executionLoop,
    continuousRuntimeLoop,
  );
}

export function summarizeRuntimeMutationResult(result: RuntimeMutationResult): string {
  const summary = [
    `Runtime mutation status: ${result.status}`,
    `Runtime status after mutation: ${result.updated_runtime_state.last_status}`,
    `Persisted at: ${result.updated_runtime_state.persisted_at}`,
    `Reason: ${result.reason}`,
    `Audit event: ${result.audit_event.audit_event_id}`,
  ];

  if (result.execution_loop) {
    summary.push(`Execution loop status: ${result.execution_loop.status}`);
    summary.push(`Execution loop reason: ${result.execution_loop.reason}`);
  }

  if (result.continuous_runtime_loop) {
    summary.push(`Continuous runtime loop status: ${result.continuous_runtime_loop.status}`);
    summary.push(`Continuous runtime loop reason: ${result.continuous_runtime_loop.reason}`);
  }

  return summary.join("\n");
}
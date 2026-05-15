import { NextResponse } from "next/server";

import { scheduleOperatorRuntimeLiveLoop } from "@/lib/aie/operatorRuntimeLiveLoopScheduler";
import type { OperatorControlAction } from "@/lib/aie/operatorControlSurface";
import { applyOperatorActionToProviderState } from "@/lib/aie/operatorRuntimeActionHandler";
import { getOperatorRuntimeId, getOperatorRuntimeStateStore } from "@/lib/aie/operatorRuntimeServerStore";
import { loadOperatorDashboardState } from "@/lib/aie/operatorRuntimeStateProvider";
import { loadRuntimeState } from "@/lib/aie/runtimeStateStore";

export const runtime = "nodejs";

const SAFE_ERROR_MESSAGE = "We couldn't apply that operator runtime action right now. Please try again.";

function normalizeAction(value: unknown): OperatorControlAction | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "approve_goal"
    && candidate.type !== "pause_goal"
    && candidate.type !== "resume_goal"
    && candidate.type !== "retry_goal"
    && candidate.type !== "pause_all_sessions"
    && candidate.type !== "resume_safe_sessions"
    && candidate.type !== "prioritize_review_queue"
    && candidate.type !== "prioritize_delivery_queue"
    && candidate.type !== "acknowledge_studio_risk"
    && candidate.type !== "request_studio_summary"
    && candidate.type !== "approve_policy_recommendation"
    && candidate.type !== "reject_policy_recommendation"
    && candidate.type !== "defer_policy_recommendation"
    && candidate.type !== "request_meta_summary"
    && candidate.type !== "acknowledge_pattern"
    && candidate.type !== "approve_strategy_goal"
    && candidate.type !== "reject_strategy_goal"
    && candidate.type !== "defer_strategy_goal"
    && candidate.type !== "activate_strategy_goal"
    && candidate.type !== "pause_strategy_goal"
    && candidate.type !== "archive_strategy_goal"
    && candidate.type !== "decompose_strategy_goal"
    && candidate.type !== "request_strategy_summary"
    && candidate.type !== "submit_chat_message"
    && candidate.type !== "select_chat_option"
    && candidate.type !== "archive_chat_session"
    && candidate.type !== "request_chat_summary"
    && candidate.type !== "pause_autonomous_session"
    && candidate.type !== "resume_autonomous_session"
    && candidate.type !== "reprioritize_autonomous_session"
    && candidate.type !== "merge_autonomous_sessions"
    && candidate.type !== "terminate_autonomous_session"
    && candidate.type !== "start_supervised_session"
    && candidate.type !== "pause_session"
    && candidate.type !== "resume_session"
    && candidate.type !== "stop_session"
    && candidate.type !== "request_operator_review"
    && candidate.type !== "approve_review_item"
    && candidate.type !== "reject_review_item"
    && candidate.type !== "defer_review_item"
    && candidate.type !== "approve_work_item"
    && candidate.type !== "reject_work_item"
    && candidate.type !== "defer_work_item"
    && candidate.type !== "approve_review_package"
    && candidate.type !== "reject_review_package"
    && candidate.type !== "approve_delivery_package"
    && candidate.type !== "reject_delivery_package"
    && candidate.type !== "request_delivery_changes"
    && candidate.type !== "archive_delivery_package"
  ) {
    return null;
  }

  return {
    type: candidate.type,
    goal_id: typeof candidate.goal_id === "string"
      ? candidate.goal_id.trim() || null
      : candidate.goal_id === null || candidate.goal_id === undefined
        ? null
        : null,
    option_id: typeof candidate.option_id === "string"
      ? candidate.option_id.trim() || null
      : candidate.option_id === null || candidate.option_id === undefined
        ? null
        : null,
    message_text: typeof candidate.message_text === "string"
      ? candidate.message_text.trim() || null
      : candidate.message_text === null || candidate.message_text === undefined
        ? null
        : null,
    review_id: typeof candidate.review_id === "string"
      ? candidate.review_id.trim() || null
      : candidate.review_id === null || candidate.review_id === undefined
        ? null
        : null,
    session_id: typeof candidate.session_id === "string"
      ? candidate.session_id.trim() || null
      : candidate.session_id === null || candidate.session_id === undefined
        ? null
        : null,
    target_session_id: typeof candidate.target_session_id === "string"
      ? candidate.target_session_id.trim() || null
      : candidate.target_session_id === null || candidate.target_session_id === undefined
        ? null
        : null,
    session_priority: candidate.session_priority === "critical"
      || candidate.session_priority === "high"
      || candidate.session_priority === "medium"
      || candidate.session_priority === "low"
      ? candidate.session_priority
      : undefined,
    work_item_id: typeof candidate.work_item_id === "string"
      ? candidate.work_item_id.trim() || null
      : candidate.work_item_id === null || candidate.work_item_id === undefined
        ? null
        : null,
    package_id: typeof candidate.package_id === "string"
      ? candidate.package_id.trim() || null
      : candidate.package_id === null || candidate.package_id === undefined
        ? null
        : null,
    recommendation_id: typeof candidate.recommendation_id === "string"
      ? candidate.recommendation_id.trim() || null
      : candidate.recommendation_id === null || candidate.recommendation_id === undefined
        ? null
        : null,
    pattern_id: typeof candidate.pattern_id === "string"
      ? candidate.pattern_id.trim() || null
      : candidate.pattern_id === null || candidate.pattern_id === undefined
        ? null
        : null,
    rationale: typeof candidate.rationale === "string"
      ? candidate.rationale.trim() || null
      : candidate.rationale === null || candidate.rationale === undefined
        ? null
        : null,
    supervised_session_input: candidate.supervised_session_input && typeof candidate.supervised_session_input === "object"
      ? {
        max_duration_ms: typeof (candidate.supervised_session_input as Record<string, unknown>).max_duration_ms === "number"
          ? Math.max(1, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).max_duration_ms as number))
          : undefined,
        tick_budget: typeof (candidate.supervised_session_input as Record<string, unknown>).tick_budget === "number"
          ? Math.max(1, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).tick_budget as number))
          : undefined,
        max_chain_count: typeof (candidate.supervised_session_input as Record<string, unknown>).max_chain_count === "number"
          ? Math.max(1, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).max_chain_count as number))
          : undefined,
        approval_policy: (candidate.supervised_session_input as Record<string, unknown>).approval_policy === "operator_must_approve_start"
          || (candidate.supervised_session_input as Record<string, unknown>).approval_policy === "operator_must_approve_sensitive"
          || (candidate.supervised_session_input as Record<string, unknown>).approval_policy === "preapproved_with_limits"
          ? (candidate.supervised_session_input as Record<string, unknown>).approval_policy as "operator_must_approve_start" | "operator_must_approve_sensitive" | "preapproved_with_limits"
          : undefined,
        recovery_policy: (candidate.supervised_session_input as Record<string, unknown>).recovery_policy === "retry_once"
          || (candidate.supervised_session_input as Record<string, unknown>).recovery_policy === "pause_chain"
          || (candidate.supervised_session_input as Record<string, unknown>).recovery_policy === "request_operator_review"
          || (candidate.supervised_session_input as Record<string, unknown>).recovery_policy === "stop_session"
          ? (candidate.supervised_session_input as Record<string, unknown>).recovery_policy as "retry_once" | "pause_chain" | "request_operator_review" | "stop_session"
          : undefined,
        overnight_mode_enabled: typeof (candidate.supervised_session_input as Record<string, unknown>).overnight_mode_enabled === "boolean"
          ? (candidate.supervised_session_input as Record<string, unknown>).overnight_mode_enabled as boolean
          : undefined,
        max_runtime_hours: typeof (candidate.supervised_session_input as Record<string, unknown>).max_runtime_hours === "number"
          ? Math.max(1, (candidate.supervised_session_input as Record<string, unknown>).max_runtime_hours as number)
          : undefined,
        allowed_time_window_start: typeof (candidate.supervised_session_input as Record<string, unknown>).allowed_time_window_start === "string"
          ? ((candidate.supervised_session_input as Record<string, unknown>).allowed_time_window_start as string).trim() || undefined
          : undefined,
        allowed_time_window_end: typeof (candidate.supervised_session_input as Record<string, unknown>).allowed_time_window_end === "string"
          ? ((candidate.supervised_session_input as Record<string, unknown>).allowed_time_window_end as string).trim() || undefined
          : undefined,
        max_tick_count: typeof (candidate.supervised_session_input as Record<string, unknown>).max_tick_count === "number"
          ? Math.max(1, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).max_tick_count as number))
          : undefined,
        max_retries_per_chain: typeof (candidate.supervised_session_input as Record<string, unknown>).max_retries_per_chain === "number"
          ? Math.max(0, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).max_retries_per_chain as number))
          : undefined,
        max_recovery_attempts: typeof (candidate.supervised_session_input as Record<string, unknown>).max_recovery_attempts === "number"
          ? Math.max(0, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).max_recovery_attempts as number))
          : undefined,
        requires_operator_review_before_commit: typeof (candidate.supervised_session_input as Record<string, unknown>).requires_operator_review_before_commit === "boolean"
          ? (candidate.supervised_session_input as Record<string, unknown>).requires_operator_review_before_commit as boolean
          : undefined,
        allowed_agent_roles: Array.isArray((candidate.supervised_session_input as Record<string, unknown>).allowed_agent_roles)
          ? ((candidate.supervised_session_input as Record<string, unknown>).allowed_agent_roles as unknown[])
            .filter((role): role is "planner" | "executor" | "validator" | "reporter" => role === "planner" || role === "executor" || role === "validator" || role === "reporter")
          : undefined,
        disallowed_actions: Array.isArray((candidate.supervised_session_input as Record<string, unknown>).disallowed_actions)
          ? ((candidate.supervised_session_input as Record<string, unknown>).disallowed_actions as unknown[])
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
          : undefined,
        shutdown_on_failure_count: typeof (candidate.supervised_session_input as Record<string, unknown>).shutdown_on_failure_count === "number"
          ? Math.max(0, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).shutdown_on_failure_count as number))
          : undefined,
        checkpoint_interval_ticks: typeof (candidate.supervised_session_input as Record<string, unknown>).checkpoint_interval_ticks === "number"
          ? Math.max(1, Math.trunc((candidate.supervised_session_input as Record<string, unknown>).checkpoint_interval_ticks as number))
          : undefined,
        review_queue_enabled: typeof (candidate.supervised_session_input as Record<string, unknown>).review_queue_enabled === "boolean"
          ? (candidate.supervised_session_input as Record<string, unknown>).review_queue_enabled as boolean
          : undefined,
      }
      : undefined,
  };
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { message: String(error) };
}

export async function POST(request: Request) {
  let action: OperatorControlAction | null = null;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    action = normalizeAction(body.action);
  } catch (error) {
    console.error("[api/operator/runtime-action] request_json failed", serializeError(error));
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }

  if (!action) {
    return NextResponse.json({ error: "A supported operator action is required." }, { status: 400 });
  }

  const runtimeStateStore = getOperatorRuntimeStateStore();
  const runtimeId = getOperatorRuntimeId();
  const now = new Date().toISOString();
  const providerResult = await loadOperatorDashboardState({
    runtime_state_store: runtimeStateStore,
    runtime_id: runtimeId,
    now,
  });

  try {
    const persistedRuntimeState = runtimeStateStore && runtimeId
      ? loadRuntimeState(runtimeStateStore, runtimeId)
      : null;
    const actionResult = applyOperatorActionToProviderState(providerResult, action, {
      runtime_state_store: runtimeStateStore,
      runtime_id: runtimeId,
      now,
      start_continuous_loop: true,
      continuous_loop_config: {
        ...(persistedRuntimeState?.continuous_loop_config ?? {}),
        max_ticks_per_run: 1,
      },
    });

    if (runtimeStateStore
      && runtimeId
      && actionResult.result === "accepted"
      && actionResult.runtime_intent !== "pause_active_goal"
      && actionResult.runtime_intent !== "pause_autonomous_session"
      && actionResult.runtime_intent !== "resume_autonomous_session"
      && actionResult.runtime_intent !== "reprioritize_autonomous_session"
      && actionResult.runtime_intent !== "merge_autonomous_sessions"
      && actionResult.runtime_intent !== "terminate_autonomous_session"
      && actionResult.runtime_intent !== "pause_supervised_session"
      && actionResult.runtime_intent !== "stop_supervised_session"
      && actionResult.runtime_intent !== "request_supervised_operator_review"
      && actionResult.runtime_intent !== "approve_review_queue_item"
      && actionResult.runtime_intent !== "reject_review_queue_item"
      && actionResult.runtime_intent !== "defer_review_queue_item"
      && actionResult.runtime_intent !== "submit_chat_message"
      && actionResult.runtime_intent !== "select_chat_option"
      && actionResult.runtime_intent !== "archive_chat_session"
      && actionResult.runtime_intent !== "request_chat_summary") {
      const updatedRuntimeState = loadRuntimeState(runtimeStateStore, runtimeId);
      if (updatedRuntimeState) {
        scheduleOperatorRuntimeLiveLoop(
          runtimeStateStore,
          runtimeId,
          updatedRuntimeState.profile_name,
          updatedRuntimeState.continuous_loop_config ?? {},
          actionResult.continuous_loop_queue ?? null,
        );
      }
    }

    const refreshedProviderResult = await loadOperatorDashboardState({
      runtime_state_store: runtimeStateStore,
      runtime_id: runtimeId,
      now,
    });

    return NextResponse.json({
      actionResult,
      providerResult: refreshedProviderResult,
    });
  } catch (error) {
    console.error("[api/operator/runtime-action] mutation failed", {
      action,
      error: serializeError(error),
    });
    return NextResponse.json({ error: SAFE_ERROR_MESSAGE }, { status: 500 });
  }
}
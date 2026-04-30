import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import type { OperatorRuntimeStateProviderResult } from "./operatorRuntimeStateProvider";
import { loadLiveOperatorDashboardState } from "./operatorRuntimeStateProvider";
import {
  createRuntimeStateStore,
  saveRuntimeState,
} from "./runtimeStateStore";
import {
  createSafeRuntimeActionBridgeResult,
  summarizeSafeRuntimeActionBridgeResult,
} from "./safeRuntimeActionBridge";

function createStoppedService() {
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    require_supervised_scope: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  return stopBackgroundRuntimeService({
    ...service,
    started_at: "2026-04-26T11:50:00.000Z",
    stopped_at: "2026-04-26T11:55:00.000Z",
    last_tick_at: "2026-04-26T11:55:00.000Z",
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
}

function createLiveProviderResult(): OperatorRuntimeStateProviderResult {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const liveResult = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  if (!liveResult.dashboard_state) {
    throw new Error("Expected live provider result to include dashboard state.");
  }

  const demoState = createOperatorDashboardDemoState();

  liveResult.dashboard_state = {
    ...liveResult.dashboard_state,
    ...demoState,
    autonomous_sessions: demoState.autonomous_sessions,
    active_goal: {
      goal_id: "live-active-goal",
      description: "Stabilize live runtime lane",
      priority: "high",
      status: "active",
      explanation: "Active live goal.",
      recommended_action: "Pause when review is required.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:59:00.000Z",
    },
    paused_goals: [{
      goal_id: "live-paused-goal",
      description: "Resume live runtime lane",
      priority: "medium",
      status: "paused",
      explanation: "Paused live goal.",
      recommended_action: "Resume when ready.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:58:00.000Z",
    }],
    blocked_goals: [{
      goal_id: "live-blocked-goal",
      description: "Retry live runtime lane",
      priority: "medium",
      status: "blocked",
      explanation: "Blocked live goal.",
      recommended_action: "Retry after review.",
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-26T11:57:00.000Z",
      blocker_type: "status",
      blocker_ids: [],
    }],
    approvals_required: [{
      goal_id: "live-active-goal",
      approvals_needed: ["session"],
      reason: "Session approval required.",
      recommended_action: "Grant session approval.",
    }],
    recovery_recommendations: [{
      report_id: "live-recovery-report",
      source: "runtime_state_store",
      category: "stale_context",
      severity: "medium",
      recommendation: "request_operator_review",
      retry_safe: false,
      operator_review_required: true,
      reason: "Review the live retry state before requeueing.",
    }],
    meta_intelligence: demoState.meta_intelligence,
    meta_detected_patterns: demoState.meta_detected_patterns,
    meta_policy_recommendations: demoState.meta_policy_recommendations,
    meta_policy_state: demoState.meta_policy_state,
    meta_operator_decision_history: demoState.meta_operator_decision_history,
    meta_summary_package: demoState.meta_summary_package,
    last_updated_at: "2026-04-26T12:00:00.000Z",
  };

  return liveResult;
}

test("rejects demo source for live bridge", () => {
  const result = createSafeRuntimeActionBridgeResult({
    source: "demo_seed",
    dashboard_state: createOperatorDashboardDemoState(),
    warnings: [],
    loaded_at: "2026-04-26T12:00:00.000Z",
  }, {
    type: "pause_goal",
    goal_id: "stabilize-kbm-input",
  });

  assert.equal(result.status, "action_rejected");
  assert.equal(result.runtime_intent, "no_op");
});

test("rejects unavailable source", () => {
  const result = createSafeRuntimeActionBridgeResult({
    source: "unavailable",
    dashboard_state: null,
    warnings: ["No runtime state is available."],
    loaded_at: "2026-04-26T12:00:00.000Z",
  }, {
    type: "pause_goal",
    goal_id: null,
  });

  assert.equal(result.status, "action_rejected");
  assert.match(result.reason, /no live runtime state/i);
});

test("approve_goal creates grant_session_approval intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "approve_goal",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.goal_id, "live-active-goal");
  assert.equal(result.runtime_intent, "grant_session_approval");
});

test("pause_goal creates pause_active_goal intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "pause_goal",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "pause_active_goal");
});

test("resume_goal creates resume_paused_goal intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "resume_goal",
    goal_id: "live-paused-goal",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "resume_paused_goal");
});

test("retry_goal creates mark_goal_retry_requested intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "retry_goal",
    goal_id: "live-blocked-goal",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "mark_goal_retry_requested");
});

test("pause_all_sessions creates the studio pause intent", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    approvals_required: [],
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "pause_all_sessions",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "pause_all_sessions");
});

test("resume_safe_sessions creates the studio resume intent", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    approvals_required: [],
    autonomous_sessions: {
      ...providerResult.dashboard_state!.autonomous_sessions!,
      sessions: providerResult.dashboard_state!.autonomous_sessions!.sessions.map((session) => ({
        ...session,
        status: session.session_id === "demo-session-feature-ui" ? "paused" : "blocked",
        blocked_by_conflict: session.session_id === "demo-session-bugfix-delivery",
      })),
    },
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "resume_safe_sessions",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "resume_safe_sessions");
});

test("acknowledge_studio_risk creates the studio acknowledgement intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "acknowledge_studio_risk",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "acknowledge_studio_risk");
});

test("approve_policy_recommendation creates the meta approval intent", () => {
  const providerResult = createLiveProviderResult();
  const recommendationId = providerResult.dashboard_state?.meta_policy_recommendations?.[0]?.recommendation_id ?? null;

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "approve_policy_recommendation",
    recommendation_id: recommendationId,
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "approve_policy_recommendation");
});

test("acknowledge_pattern creates the meta pattern acknowledgement intent", () => {
  const providerResult = createLiveProviderResult();
  const patternId = providerResult.dashboard_state?.meta_detected_patterns?.[0]?.pattern_id ?? null;

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "acknowledge_pattern",
    pattern_id: patternId,
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "acknowledge_pattern");
});

test("approve_strategy_goal creates the strategy approval intent", () => {
  const providerResult = createLiveProviderResult();

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "approve_strategy_goal",
    goal_id: "strategy-ship-first-playable-loop",
  });

  assert.equal(result.status, "action_rejected");
  assert.equal(result.runtime_intent, "no_op");
});

test("activate_strategy_goal creates the strategy activation intent for approved goals", () => {
  const providerResult = createLiveProviderResult();

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "activate_strategy_goal",
    goal_id: "strategy-ship-first-playable-loop",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "activate_strategy_goal");
});

test("prioritize_review_queue rejects when no review packages exist", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    review_packages: [],
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "prioritize_review_queue",
  });

  assert.equal(result.status, "action_rejected");
  assert.equal(result.runtime_intent, "no_op");
});

test("start_supervised_session creates start intent", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    supervised_session: null,
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "start_supervised_session",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "start_supervised_session");
});

test("pause_session creates pause supervised intent", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    supervised_session: {
      session_id: "session-1",
      runtime_id: "runtime-1",
      status: "running",
      started_at: "2026-04-26T12:00:00.000Z",
      stopped_at: null,
      duration_ms: 0,
      max_duration_ms: 3600000,
      tick_budget: 4,
      ticks_completed: 0,
      max_chain_count: 4,
      agent_ids: ["planner-agent"],
      active_chain_ids: [],
      completed_chain_ids: [],
      failed_chain_ids: [],
      safety_scope: "bounded_multi_agent_runtime",
      approval_policy: "operator_must_approve_start",
      recovery_policy: "request_operator_review",
      last_checkpoint_at: null,
      stop_reason: null,
      last_recovery_action: "none",
      next_scheduled_tick_at: null,
      latest_timeline_event_id: null,
      pending_operator_review: false,
    },
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, { type: "pause_session" });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "pause_supervised_session");
});

test("pause_autonomous_session creates live multi-session intent", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "pause_autonomous_session",
    session_id: "demo-session-feature-ui",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.goal_id, "demo-session-feature-ui");
  assert.equal(result.runtime_intent, "pause_autonomous_session");
});

test("merge_autonomous_sessions requires distinct live sessions", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "merge_autonomous_sessions",
    session_id: "demo-session-feature-ui",
    target_session_id: "demo-session-feature-ui",
  });

  assert.equal(result.status, "action_rejected");
});

test("rejects approval when no approval required", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    approvals_required: [],
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "approve_goal",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "action_rejected");
});

test("rejects pause when no active goal exists", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    active_goal: null,
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "pause_goal",
    goal_id: "live-active-goal",
  });

  assert.equal(result.status, "action_rejected");
});

test("rejects resume when no paused goal exists", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    paused_goals: [],
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "resume_goal",
    goal_id: "live-paused-goal",
  });

  assert.equal(result.status, "action_rejected");
});

test("rejects retry when no blocked or recovery item exists", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    blocked_goals: [],
    recovery_recommendations: [],
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "retry_goal",
    goal_id: "live-blocked-goal",
  });

  assert.equal(result.status, "action_rejected");
});

test("audit event is generated for accepted action", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "pause_goal",
    goal_id: "live-active-goal",
  });

  assert.match(result.audit_event.audit_event_id, /safe-runtime-action-bridge/);
  assert.equal(result.audit_event.status, "action_ready");
});

test("audit event is generated for rejected action", () => {
  const providerResult = createLiveProviderResult();
  providerResult.dashboard_state = {
    ...providerResult.dashboard_state!,
    active_goal: null,
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "pause_goal",
    goal_id: "live-active-goal",
  });

  assert.equal(result.audit_event.status, "action_rejected");
});

test("unsupported action is rejected", () => {
  const result = createSafeRuntimeActionBridgeResult(createLiveProviderResult(), {
    type: "ship_goal" as "approve_goal",
    goal_id: null,
  });

  assert.equal(result.status, "action_unsupported");
});

test("deterministic output", () => {
  const providerResult = createLiveProviderResult();
  const action = {
    type: "pause_goal" as const,
    goal_id: "live-active-goal",
  };

  const first = summarizeSafeRuntimeActionBridgeResult(createSafeRuntimeActionBridgeResult(providerResult, action, "2026-04-26T12:00:00.000Z"));
  const second = summarizeSafeRuntimeActionBridgeResult(createSafeRuntimeActionBridgeResult(providerResult, action, "2026-04-26T12:00:00.000Z"));

  assert.equal(first, second);
});
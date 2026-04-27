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

  liveResult.dashboard_state = {
    ...liveResult.dashboard_state,
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
import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import { createOperatorDashboardDemoState } from "./operatorDashboardDemoState";
import { applyOperatorControlAction } from "./operatorControlSurface";
import { loadLiveOperatorDashboardState } from "./operatorRuntimeStateProvider";
import {
  createRuntimeStateStore,
  loadRuntimeState,
  saveRuntimeState,
} from "./runtimeStateStore";
import { createSafeRuntimeActionBridgeResult } from "./safeRuntimeActionBridge";
import { executeRuntimeMutation } from "./runtimeMutationExecutor";

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

test("operator control surface records bounded chat submission", () => {
  const state = createOperatorDashboardDemoState();

  const result = applyOperatorControlAction(state, {
    type: "submit_chat_message",
    message_text: "make enemies smarter when grenade blows up",
  });

  assert.equal(result.changed, true);
  assert.ok(result.state.conversational_session?.latest_proposal);
  assert.equal(result.state.conversational_session?.latest_proposal?.safe_to_execute, false);
});

test("safe runtime bridge accepts bounded chat submission", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const providerResult = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  if (!providerResult.dashboard_state) {
    throw new Error("Expected a live dashboard state.");
  }

  providerResult.dashboard_state = {
    ...providerResult.dashboard_state,
    ...createOperatorDashboardDemoState(),
  };

  const result = createSafeRuntimeActionBridgeResult(providerResult, {
    type: "submit_chat_message",
    message_text: "make enemies smarter when grenade blows up",
  });

  assert.equal(result.status, "action_ready");
  assert.equal(result.runtime_intent, "submit_chat_message");
});

test("runtime mutation persists conversational command state without starting execution", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const persisted = loadRuntimeState(store, record.runtime_id);
  if (!persisted) {
    throw new Error("Expected persisted runtime record.");
  }

  persisted.operator_dashboard_state = createOperatorDashboardDemoState();
  persisted.persisted_at = "2026-04-26T12:00:00.000Z";

  const result = executeRuntimeMutation({
    action: {
      type: "submit_chat_message",
      message_text: "make enemies smarter when grenade blows up",
    },
    runtime_intent: "submit_chat_message",
    current_runtime_state: persisted,
    current_dashboard_state: persisted.operator_dashboard_state,
    runtime_state_store: store,
    runtime_id: persisted.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
  });

  assert.equal(result.status, "mutation_applied");
  assert.match(result.reason, /bounded advisory chat session/i);
  assert.match(result.updated_runtime_state.continuous_loop?.tick_history.slice(-1)[0]?.mutation_applied ?? "", /conversational command state/i);
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.continuous_runtime_loop, null);
});

test("runtime mutation keeps production pipeline chat intake in planning-only mode", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const persisted = loadRuntimeState(store, record.runtime_id);
  if (!persisted) {
    throw new Error("Expected persisted runtime record.");
  }

  persisted.operator_dashboard_state = createOperatorDashboardDemoState();
  persisted.persisted_at = "2026-04-26T12:00:00.000Z";

  const result = executeRuntimeMutation({
    action: {
      type: "submit_chat_message",
      message_text: "plan the Unity art and audio production pipeline for OpenClaw room ambience",
    },
    runtime_intent: "submit_chat_message",
    current_runtime_state: persisted,
    current_dashboard_state: persisted.operator_dashboard_state,
    runtime_state_store: store,
    runtime_id: persisted.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.continuous_runtime_loop, null);
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.conversational_session?.latest_proposal?.production_pipeline_plan?.mutation_policy, "planning_only");
});

test("runtime mutation keeps Unity planning chat intake advisory and non-executing", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const persisted = loadRuntimeState(store, record.runtime_id);
  if (!persisted) {
    throw new Error("Expected persisted runtime record.");
  }

  persisted.operator_dashboard_state = createOperatorDashboardDemoState();
  persisted.persisted_at = "2026-04-26T12:00:00.000Z";

  const result = executeRuntimeMutation({
    action: {
      type: "submit_chat_message",
      message_text: "prepare a Unity scene prefab validation plan for the castle hub room",
    },
    runtime_intent: "submit_chat_message",
    current_runtime_state: persisted,
    current_dashboard_state: persisted.operator_dashboard_state,
    runtime_state_store: store,
    runtime_id: persisted.runtime_id,
    timestamp: "2026-04-26T12:01:00.000Z",
    start_continuous_loop: true,
  });

  assert.equal(result.status, "mutation_applied");
  assert.equal(result.execution_loop?.status, "loop_not_triggered");
  assert.equal(result.continuous_runtime_loop, null);
  assert.deepEqual(result.updated_runtime_state.operator_dashboard_state?.conversational_session?.latest_proposal?.production_pipeline_plan?.unity_planning_packet?.request_types, [
    "scene_request",
    "prefab_request",
    "validation_playtest_request",
  ]);
  assert.equal(result.updated_runtime_state.operator_dashboard_state?.conversational_session?.latest_proposal?.production_pipeline_plan?.unity_validation_execution_result, null);
});

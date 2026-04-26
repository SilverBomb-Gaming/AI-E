import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import {
  applyOperatorActionToProviderState,
  loadDemoOperatorDashboardState,
  loadLiveOperatorDashboardState,
  loadOperatorDashboardState,
  resolveOperatorStateSource,
  summarizeOperatorStateProviderResult,
} from "./operatorRuntimeStateProvider";
import { createRuntimeStateStore, saveRuntimeState } from "./runtimeStateStore";

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

test("provider returns demo_seed when no live runtime exists", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });

  assert.equal(result.source, "demo_seed");
  assert.equal(result.dashboard_state?.active_goal?.description, "Stabilize KBM input lane");
});

test("provider labels demo state clearly", () => {
  const result = loadDemoOperatorDashboardState("2026-04-26T12:00:00.000Z");

  assert.equal(result.source, "demo_seed");
  assert.match(result.warnings.join(" "), /seeded demo state/i);
});

test("provider returns live_runtime when runtime state exists", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(result.source, "live_runtime");
  assert.equal(result.dashboard_state?.runtime_status.status, record.last_status);
});

test("provider labels live state clearly", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");

  const result = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.match(result.warnings.join(" "), /connected to live ai-e runtime state/i);
});

test("unavailable state is handled safely", async () => {
  const store = createRuntimeStateStore({
    records: {
      broken: "{not-valid-json",
    },
  });

  const result = await loadOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: "broken",
    now: "2026-04-26T12:00:00.000Z",
  });

  assert.equal(result.source, "unavailable");
  assert.equal(result.dashboard_state, null);
});

test("demo actions still work", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });
  const actionResult = applyOperatorActionToProviderState(result, {
    type: "pause_goal",
    goal_id: result.dashboard_state?.active_goal?.goal_id ?? null,
  });

  assert.equal(actionResult.result, "accepted");
  assert.equal(actionResult.dashboard_state?.runtime_status.status, "runtime_paused");
});

test("live unsupported mutation is rejected safely", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "operator_away_safe");
  const providerResult = loadLiveOperatorDashboardState({
    runtime_state_store: store,
    runtime_id: record.runtime_id,
    now: "2026-04-26T12:00:00.000Z",
  });

  const actionResult = applyOperatorActionToProviderState(providerResult, {
    type: "retry_goal",
    goal_id: "runtime-blocker-1",
  });

  assert.equal(actionResult.result, "rejected");
  assert.equal(actionResult.reason, "live runtime mutation not enabled for this action");
});

test("resolveOperatorStateSource is deterministic", () => {
  const first = resolveOperatorStateSource({ now: "2026-04-26T12:00:00.000Z" });
  const second = resolveOperatorStateSource({ now: "2026-04-26T12:00:00.000Z" });

  assert.equal(first, "demo_seed");
  assert.equal(first, second);
});

test("deterministic provider summary", async () => {
  const result = await loadOperatorDashboardState({ now: "2026-04-26T12:00:00.000Z" });

  const first = summarizeOperatorStateProviderResult(result);
  const second = summarizeOperatorStateProviderResult(result);

  assert.equal(first, second);
});
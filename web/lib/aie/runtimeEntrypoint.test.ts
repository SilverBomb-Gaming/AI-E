import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession } from "./autonomousWorkSession";
import { createBackgroundRunHistory } from "./backgroundRunHistory";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
} from "./backgroundSessionQueue";
import type { BackgroundRuntimeClock } from "./backgroundRuntimeService";
import {
  loadRuntimeEntrypointConfig,
  runBackgroundRuntimeEntrypoint,
  summarizeRuntimeEntrypoint,
} from "./runtimeEntrypoint";
import { createBackgroundRuntimeService } from "./backgroundRuntimeService";
import {
  createRuntimeStateStore,
  loadRuntimeState,
  persistRuntimeStateRecord,
  saveRuntimeState,
} from "./runtimeStateStore";

function createSession(goal: string, stepTitle = goal) {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-25T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-25T14:00:00.000Z",
    maxCycles: 8,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: stepTitle,
        plannerReadyRequest: stepTitle,
        requiredGate: "controlled_validation",
        validationRequired: true,
        commitAllowed: false,
        pushAllowed: false,
        stopOnFailure: true,
      }],
    },
  });
}

function createQueue() {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 2,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("BABYLON grenade polish", "Complete BABYLON grenade polish"));
  queue = enqueueBackgroundSession(queue, createSession("AI-E docs cleanup", "Complete AI-E docs cleanup"));
  return queue;
}

function createBlockedQueue() {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 1,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const blockedSession = createSession("BABYLON grenade polish", "Inspect BABYLON grenade polish");
  queue = enqueueBackgroundSession(queue, {
    ...blockedSession,
    latest_persistence_record: {
      ...blockedSession.latest_persistence_record,
      context_snapshot: {
        ...blockedSession.latest_persistence_record.context_snapshot,
        chain_updated_at: "2026-04-24T10:00:00.000Z",
        validation_completed_at: "2026-04-24T10:00:00.000Z",
        stale_after_ms: 60_000,
      },
    },
  });
  return queue;
}

function createClock(times: string[]): BackgroundRuntimeClock {
  let index = 0;
  return {
    nextTickTime() {
      const value = times[index];
      if (!value) {
        throw new Error("No more deterministic clock values available.");
      }
      index += 1;
      return value;
    },
  };
}

function createDashboardState() {
  return {
    active_goal: {
      goal_id: "entrypoint-goal-active",
      description: "Advance entrypoint runtime goal",
      priority: "high",
      status: "active",
      explanation: "The active entrypoint goal is ready to continue.",
      recommended_action: null,
      depends_on_goal_ids: [],
      blocking_goal_ids: [],
      conflict_goal_ids: [],
      last_updated_at: "2026-04-25T10:09:00.000Z",
    },
    queued_goals: [],
    blocked_goals: [],
    completed_goals: [],
    paused_goals: [],
    dependency_blockers: [],
    conflict_blockers: [],
    recent_failures: [],
    recovery_recommendations: [],
    approvals_required: [],
    validation_issues: [],
    runtime_status: {
      status: "runtime_ready",
      explanation: "The runtime is ready.",
    },
    session_status: {
      status: "session_running",
      explanation: "The session is running.",
    },
    queue_status: {
      status: "queue_running",
      explanation: "Queued work is available.",
    },
    scheduler_status: {
      status: "goal_selected",
      explanation: "The runtime has a selected goal.",
    },
    last_updated_at: "2026-04-25T10:10:00.000Z",
  };
}

test("loads default safe config", () => {
  const config = loadRuntimeEntrypointConfig({
    started_at: "2026-04-25T10:00:00.000Z",
  });

  assert.equal(config.tick_interval_ms, 60_000);
  assert.equal(config.max_ticks_per_run, 3);
  assert.equal(config.max_runs_per_invocation, 1);
  assert.equal(config.profile_name, "local_supervised");
  assert.equal(config.operator_away_mode, false);
  assert.equal(config.require_supervised_scope, true);
  assert.equal(config.dry_run_mode, false);
  assert.equal(config.require_fresh_approvals, true);
  assert.equal(config.require_fresh_context, true);
  assert.equal(config.stop_on_blocker, true);
  assert.equal(config.stop_on_error, true);
});

test("rejects invalid unbounded config", () => {
  assert.throws(() => loadRuntimeEntrypointConfig({ max_ticks_per_run: Number.POSITIVE_INFINITY }), /max_ticks_per_run/);
  assert.throws(() => loadRuntimeEntrypointConfig({ tick_interval_ms: 0 }), /tick_interval_ms/);
  assert.throws(() => loadRuntimeEntrypointConfig({ require_supervised_scope: false }), /require_supervised_scope/);
});

test("starts bounded runtime service", () => {
  const result = runBackgroundRuntimeEntrypoint(
    {
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      queue: createQueue(),
      history: createBackgroundRunHistory(),
      clock: createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
    },
  );

  assert.equal(result.status, "entrypoint_completed");
  assert.equal(result.service.ticks_attempted, 2);
  assert.equal(result.service.config.max_runs_per_invocation, 1);
});

test("returns readable summary", () => {
  const result = runBackgroundRuntimeEntrypoint({
    profile_name: "dry_run",
    dry_run_mode: true,
    started_at: "2026-04-25T10:10:00.000Z",
  });
  const summary = summarizeRuntimeEntrypoint(result);
  const runtimeProfileMatches = summary.match(/Runtime profile:/g) ?? [];

  assert.match(summary, /Runtime entrypoint status:/);
  assert.match(summary, /Runtime profile:/);
  assert.match(summary, /Profile description:/);
  assert.match(summary, /Dry run mode:/);
  assert.match(summary, /Service status:/);
  assert.equal(runtimeProfileMatches.length, 1);
});

test("dry_run_mode does not mutate state unexpectedly", () => {
  const queue = createQueue();
  const history = createBackgroundRunHistory();

  const result = runBackgroundRuntimeEntrypoint(
    {
      dry_run_mode: true,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      queue,
      history,
    },
  );

  assert.equal(result.status, "entrypoint_paused");
  assert.equal(result.service.ticks_attempted, 0);
  assert.equal(queue.sessions.length, 2);
  assert.equal(history.records.length, 0);
});

test("exits cleanly when service completes", () => {
  const result = runBackgroundRuntimeEntrypoint(
    {
      tick_interval_ms: 60_000,
      max_ticks_per_run: 1,
      max_runs_per_invocation: 1,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      queue: createQueue(),
      history: createBackgroundRunHistory(),
      clock: createClock(["2026-04-25T10:10:00.000Z"]),
    },
  );

  assert.equal(result.status, "entrypoint_completed");
  assert.match(result.reason, /bounded tick run/i);
});

test("exits cleanly when service pauses or blocks", () => {
  const paused = runBackgroundRuntimeEntrypoint({
    profile_name: "dry_run",
    dry_run_mode: true,
    started_at: "2026-04-25T10:10:00.000Z",
  });
  const blocked = runBackgroundRuntimeEntrypoint(
    {
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      queue: createBlockedQueue(),
      history: createBackgroundRunHistory(),
      clock: createClock(["2026-04-25T10:10:00.000Z"]),
    },
  );

  assert.equal(paused.status, "entrypoint_paused");
  assert.equal(blocked.status, "entrypoint_blocked");
  assert.equal(blocked.service.stop_reason, "blocker_detected");
});

test("deterministic behavior", () => {
  const config = {
    tick_interval_ms: 60_000,
    max_ticks_per_run: 2,
    max_runs_per_invocation: 1,
    started_at: "2026-04-25T10:10:00.000Z",
  };

  const first = runBackgroundRuntimeEntrypoint(config, {
    queue: createQueue(),
    history: createBackgroundRunHistory(),
    clock: createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
  });
  const second = runBackgroundRuntimeEntrypoint(config, {
    queue: createQueue(),
    history: createBackgroundRunHistory(),
    clock: createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
  });

  assert.equal(first.summary, second.summary);
});

test("no auto-start on import", async () => {
  const captured: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    captured.push(args.join(" "));
  };

  try {
    const runtimeModule = await import("../../scripts/runBackgroundRuntime");
    assert.equal(typeof runtimeModule.main, "function");
    assert.equal(captured.length, 0);
  } finally {
    console.log = originalLog;
  }
});

test("integrates with backgroundRuntimeService", () => {
  const result = runBackgroundRuntimeEntrypoint(
    {
      profile_name: "bounded_batch",
      tick_interval_ms: 60_000,
      max_ticks_per_run: 1,
      max_runs_per_invocation: 2,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      queue: createQueue(),
      history: createBackgroundRunHistory(),
      clock: createClock(["2026-04-25T10:10:00.000Z"]),
    },
  );

  assert.equal(result.service_result?.status, "service_completed");
  assert.equal(result.service.trigger_state.config.max_runs_per_invocation, 2);
  assert.equal(result.service.config.require_fresh_approvals, true);
  assert.equal(result.service.config.require_fresh_context, true);
});

test("prefers continuous runtime loop when persisted dashboard state exists", () => {
  const store = createRuntimeStateStore();
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 2,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    require_supervised_scope: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const record = saveRuntimeState(store, {
    ...service,
    started_at: "2026-04-25T10:00:00.000Z",
    stopped_at: "2026-04-25T10:00:00.000Z",
    status: "service_idle",
  }, "bounded_batch");
  const persisted = loadRuntimeState(store, record.runtime_id);

  if (!persisted) {
    throw new Error("Expected persisted runtime record.");
  }

  persisted.operator_dashboard_state = createDashboardState();
  persistRuntimeStateRecord(store, persisted);

  const result = runBackgroundRuntimeEntrypoint(
    {
      profile_name: "bounded_batch",
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      max_runs_per_invocation: 1,
      started_at: "2026-04-25T10:10:00.000Z",
    },
    {
      runtime_state_store: store,
    },
  );

  assert.equal(result.continuous_loop_result !== null, true);
  assert.equal(result.service_result, null);
  assert.equal(result.service.ticks_attempted >= 1, true);
});
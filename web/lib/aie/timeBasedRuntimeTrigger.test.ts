import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousWorkSession } from "./autonomousWorkSession";
import { createBackgroundRunHistory } from "./backgroundRunHistory";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
} from "./backgroundSessionQueue";
import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
} from "./backgroundRuntimeService";
import {
  createContinuousRuntimeLoopClock,
} from "./continuousRuntimeLoop";
import {
  createTimeTrigger,
  runTimeTriggeredContinuousLoop,
  runTimeTriggeredCycle,
  shouldTriggerRun,
  summarizeTrigger,
  updateTriggerState,
} from "./timeBasedRuntimeTrigger";
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

function createLoopStore() {
  const store = createRuntimeStateStore();
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: true,
    require_supervised_scope: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const record = saveRuntimeState(store, stopBackgroundRuntimeService({
    ...service,
    started_at: "2026-04-25T10:00:00.000Z",
    stopped_at: "2026-04-25T10:00:00.000Z",
    status: "service_idle",
  }, "max_ticks_reached"), "bounded_batch");
  const persisted = loadRuntimeState(store, record.runtime_id);

  if (!persisted) {
    throw new Error("Expected persisted runtime record.");
  }

  persisted.operator_dashboard_state = {
    active_goal: {
      goal_id: "trigger-goal-active",
      description: "Advance trigger runtime goal",
      priority: "high",
      status: "active",
      explanation: "The active goal is ready to continue.",
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
    runtime_status: { status: "runtime_ready", explanation: "The runtime is ready." },
    session_status: { status: "session_running", explanation: "The session is running." },
    queue_status: { status: "queue_running", explanation: "Queued work is available." },
    scheduler_status: { status: "goal_selected", explanation: "An active goal is selected." },
    last_updated_at: "2026-04-25T10:10:00.000Z",
  };
  persistRuntimeStateRecord(store, persisted);

  return { store, record: persisted };
}

test("triggers run after interval elapsed", () => {
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  const result = runTimeTriggeredCycle(
    trigger,
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.status, "trigger_completed");
  assert.equal(result.triggered, true);
  assert.equal(result.run_results.length, 1);
});

test("skips run if interval not reached", () => {
  const initial = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const first = runTimeTriggeredCycle(initial, createQueue(), createBackgroundRunHistory(), "2026-04-25T10:10:00.000Z");
  const updated = updateTriggerState(initial, first);

  const second = runTimeTriggeredCycle(updated, first.queue, first.history, "2026-04-25T10:10:30.000Z");

  assert.equal(second.status, "trigger_skipped");
  assert.equal(second.triggered, false);
});

test("triggers queue correctly", () => {
  const result = runTimeTriggeredCycle(
    createTimeTrigger({
      interval_ms: 60_000,
      max_runs_per_invocation: 1,
      allow_empty_runs: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.run_results[0].sessions_run, 2);
  assert.equal(result.run_results[0].sessions_completed, 2);
});

test("appends history record", () => {
  const result = runTimeTriggeredCycle(
    createTimeTrigger({
      interval_ms: 60_000,
      max_runs_per_invocation: 1,
      allow_empty_runs: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.history.records.length, 1);
});

test("avoids duplicate triggers", () => {
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const first = runTimeTriggeredCycle(trigger, createQueue(), createBackgroundRunHistory(), "2026-04-25T10:10:00.000Z");
  const second = runTimeTriggeredCycle(first.state, first.queue, first.history, "2026-04-25T10:10:00.000Z");

  assert.equal(second.status, "trigger_skipped");
  assert.equal(second.history.records.length, 1);
});

test("respects max_runs_per_invocation", () => {
  let queue = createBackgroundSessionQueue({
    max_sessions_per_run: 1,
    max_cycles_per_session: 2,
    skip_blocked_sessions: false,
    stop_on_first_failure: false,
    operator_away_mode: true,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  queue = enqueueBackgroundSession(queue, createSession("BABYLON grenade polish", "Complete BABYLON grenade polish"));
  queue = enqueueBackgroundSession(queue, createSession("AI-E docs cleanup", "Complete AI-E docs cleanup"));

  const result = runTimeTriggeredCycle(
    createTimeTrigger({
      interval_ms: 60_000,
      max_runs_per_invocation: 1,
      allow_empty_runs: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    queue,
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.run_results.length, 1);
  assert.equal(result.run_results[0].status, "queue_running");
});

test("deterministic output", () => {
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const first = runTimeTriggeredCycle(trigger, createQueue(), createBackgroundRunHistory(), "2026-04-25T10:10:00.000Z");
  const second = runTimeTriggeredCycle(trigger, createQueue(), createBackgroundRunHistory(), "2026-04-25T10:10:00.000Z");

  assert.deepEqual(first.run_results, second.run_results);
  assert.equal(first.reason, second.reason);
});

test("integrates with queue and history", () => {
  const result = runTimeTriggeredCycle(
    createTimeTrigger({
      interval_ms: 60_000,
      max_runs_per_invocation: 1,
      allow_empty_runs: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.history.records[0].queue_status, result.run_results[0].status);
  assert.equal(result.state.runs_executed, 1);
});

test("produces readable summary", () => {
  const result = runTimeTriggeredCycle(
    createTimeTrigger({
      interval_ms: 60_000,
      max_runs_per_invocation: 1,
      allow_empty_runs: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );
  const summary = summarizeTrigger(result);

  assert.match(summary, /Trigger status:/);
  assert.match(summary, /Runs this cycle:/);
  assert.match(summary, /Reason:/);
});

test("no side effects", () => {
  const queue = createQueue();
  const history = createBackgroundRunHistory();
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const originalQueueSessions = queue.sessions.length;
  const originalHistoryRecords = history.records.length;

  const result = runTimeTriggeredCycle(trigger, queue, history, "2026-04-25T10:10:00.000Z");

  assert.equal(queue.sessions.length, originalQueueSessions);
  assert.equal(history.records.length, originalHistoryRecords);
  assert.notEqual(result.queue, queue);
  assert.notEqual(result.history, history);
});

test("shouldTriggerRun checks elapsed interval", () => {
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  const first = runTimeTriggeredCycle(trigger, createQueue(), createBackgroundRunHistory(), "2026-04-25T10:10:00.000Z");

  assert.equal(shouldTriggerRun(first.state, "2026-04-25T10:10:30.000Z"), false);
  assert.equal(shouldTriggerRun(first.state, "2026-04-25T10:11:00.000Z"), true);
});

test("time trigger invokes continuous runtime loop when interval elapses", () => {
  const seeded = createLoopStore();
  const trigger = createTimeTrigger({
    interval_ms: 60_000,
    max_runs_per_invocation: 1,
    allow_empty_runs: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });

  const result = runTimeTriggeredContinuousLoop(
    trigger,
    seeded.store,
    {
      runtime_id: seeded.record.runtime_id,
      profile_name: "bounded_batch",
      max_ticks_per_run: 2,
    },
    "2026-04-25T10:10:00.000Z",
    createContinuousRuntimeLoopClock("2026-04-25T10:10:00.000Z", 60_000),
  );

  assert.equal(result.status, "trigger_completed");
  assert.equal(result.triggered, true);
  assert.equal(result.loop_result?.runtime_state?.continuous_loop?.ticks_attempted, 2);
});
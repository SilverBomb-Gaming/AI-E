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
  runBackgroundRuntimeTick,
  startBackgroundRuntimeService,
  stopBackgroundRuntimeService,
  summarizeBackgroundRuntimeService,
  type BackgroundRuntimeClock,
} from "./backgroundRuntimeService";

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

test("creates idle service", () => {
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 2,
    stop_on_blocker: true,
    stop_on_error: true,
    operator_away_mode: true,
    require_supervised_scope: true,
  });

  assert.equal(service.status, "service_idle");
  assert.equal(service.ticks_attempted, 0);
});

test("starts service and runs bounded ticks", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
  );

  assert.equal(result.status, "service_completed");
  assert.equal(result.service.ticks_attempted, 2);
});

test("invokes time-based runtime trigger", () => {
  const result = runBackgroundRuntimeTick(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    "2026-04-25T10:10:00.000Z",
  );

  assert.equal(result.tick_result?.triggered, true);
  assert.equal(result.service.last_trigger_result?.status, "trigger_completed");
});

test("records tick history", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
  );

  assert.equal(result.service.tick_history.length, 2);
});

test("stops at max_ticks_per_run", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 1,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z"]),
  );

  assert.equal(result.service.stop_reason, "max_ticks_reached");
  assert.equal(result.service.ticks_attempted, 1);
});

test("stops on blocker when configured", () => {
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

  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    queue,
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z"]),
  );

  assert.equal(result.status, "service_blocked");
  assert.equal(result.service.stop_reason, "blocker_detected");
});

test("continues on skipped trigger without failing", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:10:30.000Z"]),
  );

  assert.equal(result.service.tick_history[1].status, "trigger_skipped");
  assert.equal(result.status, "service_completed");
});

test("uses deterministic clock in tests", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 2,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z", "2026-04-25T10:11:00.000Z"]),
  );

  assert.equal(result.service.last_tick_at, "2026-04-25T10:11:00.000Z");
});

test("produces readable service summary", () => {
  const result = startBackgroundRuntimeService(
    createBackgroundRuntimeService({
      tick_interval_ms: 60_000,
      max_ticks_per_run: 1,
      stop_on_blocker: true,
      stop_on_error: true,
      operator_away_mode: true,
      require_supervised_scope: true,
    }),
    createQueue(),
    createBackgroundRunHistory(),
    createClock(["2026-04-25T10:10:00.000Z"]),
  );
  const summary = summarizeBackgroundRuntimeService(result.service);

  assert.match(summary, /Service status:/);
  assert.match(summary, /Ticks attempted:/);
  assert.match(summary, /Stop reason:/);
});

test("no side effects beyond returned service state", () => {
  const queue = createQueue();
  const history = createBackgroundRunHistory();
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 1,
    stop_on_blocker: true,
    stop_on_error: true,
    operator_away_mode: true,
    require_supervised_scope: true,
  });

  const result = startBackgroundRuntimeService(
    service,
    queue,
    history,
    createClock(["2026-04-25T10:10:00.000Z"]),
  );
  const stopped = stopBackgroundRuntimeService(result.service, "operator_stopped");

  assert.equal(service.tick_history.length, 0);
  assert.equal(queue.sessions.length, 2);
  assert.equal(history.records.length, 0);
  assert.equal(stopped.status, "service_stopped");
});
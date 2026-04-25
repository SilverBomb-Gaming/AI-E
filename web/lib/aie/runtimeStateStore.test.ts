import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundRuntimeService,
  stopBackgroundRuntimeService,
  type BackgroundRuntimeClock,
} from "./backgroundRuntimeService";
import { createBackgroundRunHistory } from "./backgroundRunHistory";
import {
  createBackgroundSessionQueue,
  enqueueBackgroundSession,
} from "./backgroundSessionQueue";
import { createAutonomousWorkSession } from "./autonomousWorkSession";
import {
  createRuntimeStateStore,
  evaluateBootResume,
  loadRuntimeState,
  saveRuntimeState,
  summarizeBootResume,
} from "./runtimeStateStore";
import { runBackgroundRuntimeEntrypoint } from "./runtimeEntrypoint";

function createSession(goal: string) {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-25T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-25T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-25T14:00:00.000Z",
    maxCycles: 4,
    chainInput: {
      maxSteps: 1,
      requestedSteps: [{
        title: goal,
        plannerReadyRequest: goal,
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
  return enqueueBackgroundSession(
    createBackgroundSessionQueue({
      max_sessions_per_run: 1,
      max_cycles_per_session: 1,
      skip_blocked_sessions: false,
      stop_on_first_failure: true,
      operator_away_mode: false,
      require_fresh_approvals: true,
      require_fresh_context: true,
    }),
    createSession("Resume AI-E runtime safely"),
  );
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

function createStoppedService() {
  const service = createBackgroundRuntimeService({
    tick_interval_ms: 60_000,
    max_ticks_per_run: 3,
    max_runs_per_invocation: 1,
    operator_away_mode: false,
    require_fresh_approvals: true,
    require_fresh_context: true,
  });
  return stopBackgroundRuntimeService({
    ...service,
    started_at: "2026-04-25T10:00:00.000Z",
    stopped_at: "2026-04-25T10:01:00.000Z",
    last_tick_at: "2026-04-25T10:01:00.000Z",
    status: "service_completed",
    ticks_attempted: 1,
    ticks_completed: 1,
  }, "max_ticks_reached");
}

test("creates empty state store", () => {
  const store = createRuntimeStateStore();

  assert.deepEqual(store.records, {});
  assert.equal(store.stale_after_ms > 0, true);
});

test("saves runtime state", () => {
  const store = createRuntimeStateStore();
  const service = createStoppedService();
  const record = saveRuntimeState(store, service, "local_supervised");

  assert.equal(record.runtime_id, service.service_id);
  assert.equal(record.profile_name, "local_supervised");
  assert.equal(typeof store.records[service.service_id], "string");
});

test("loads runtime state", () => {
  const store = createRuntimeStateStore();
  const service = createStoppedService();
  saveRuntimeState(store, service, "local_supervised");

  const record = loadRuntimeState(store, service.service_id);

  assert.equal(record?.runtime_id, service.service_id);
  assert.equal(record?.last_status, "service_stopped");
});

test("no prior state returns no_prior_state", () => {
  const result = evaluateBootResume(createRuntimeStateStore(), "missing-runtime", "2026-04-25T10:05:00.000Z");

  assert.equal(result.status, "no_prior_state");
});

test("corrupt state returns state_corrupt", () => {
  const store = createRuntimeStateStore({
    records: {
      corrupt: "{not-valid-json",
    },
  });

  const result = evaluateBootResume(store, "corrupt", "2026-04-25T10:05:00.000Z");

  assert.equal(result.status, "state_corrupt");
});

test("stale state requires review", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 60_000 });
  const service = createStoppedService();
  saveRuntimeState(store, service, "local_supervised");

  const result = evaluateBootResume(store, service.service_id, "2026-04-25T10:05:00.000Z");

  assert.equal(result.status, "resume_requires_review");
});

test("fresh stopped state is resume_ready", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const service = createStoppedService();
  saveRuntimeState(store, service, "local_supervised");

  const result = evaluateBootResume(store, service.service_id, "2026-04-25T10:05:00.000Z");

  assert.equal(result.status, "resume_ready");
});

test("blocked prior state remains resume_blocked", () => {
  const store = createRuntimeStateStore();
  const service = {
    ...createStoppedService(),
    status: "service_blocked" as const,
    stop_reason: "blocker_detected" as const,
    blockers: [{ code: "freshness_blocked", message: "Approvals are stale." }],
  };
  saveRuntimeState(store, service, "operator_away_safe");

  const result = evaluateBootResume(store, service.service_id, "2026-04-25T10:02:00.000Z");

  assert.equal(result.status, "resume_blocked");
});

test("deterministic summary", () => {
  const store = createRuntimeStateStore();
  const service = createStoppedService();
  saveRuntimeState(store, service, "local_supervised");

  const first = summarizeBootResume(evaluateBootResume(store, service.service_id, "2026-04-25T10:02:00.000Z"));
  const second = summarizeBootResume(evaluateBootResume(store, service.service_id, "2026-04-25T10:02:00.000Z"));

  assert.equal(first, second);
});

test("integrates with runtime entrypoint config/profile if clean", () => {
  const store = createRuntimeStateStore({ stale_after_ms: 10 * 60 * 1000 });
  const previousService = createStoppedService();
  saveRuntimeState(store, previousService, "local_supervised");

  const result = runBackgroundRuntimeEntrypoint(
    {
      profile_name: "local_supervised",
      tick_interval_ms: 60_000,
      max_ticks_per_run: 3,
      max_runs_per_invocation: 1,
      started_at: "2026-04-25T10:02:00.000Z",
    },
    {
      runtime_state_store: store,
      queue: createQueue(),
      history: createBackgroundRunHistory(),
      clock: createClock([
        "2026-04-25T10:02:00.000Z",
        "2026-04-25T10:03:00.000Z",
        "2026-04-25T10:04:00.000Z",
      ]),
    },
  );

  assert.equal(result.boot_resume.status, "resume_ready");
  assert.equal(result.config.profile_name, "local_supervised");
  assert.equal(result.status, "entrypoint_completed");
});
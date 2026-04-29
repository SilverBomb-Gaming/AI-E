import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutonomousSessionRecord,
  createAutonomousSessionRegistry,
} from "./autonomousSessionRegistry";
import {
  createMultiSessionSchedulerState,
  recordAutonomousSessionTick,
  scheduleNextAutonomousSession,
  summarizeMultiSessionScheduler,
} from "./multiSessionScheduler";

function createSession(input: {
  session_id: string;
  session_type: "feature" | "bugfix" | "refactor" | "experiment";
  priority?: "critical" | "high" | "medium" | "low";
  status?: "pending" | "running" | "paused" | "blocked" | "completed" | "failed";
  start_time?: string;
  last_tick?: string | null;
  max_tick_budget?: number;
}) {
  return createAutonomousSessionRecord({
    session_id: input.session_id,
    runtime_id: "runtime-test",
    session_type: input.session_type,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    start_time: input.start_time ?? "2026-04-29T10:00:00.000Z",
    last_tick: input.last_tick ?? null,
    max_tick_budget: input.max_tick_budget ?? 4,
    max_chain_budget: 2,
  });
}

test("weighted fair scheduler gives high priority sessions more ticks without starving lower priority work", () => {
  const registry = createAutonomousSessionRegistry({
    runtime_id: "runtime-test",
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", priority: "high" }),
      createSession({ session_id: "bugfix-b", session_type: "bugfix", priority: "low" }),
    ],
  });

  let schedulerState = createMultiSessionSchedulerState({ global_tick_budget: 6 });
  const selections: string[] = [];

  for (let index = 0; index < 6; index += 1) {
    const result = scheduleNextAutonomousSession(registry, schedulerState);
    assert.equal(result.status, "session_selected");
    selections.push(result.selected_session?.session_id ?? "none");
    schedulerState = recordAutonomousSessionTick(schedulerState, result.selected_session?.session_id ?? "");
  }

  assert.ok(selections.filter((sessionId) => sessionId === "feature-a").length > selections.filter((sessionId) => sessionId === "bugfix-b").length);
  assert.ok(selections.includes("bugfix-b"));
});

test("session tick budget exhaustion removes the session from scheduling", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "feature-a", session_type: "feature", priority: "high", max_tick_budget: 1 }),
      createSession({ session_id: "bugfix-b", session_type: "bugfix", priority: "medium", max_tick_budget: 3 }),
    ],
  });

  let schedulerState = createMultiSessionSchedulerState({ global_tick_budget: 4 });
  const first = scheduleNextAutonomousSession(registry, schedulerState);
  assert.equal(first.selected_session?.session_id, "feature-a");

  schedulerState = recordAutonomousSessionTick(schedulerState, "feature-a");

  const second = scheduleNextAutonomousSession(registry, schedulerState);
  assert.equal(second.selected_session?.session_id, "bugfix-b");
  assert.equal(second.skipped_sessions.some((session) => session.session_id === "feature-a" && session.reason === "session_tick_budget_exhausted"), true);
});

test("global tick budget exhaustion blocks further scheduling", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [createSession({ session_id: "feature-a", session_type: "feature", priority: "critical" })],
  });

  const result = scheduleNextAutonomousSession(
    registry,
    createMultiSessionSchedulerState({ global_tick_budget: 1, global_ticks_consumed: 1 }),
  );

  assert.equal(result.status, "no_runnable_sessions");
  assert.match(result.reason, /global multi-session tick budget is exhausted/i);
});

test("non-runnable sessions are skipped deterministically", () => {
  const registry = createAutonomousSessionRegistry({
    sessions: [
      createSession({ session_id: "completed-a", session_type: "feature", status: "completed" }),
      createSession({ session_id: "blocked-b", session_type: "bugfix", status: "blocked" }),
      createSession({ session_id: "pending-c", session_type: "experiment", priority: "medium" }),
    ],
  });

  const result = scheduleNextAutonomousSession(registry, createMultiSessionSchedulerState({ global_tick_budget: 3 }));

  assert.equal(result.status, "session_selected");
  assert.equal(result.selected_session?.session_id, "pending-c");
  assert.deepEqual(result.skipped_sessions.map((session) => session.session_id), ["blocked-b", "completed-a"]);
  assert.match(summarizeMultiSessionScheduler(result), /Multi-session scheduler status:/);
});
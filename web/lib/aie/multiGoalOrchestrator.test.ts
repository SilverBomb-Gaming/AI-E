import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoalQueue,
  createGoalRecord,
  createGoalRecordFromSession,
  createGoalQueue as createQueue,
  scheduleNextGoal,
  summarizeGoalScheduler,
} from "./multiGoalOrchestrator";
import { createAutonomousWorkSession } from "./autonomousWorkSession";

function createGoal(input: Partial<ReturnType<typeof createGoalRecord>> & { id: string; description: string }) {
  return createGoalRecord({
    id: input.id,
    description: input.description,
    priority: input.priority ?? "medium",
    status: input.status ?? "pending",
    created_at: input.created_at ?? "2026-04-26T10:00:00.000Z",
    last_updated_at: input.last_updated_at ?? input.created_at ?? "2026-04-26T10:00:00.000Z",
    conflicts_with_goal_ids: input.conflicts_with_goal_ids ?? [],
  });
}

function createSession(goal: string, status?: "session_planned" | "session_running" | "session_paused" | "session_blocked" | "session_completed") {
  return createAutonomousWorkSession({
    operatorGoal: goal,
    createdAt: "2026-04-26T10:00:00.000Z",
    sessionApproval: true,
    sessionApprovalGrantedAt: "2026-04-26T10:00:00.000Z",
    sessionApprovalExpiresAt: "2026-04-26T14:00:00.000Z",
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

test("multiple goals with different priorities select highest priority first", () => {
  const queue = createGoalQueue([
    createGoal({ id: "low", description: "Low priority goal", priority: "low" }),
    createGoal({ id: "high", description: "High priority goal", priority: "high" }),
    createGoal({ id: "medium", description: "Medium priority goal", priority: "medium" }),
  ]);

  const result = scheduleNextGoal(queue);

  assert.equal(result.status, "goal_selected");
  assert.equal(result.next_goal?.id, "high");
  assert.deepEqual(result.ordered_goals.map((goal) => goal.id), ["high", "medium", "low"]);
});

test("equal priority goals run oldest first", () => {
  const queue = createQueue([
    createGoal({ id: "newer", description: "Newer goal", priority: "medium", created_at: "2026-04-26T10:05:00.000Z" }),
    createGoal({ id: "older", description: "Older goal", priority: "medium", created_at: "2026-04-26T10:00:00.000Z" }),
  ]);

  const result = scheduleNextGoal(queue);

  assert.equal(result.next_goal?.id, "older");
  assert.deepEqual(result.ordered_goals.map((goal) => goal.id), ["older", "newer"]);
});

test("blocked and completed goals are skipped", () => {
  const queue = createQueue([
    createGoal({ id: "blocked", description: "Blocked goal", priority: "high", status: "blocked" }),
    createGoal({ id: "completed", description: "Completed goal", priority: "high", status: "completed" }),
    createGoal({ id: "pending", description: "Pending goal", priority: "medium", status: "pending" }),
  ]);

  const result = scheduleNextGoal(queue);

  assert.equal(result.status, "goal_selected");
  assert.equal(result.next_goal?.id, "pending");
});

test("empty queue returns no work", () => {
  const result = scheduleNextGoal(createQueue());

  assert.equal(result.status, "no_runnable_goals");
  assert.equal(result.next_goal, null);
  assert.match(result.reason, /No goals were queued/i);
});

test("scheduler is deterministic", () => {
  const queue = createQueue([
    createGoal({ id: "one", description: "First goal", priority: "high", created_at: "2026-04-26T10:00:00.000Z" }),
    createGoal({ id: "two", description: "Second goal", priority: "high", created_at: "2026-04-26T10:01:00.000Z" }),
    createGoal({ id: "three", description: "Third goal", priority: "low", created_at: "2026-04-26T10:02:00.000Z" }),
  ]);

  const first = scheduleNextGoal(queue);
  const second = scheduleNextGoal(queue);

  assert.deepEqual(first, second);
  assert.match(summarizeGoalScheduler(first), /Goal orchestration status:/);
});

test("active goal keeps ownership and session mapping is supported", () => {
  const session = {
    ...createSession("Continue OpenClaw session"),
    status: "session_running" as const,
    updated_at: "2026-04-26T10:10:00.000Z",
  };
  const active = createGoalRecordFromSession(session, { priority: "low" });
  const pending = createGoal({ id: "pending", description: "Higher priority pending", priority: "high", status: "pending" });

  const result = scheduleNextGoal(createQueue([pending, active]));

  assert.equal(result.status, "goal_selected");
  assert.equal(result.next_goal?.id, active.id);
  assert.equal(result.next_goal?.status, "active");
});
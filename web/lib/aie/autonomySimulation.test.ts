import assert from "node:assert/strict";
import test from "node:test";

import { getAutonomyPolicy } from "./autonomyPolicy";
import { simulateAutonomousRun } from "./autonomySimulation";
import type { LearningApplicationQueueRecord } from "./learningApplicationQueue";

function createQueueItem(overrides?: Partial<LearningApplicationQueueRecord>): LearningApplicationQueueRecord {
  return {
    queue_id: overrides?.queue_id ?? "queue-1",
    created_at: overrides?.created_at ?? "2026-05-04T12:00:00.000Z",
    recommendation_id: overrides?.recommendation_id ?? `rec-${overrides?.queue_id ?? "queue-1"}`,
    decision_id: overrides?.decision_id ?? `decision-${overrides?.queue_id ?? "queue-1"}`,
    scope: "ranking_weight_adjustment",
    status: overrides?.status ?? "queued",
    applied: overrides?.applied ?? false,
    blocked_reason: overrides?.blocked_reason,
    recommendation_snapshot: overrides?.recommendation_snapshot ?? {
      recommendation_id: `rec-${overrides?.queue_id ?? "queue-1"}`,
      created_at: "2026-05-04T11:59:00.000Z",
      scope: "ranking_weight_adjustment",
      current_value: 0.4,
      proposed_value: 0.3,
      rationale: "test recommendation",
      confidence: 0.9,
      requires_operator_review: true,
      applied: false,
    },
    decision_snapshot: overrides?.decision_snapshot ?? {
      recommendation_id: `rec-${overrides?.queue_id ?? "queue-1"}`,
      operator_decision: "approved_for_future_application",
      decided_at: "2026-05-04T11:59:30.000Z",
      notes: "test decision",
    },
  };
}

test("simulation produces execution plan", () => {
  const queueItems = [
    createQueueItem({ queue_id: "queue-1", created_at: "2026-05-04T12:00:00.000Z" }),
    createQueueItem({ queue_id: "queue-2", created_at: "2026-05-04T12:01:00.000Z", recommendation_snapshot: {
      recommendation_id: "rec-queue-2",
      created_at: "2026-05-04T11:58:00.000Z",
      scope: "ranking_weight_adjustment",
      current_value: 0.4,
      proposed_value: 0.39,
      rationale: "lower-risk recommendation",
      confidence: 0.95,
      requires_operator_review: true,
      applied: false,
    } }),
  ];
  const policy = {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item" as const,
    max_items_per_run: 1,
  };

  const result = simulateAutonomousRun(queueItems, policy);

  assert.equal(result.simulated, true);
  assert.deepEqual(result.execution_plan, ["queue-1"]);
  assert.deepEqual(result.executable_items, ["queue-1"]);
});

test("simulation does not execute anything", () => {
  const result = simulateAutonomousRun([
    createQueueItem({ queue_id: "queue-1" }),
  ], {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item",
    max_items_per_run: 1,
  });

  assert.equal(result.execution_triggered, false);
  assert.equal(result.autonomy_triggered, false);
  assert.ok(result.reasons.includes("simulation only: Layer 29 safety stack would still be required before any real execution"));
});

test("simulation respects policy constraints", () => {
  const result = simulateAutonomousRun([
    createQueueItem({ queue_id: "queue-1" }),
  ], getAutonomyPolicy());

  assert.deepEqual(result.execution_plan, []);
  assert.deepEqual(result.executable_items, []);
  assert.equal(result.blocked_items[0]?.reason, "autonomy disabled");
});

test("simulation blocks items correctly", () => {
  const result = simulateAutonomousRun([
    createQueueItem({ queue_id: "queue-1" }),
    createQueueItem({ queue_id: "queue-2", status: "blocked", blocked_reason: "learning disabled globally" }),
  ], {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item",
    max_items_per_run: 1,
  });

  assert.ok(result.blocked_items.some((item) => item.queue_id === "queue-2" && item.reason === "learning disabled globally"));
});

test("simulation does not mutate queue", () => {
  const queueItems = [
    createQueueItem({ queue_id: "queue-1" }),
    createQueueItem({ queue_id: "queue-2" }),
  ];
  const before = structuredClone(queueItems);

  void simulateAutonomousRun(queueItems, {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item",
    max_items_per_run: 1,
  });

  assert.deepEqual(queueItems, before);
});

test("simulation respects max_items_per_run equals one", () => {
  const result = simulateAutonomousRun([
    createQueueItem({ queue_id: "queue-1" }),
    createQueueItem({ queue_id: "queue-2" }),
  ], {
    ...getAutonomyPolicy(),
    autonomy_enabled: true,
    allowed_lane: "single_queued_learning_item",
    max_items_per_run: 1,
  });

  assert.equal(result.executable_items.length, 1);
  assert.ok(result.blocked_items.some((item) => item.reason === "max_items_per_run limit reached (1)"));
});

test("simulation returns empty executable list when autonomy disabled", () => {
  const result = simulateAutonomousRun([
    createQueueItem({ queue_id: "queue-1" }),
  ], getAutonomyPolicy());

  assert.deepEqual(result.executable_items, []);
  assert.ok(result.reasons.includes("autonomy disabled"));
});